import { advancedSlot, assertPhaseSourcesCurrent, consumersOfBracket } from './format-guards';
import { Prisma } from '@/generated/prisma/client';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { competitionStoredConfigSchema } from './competition-archive';
import {
  competitionChanges,
  competitionEliminated,
  competitionOrder,
  generateCompetition,
  groupStandings,
  recalculateCompetition,
  type CompetitionPlan,
} from './competition-engine';
import {
  GroupConfig,
  groupResultsHash,
  resolvedGroupSeeds,
  reviewedGroupOrder,
  stable,
} from './competition-groups';
import { allNodes, tenant } from './competition-queries';
import type {
  CompetitionNode,
  CompetitionLifecyclePreview,
  CompetitionGenerationPreview,
} from './competition-types';
import { orderedCompetitionStages, suggestedCompetitionStages } from './competition-stages';
import {
  competitionActionSchema,
  type CompetitionAction,
  type CompetitionCreate,
} from './competition-validation';
import { inheritedRules } from './gameplay-scoring';
import {
  allocateMatchNumber,
  reserveBracketMatchNumbers,
  numberBracketNodes,
  bracketNumberingOrder,
} from './match-numbering';
import { matchRulesSchema } from './match-rules';
import { AppError, assertPermission, type Actor, type PermissionKey } from './permissions';
import { finalizedQualifierSeeds } from './qualifier-standings-service';
import { assertScheduleAvailability } from './schedule-availability';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export function competitionPermission(action: CompetitionAction): PermissionKey {
  return action.type === 'competition.delete' ||
    (action.type === 'competition.lifecycle.preview' && action.operation === 'delete')
    ? 'matches.delete'
    : 'matches.manage';
}
export function assertCompetitionPermission(
  actor: Actor | null,
  action: CompetitionAction,
): asserts actor is Actor {
  assertPermission(actor, competitionPermission(action));
  assertPermission(actor, 'matches.manage');
}
async function lock(tx: Prisma.TransactionClient) {
  // Match actions use this same transaction lock, including direct referee mutations.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
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
async function checkedPlan(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  a: CompetitionCreate | Extract<CompetitionAction, { type: 'competition.preview' }>,
) {
  const availableStages = orderedCompetitionStages(
    await tx.tournamentStage.findMany({
      where: {
        tournamentId,
        archivedAt: null,
        kind: { notIn: ['QUALIFIERS', 'QUALIFIER'] },
      },
    }),
  );
  if (
    [a.stageId, ...Object.values(a.roundStages)].some(
      (id) => !availableStages.some((stage) => stage.id === id),
    )
  )
    throw new AppError('Choose valid, active head-to-head stages from this tournament.');
  const plan = await generateCompetition(a, availableStages);
  if (Object.keys(a.roundStages).some((key) => !plan.rounds.some((round) => round.key === key)))
    throw new AppError('Choose stage overrides for rounds in this bracket.');
  const stageRank = new Map(availableStages.map((stage, index) => [stage.id, index]));
  const roundRank = new Map(plan.rounds.map((round) => [round.key, stageRank.get(round.stageId)!]));
  const nodeRank = new Map(plan.nodes.map((node) => [node.key, roundRank.get(node.roundKey)!]));
  if (
    plan.nodes.some((node) =>
      node.slots.some(
        (slot) => slot.sourceKey && nodeRank.get(slot.sourceKey)! > nodeRank.get(node.key)!,
      ),
    )
  )
    throw new AppError(
      'A round cannot use a stage before its feeder round. Review the stage assignments.',
    );
  const usedIds = new Set([a.stageId, ...plan.rounds.map((round) => round.stageId)]);
  const stages = availableStages.filter((stage) => usedIds.has(stage.id));
  const teams = await tx.team.findMany({
    where: { tournamentId, id: { in: a.teamIds }, status: 'APPROVED', supersededAt: null },
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
      throw new AppError('Participants need sufficient starting players for {0}.', 400, [
        stage.name,
      ]);
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
  let groupSource;
  if (a.sourceBracketId) {
    const source = await finalizedGroupSeeds(tx, tournamentId, a.sourceBracketId);
    if (!a.teamIds.every((id) => source.seeds.some((s) => s.teamId === id)))
      throw new AppError(
        'Only qualified participants from the completed source groups may enter this path.',
      );
    const order = source.seeds.filter((s) => a.teamIds.includes(s.teamId)).map((s) => s.teamId);
    if (order.some((id, index) => id !== a.teamIds[index]))
      throw new AppError('Preserve the reviewed group seed order.');
    groupSource = { bracketId: a.sourceBracketId, ...source };
  }
  return {
    ...plan,
    groupSource,
    availableStages,
    witness: { stages, gameplayScoring: settings.gameplayScoring, matchRules: settings.matchRules },
  };
}

function generationPreview(
  plan: CompetitionPlan & {
    groupSource?: unknown;
    availableStages: { id: string; name: string; position: number }[];
    witness: unknown;
  },
  input: CompetitionCreate | Extract<CompetitionAction, { type: 'competition.preview' }>,
  sequence: number,
): CompetitionGenerationPreview {
  const ranks = new Map(plan.availableStages.map((stage, index) => [stage.id, index]));
  const suggested = suggestedCompetitionStages(plan.rounds, input.stageId, plan.availableStages);
  const rounds = plan.rounds.map((round) => ({
    ...round,
    id: round.key,
    stagePosition: ranks.get(round.stageId)!,
  }));
  const nodes = recalculateCompetition(
    plan.nodes.map((node) => ({
      ...node,
      id: node.key,
      bracketId: 'preview',
      roundId: node.roundKey,
      state: 'WAITING',
      matchNumber: null,
      matchId: null,
      match: null,
      slots: node.slots.map(({ sourceKey, ...slot }) => ({ ...slot, sourceNodeId: sourceKey })),
    })),
  );
  const assignments = input.manualMatches
    ? new Map<string, number>()
    : numberBracketNodes(
        nodes.filter((node) => !['BYE', 'SKIPPED'].includes(node.state)),
        rounds,
        sequence + 1,
      );
  const orderedRounds = bracketNumberingOrder(
    rounds.map((round) => ({
      id: round.key,
      bracketId: 'preview',
      roundId: round.key,
      key: round.key,
      position: 0,
      state: 'READY',
    })),
    rounds,
  );
  const ranges = orderedRounds.map(({ key }) => {
    const round = rounds.find((round) => round.key === key)!;
    const numbers = nodes
      .filter((node) => node.roundId === key)
      .flatMap((node) => {
        const number = assignments.get(node.id);
        return number ? [number] : [];
      });
    return {
      roundKey: key,
      stageId: round.stageId,
      stageName: plan.availableStages.find((stage) => stage.id === round.stageId)!.name,
      suggestedStageId: suggested[key],
      suggestedStageName: plan.availableStages.find((stage) => stage.id === suggested[key])!.name,
      firstMatchNumber: numbers.length ? Math.min(...numbers) : null,
      lastMatchNumber: numbers.length ? Math.max(...numbers) : null,
      matchCount: numbers.length,
    };
  });
  const { reviewHash: _review, ...request } = {
    ...input,
    type: 'competition.create',
  } as CompetitionCreate;
  const reviewHash = createHash('sha256')
    .update(
      stable({
        request,
        sequence: input.manualMatches ? null : sequence,
        rounds: plan.rounds,
        nodes: plan.nodes,
        groupSource: plan.groupSource,
        witness: plan.witness,
        stageOrder: plan.availableStages.map((stage) => stage.id),
      }),
    )
    .digest('hex');
  return { rounds: plan.rounds, nodes: plan.nodes, assignments: ranges, reviewHash };
}

function generationRequest(input: CompetitionCreate) {
  const { reviewHash: _review, ...request } = input;
  return request;
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
export async function persistRecalculation(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  before: CompetitionNode[],
  after: CompetitionNode[],
  actorId: string | null,
  approveCorrections: boolean,
  forceNodes: string[] = [],
) {
  const changes = competitionChanges(before, after);
  if (changes.some((c) => c.protected))
    throw new AppError(
      'Started or completed downstream matches require manual reconciliation: {0}.',
      409,
      [
        changes
          .filter((c) => c.protected)
          .map((c) => c.code)
          .join(', '),
      ],
    );
  if (changes.length && !approveCorrections)
    throw new AppError('Review and approve changed downstream fixtures: {0}.', 409, [
      changes.map((c) => c.code).join(', '),
    ]);
  const snapshots = await snapshotTeams(tx, tournamentId, [
    ...new Set(after.flatMap((n) => n.slots.flatMap((s) => (s.teamId ? [s.teamId] : [])))),
  ]);
  const settings = await tx.tournamentSettings.findUniqueOrThrow({ where: { tournamentId } });
  const tournament = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
  const brackets = await tx.bracket.findMany({
    where: { tournamentId },
    select: { id: true, name: true, published: true, config: true },
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
    if (
      node.match &&
      !node.match.deletedAt &&
      (node.match.teamAId !== a.teamId || node.match.teamBId !== b.teamId)
    ) {
      if (node.match.status !== 'SCHEDULED' || node.match.startedAt)
        throw new AppError('Match {0} has started; participants cannot be replaced.', 409, [
          node.match.code,
        ]);
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
    const bracket = brackets.find((b) => b.id === node.bracketId)!;
    const manualMatches = (bracket.config as { manualMatches?: boolean }).manualMatches;
    if (
      !node.matchId &&
      node.state === 'READY' &&
      (!manualMatches || forceNodes.includes(node.id))
    ) {
      const round = rounds.find((r) => r.id === node.roundId)!;
      if (round.stage.archivedAt || ['QUALIFIERS', 'QUALIFIER'].includes(round.stage.kind))
        throw new AppError('Choose an active head-to-head stage.');
      const rules = matchRulesSchema.parse({
        ...inheritedRules(round.stage.matchRules || settings.matchRules, settings.gameplayScoring),
        gameMode: tournament.gameMode,
      });
      for (const teamId of [a.teamId!, b.teamId!]) {
        const snapshot = snapshots.get(teamId);
        if (
          !snapshot ||
          snapshot.members.filter((member) => !member.substitute).length < rules.teamSize ||
          !(await tx.team.count({
            where: { id: teamId, tournamentId, status: 'APPROVED', supersededAt: null },
          }))
        )
          throw new AppError(
            'Bracket participants must have approved registrations and sufficient starting players.',
            409,
          );
      }
      const matchNumber = node.matchNumber ?? (await allocateMatchNumber(tx, tournamentId));
      if (node.matchNumber == null) {
        await tx.bracketNode.updateMany({
          where: { id: node.id, tournamentId, matchNumber: null },
          data: { matchNumber },
        });
        node.matchNumber = matchNumber;
      }
      const match = await tx.match.create({
        data: {
          tournamentId,
          matchNumber,
          code: String(matchNumber),
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
const restoredStatus = z.object({
  before: z.object({
    status: z.enum([
      'SCHEDULED',
      'IN_PROGRESS',
      'AWAITING_CONFIRMATION',
      'COMPLETED',
      'DISPUTED',
      'CANCELLED',
    ]),
  }),
});

// Previews and writes share the global competition lock and the same reviewed witness.
async function lifecyclePlan(
  tx: Prisma.TransactionClient,
  actor: Actor,
  request: {
    id: string;
    baseVersion: number;
    operation: 'delete' | 'regenerate' | 'missing';
    nodeId?: string;
  },
) {
  const tournamentId = tenant(actor);
  const bracket = await tx.bracket.findFirst({ where: { id: request.id, tournamentId } });
  if (!bracket) throw new AppError('Bracket not found.', 404);
  if (bracket.version !== request.baseVersion)
    throw new AppError('The bracket changed. Reload before saving.', 409);
  const counters = await tx.$queryRaw<{ matchNumberSequence: number }[]>`
    SELECT "matchNumberSequence" FROM "Tournament" WHERE "id" = ${tournamentId} FOR UPDATE
  `;
  const before = (await allNodes(tx, tournamentId)).sort((a, b) => a.id.localeCompare(b.id));
  const own = before.filter((node) => node.bracketId === bracket.id);
  const matches = await tx.match.findMany({
    where: { tournamentId, bracketNode: { bracketId: bracket.id } },
    include: {
      assignments: true,
      _count: { select: { actions: true, results: true, revisions: true } },
    },
    orderBy: { matchNumber: 'asc' },
  });
  const reasons: string[] = [];
  const targets =
    request.operation === 'regenerate'
      ? own.filter((node) => node.id === request.nodeId)
      : request.operation === 'missing'
        ? own.filter((node) => !node.matchId)
        : own;
  if (request.operation === 'regenerate' && targets.length !== 1)
    throw new AppError('Bracket position not found.', 404);
  if (
    request.operation === 'missing' &&
    (bracket.config as { manualMatches?: boolean }).manualMatches
  )
    reasons.push('Link existing matches individually in a manual-match bracket.');
  const related = await tx.bracket.findMany({ where: { tournamentId }, orderBy: { id: 'asc' } });
  const dependencies = related.filter(
    (candidate) =>
      candidate.id !== bracket.id &&
      (candidate.config as GroupConfig).sourceBracketId === bracket.id,
  );
  if (request.operation === 'delete') {
    if ((bracket.config as { phaseKey?: string }).phaseKey)
      reasons.push('This bracket belongs to the tournament format. Unlock the format instead.');
    if (dependencies.length)
      reasons.push('Delete dependent brackets before deleting their seed source.');
    if (
      before.some(
        (node) =>
          node.bracketId !== bracket.id &&
          node.slots.some((slot) => own.some((source) => source.id === slot.sourceNodeId)),
      )
    )
      reasons.push('Another active bracket uses progression from this bracket.');
    const external = await tx.match.findFirst({
      where: {
        tournamentId,
        id: { notIn: matches.map((match) => match.id) },
        OR: matches.flatMap((match) => [
          ...(['A', 'B'] as const).flatMap((side) =>
            ['W', 'L'].map((prefix) => ({
              participants: { path: [side, 'name'], equals: `${prefix}${match.code}` },
            })),
          ),
          {
            events: {
              some: { kind: 'match.resolve', data: { path: ['sourceMatchId'], equals: match.id } },
            },
          },
        ]),
      },
      select: { id: true },
    });
    if (external) reasons.push('An external match depends on this bracket.');
    if (
      matches.some(
        (match) =>
          !match.deletedAt &&
          ['IN_PROGRESS', 'AWAITING_CONFIRMATION', 'DISPUTED'].includes(match.status),
      )
    )
      reasons.push('Finish or cancel active matches before deleting this bracket.');
  }
  const requestedMatches =
    request.operation === 'delete'
      ? matches
      : matches.filter((match) => targets.some((node) => node.matchId === match.id));
  const pending = await tx.ircLobbyRequest.findMany({
    where: {
      matchId: { in: requestedMatches.map((match) => match.id) },
      status: { in: ['PENDING', 'UNKNOWN'] },
    },
    select: { id: true, status: true },
  });
  if (pending.length)
    reasons.push('Resolve pending or uncertain lobby creation before changing this bracket.');
  const after = structuredClone(before);
  const restorations: { id: string; status: z.infer<typeof restoredStatus>['before']['status'] }[] =
    [];
  for (const target of request.operation === 'delete' ? [] : targets) {
    const simulated = after.find((node) => node.id === target.id)!;
    if (target.match?.deletedAt) {
      const event = await tx.matchEvent.findFirst({
        where: { matchId: target.match.id, kind: 'match.delete' },
        orderBy: { version: 'desc' },
        select: { data: true },
      });
      const witness = restoredStatus.safeParse(event?.data);
      if (!witness.success) {
        reasons.push('The deleted match has no valid restoration witness. Review its history.');
        continue;
      }
      simulated.match!.deletedAt = null;
      simulated.match!.status = witness.data.before.status;
      restorations.push({ id: target.match.id, status: witness.data.before.status });
    }
  }
  const computed = recalculateCompetition(after);
  for (const restoration of restorations) {
    const node = computed.find((node) => node.matchId === restoration.id)!;
    const match = matches.find((match) => match.id === restoration.id)!;
    if (
      (match.startedAt ||
        match._count.actions ||
        match._count.results ||
        match.scoreA ||
        match.scoreB) &&
      node.slots.some((slot) => slot.teamId !== (slot.side === 'A' ? match.teamAId : match.teamBId))
    )
      reasons.push('Restoring this match would replace participants in recorded history.');
  }
  const affected = request.operation === 'delete' ? [] : competitionChanges(before, computed);
  if (affected.some((change) => change.protected))
    reasons.push('Restoring this match would change started downstream matches.');
  if (restorations.length && dependencies.length)
    reasons.push('Frozen downstream seed snapshots protect this bracket.');
  const settings = await tx.tournamentSettings.findUniqueOrThrow({ where: { tournamentId } });
  const remainingMatches = await tx.match.count({
    where: { tournamentId, id: { notIn: matches.map((match) => match.id) } },
  });
  const remainingReservations = before.filter(
    (node) => node.bracketId !== bracket.id && node.matchNumber != null,
  ).length;
  const stages = await tx.tournamentStage.findMany({
    where: { tournamentId },
    include: { mappool: { select: { state: true, publishedRevisionId: true } } },
    orderBy: { id: 'asc' },
  });
  const preview: CompetitionLifecyclePreview = {
    hash: createHash('sha256')
      .update(
        stable({
          request,
          bracket,
          before,
          matches,
          related,
          pending,
          settings,
          stages,
          counters,
          remainingMatches,
          remainingReservations,
        }),
      )
      .digest('hex'),
    blocked: reasons.length > 0,
    reasons: [...new Set(reasons)],
    matches: requestedMatches.map((match) => ({
      matchNumber: match.matchNumber,
      status: match.status,
    })),
    historical: requestedMatches.filter(
      (match) =>
        match.startedAt ||
        match._count.actions ||
        match._count.results ||
        match.status === 'COMPLETED',
    ).length,
    numberingRestarts: remainingMatches === 0 && remainingReservations === 0,
    affected: affected.map((change) => ({
      matchNumber: change.matchNumber,
      protected: change.protected,
    })),
  };
  return { preview, bracket, before, computed, restorations, matches, targets };
}

async function applyLifecycle(
  tx: Prisma.TransactionClient,
  actor: Actor,
  a: Extract<
    CompetitionAction,
    {
      type:
        | 'competition.lifecycle.preview'
        | 'competition.delete'
        | 'competition.regenerate'
        | 'competition.regenerate-missing';
    }
  >,
) {
  const tournamentId = tenant(actor);
  const operation =
    a.type === 'competition.lifecycle.preview'
      ? a.operation
      : a.type === 'competition.delete'
        ? 'delete'
        : a.type === 'competition.regenerate'
          ? 'regenerate'
          : 'missing';
  const request = {
    id: a.id,
    baseVersion: a.baseVersion,
    operation,
    ...('nodeId' in a && a.nodeId ? { nodeId: a.nodeId } : {}),
  };
  const plan = await lifecyclePlan(tx, actor, request);
  if (a.type === 'competition.lifecycle.preview') return plan.preview;
  if (a.reviewHash !== plan.preview.hash)
    throw new AppError('The bracket or its matches changed. Review the operation again.', 409);
  if (plan.preview.blocked) throw new AppError(plan.preview.reasons[0], 409);
  if (plan.preview.affected.length && !a.approveCorrections)
    throw new AppError('Review and approve the downstream fixture changes.', 409);
  if (a.type === 'competition.delete') {
    if (a.confirmation !== plan.bracket.name)
      throw new AppError('Type the exact bracket name to confirm deletion.');
    if (plan.preview.historical && !a.acknowledgeHistory)
      throw new AppError('Confirm permanent removal of completed matches and referee histories.');
    const matchIds = plan.matches.map((match) => match.id);
    const nodeIds = plan.before.filter((node) => node.bracketId === a.id).map((node) => node.id);
    await tx.bracketSlot.deleteMany({ where: { tournamentId, nodeId: { in: nodeIds } } });
    await tx.bracketNode.deleteMany({ where: { tournamentId, bracketId: a.id } });
    await tx.bracketEntry.deleteMany({ where: { tournamentId, bracketId: a.id } });
    await tx.bracketRound.deleteMany({ where: { tournamentId, bracketId: a.id } });
    await tx.bracket.deleteMany({ where: { tournamentId, id: a.id, version: a.baseVersion } });
    await tx.multiplayerGame.deleteMany({ where: { matchId: { in: matchIds } } });
    await tx.match.deleteMany({ where: { tournamentId, id: { in: matchIds } } });
    await tx.auditLog.deleteMany({
      where: { tournamentId, entityId: { in: [a.id, ...nodeIds, ...matchIds] } },
    });
    // Bulk schedule receipts can contain several matches. Remove only the purged entries.
    const bulkAudits = await tx.auditLog.findMany({
      where: { tournamentId, action: { in: ['matches.bulk.schedule', 'matches.batch.schedule'] } },
    });
    const purgeIds = new Set(matchIds);
    const scrub = (value: Prisma.JsonValue): Prisma.JsonValue | undefined => {
      if (Array.isArray(value))
        return value.flatMap((entry) => {
          const clean = scrub(entry);
          return clean === undefined ? [] : [clean];
        });
      if (value && typeof value === 'object') {
        if (Object.values(value).some((field) => typeof field === 'string' && purgeIds.has(field)))
          return undefined;
        return Object.fromEntries(
          Object.entries(value).flatMap(([key, entry]) => {
            const clean = scrub(entry!);
            return clean === undefined ? [] : [[key, clean]];
          }),
        );
      }
      return value;
    };
    for (const entry of bulkAudits) {
      const cleaned = scrub(entry.details);
      if (stable(cleaned) === stable(entry.details)) continue;
      if (cleaned === undefined)
        await tx.auditLog.deleteMany({ where: { id: entry.id, tournamentId } });
      else await tx.auditLog.update({ where: { id: entry.id }, data: { details: json(cleaned) } });
    }
    if (plan.preview.numberingRestarts)
      await tx.tournament.update({ where: { id: tournamentId }, data: { matchNumberSequence: 0 } });
    await audit(tx, tournamentId, actor.id, a.type, a.id, {
      deletedMatches: matchIds.length,
      numberingRestarted: plan.preview.numberingRestarts,
    });
    return { id: a.id, numberingRestarted: plan.preview.numberingRestarts };
  } else {
    await assertScheduleAvailability(
      tx,
      tournamentId,
      plan.matches
        .filter((match) => plan.restorations.some((row) => row.id === match.id))
        .filter(
          (match) => plan.restorations.find((row) => row.id === match.id)!.status !== 'COMPLETED',
        )
        .map((match) => ({
          label: `Match ${match.matchNumber}`,
          scheduledAt: match.scheduledAt,
          refereeIds: match.assignments.map((assignment) => assignment.userId),
          participants: match.participants,
          teamIds: [match.teamAId, match.teamBId],
        })),
      { matchIds: plan.restorations.map((row) => row.id) },
    );
    for (const restoration of plan.restorations) {
      const saved = await tx.match.update({
        where: { id: restoration.id },
        data: {
          deletedAt: null,
          status: restoration.status,
          published: plan.bracket.published,
          version: { increment: 1 },
        },
      });
      await tx.matchEvent.create({
        data: {
          matchId: saved.id,
          version: saved.version,
          actorId: actor.id,
          kind: a.type,
          data: json({
            bracketId: a.id,
            nodeId: plan.targets.find((node) => node.matchId === saved.id)!.id,
          }),
        },
      });
      await tx.matchResultRevision.create({
        data: {
          matchId: saved.id,
          version: saved.version,
          createdBy: actor.id,
          kind: a.type,
          reason: 'Explicitly restored from the bracket.',
          snapshot: json(saved),
        },
      });
    }
    const current = await allNodes(tx, tournamentId);
    await persistRecalculation(
      tx,
      tournamentId,
      plan.before,
      recalculateCompetition(current),
      actor.id,
      true,
      operation === 'regenerate' ? plan.targets.map((node) => node.id) : [],
    );
    await tx.bracket.update({ where: { id: a.id }, data: { version: { increment: 1 } } });
  }
  await audit(tx, tournamentId, actor.id, a.type, a.id, { ...a, matches: plan.preview.matches });
  return { id: a.id };
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
  if (
    a.type === 'competition.lifecycle.preview' ||
    a.type === 'competition.delete' ||
    a.type === 'competition.regenerate' ||
    a.type === 'competition.regenerate-missing'
  )
    return applyLifecycle(tx, actor, a);
  if (a.type === 'competition.preview') {
    const plan = await checkedPlan(tx, tournamentId, a);
    const tournament = await tx.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
      select: { matchNumberSequence: true },
    });
    return generationPreview(plan, a, tournament.matchNumberSequence);
  }
  if (a.type === 'competition.create') {
    const existing = await tx.bracket.findFirst({
      where: { tournamentId, generationKey: a.generationKey },
    });
    if (existing) {
      if (
        stable(generationRequest(competitionActionSchema.options[0].parse(existing.config))) !==
        stable(generationRequest(a))
      )
        throw new AppError(
          'This generation key has already been used for a different bracket.',
          409,
        );
      return { id: existing.id, version: existing.version };
    }
    const plan = await checkedPlan(tx, tournamentId, a);
    // Preserve the existing advisory-lock -> tournament-counter row-lock order.
    // The reviewed counter must stay locked until its reservation is committed.
    const counters = await tx.$queryRaw<{ matchNumberSequence: number }[]>`
      SELECT "matchNumberSequence" FROM "Tournament" WHERE "id" = ${tournamentId} FOR UPDATE
    `;
    const preview = generationPreview(plan, a, counters[0].matchNumberSequence);
    if (a.reviewHash && a.reviewHash !== preview.reviewHash)
      throw new AppError(
        'Bracket stages or match numbers changed. Preview the bracket again before generating.',
        409,
      );
    const bracket = await tx.bracket.create({
      data: {
        tournamentId,
        generationKey: a.generationKey,
        name: a.name,
        format: a.format,
        config: json({
          ...generationRequest(a),
          ...(plan.groupSource ? { groupSource: plan.groupSource } : {}),
        }),
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
    const after = recalculateCompetition(before);
    const newBracketNodes = after.filter((node) => node.bracketId === bracket.id);
    const numberingRounds = plan.rounds.map((round) => ({
      ...round,
      id: rounds.get(round.key)!,
      stagePosition: plan.availableStages.findIndex((stage) => stage.id === round.stageId),
    }));
    const allocated = a.manualMatches
      ? new Map<string, number>()
      : await reserveBracketMatchNumbers(tx, tournamentId, newBracketNodes, numberingRounds);
    for (const node of newBracketNodes)
      node.matchNumber = allocated.get(node.id) ?? node.matchNumber ?? null;
    await persistRecalculation(tx, tournamentId, before, after, actor.id, true);
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
  } else if (a.type === 'competition.rounds.stage') {
    const rounds = await tx.bracketRound.findMany({
      where: { tournamentId, bracketId: a.id, id: { in: a.roundIds } },
      include: {
        nodes: {
          include: { match: { include: { _count: { select: { actions: true, results: true } } } } },
        },
      },
    });
    if (rounds.length !== a.roundIds.length)
      throw new AppError('Choose rounds from this bracket.', 404);
    const stage = await tx.tournamentStage.findFirst({
      where: {
        id: a.stageId,
        tournamentId,
        archivedAt: null,
        kind: { notIn: ['QUALIFIERS', 'QUALIFIER'] },
      },
      include: { mappool: true },
    });
    if (!stage) throw new AppError('Choose an active head-to-head stage.');
    const settings = await tx.tournamentSettings.findUniqueOrThrow({ where: { tournamentId } });
    const tournament = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    const rules = inheritedRules(
      stage.matchRules || settings.matchRules,
      settings.gameplayScoring,
      tournament.gameMode,
    );
    const matches = rounds.flatMap((round) =>
      round.nodes.flatMap((node) => (node.match ? [node.match] : [])),
    );
    for (const match of matches) {
      if (
        match.status !== 'SCHEDULED' ||
        match.startedAt ||
        match._count.actions ||
        match._count.results
      )
        throw new AppError(
          'Match {0} has operational history. Its round stage cannot be changed.',
          409,
          [match.matchNumber],
        );
      const participants = match.participants as {
        [side: string]: { format?: string; members?: { substitute?: boolean }[] };
      };
      if (
        ['A', 'B'].some(
          (side) =>
            (participants[side]?.members?.filter((member) => !member.substitute).length || 0) <
            rules.teamSize,
        )
      )
        throw new AppError('Match {0} needs {1} starting players per side for this stage.', 400, [
          match.matchNumber,
          rules.teamSize,
        ]);
    }
    for (const match of matches) {
      if (match.stageId === stage.id) continue;
      const updatedMatch = await tx.match.updateMany({
        where: {
          id: match.id,
          tournamentId,
          version: match.version,
          status: 'SCHEDULED',
          startedAt: null,
        },
        data: {
          stageId: stage.id,
          rules: json(rules),
          poolRevisionId:
            stage.mappool?.state === 'PUBLISHED' ? stage.mappool.publishedRevisionId : null,
          version: { increment: 1 },
        },
      });
      if (updatedMatch.count !== 1)
        throw new AppError('A round match changed. Reload before applying.', 409);
      await tx.matchEvent.create({
        data: {
          matchId: match.id,
          actorId: actor.id,
          version: match.version + 1,
          kind: 'competition.stage',
          data: { before: match.stageId, after: stage.id },
        },
      });
    }
    await tx.bracketRound.updateMany({
      where: { tournamentId, bracketId: a.id, id: { in: a.roundIds } },
      data: { stageId: stage.id },
    });
    const config = competitionStoredConfigSchema.parse(bracket.config);
    await tx.bracket.updateMany({
      where: { id: a.id, tournamentId },
      data: {
        config: json({
          ...config,
          roundStages: {
            ...config.roundStages,
            ...Object.fromEntries(rounds.map((round) => [round.key, stage.id])),
          },
        }),
      },
    });
  } else if (a.type === 'competition.link-match') {
    if (!(bracket.config as { manualMatches?: boolean }).manualMatches)
      throw new AppError('Enable manual-match mode when creating the bracket to link history.');
    const before = await allNodes(tx, tournamentId);
    const node = before.find((item) => item.id === a.nodeId && item.bracketId === a.id);
    if (!node || node.matchId) throw new AppError('Choose an empty bracket position.', 409);
    if (node.state !== 'READY' || node.slots.some((slot) => !slot.resolved || !slot.teamId))
      throw new AppError('Both participants must be resolved before linking a match.', 409);
    const round = await tx.bracketRound.findFirst({
      where: { id: node.roundId, bracketId: a.id, tournamentId },
      select: { stageId: true },
    });
    if (!round) throw new AppError('Bracket round not found.', 404);
    const match = await tx.match.findFirst({
      where: {
        id: a.matchId,
        tournamentId,
        bracketNode: { is: null },
        status: { not: 'CANCELLED' },
      },
      select: {
        id: true,
        stageId: true,
        teamAId: true,
        teamBId: true,
        status: true,
        version: true,
        matchNumber: true,
      },
    });
    const sideA = node.slots.find((slot) => slot.side === 'A')!;
    const sideB = node.slots.find((slot) => slot.side === 'B')!;
    if (!match) throw new AppError('That match is missing, cancelled, or already linked.', 404);
    if (match.version !== a.matchVersion)
      throw new AppError('The existing match changed. Reload before linking it.', 409);
    if (
      match.stageId !== round.stageId ||
      match.teamAId !== (a.reverseSides ? sideB.teamId : sideA.teamId) ||
      match.teamBId !== (a.reverseSides ? sideA.teamId : sideB.teamId)
    )
      throw new AppError(
        'The existing match must use this round’s stage and the exact same participants on sides A and B.',
        409,
      );
    if (a.reverseSides) {
      for (const [destination, source] of [
        [sideA, sideB],
        [sideB, sideA],
      ])
        await tx.bracketSlot.updateMany({
          where: { nodeId: node.id, tournamentId, side: destination.side },
          data: {
            teamId: source.teamId,
            resolved: source.resolved,
            mode: source.sourceNodeId ? source.mode : 'MANUAL',
            sourceNodeId: source.sourceNodeId,
            outcome: source.outcome,
          },
        });
    }
    const linked = await tx.bracketNode.updateMany({
      where: { id: node.id, tournamentId, bracketId: a.id, matchId: null },
      data: {
        matchId: match.id,
        matchNumber: match.matchNumber,
        state: match.status === 'COMPLETED' ? 'COMPLETED' : 'READY',
      },
    });
    if (linked.count !== 1)
      throw new AppError('This bracket position changed. Reload and retry.', 409);
    const current = await allNodes(tx, tournamentId);
    await persistRecalculation(
      tx,
      tournamentId,
      before,
      recalculateCompetition(current),
      actor.id,
      true,
    );
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
        if (a.sourceNodeId && !before.some((n) => n.id === a.sourceNodeId && !n.match?.deletedAt))
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
            where: { id: a.teamId, tournamentId, status: 'APPROVED', supersededAt: null },
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
          const original = (bracket.config as { phaseKey?: string }).phaseKey
            ? await advancedSlot(tx, tournamentId, bracket.id, node.key, a.side)
            : (
                await generateCompetition(competitionActionSchema.options[0].parse(bracket.config))
              ).nodes
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
  await assertPhaseSourcesCurrent(tx, tournamentId, bracket.id);
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
      where: {
        tournamentId,
        id: { in: computed.slots.map((s) => s.teamId!) },
        status: 'APPROVED',
        supersededAt: null,
      },
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
    where: {
      tournamentId,
      config: { path: ['sourceBracketId'], equals: target.bracketId },
    },
    select: { id: true, name: true, version: true },
  });
  // A format's later phase can be re-advanced after a correction, until it has been played.
  for (const consumer of await consumersOfBracket(tx, tournamentId, target.bracketId, before))
    seededBrackets.push(consumer);
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
  if (bracket.format === 'GROUPS' && !(bracket.config as { phaseKey?: string }).phaseKey) {
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
  } else if (
    competitionEliminated(path, bracket.rounds, bracket.format, teamId, entry.lossesAllowed)
  )
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
