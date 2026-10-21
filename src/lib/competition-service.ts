import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { db } from './db';
import { AppError, assertPermission, can, type Actor, type PermissionKey } from './permissions';
import { inheritedRules } from './gameplay-scoring';
import { matchRulesSchema } from './match-rules';
import { finalizedQualifierSeeds } from './qualifier-standings-service';
import {
  competitionStoredConfigSchema,
  remapCompetitionConfig,
  remapCompetitionSeedOrder,
} from './competition-archive';
export { remapCompetitionConfig, remapCompetitionSeedOrder } from './competition-archive';
import {
  competitionActionSchema,
  type CompetitionAction,
  type CompetitionCreate,
} from './competition-validation';
import {
  competitionChanges,
  competitionEliminated,
  competitionOrder,
  generateCompetition,
  groupStandings,
  recalculateCompetition,
} from './competition-engine';
import type {
  CompetitionBracketData,
  CompetitionData,
  CompetitionNode,
  CompetitionOptions,
  CompetitionRound,
} from './competition-types';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const matchSelect = {
  id: true,
  code: true,
  status: true,
  teamAId: true,
  teamBId: true,
  scoreA: true,
  scoreB: true,
  winnerSide: true,
  version: true,
  startedAt: true,
  scheduledAt: true,
  published: true,
};
const include = {
  rounds: { orderBy: { position: 'asc' as const } },
  entries: {
    orderBy: { seed: 'asc' as const },
    include: { team: { select: { id: true, name: true, slug: true } } },
  },
  nodes: {
    orderBy: { position: 'asc' as const },
    include: { slots: { orderBy: { side: 'asc' as const } }, match: { select: matchSelect } },
  },
};
function tenant(actor: Actor) {
  if (actor.tournamentId === 'none') throw new AppError('Select a tournament before continuing.');
  return actor.tournamentId || 'main';
}
export function competitionPermission(_action: CompetitionAction): PermissionKey {
  void _action;
  return 'matches.manage';
}
export function assertCompetitionPermission(
  actor: Actor | null,
  action: CompetitionAction,
): asserts actor is Actor {
  assertPermission(actor, competitionPermission(action));
}
function assertView(actor: Actor) {
  if (
    !['matches.manage', 'matches.view_all', 'matches.manage_all'].some((key) =>
      can(actor, key as PermissionKey),
    )
  )
    throw new AppError('Full competition access is not permitted.', 403);
}
async function lock(tx: Prisma.TransactionClient) {
  // Match actions use this same transaction lock, including direct referee mutations.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
}
async function allNodes(
  tx: Prisma.TransactionClient,
  tournamentId: string,
): Promise<CompetitionNode[]> {
  return tx.bracketNode.findMany({
    where: { tournamentId },
    include: { slots: true, match: { select: matchSelect } },
  });
}
async function audit(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  actorId: string | null,
  action: string,
  entityId: string,
  details: unknown,
) {
  await tx.auditLog.create({
    data: {
      tournamentId,
      actorId,
      action,
      entityType: 'Bracket',
      entityId,
      details: json(details),
    },
  });
}
type GroupConfig = {
  advancePerGroup?: number;
  groupTieOrder?: string[];
  groupTieSourceHash?: string;
  sourceBracketId?: string;
  groupSource?: {
    bracketId: string;
    sourceHash: string;
    seeds: { teamId: string; seed: number }[];
  };
};
function groupResultsHash(
  bracketId: string,
  nodes: CompetitionNode[],
  rounds: CompetitionRound[],
  count: number,
) {
  return createHash('sha256')
    .update(
      stable({
        bracketId,
        count,
        rounds: rounds.map((r) => [r.id, r.lane]).sort(),
        nodes: nodes
          .filter((n) => n.bracketId === bracketId)
          .map((n) => ({
            id: n.id,
            slots: [...n.slots]
              .sort((a, b) => a.side.localeCompare(b.side))
              .map((s) => [s.side, s.teamId, s.resolved]),
            result: n.match
              ? [n.match.status, n.match.winnerSide, n.match.scoreA, n.match.scoreB]
              : null,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      }),
    )
    .digest('hex');
}
function reviewedGroupOrder(
  bracket: { id: string; config: Prisma.JsonValue; rounds: CompetitionRound[] },
  nodes: CompetitionNode[],
) {
  const config = bracket.config as GroupConfig;
  return config.groupTieSourceHash ===
    groupResultsHash(bracket.id, nodes, bracket.rounds, config.advancePerGroup || 2)
    ? config.groupTieOrder || []
    : [];
}
function resolvedGroupSeeds(
  bracket: {
    id: string;
    format: string;
    config: Prisma.JsonValue;
    rounds: CompetitionRound[];
    entries: { teamId: string; seed: number; status: string }[];
  },
  nodes: CompetitionNode[],
) {
  if (bracket.format !== 'GROUPS') throw new AppError('Choose a group-stage competition.');
  const path = nodes.filter((n) => n.bracketId === bracket.id),
    config = bracket.config as GroupConfig;
  if (
    !path.length ||
    !path.every(
      (n) =>
        n.state === 'BYE' ||
        n.state === 'SKIPPED' ||
        (n.match?.status === 'COMPLETED' && n.match.winnerSide),
    )
  )
    throw new AppError(
      'Complete and confirm every group fixture before generating downstream brackets.',
      409,
    );
  const order = reviewedGroupOrder(bracket, path);
  const rows = groupStandings(
    path,
    bracket.rounds,
    bracket.entries,
    config.advancePerGroup || 2,
    order,
  );
  if (rows.some((r) => r.tied))
    throw new AppError(
      'Review and resolve tied group standings before generating a downstream bracket.',
      409,
    );
  const seeds = rows
    .filter(
      (r) => r.qualified && bracket.entries.find((e) => e.teamId === r.teamId)?.status === 'ACTIVE',
    )
    .sort((a, b) => a.rank - b.rank || a.group.localeCompare(b.group, 'en', { numeric: true }))
    .map((r, index) => ({ teamId: r.teamId, seed: index + 1 }));
  const sourceHash = createHash('sha256')
    .update(
      stable({
        results: groupResultsHash(bracket.id, path, bracket.rounds, config.advancePerGroup || 2),
        order,
        seeds,
      }),
    )
    .digest('hex');
  return { seeds, sourceHash };
}
export async function finalizedGroupSeeds(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  bracketId: string,
) {
  const bracket = await tx.bracket.findFirst({
    where: { id: bracketId, tournamentId },
    include: { rounds: true, entries: true },
  });
  if (!bracket) throw new AppError('Source groups not found.', 404);
  return resolvedGroupSeeds(bracket, recalculateCompetition(await allNodes(tx, tournamentId)));
}
export type CompetitionArchiveWitness = {
  brackets: Record<string, unknown>[];
  bracketRounds: Record<string, unknown>[];
  bracketNodes: Record<string, unknown>[];
  bracketSlots: Record<string, unknown>[];
  bracketEntries: Record<string, unknown>[];
  matches: Record<string, unknown>[];
};
function archiveCompetition(witness: CompetitionArchiveWitness) {
  const id = z.string().min(1);
  const rounds = witness.bracketRounds.map((row) =>
    z
      .object({
        id,
        bracketId: id,
        key: id,
        name: z.string(),
        lane: z.string(),
        stageId: id,
        position: z.number().int(),
      })
      .parse(row),
  );
  const entries = witness.bracketEntries.map((row) =>
    z
      .object({ bracketId: id, teamId: id, seed: z.number().int().positive(), status: z.string() })
      .parse(row),
  );
  const slots = witness.bracketSlots.map((row) =>
    z
      .object({
        nodeId: id,
        side: z.enum(['A', 'B']),
        teamId: id.nullable(),
        resolved: z.boolean(),
        mode: z.string(),
        sourceNodeId: id.nullable(),
        outcome: z.string().nullable(),
      })
      .parse(row),
  );
  const matches = witness.matches.map((row) =>
    z
      .object({
        id,
        code: id,
        status: z.string(),
        teamAId: id.nullable(),
        teamBId: id.nullable(),
        scoreA: z.number().int(),
        scoreB: z.number().int(),
        winnerSide: z.enum(['A', 'B']).nullable(),
        version: z.number().int(),
      })
      .parse(row),
  );
  const nodes = recalculateCompetition(
    witness.bracketNodes.map((row) => {
      const node = z
        .object({
          id,
          bracketId: id,
          roundId: id,
          key: id,
          position: z.number().int(),
          state: z.string(),
          matchId: id.nullable(),
        })
        .parse(row);
      const match = matches.find((match) => match.id === node.matchId) || null,
        assigned = slots.filter((slot) => slot.nodeId === node.id);
      if (assigned.length !== 2 || new Set(assigned.map((slot) => slot.side)).size !== 2)
        throw new AppError('Archived competition nodes require two distinct slots.');
      if (node.matchId && !match) throw new AppError('Archived competition match not found.');
      if (
        match &&
        assigned.some((slot) => slot.teamId !== (slot.side === 'A' ? match.teamAId : match.teamBId))
      )
        throw new AppError(
          'Archived bracket participants do not match their native match snapshots.',
        );
      return { ...node, slots: assigned, match };
    }),
  );
  const brackets = witness.brackets.map((row) => {
    const bracket = z
      .object({ id, format: z.string(), config: z.unknown(), seedOrder: z.array(id) })
      .parse(row);
    const config = competitionStoredConfigSchema.parse(bracket.config);
    if (stable(bracket.seedOrder) !== stable(config.teamIds))
      throw new AppError('Archived bracket seeds differ from their immutable creation snapshot.');
    return {
      ...bracket,
      config: json(config) as Prisma.JsonValue,
      rounds: rounds.filter((round) => round.bracketId === bracket.id),
      entries: entries.filter((entry) => entry.bracketId === bracket.id),
    };
  });
  return { brackets, nodes };
}
export function validateCompetitionArchive(witness: CompetitionArchiveWitness) {
  const { brackets, nodes } = archiveCompetition(witness),
    byId = new Map(brackets.map((bracket) => [bracket.id, bracket]));
  for (const bracket of brackets) {
    const config = competitionStoredConfigSchema.parse(bracket.config);
    if (config.groupTieOrder || config.groupTieSourceHash || config.groupTieReason) {
      if (
        !config.groupTieOrder ||
        !config.groupTieReason ||
        !config.groupTieSourceHash ||
        new Set(config.groupTieOrder).size !== config.groupTieOrder.length ||
        stable([...config.groupTieOrder].sort()) !==
          stable(bracket.entries.map((entry) => entry.teamId).sort()) ||
        config.groupTieSourceHash !==
          groupResultsHash(bracket.id, nodes, bracket.rounds, config.advancePerGroup)
      )
        throw new AppError(
          'Archived group tiebreak approval does not reproduce its source results.',
        );
    }
    if (config.sourceBracketId || config.groupSource) {
      const source = byId.get(config.sourceBracketId || '');
      if (!source || config.groupSource?.bracketId !== source.id)
        throw new AppError('Archived group seed source is missing or inconsistent.');
      const result = resolvedGroupSeeds(source, nodes);
      if (stable(config.groupSource) !== stable({ bracketId: source.id, ...result }))
        throw new AppError('Archived frozen group seeds do not reproduce their reviewed source.');
      const selected = result.seeds
        .filter((seed) => config.teamIds.includes(seed.teamId))
        .map((seed) => seed.teamId);
      if (stable(selected) !== stable(config.teamIds))
        throw new AppError('Archived bracket contains ineligible or reordered group seeds.');
    }
  }
  for (const bracket of brackets) {
    const seen = new Set<string>();
    let current: typeof bracket | undefined = bracket;
    while (current) {
      if (seen.has(current.id))
        throw new AppError('Archived competition seeding sources contain a cycle.');
      seen.add(current.id);
      const sourceId: string | undefined = (current.config as GroupConfig).sourceBracketId;
      current = sourceId ? byId.get(sourceId) : undefined;
    }
  }
}
// Export localization changes the hash namespace. Verify the old witness and every mapped
// competitive field before rebinding only the two ID-dependent provenance hashes.
export function rebindLocalizedCompetition(
  originalWitness: CompetitionArchiveWitness,
  localizedWitness: CompetitionArchiveWitness,
  ids: ReadonlyMap<string, string>,
) {
  validateCompetitionArchive(originalWitness);
  const expectedWitness = structuredClone(originalWitness);
  for (const table of Object.values(expectedWitness))
    for (const row of table) {
      for (const [field, value] of Object.entries(row))
        if (/^(?:id|.*Id)$/.test(field) && typeof value === 'string' && ids.has(value))
          row[field] = ids.get(value)!;
    }
  for (let index = 0; index < expectedWitness.brackets.length; index++) {
    const original = originalWitness.brackets[index],
      expected = expectedWitness.brackets[index];
    expected.config = remapCompetitionConfig(original.config, ids);
    expected.seedOrder = remapCompetitionSeedOrder(original.seedOrder, ids);
  }
  const expected = archiveCompetition(expectedWitness),
    localized = archiveCompetition(localizedWitness);
  const canonical = (snapshot: ReturnType<typeof archiveCompetition>) => ({
    brackets: snapshot.brackets
      .map((bracket) => ({
        ...bracket,
        rounds: [...bracket.rounds].sort((a, b) => a.id.localeCompare(b.id)),
        entries: [...bracket.entries].sort((a, b) => a.teamId.localeCompare(b.teamId)),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    nodes: snapshot.nodes
      .map((node) => ({
        ...node,
        slots: [...node.slots].sort((a, b) => a.side.localeCompare(b.side)),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
  if (stable(canonical(expected)) !== stable(canonical(localized)))
    throw new AppError(
      'Localized competition results, reviewed ties, seeds or identity references differ from the original witness.',
    );
  const report = { reboundGroups: 0, reboundSources: 0 };
  const saveConfig = (bracket: (typeof localized.brackets)[number], config: unknown) => {
    bracket.config = json(config) as Prisma.JsonValue;
    localizedWitness.brackets.find((row) => row.id === bracket.id)!.config = json(config);
  };
  for (const bracket of localized.brackets) {
    const config = competitionStoredConfigSchema.parse(bracket.config);
    if (!config.groupTieOrder) continue;
    saveConfig(bracket, {
      ...config,
      groupTieSourceHash: groupResultsHash(
        bracket.id,
        localized.nodes,
        bracket.rounds,
        config.advancePerGroup,
      ),
    });
    report.reboundGroups++;
  }
  for (const bracket of localized.brackets) {
    const config = competitionStoredConfigSchema.parse(bracket.config);
    if (!config.groupSource) continue;
    const source = localized.brackets.find((candidate) => candidate.id === config.sourceBracketId);
    if (!source) throw new AppError('Localized group seed source is missing.');
    const fresh = resolvedGroupSeeds(source, localized.nodes);
    if (stable(fresh.seeds) !== stable(config.groupSource.seeds))
      throw new AppError('Localized groups do not reproduce the original qualified seeds.');
    saveConfig(bracket, {
      ...config,
      groupSource: { ...config.groupSource, sourceHash: fresh.sourceHash },
    });
    report.reboundSources++;
  }
  validateCompetitionArchive(localizedWitness);
  return report;
}
// Validate the original-ID witness before rebinding hashes. No results, participants, or seeds are rewritten.
export async function rebindImportedCompetition(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  witness: CompetitionArchiveWitness,
  ids: ReadonlyMap<string, string>,
) {
  validateCompetitionArchive(witness);
  const original = archiveCompetition(witness),
    imported = await tx.bracket.findMany({
      where: { tournamentId },
      include: { rounds: true, entries: true },
    }),
    nodes = recalculateCompetition(await allNodes(tx, tournamentId));
  const mappedId = (id: string) => {
    const result = ids.get(id);
    if (!result) throw new AppError('Competition archive identity remapping is incomplete.');
    return result;
  };
  const mappedNodes = original.nodes.map((node) => ({
    ...node,
    id: mappedId(node.id),
    bracketId: mappedId(node.bracketId),
    roundId: mappedId(node.roundId),
    matchId: node.matchId ? mappedId(node.matchId) : null,
    slots: node.slots.map((slot) => ({
      ...slot,
      teamId: slot.teamId ? mappedId(slot.teamId) : null,
      sourceNodeId: slot.sourceNodeId ? mappedId(slot.sourceNodeId) : null,
    })),
    match: node.match
      ? {
          ...node.match,
          id: mappedId(node.match.id),
          teamAId: node.match.teamAId ? mappedId(node.match.teamAId) : null,
          teamBId: node.match.teamBId ? mappedId(node.match.teamBId) : null,
        }
      : null,
  }));
  const report = { reboundGroups: 0, reboundSources: 0 };
  for (const old of original.brackets) {
    const current = imported.find((bracket) => bracket.id === mappedId(old.id));
    if (!current) throw new AppError('Imported competition bracket is missing.');
    const expected = remapCompetitionConfig(old.config, ids),
      config = competitionStoredConfigSchema.parse(current.config);
    if (
      stable(competitionActionSchema.options[0].parse(expected)) !==
        stable(competitionActionSchema.options[0].parse(config)) ||
      stable(current.seedOrder) !== stable(remapCompetitionSeedOrder(old.seedOrder, ids))
    )
      throw new AppError(
        'Imported competition configuration or frozen seed order was not remapped correctly.',
      );
    if (expected.groupTieOrder) {
      const expectedRounds = old.rounds.map((round) => ({
        ...round,
        id: mappedId(round.id),
        stageId: mappedId(round.stageId),
      }));
      const fresh = groupResultsHash(current.id, nodes, current.rounds, config.advancePerGroup);
      if (
        stable(config.groupTieOrder) !== stable(expected.groupTieOrder) ||
        fresh !== groupResultsHash(current.id, mappedNodes, expectedRounds, config.advancePerGroup)
      )
        throw new AppError(
          'Imported group results or reviewed tiebreak order differ from the original archive.',
        );
      current.config = json({ ...config, groupTieSourceHash: fresh }) as Prisma.JsonValue;
      await tx.bracket.updateMany({
        where: { id: current.id, tournamentId },
        data: { config: json(current.config) },
      });
      report.reboundGroups++;
    }
  }
  for (const old of original.brackets) {
    const expected = remapCompetitionConfig(old.config, ids);
    if (!expected.groupSource) continue;
    const current = imported.find((bracket) => bracket.id === mappedId(old.id))!,
      config = competitionStoredConfigSchema.parse(current.config),
      source = imported.find((bracket) => bracket.id === expected.sourceBracketId);
    if (!source || config.groupSource?.bracketId !== source.id)
      throw new AppError('Imported group seed source was not remapped correctly.');
    const fresh = resolvedGroupSeeds(source, nodes);
    if (
      stable(fresh.seeds) !== stable(expected.groupSource.seeds) ||
      stable(config.groupSource.seeds) !== stable(expected.groupSource.seeds)
    )
      throw new AppError('Imported source groups do not reproduce the archived frozen seeds.');
    await tx.bracket.updateMany({
      where: { id: current.id, tournamentId },
      data: {
        config: json({
          ...config,
          groupSource: { ...config.groupSource, sourceHash: fresh.sourceHash },
          groupImportProvenance: {
            originalSourceHash: expected.groupSource.sourceHash,
            reboundSourceHash: fresh.sourceHash,
          },
        }),
      },
    });
    report.reboundSources++;
  }
  return report;
}
function withStandings<T extends CompetitionBracketData & { config: Prisma.JsonValue }>(
  bracket: T,
): T & Pick<CompetitionBracketData, 'standings'> {
  const config = bracket.config as { advancePerGroup?: number };
  return {
    ...bracket,
    standings: groupStandings(
      bracket.nodes,
      bracket.rounds,
      bracket.entries,
      config.advancePerGroup || 2,
      reviewedGroupOrder(bracket, bracket.nodes),
    ),
  };
}
export async function competitionOptions(actor: Actor): Promise<CompetitionOptions> {
  assertPermission(actor, 'matches.manage');
  const tournamentId = tenant(actor);
  const [stages, teams, standings, groups, nodes] = await Promise.all([
    db.tournamentStage.findMany({
      where: { tournamentId, archivedAt: null, kind: { notIn: ['QUALIFIERS', 'QUALIFIER'] } },
      orderBy: { position: 'asc' },
      include: { mappool: { select: { state: true, publishedRevisionId: true } } },
    }),
    db.team.findMany({
      where: { tournamentId, status: 'APPROVED' },
      orderBy: [{ seed: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
      select: { id: true, name: true, seed: true },
    }),
    db.qualifierStanding.findMany({
      where: { tournamentId },
      orderBy: [{ stageId: 'asc' }, { version: 'desc' }],
      select: { id: true, stageId: true, version: true, snapshot: true },
    }),
    db.bracket.findMany({
      where: { tournamentId, format: 'GROUPS' },
      include: { rounds: true, entries: true },
      orderBy: { createdAt: 'asc' },
    }),
    allNodes(db, tournamentId),
  ]);
  return {
    stages: stages.map((s) => ({
      id: s.id,
      name: s.name,
      ready: s.mappool?.state === 'PUBLISHED' && !!s.mappool.publishedRevisionId,
    })),
    teams,
    standings,
    groupSources: groups.flatMap((group) => {
      try {
        return [
          {
            id: group.id,
            name: group.name,
            ...resolvedGroupSeeds(group, recalculateCompetition(nodes)),
          },
        ];
      } catch (error) {
        if (error instanceof AppError) return [];
        throw error;
      }
    }),
  };
}
export async function competitionData(actor: Actor): Promise<CompetitionData> {
  assertView(actor);
  const tournamentId = tenant(actor);
  const [brackets, options] = await Promise.all([
    db.bracket.findMany({ where: { tournamentId }, include, orderBy: { createdAt: 'asc' } }),
    can(actor, 'matches.manage') ? competitionOptions(actor) : null,
  ]);
  return { brackets: brackets.map(withStandings), options };
}
export async function publicCompetitionData(
  tournamentId: string,
): Promise<CompetitionBracketData[]> {
  const tournament = await db.tournament.findFirst({
    where: { id: tournamentId, published: true, archivedAt: null },
    select: { id: true },
  });
  if (!tournament) return [];
  const brackets = await db.bracket.findMany({
    where: { tournamentId, published: true },
    include,
    orderBy: { createdAt: 'asc' },
  });
  // Publish only the explicit read model, never configuration, seed provenance, rosters, or audit data.
  return brackets.map((b) => {
    const data = withStandings(b);
    return {
      id: b.id,
      name: b.name,
      format: b.format,
      version: b.version,
      published: true,
      rounds: b.rounds,
      entries: b.entries,
      standings: data.standings,
      nodes: b.nodes.map((n) => ({
        id: n.id,
        bracketId: n.bracketId,
        roundId: n.roundId,
        key: n.key,
        position: n.position,
        state: n.state,
        matchId: n.match?.published ? n.matchId : null,
        slots: n.slots.map((s) => ({
          side: s.side,
          teamId: s.teamId,
          resolved: s.resolved,
          mode: s.mode,
          sourceNodeId: s.sourceNodeId,
          outcome: s.outcome,
        })),
        match: n.match?.published ? n.match : null,
      })),
    };
  });
}
async function checkedPlan(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  a: CompetitionCreate | Extract<CompetitionAction, { type: 'competition.preview' }>,
) {
  const stages = await tx.tournamentStage.findMany({
    where: {
      tournamentId,
      id: { in: [...new Set([a.stageId, ...Object.values(a.roundStages)])] },
      archivedAt: null,
      kind: { notIn: ['QUALIFIERS', 'QUALIFIER'] },
    },
  });
  if (stages.length !== new Set([a.stageId, ...Object.values(a.roundStages)]).size)
    throw new AppError('Choose valid, active head-to-head stages from this tournament.');
  const teams = await tx.team.findMany({
    where: { tournamentId, id: { in: a.teamIds }, status: 'APPROVED' },
    include: { members: { select: { substitute: true } } },
  });
  if (teams.length !== a.teamIds.length)
    throw new AppError('All seeds must be different approved participants in this tournament.');
  const settings = await tx.tournamentSettings.findUniqueOrThrow({ where: { tournamentId } });
  for (const stage of stages) {
    const rules = inheritedRules(stage.matchRules || settings.matchRules, settings.gameplayScoring);
    if (
      teams.some(
        (team) =>
          team.members.filter((member) => !member.substitute).length < rules.teamSize ||
          (team.format === 'INDIVIDUAL' && rules.teamSize !== 1),
      )
    )
      throw new AppError(`Participants need sufficient starting players for ${stage.name}.`);
  }
  if (a.sourceStandingId) {
    if (a.sourceBracketId) throw new AppError('Choose a single seeding source.');
    const rows = await finalizedQualifierSeeds(tx, tournamentId, a.sourceStandingId);
    if (!a.teamIds.every((id) => rows.some((r) => r.teamId === id)))
      throw new AppError('Selected participants must be within the finalized qualifier cutoff.');
    const order = [...a.teamIds].sort(
      (a, b) => rows.find((r) => r.teamId === a)!.seed - rows.find((r) => r.teamId === b)!.seed,
    );
    if (order.some((id, index) => id !== a.teamIds[index]))
      throw new AppError('Preserve finalized seed order when generating this bracket.');
  }
  const plan = await generateCompetition(a);
  if (a.sourceBracketId) {
    const source = await finalizedGroupSeeds(tx, tournamentId, a.sourceBracketId);
    if (!a.teamIds.every((id) => source.seeds.some((s) => s.teamId === id)))
      throw new AppError(
        'Only qualified participants from the completed source groups may enter this path.',
      );
    const order = source.seeds.filter((s) => a.teamIds.includes(s.teamId)).map((s) => s.teamId);
    if (order.some((id, index) => id !== a.teamIds[index]))
      throw new AppError('Preserve the reviewed group seed order.');
    return { ...plan, groupSource: { bracketId: a.sourceBracketId, ...source } };
  }
  return { ...plan, groupSource: undefined };
}
async function snapshotTeams(tx: Prisma.TransactionClient, tournamentId: string, ids: string[]) {
  const teams = await tx.team.findMany({
    where: { tournamentId, id: { in: ids } },
    include: { members: { orderBy: { position: 'asc' }, include: { participant: true } } },
  });
  return new Map(
    teams.map((team) => [
      team.id,
      {
        id: team.id,
        name: team.name,
        slug: team.slug,
        format: team.format,
        logoImageId: team.logoImageId,
        members: team.members.map((m) => ({
          osuId: m.osuId,
          username: m.registeredUsername || m.participant.username,
          avatarUrl: m.participant.avatarUrl,
          captain: m.captain,
          substitute: m.substitute,
        })),
      },
    ]),
  );
}
const pending = {
  id: null,
  name: 'Pending',
  slug: '',
  format: 'TEAM',
  logoImageId: null,
  members: [],
};
async function persistRecalculation(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  before: CompetitionNode[],
  after: CompetitionNode[],
  actorId: string | null,
  approveCorrections: boolean,
) {
  const changes = competitionChanges(before, after);
  if (changes.some((c) => c.protected))
    throw new AppError(
      `Started or completed downstream matches require manual reconciliation: ${changes
        .filter((c) => c.protected)
        .map((c) => c.code)
        .join(', ')}.`,
      409,
    );
  if (changes.length && !approveCorrections)
    throw new AppError(
      `Review and approve changed downstream fixtures: ${changes.map((c) => c.code).join(', ')}.`,
      409,
    );
  const snapshots = await snapshotTeams(tx, tournamentId, [
    ...new Set(after.flatMap((n) => n.slots.flatMap((s) => (s.teamId ? [s.teamId] : [])))),
  ]);
  const settings = await tx.tournamentSettings.findUniqueOrThrow({ where: { tournamentId } });
  const tournament = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
  const brackets = await tx.bracket.findMany({
    where: { tournamentId },
    select: { id: true, name: true, published: true },
  });
  const rounds = await tx.bracketRound.findMany({
    where: { tournamentId },
    include: {
      stage: { include: { mappool: { select: { publishedRevisionId: true, state: true } } } },
    },
  });
  const entries = await tx.bracketEntry.findMany({ where: { tournamentId } });
  const changedBrackets = new Set<string>();
  for (const node of competitionOrder(after)) {
    const old = before.find((n) => n.id === node.id)!;
    const a = node.slots.find((s) => s.side === 'A')!,
      b = node.slots.find((s) => s.side === 'B')!;
    for (const slot of node.slots)
      if (slot.mode === 'AUTO' && slot.sourceNodeId && slot.teamId) {
        if (
          !entries.some(
            (entry) => entry.bracketId === node.bracketId && entry.teamId === slot.teamId,
          )
        )
          throw new AppError(
            'Automatic progression cannot introduce a participant outside the target competition path. Review the target cohort or make an explicit manual override.',
            409,
          );
      }
    let changed = old.state !== node.state;
    for (const slot of node.slots) {
      const prev = old.slots.find((s) => s.side === slot.side)!;
      if (prev.teamId !== slot.teamId || prev.resolved !== slot.resolved) {
        await tx.bracketSlot.updateMany({
          where: { nodeId: node.id, side: slot.side, tournamentId, mode: 'AUTO' },
          data: { teamId: slot.teamId, resolved: slot.resolved },
        });
        changed = true;
      }
    }
    if (node.match && (node.match.teamAId !== a.teamId || node.match.teamBId !== b.teamId)) {
      if (node.match.status !== 'SCHEDULED' || node.match.startedAt)
        throw new AppError(
          `Match ${node.match.code} has started; participants cannot be replaced.`,
          409,
        );
      const updated = await tx.match.updateMany({
        where: {
          id: node.match.id,
          tournamentId,
          version: node.match.version,
          status: 'SCHEDULED',
          startedAt: null,
        },
        data: {
          teamAId: a.teamId,
          teamBId: b.teamId,
          participants: json({
            A: a.teamId ? snapshots.get(a.teamId) : pending,
            B: b.teamId ? snapshots.get(b.teamId) : pending,
          }),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1)
        throw new AppError('A downstream match changed. Reload before continuing.', 409);
      await tx.matchEvent.create({
        data: {
          matchId: node.match.id,
          version: node.match.version + 1,
          actorId,
          kind: 'competition.assignment',
          data: json({ A: a.teamId, B: b.teamId }),
        },
      });
      changed = true;
    }
    if (!node.matchId && node.state === 'READY') {
      const round = rounds.find((r) => r.id === node.roundId)!,
        bracket = brackets.find((b) => b.id === node.bracketId)!;
      const rules = matchRulesSchema.parse({
        ...inheritedRules(round.stage.matchRules || settings.matchRules, settings.gameplayScoring),
        gameMode: tournament.gameMode,
      });
      const match = await tx.match.create({
        data: {
          tournamentId,
          code: `B-${node.id}`,
          stageId: round.stageId,
          teamAId: a.teamId,
          teamBId: b.teamId,
          poolRevisionId:
            round.stage.mappool?.state === 'PUBLISHED'
              ? round.stage.mappool.publishedRevisionId
              : null,
          rules: json(rules),
          participants: json({ A: snapshots.get(a.teamId!)!, B: snapshots.get(b.teamId!)! }),
          bracket: `${bracket.name} / ${round.name}`,
          published: bracket.published,
          events: {
            create: {
              version: 1,
              actorId,
              kind: 'competition.match.create',
              data: json({ bracketId: bracket.id, nodeId: node.id }),
            },
          },
        },
      });
      node.matchId = match.id;
      changed = true;
    }
    if (changed) {
      await tx.bracketNode.updateMany({
        where: { id: node.id, tournamentId },
        data: { state: node.state, matchId: node.matchId },
      });
      changedBrackets.add(node.bracketId);
    }
  }
  for (const id of changedBrackets)
    await tx.bracket.updateMany({
      where: { id, tournamentId },
      data: { version: { increment: 1 } },
    });
  return changes;
}
export async function applyCompetitionAction(
  tx: Prisma.TransactionClient,
  actor: Actor,
  raw: CompetitionAction,
): Promise<unknown> {
  const a = competitionActionSchema.parse(raw),
    tournamentId = tenant(actor);
  assertCompetitionPermission(actor, a);
  await lock(tx);
  if (a.type === 'competition.preview') return checkedPlan(tx, tournamentId, a);
  if (a.type === 'competition.create') {
    const existing = await tx.bracket.findFirst({
      where: { tournamentId, generationKey: a.generationKey },
    });
    if (existing) {
      if (stable(competitionActionSchema.options[0].parse(existing.config)) !== stable(a))
        throw new AppError(
          'This generation key has already been used for a different bracket.',
          409,
        );
      return { id: existing.id, version: existing.version };
    }
    const plan = await checkedPlan(tx, tournamentId, a);
    const bracket = await tx.bracket.create({
      data: {
        tournamentId,
        generationKey: a.generationKey,
        name: a.name,
        format: a.format,
        config: json({ ...a, ...(plan.groupSource ? { groupSource: plan.groupSource } : {}) }),
        seedOrder: json(a.teamIds),
        sourceStandingId: a.sourceStandingId,
      },
    });
    await tx.bracketEntry.createMany({
      data: a.teamIds.map((teamId, index) => ({
        tournamentId,
        bracketId: bracket.id,
        teamId,
        seed: index + 1,
      })),
    });
    const rounds = new Map<string, string>(),
      nodes = new Map<string, string>();
    for (const round of plan.rounds)
      rounds.set(
        round.key,
        (await tx.bracketRound.create({ data: { ...round, tournamentId, bracketId: bracket.id } }))
          .id,
      );
    for (const node of plan.nodes)
      nodes.set(
        node.key,
        (
          await tx.bracketNode.create({
            data: {
              tournamentId,
              bracketId: bracket.id,
              roundId: rounds.get(node.roundKey)!,
              key: node.key,
              position: node.position,
            },
          })
        ).id,
      );
    for (const node of plan.nodes)
      for (const { sourceKey, ...slot } of node.slots)
        await tx.bracketSlot.create({
          data: {
            ...slot,
            tournamentId,
            nodeId: nodes.get(node.key)!,
            sourceNodeId: sourceKey ? nodes.get(sourceKey)! : null,
          },
        });
    const before = await allNodes(tx, tournamentId);
    await persistRecalculation(
      tx,
      tournamentId,
      before,
      recalculateCompetition(before),
      actor.id,
      true,
    );
    await audit(tx, tournamentId, actor.id, a.type, bracket.id, a);
    return tx.bracket.findFirstOrThrow({
      where: { id: bracket.id, tournamentId },
      select: { id: true, version: true },
    });
  }
  const bracket = await tx.bracket.findFirst({ where: { id: a.id, tournamentId } });
  if (!bracket) throw new AppError('Bracket not found.', 404);
  const updated = await tx.bracket.updateMany({
    where: { id: a.id, tournamentId, version: a.baseVersion },
    data: { version: { increment: 1 } },
  });
  if (updated.count !== 1) throw new AppError('The bracket changed. Reload before saving.', 409);
  if (a.type === 'competition.publish') {
    await tx.bracket.updateMany({
      where: { id: a.id, tournamentId },
      data: { published: a.published },
    });
    await tx.match.updateMany({
      where: { tournamentId, bracketNode: { bracketId: a.id, tournamentId } },
      data: { published: a.published },
    });
  } else if (a.type === 'competition.group.resolve') {
    if (bracket.format !== 'GROUPS') throw new AppError('Choose a group-stage competition.');
    const entries = await tx.bracketEntry.findMany({ where: { tournamentId, bracketId: a.id } });
    if (
      new Set(a.tieOrder).size !== a.tieOrder.length ||
      a.tieOrder.length !== entries.length ||
      !a.tieOrder.every((id) => entries.some((entry) => entry.teamId === id))
    )
      throw new AppError('The reviewed order must contain every group participant exactly once.');
    const nodes = recalculateCompetition(await allNodes(tx, tournamentId)).filter(
      (n) => n.bracketId === a.id,
    );
    if (
      !nodes.every(
        (n) =>
          n.state === 'BYE' ||
          n.state === 'SKIPPED' ||
          (n.match?.status === 'COMPLETED' && n.match.winnerSide),
      )
    )
      throw new AppError('Confirm every group fixture before resolving group standings.', 409);
    const rounds = await tx.bracketRound.findMany({ where: { tournamentId, bracketId: a.id } });
    const config = bracket.config as Record<string, Prisma.JsonValue>;
    await tx.bracket.updateMany({
      where: { id: a.id, tournamentId },
      data: {
        config: json({
          ...config,
          groupTieOrder: a.tieOrder,
          groupTieReason: a.reason,
          groupTieSourceHash: groupResultsHash(
            a.id,
            nodes,
            rounds,
            (config.advancePerGroup as number) || 2,
          ),
        }),
      },
    });
  } else if (a.type === 'competition.entry') {
    const entry = await tx.bracketEntry.findFirst({
      where: { tournamentId, bracketId: a.id, teamId: a.teamId },
    });
    if (!entry) throw new AppError('Participant is not in this bracket.');
    await tx.bracketEntry.updateMany({
      where: { tournamentId, bracketId: a.id, teamId: a.teamId },
      data: { status: a.status },
    });
  } else {
    const before = await allNodes(tx, tournamentId);
    if (a.type === 'competition.slot' || a.type === 'competition.route') {
      const node = before.find((n) => n.id === a.nodeId && n.bracketId === a.id);
      if (!node) throw new AppError('Bracket position not found.', 404);
      if (node.match && (node.match.status !== 'SCHEDULED' || node.match.startedAt))
        throw new AppError('Started match positions cannot be changed.', 409);
      const slot = node.slots.find((s) => s.side === a.side)!;
      if (a.type === 'competition.route') {
        if (slot.mode === 'LOCKED')
          throw new AppError('Unlock this position before changing its progression.', 409);
        if (!!a.sourceNodeId !== !!a.outcome)
          throw new AppError('Choose both a source match and an outcome.');
        if (a.sourceNodeId && !before.some((n) => n.id === a.sourceNodeId))
          throw new AppError('Progression source not found.', 404);
        Object.assign(slot, {
          sourceNodeId: a.sourceNodeId,
          outcome: a.outcome,
          mode: 'AUTO',
          teamId: null,
          resolved: !a.sourceNodeId,
        });
      } else {
        if (a.mode !== 'AUTO' && a.teamId) {
          const team = await tx.team.findFirst({
            where: { id: a.teamId, tournamentId, status: 'APPROVED' },
          });
          if (!team) throw new AppError('Choose an approved participant from this tournament.');
          await assertCompetitionEligibility(tx, actor, {
            bracketId: a.id,
            teamId: a.teamId,
            allowIneligible: a.allowIneligible,
            reason: a.reason,
            ignoreNodeId: node.id,
          });
          if (
            !(await tx.bracketEntry.findFirst({
              where: { bracketId: a.id, teamId: a.teamId, tournamentId },
            }))
          ) {
            const aggregate = await tx.bracketEntry.aggregate({
              where: { bracketId: a.id, tournamentId },
              _max: { seed: true },
            });
            await tx.bracketEntry.create({
              data: {
                tournamentId,
                bracketId: a.id,
                teamId: a.teamId,
                seed: (aggregate._max.seed || 0) + 1,
              },
            });
          }
        }
        if (a.mode === 'AUTO' && !slot.sourceNodeId) {
          const plan = await generateCompetition(
            competitionActionSchema.options[0].parse(bracket.config),
          );
          const original = plan.nodes
            .find((n) => n.key === node.key)
            ?.slots.find((s) => s.side === a.side);
          if (!original) throw new AppError('Original seed position unavailable.');
          Object.assign(slot, {
            teamId: original.teamId,
            resolved: original.resolved,
            mode: 'AUTO',
          });
        } else
          Object.assign(slot, {
            mode: a.mode,
            ...(a.mode === 'AUTO' ? {} : { teamId: a.teamId, resolved: true }),
          });
      }
      competitionOrder(before);
      await tx.bracketSlot.updateMany({
        where: { nodeId: node.id, side: slot.side, tournamentId },
        data: {
          sourceNodeId: slot.sourceNodeId,
          outcome: slot.outcome,
          mode: slot.mode,
          teamId: slot.teamId,
          resolved: slot.resolved,
        },
      });
    }
    const current = await allNodes(tx, tournamentId),
      after = recalculateCompetition(current);
    await persistRecalculation(
      tx,
      tournamentId,
      before,
      after,
      actor.id,
      a.type !== 'competition.sync' || a.approveCorrections,
    );
  }
  await audit(tx, tournamentId, actor.id, a.type, a.id, a);
  return tx.bracket.findFirstOrThrow({
    where: { id: a.id, tournamentId },
    select: { id: true, version: true },
  });
}
export async function advanceConfirmedCompetitionResult(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  matchId: string,
  actorId?: string,
) {
  await lock(tx);
  const match = await tx.match.findFirst({
    where: { id: matchId, tournamentId },
    select: {
      status: true,
      winnerSide: true,
      bracketNode: { select: { id: true, bracketId: true } },
    },
  });
  if (!match?.bracketNode || match.status !== 'COMPLETED' || !match.winnerSide) return;
  const before = await allNodes(tx, tournamentId);
  await persistRecalculation(
    tx,
    tournamentId,
    before,
    recalculateCompetition(before),
    actorId || null,
    true,
  );
  await audit(
    tx,
    tournamentId,
    actorId || null,
    'competition.advance',
    match.bracketNode.bracketId,
    { matchId },
  );
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export async function synchronizeCompetitionResults(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  actorId?: string,
) {
  await lock(tx);
  const before = await allNodes(tx, tournamentId);
  return persistRecalculation(
    tx,
    tournamentId,
    before,
    recalculateCompetition(before),
    actorId || null,
    true,
  );
}
export async function assertCompetitionMatchStart(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  matchId: string,
) {
  await lock(tx);
  const nodes = await allNodes(tx, tournamentId),
    node = nodes.find((n) => n.matchId === matchId);
  if (!node) return;
  const bracket = await tx.bracket.findFirstOrThrow({
    where: { id: node.bracketId, tournamentId },
  });
  if (bracket.sourceStandingId) {
    const seeds = await finalizedQualifierSeeds(tx, tournamentId, bracket.sourceStandingId);
    const selected = bracket.seedOrder as string[];
    const current = seeds
      .filter((seed) => selected.includes(seed.teamId))
      .map((seed) => seed.teamId);
    if (stable(current) !== stable(selected))
      throw new AppError(
        'Finalized qualifier seeds no longer match this frozen bracket. Review the source standings before starting; automatic reseeding is disabled.',
        409,
      );
  }
  const provenance = (bracket.config as GroupConfig).groupSource;
  if (
    provenance &&
    (await finalizedGroupSeeds(tx, tournamentId, provenance.bracketId)).sourceHash !==
      provenance.sourceHash
  )
    throw new AppError(
      'Source group standings changed. Review the frozen downstream seeds before starting; automatic reseeding is disabled.',
      409,
    );
  const computed = recalculateCompetition(nodes).find((n) => n.id === node.id)!;
  if (
    computed.state !== 'READY' ||
    !node.match ||
    computed.slots.some(
      (s) =>
        !s.resolved ||
        !s.teamId ||
        s.teamId !== (s.side === 'A' ? node.match!.teamAId : node.match!.teamBId),
    )
  )
    throw new AppError(
      'This bracket match is awaiting confirmed participants. Refresh progression before starting.',
      409,
    );
  const match = await tx.match.findFirstOrThrow({
    where: { id: matchId, tournamentId },
    select: { rules: true, participants: true },
  });
  const rules = matchRulesSchema.parse(match.rules);
  const snapshot = z.object({
    format: z.string(),
    members: z.array(z.object({ substitute: z.boolean() })),
  });
  const participants = z.object({ A: snapshot, B: snapshot }).parse(match.participants);
  if (
    Object.values(participants).some(
      (team) =>
        team.members.filter((member) => !member.substitute).length < rules.teamSize ||
        (team.format === 'INDIVIDUAL' && rules.teamSize !== 1),
    )
  )
    throw new AppError('The frozen match rosters do not satisfy the configured team size.', 409);
  if (
    (await tx.team.count({
      where: { tournamentId, id: { in: computed.slots.map((s) => s.teamId!) }, status: 'APPROVED' },
    })) !== 2
  )
    throw new AppError('Both bracket participants must still have approved registrations.', 409);
  for (const slot of computed.slots) {
    const entry = await tx.bracketEntry.findFirst({
      where: { tournamentId, bracketId: node.bracketId, teamId: slot.teamId! },
    });
    if (entry && entry.status !== 'ACTIVE')
      throw new AppError('A participant has withdrawn or been disqualified from this path.', 409);
  }
}
export async function previewCompetitionCorrection(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  matchId: string,
  proposedWinnerSide: 'A' | 'B' | null,
) {
  const before = (await allNodes(tx, tournamentId)).sort((a, b) => a.id.localeCompare(b.id)),
    target = before.find((n) => n.matchId === matchId);
  if (!target?.match) return { affected: [], blocked: false, hash: '', seededBrackets: [] };
  const seededBrackets = await tx.bracket.findMany({
    where: { tournamentId, config: { path: ['sourceBracketId'], equals: target.bracketId } },
    select: { id: true, name: true, version: true },
  });
  const simulated = structuredClone(before),
    current = simulated.find((n) => n.id === target.id)!;
  current.match!.winnerSide = proposedWinnerSide;
  current.match!.status = proposedWinnerSide ? 'COMPLETED' : 'SCHEDULED';
  const affected = competitionChanges(before, recalculateCompetition(simulated)).sort((a, b) =>
    a.nodeId.localeCompare(b.nodeId),
  );
  return {
    affected,
    seededBrackets,
    blocked: affected.some((c) => c.protected) || seededBrackets.length > 0,
    hash: createHash('sha256')
      .update(
        JSON.stringify({
          matchId,
          proposedWinnerSide,
          affected,
          seededBrackets: [...seededBrackets].sort((a, b) => a.id.localeCompare(b.id)),
          versions: before.map((n) => [n.id, n.match?.version]),
        }),
      )
      .digest('hex'),
  };
}
export async function assertCompetitionResultCorrection(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  matchId: string,
  proposedWinnerSide: 'A' | 'B' | null,
  approveCorrections = false,
) {
  await lock(tx);
  const preview = await previewCompetitionCorrection(tx, tournamentId, matchId, proposedWinnerSide);
  if (preview.seededBrackets.length)
    throw new AppError(
      'These group standings have frozen downstream seed snapshots. Review and reconcile those brackets before correcting the source groups.',
      409,
    );
  if (preview.blocked)
    throw new AppError(
      'This correction would change participants in started or completed downstream matches. Reconcile those matches first.',
      409,
    );
  if (preview.affected.length && !approveCorrections)
    throw new AppError(
      'Review the downstream correction impact and explicitly approve it before saving.',
      409,
    );
  return preview;
}
export async function competitionEligibility(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  bracketId: string,
  teamId: string,
  ignoreNodeId?: string,
) {
  const bracket = await tx.bracket.findFirst({
    where: { id: bracketId, tournamentId },
    include: { entries: true, rounds: true },
  });
  if (!bracket) throw new AppError('Competition path not found.', 404);
  const entry = bracket.entries.find((e) => e.teamId === teamId);
  if (
    !entry ||
    ((bracket.sourceStandingId || (bracket.config as GroupConfig).sourceBracketId) &&
      !(bracket.seedOrder as string[]).includes(teamId))
  )
    return { eligible: false, reason: 'Participant is outside this path or qualifier cutoff.' };
  if (entry.status !== 'ACTIVE')
    return {
      eligible: false,
      reason: `Participant is ${entry.status.toLowerCase()} in this path.`,
    };
  const nodes = await allNodes(tx, tournamentId),
    path = recalculateCompetition(nodes).filter((n) => n.bracketId === bracketId);
  if (bracket.format === 'GROUPS') {
    const standings = groupStandings(
      path,
      bracket.rounds,
      bracket.entries,
      (bracket.config as { advancePerGroup?: number }).advancePerGroup || 2,
      reviewedGroupOrder(bracket, path),
    );
    const row = standings.find((r) => r.teamId === teamId);
    if (
      row &&
      standings
        .filter((r) => r.group === row.group)
        .every((r) => r.played === standings.filter((s) => s.group === row.group).length - 1) &&
      !row.qualified &&
      !row.tied
    )
      return { eligible: false, reason: 'Participant did not qualify from this group.' };
  } else if (competitionEliminated(path, bracket.rounds, bracket.format, teamId))
    return { eligible: false, reason: 'Participant is eliminated from this competition path.' };
  if (
    ignoreNodeId &&
    path.some(
      (n) =>
        n.id !== ignoreNodeId &&
        n.state === 'READY' &&
        n.match?.status !== 'COMPLETED' &&
        n.slots.some((s) => s.teamId === teamId),
    )
  )
    return { eligible: false, reason: 'Participant already occupies another active position.' };
  return { eligible: true, reason: '' };
}
export async function assertCompetitionEligibility(
  tx: Prisma.TransactionClient,
  actor: Actor,
  options: {
    bracketId: string;
    teamId: string;
    allowIneligible?: boolean;
    reason?: string;
    ignoreNodeId?: string;
  },
) {
  const tournamentId = tenant(actor),
    result = await competitionEligibility(
      tx,
      tournamentId,
      options.bracketId,
      options.teamId,
      options.ignoreNodeId,
    );
  if (result.eligible) return;
  if (!options.allowIneligible) throw new AppError(result.reason, 409);
  assertPermission(actor, 'matches.manage');
  if (!options.reason || options.reason.trim().length < 3)
    throw new AppError('An intentional eligibility override requires a reason.');
  await audit(tx, tournamentId, actor.id, 'competition.eligibility.override', options.bracketId, {
    ...options,
    originalReason: result.reason,
  });
}
export async function competitionEligibilityOptions(actor: Actor): Promise<
  {
    id: string;
    name: string;
    stageIds: string[];
    teams: { teamId: string; eligible: boolean; reason: string }[];
  }[]
> {
  assertPermission(actor, 'matches.manage');
  const tournamentId = tenant(actor);
  const [brackets, teams, nodes] = await Promise.all([
    db.bracket.findMany({
      where: { tournamentId },
      include: { entries: true, rounds: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.team.findMany({ where: { tournamentId, status: 'APPROVED' }, select: { id: true } }),
    allNodes(db, tournamentId),
  ]);
  const computed = recalculateCompetition(nodes);
  return brackets.map((bracket) => {
    const path = computed.filter((n) => n.bracketId === bracket.id);
    const standings = groupStandings(
      path,
      bracket.rounds,
      bracket.entries,
      (bracket.config as { advancePerGroup?: number }).advancePerGroup || 2,
      reviewedGroupOrder(bracket, path),
    );
    return {
      id: bracket.id,
      name: bracket.name,
      stageIds: [...new Set(bracket.rounds.map((r) => r.stageId))],
      teams: teams.map((team) => {
        const entry = bracket.entries.find((e) => e.teamId === team.id);
        let reason =
          !entry ||
          ((bracket.sourceStandingId || (bracket.config as GroupConfig).sourceBracketId) &&
            !(bracket.seedOrder as string[]).includes(team.id))
            ? 'Participant is outside this path or qualifier cutoff.'
            : entry.status !== 'ACTIVE'
              ? `Participant is ${entry.status.toLowerCase()} in this path.`
              : '';
        if (!reason && competitionEliminated(path, bracket.rounds, bracket.format, team.id))
          reason = 'Participant is eliminated from this competition path.';
        const standing = standings.find((s) => s.teamId === team.id);
        if (
          !reason &&
          standing &&
          standings
            .filter((s) => s.group === standing.group)
            .every(
              (s) => s.played === standings.filter((r) => r.group === standing.group).length - 1,
            ) &&
          !standing.qualified &&
          !standing.tied
        )
          reason = 'Participant did not qualify from this group.';
        return { teamId: team.id, eligible: !reason, reason };
      }),
    };
  });
}
