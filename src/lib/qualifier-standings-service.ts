import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { db as rootDb } from './db';
import { scopedDb } from './scoped-db';
import { AppError, assertPermission, can, type Actor } from './permissions';
import { historicalScoring, tournamentScoring } from './gameplay-scoring';
import { matchRulesSchema } from './match-rules';
import { convertedScore } from './match-engine';
import { qualifierPolicySchema } from './qualifier-policy';
import {
  qualifierStandingsActionSchema,
  type QualifierStandingsAction,
} from './qualifier-standings-validation';
export {
  qualifierStandingsActionSchema,
  type QualifierStandingsAction,
} from './qualifier-standings-validation';
import {
  calculateQualifierStandings,
  canonicalQualifierJson,
  qualifierSourceHash,
  resolveQualifierTies,
  QUALIFIER_CALCULATION_VERSION,
  type QualifierCalculation,
  type QualifierIssue,
  type QualifierSeedingInput,
} from './qualifier-seeding';

export type QualifierStandingSnapshot = {
  state: 'PROVISIONAL' | 'FINALIZED' | 'REOPENED';
  calculation: QualifierCalculation;
  calculatedBy: string;
  calculatedAt: string;
  finalizedAt: string | null;
  cutoff: number | null;
  tieResolution: { order: string[]; reason: string; actorId: string } | null;
  seeds: { teamId: string; seed: number; qualified: boolean }[];
  correctionReview?: {
    standingId: string;
    reason: string;
    actorId: string;
    impact: QualifierCorrectionImpact;
  };
  importProvenance?: {
    originalSourceHash: string;
    reboundSourceHash: string;
    reboundAt: string;
    calculationVersion: string;
  }[];
};
export type QualifierStandingVersion = {
  id: string;
  version: number;
  published: boolean;
  sourceHash: string;
  createdAt: string;
  snapshot: QualifierStandingSnapshot;
  stale: boolean;
};
export type QualifierStandingsData = {
  stage: { id: string; name: string };
  preview: QualifierCalculation;
  versions: QualifierStandingVersion[];
  latest: QualifierStandingVersion | null;
  locked: boolean;
  canManage: boolean;
  correctionImpact: QualifierCorrectionImpact | null;
};
export type QualifierCorrectionImpact = {
  brackets: {
    id: string;
    name: string;
    version: number;
    published: boolean;
    sourceStandingId: string | null;
    sourceBracketId: string | null;
    nodes: {
      id: string;
      state: string;
      match: {
        id: string;
        code: string;
        status: string;
        version: number;
        startedAt: string | null;
        submittedAt: string | null;
        completedAt: string | null;
        scoreA: number;
        scoreB: number;
        winnerSide: string | null;
        resultCount: number;
        multiplayerGameCount: number;
      } | null;
    }[];
  }[];
  blockingMatches: { id: string; code: string; reason: string }[];
  impactHash: string;
  canReopen: boolean;
};
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const rosterSchema = z.array(
  z.object({
    id: z.string().nullable(),
    name: z.string(),
    members: z.array(z.object({ osuId: z.number().int().positive() })),
  }),
);

export function qualifierStandingSnapshot(value: unknown): QualifierStandingSnapshot {
  if (
    !value ||
    typeof value !== 'object' ||
    !('state' in value) ||
    !('calculation' in value) ||
    !['PROVISIONAL', 'FINALIZED', 'REOPENED'].includes(String(value.state))
  )
    throw new AppError('This standings snapshot needs a controlled historical review.', 409);
  return value as QualifierStandingSnapshot;
}

async function lockStage(tx: Prisma.TransactionClient, stageId: string, tournamentId: string) {
  // Qualifier capture and finalization acquire this same row lock before touching source records.
  const stages = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "TournamentStage" WHERE "id" = ${stageId} AND "tournamentId" = ${tournamentId} FOR UPDATE`;
  if (!stages.length) throw new AppError('Qualifier stage not found.', 404);
}

export async function assertQualifierMutable(
  tx: Prisma.TransactionClient,
  stageId: string,
  tournamentId = 'main',
) {
  tx = scopedDb(tx, tournamentId);
  await lockStage(tx, stageId, tournamentId);
  const versions = await tx.qualifierStanding.findMany({
    where: { stageId, tournamentId },
    orderBy: { version: 'desc' },
    take: 1,
    select: { snapshot: true },
  });
  if (versions[0] && qualifierStandingSnapshot(versions[0].snapshot).state === 'FINALIZED')
    throw new AppError(
      'Finalized qualifier results are locked. A controlled standings and downstream-bracket review is required before changing source records.',
      409,
    );
}

export async function qualifierCorrectionImpact(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  stageId: string,
): Promise<QualifierCorrectionImpact> {
  tx = scopedDb(tx, tournamentId);
  const stage = await tx.tournamentStage.findFirst({
    where: { id: stageId, tournamentId },
    select: { id: true },
  });
  if (!stage) throw new AppError('Qualifier stage not found.', 404);
  const standings = await tx.qualifierStanding.findMany({
    where: { stageId, tournamentId },
    select: { id: true },
  });
  const standingIds = new Set(standings.map((s) => s.id));
  const records = await tx.bracket.findMany({
    where: { tournamentId },
    orderBy: { id: 'asc' },
    include: {
      nodes: {
        orderBy: { id: 'asc' },
        include: {
          match: {
            select: {
              id: true,
              code: true,
              status: true,
              version: true,
              startedAt: true,
              submittedAt: true,
              completedAt: true,
              scoreA: true,
              scoreB: true,
              winnerSide: true,
              _count: { select: { results: true, multiplayerGames: true } },
            },
          },
        },
      },
    },
  });
  const sourceBracket = (value: unknown) => {
    const config =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const group =
      config.groupSource && typeof config.groupSource === 'object'
        ? (config.groupSource as Record<string, unknown>)
        : {};
    return typeof config.sourceBracketId === 'string'
      ? config.sourceBracketId
      : typeof group.bracketId === 'string'
        ? group.bracketId
        : null;
  };
  const affected = new Set(
    records
      .filter((b) => b.sourceStandingId && standingIds.has(b.sourceStandingId))
      .map((b) => b.id),
  );
  let previous = -1;
  while (previous !== affected.size) {
    previous = affected.size;
    for (const record of records) {
      const parent = sourceBracket(record.config);
      if (parent && affected.has(parent)) affected.add(record.id);
    }
  }
  const brackets: QualifierCorrectionImpact['brackets'] = records
    .filter((b) => affected.has(b.id))
    .map((b) => ({
      id: b.id,
      name: b.name,
      version: b.version,
      published: b.published,
      sourceStandingId: b.sourceStandingId,
      sourceBracketId: sourceBracket(b.config),
      nodes: b.nodes.map((n) => ({
        id: n.id,
        state: n.state,
        match: n.match
          ? {
              ...n.match,
              startedAt: n.match.startedAt?.toISOString() || null,
              submittedAt: n.match.submittedAt?.toISOString() || null,
              completedAt: n.match.completedAt?.toISOString() || null,
              resultCount: n.match._count.results,
              multiplayerGameCount: n.match._count.multiplayerGames,
            }
          : null,
      })),
    }));
  const blockingMatches = brackets.flatMap((b) =>
    b.nodes.flatMap((n) => {
      const m = n.match;
      if (!m) return [];
      if (m.resultCount || m.multiplayerGameCount || m.scoreA || m.scoreB || m.winnerSide)
        return [
          { id: m.id, code: m.code, reason: 'Recorded competitive results or gameplay exist.' },
        ];
      return m.startedAt ||
        m.submittedAt ||
        m.completedAt ||
        !['SCHEDULED', 'CANCELLED'].includes(m.status)
        ? [{ id: m.id, code: m.code, reason: 'The downstream match has started or progressed.' }]
        : [];
    }),
  );
  return {
    brackets,
    blockingMatches,
    impactHash: qualifierSourceHash({ tournamentId, stageId, brackets }),
    canReopen: blockingMatches.length === 0,
  };
}

export async function loadQualifierCalculation(
  tx: Prisma.TransactionClient,
  stageId: string,
  tournamentId: string,
) {
  tx = scopedDb(tx, tournamentId);
  const stage = await tx.tournamentStage.findFirst({
    where: { id: stageId, tournamentId },
    include: { mappool: { include: { publishedRevision: { include: { slots: true } } } } },
  });
  if (!stage) throw new AppError('Qualifier stage not found.', 404);
  if (stage.kind !== 'QUALIFIERS') throw new AppError('Select a qualifier stage.');
  const settings = await tx.tournamentSettings.findUniqueOrThrow({ where: { tournamentId } });
  const gameplayScoring = tournamentScoring(settings.gameplayScoring);
  const lobbies = await tx.qualifierLobby.findMany({
    where: { stageId, tournamentId },
    include: {
      scores: { orderBy: { id: 'asc' } },
      entries: { include: { team: true }, orderBy: { position: 'asc' } },
      poolRevision: { include: { slots: true } },
    },
    orderBy: { id: 'asc' },
  });
  const firstRules = matchRulesSchema.parse(
    lobbies[0]?.rules || stage.matchRules || settings.matchRules,
  );
  const policy = qualifierPolicySchema.parse(
    stage.qualifierPolicy ?? { requiredPlayers: firstRules.teamSize },
  );
  const maps = (stage.mappool?.publishedRevision?.slots || [])
    .map((s) => ({ slotName: s.name, beatmapId: s.beatmapId }))
    .sort((a, b) => (a.slotName < b.slotName ? -1 : a.slotName > b.slotName ? 1 : 0));
  const issues: QualifierIssue[] = [];
  const add = (code: string, message: string, severity: 'ERROR' | 'WARNING' = 'ERROR') =>
    issues.push({ code, message, severity });
  if (stage.mappool?.state !== 'PUBLISHED')
    add(
      'UNPUBLISHED_POOL',
      'The qualifier mappool must be published before standings can be finalized.',
    );
  if (
    stage.qualifierPolicy === null &&
    lobbies.length &&
    new Set(lobbies.map((l) => matchRulesSchema.parse(l.rules).teamSize)).size > 1
  )
    add(
      'AMBIGUOUS_LEGACY_POLICY',
      'Legacy qualifier lobbies disagree on required players. Configure the stage policy explicitly.',
    );
  const participants = new Map<string, QualifierSeedingInput['participants'][number]>();
  const scores: QualifierSeedingInput['scores'] = [];
  const context: unknown[] = [];
  for (const lobby of lobbies) {
    context.push({
      id: lobby.id,
      version: lobby.version,
      status: lobby.status,
      policy: lobby.policy,
      gameplayScoring: lobby.gameplayScoring,
      rules: lobby.rules,
      participants: lobby.participants,
      entries: lobby.entries.map((e) => ({ teamId: e.teamId, status: e.team.status })),
      poolRevisionId: lobby.poolRevisionId,
      maps: lobby.poolRevision.slots
        .map((s) => ({ slotName: s.name, beatmapId: s.beatmapId }))
        .sort((a, b) => (a.slotName < b.slotName ? -1 : a.slotName > b.slotName ? 1 : 0)),
      originalScores: lobby.scores.map((s) => ({ ...s, updatedAt: s.updatedAt.toISOString() })),
    });
    if (lobby.status === 'CANCELLED') continue;
    if (lobby.status !== 'COMPLETED')
      add('UNCONFIRMED_LOBBY', `${lobby.code} must be referee-confirmed before finalization.`);
    const rules = matchRulesSchema.parse(lobby.rules);
    const actualScoring = lobby.gameplayScoring || historicalScoring(rules);
    if (actualScoring !== gameplayScoring)
      add(
        'LOBBY_SCORING_MISMATCH',
        `${lobby.code} was configured for a different gameplay scoring system.`,
      );
    const lobbyPolicy = qualifierPolicySchema.safeParse(
      lobby.policy ?? { requiredPlayers: rules.teamSize },
    );
    if (
      !lobbyPolicy.success ||
      canonicalQualifierJson(lobbyPolicy.data) !== canonicalQualifierJson(policy)
    )
      add(
        'LOBBY_POLICY_MISMATCH',
        `${lobby.code} does not match the current stage policy; review its historical snapshot.`,
      );
    const lobbyMaps = lobby.poolRevision.slots
      .map((s) => ({ slotName: s.name, beatmapId: s.beatmapId }))
      .sort((a, b) => (a.slotName < b.slotName ? -1 : a.slotName > b.slotName ? 1 : 0));
    if (canonicalQualifierJson(lobbyMaps) !== canonicalQualifierJson(maps))
      add('POOL_MISMATCH', `${lobby.code} used a different qualifier pool.`);
    const parsed = rosterSchema.safeParse(lobby.participants);
    if (!parsed.success) {
      add('INVALID_ROSTER_SNAPSHOT', `${lobby.code} has an invalid roster snapshot.`);
      continue;
    }
    const entryIds = new Set(lobby.entries.map((e) => e.teamId));
    const localOwners = new Map<number, string>();
    for (const entrant of parsed.data) {
      if (!entrant.id || !entryIds.has(entrant.id)) {
        add(
          'ENTRY_ROSTER_MISMATCH',
          `${lobby.code} has an entrant missing from its native entries.`,
        );
        continue;
      }
      const entry = lobby.entries.find((e) => e.teamId === entrant.id)!;
      const participant = {
        id: entrant.id,
        name: entrant.name,
        roster: entrant.members.map((m) => m.osuId).sort((a, b) => a - b),
        eligible: entry.team.status === 'APPROVED',
      };
      const previous = participants.get(entrant.id);
      if (previous && canonicalQualifierJson(previous) !== canonicalQualifierJson(participant))
        add('ROSTER_CHANGED', `${entrant.name} has conflicting qualifier roster snapshots.`);
      participants.set(entrant.id, participant);
      for (const member of entrant.members) {
        if (localOwners.has(member.osuId))
          add('DUPLICATE_LOBBY_ROSTER', `${lobby.code} has duplicate player ${member.osuId}.`);
        localOwners.set(member.osuId, entrant.id);
      }
    }
    if (parsed.data.length !== entryIds.size)
      add('ENTRY_ROSTER_MISMATCH', `${lobby.code} entries and roster snapshots disagree.`);
    for (const score of lobby.scores) {
      const parsedMods = z.array(z.string()).safeParse(score.mods);
      if (!parsedMods.success)
        add('INVALID_MODS', `${lobby.code}: ${score.slotName} has invalid mod metadata.`);
      const mods = parsedMods.success ? parsedMods.data : [];
      try {
        const expected = convertedScore(rules, score.raw, mods, score.slotName).adjusted;
        if (expected !== score.adjusted)
          add(
            'NORMALIZATION_MISMATCH',
            `${lobby.code}: ${score.slotName} has an adjusted score inconsistent with its rule snapshot.`,
          );
      } catch {
        add(
          'INVALID_SOURCE_SCORE',
          `${lobby.code}: ${score.slotName} contains an invalid raw score or normalization rule.`,
        );
      }
      if (!score.actualScoring)
        add(
          'LEGACY_SCORING_PROVENANCE',
          `${lobby.code}: scoring metadata is inherited from the historical lobby rules, not converted.`,
          'WARNING',
        );
      scores.push({
        id: score.id,
        lobbyId: lobby.id,
        participantId: localOwners.get(score.osuId) || '',
        osuId: score.osuId,
        slotName: score.slotName,
        run: score.run,
        raw: score.raw,
        adjusted: score.adjusted,
        mods,
        actualScoring: score.actualScoring || actualScoring,
        representation: score.representation,
        source: score.source,
        gameId: score.gameId,
        verified: score.verified,
      });
    }
  }
  const calculation = calculateQualifierStandings({
    tournamentId,
    stageId,
    gameplayScoring,
    policy,
    maps,
    participants: [...participants.values()],
    scores,
    context: {
      stagePolicy: stage.qualifierPolicy,
      poolRevisionId: stage.mappool?.publishedRevisionId,
      lobbies: context,
    },
    issues,
  });
  return { stage: { id: stage.id, name: stage.name }, calculation };
}

export async function qualifierStandingsData(
  actor: Actor,
  stageId: string,
): Promise<QualifierStandingsData> {
  if (
    !can(actor, 'matches.manage') &&
    !can(actor, 'matches.view_all') &&
    !can(actor, 'matches.manage_all')
  )
    throw new AppError('You do not have access to the full qualifier cohort.', 403);
  const tournamentId = actor.tournamentId || 'main';
  const tx = scopedDb(rootDb, tournamentId);
  const { stage, calculation: preview } = await loadQualifierCalculation(tx, stageId, tournamentId);
  const records = await tx.qualifierStanding.findMany({
    where: { stageId, tournamentId },
    orderBy: { version: 'desc' },
  });
  const versions = records.map((record) => ({
    ...record,
    createdAt: record.createdAt.toISOString(),
    snapshot: qualifierStandingSnapshot(record.snapshot),
    stale:
      record.sourceHash !== preview.sourceHash ||
      (qualifierStandingSnapshot(record.snapshot).state === 'FINALIZED' &&
        record.id !== records[0]?.id),
  }));
  const locked = versions[0]?.snapshot.state === 'FINALIZED';
  return {
    stage,
    preview,
    versions,
    latest: versions[0] || null,
    locked,
    canManage: can(actor, 'matches.manage'),
    correctionImpact:
      locked && can(actor, 'matches.manage')
        ? await qualifierCorrectionImpact(tx, tournamentId, stageId)
        : null,
  };
}

// The caller supplies a transaction. No source writes, team seed rewrites, or bracket reseeding happen here.
export async function applyQualifierStandingsAction(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: QualifierStandingsAction,
) {
  assertPermission(actor, 'matches.manage');
  const action = qualifierStandingsActionSchema.parse(input);
  const tournamentId = actor.tournamentId || 'main';
  tx = scopedDb(tx, tournamentId);
  if (action.type === 'qualifier.standings.reopen')
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
  await lockStage(tx, action.stageId, tournamentId);
  const { calculation } = await loadQualifierCalculation(tx, action.stageId, tournamentId);
  const versions = await tx.qualifierStanding.findMany({
    where: { stageId: action.stageId, tournamentId },
    orderBy: { version: 'desc' },
  });
  const latest = versions[0];
  if ((latest?.version || 0) !== action.baseVersion)
    throw new AppError('Standings changed. Reload and review the latest version.', 409);
  if (action.sourceHash !== calculation.sourceHash)
    throw new AppError('Qualifier sources changed. Recalculate and review before continuing.', 409);
  const locked = !!latest && qualifierStandingSnapshot(latest.snapshot).state === 'FINALIZED';
  if (action.type === 'qualifier.standings.reopen') {
    if (!latest || !locked)
      throw new AppError('Only the current finalized standings can be reopened.', 409);
    const impact = await qualifierCorrectionImpact(tx, tournamentId, action.stageId);
    if (
      impact.impactHash !== action.impactHash ||
      new Set(action.affectedBracketIds).size !== action.affectedBracketIds.length ||
      canonicalQualifierJson([...action.affectedBracketIds].sort()) !==
        canonicalQualifierJson(impact.brackets.map((b) => b.id).sort())
    )
      throw new AppError(
        'Downstream competition changed. Reload and acknowledge every affected bracket before reopening.',
        409,
      );
    if (!impact.canReopen)
      throw new AppError(
        `Started or scored downstream matches require manual historical reconciliation: ${impact.blockingMatches.map((m) => m.code).join(', ')}.`,
        409,
      );
    const now = new Date().toISOString();
    const snapshot: QualifierStandingSnapshot = {
      state: 'REOPENED',
      calculation,
      calculatedBy: actor.id,
      calculatedAt: now,
      finalizedAt: null,
      cutoff: null,
      tieResolution: null,
      seeds: [],
      correctionReview: { standingId: latest.id, reason: action.reason, actorId: actor.id, impact },
    };
    await tx.qualifierStanding.updateMany({
      where: { tournamentId, stageId: action.stageId, published: true },
      data: { published: false },
    });
    const record = await tx.qualifierStanding.create({
      data: {
        tournamentId,
        stageId: action.stageId,
        version: action.baseVersion + 1,
        sourceHash: calculation.sourceHash,
        snapshot: json(snapshot),
      },
    });
    await audit(tx, actor, action, {
      standingId: record.id,
      supersededStandingId: latest.id,
      sourceHash: record.sourceHash,
      reason: action.reason,
      impact,
    });
    return record;
  }
  if (action.type === 'qualifier.standings.publish') {
    if (
      !latest ||
      qualifierStandingSnapshot(latest.snapshot).state !== 'FINALIZED' ||
      (action.published && latest.sourceHash !== calculation.sourceHash)
    )
      throw new AppError('Only current finalized standings can be published.', 409);
    await tx.qualifierStanding.updateMany({
      where: { tournamentId, stageId: action.stageId, published: true },
      data: { published: false },
    });
    const record = await tx.qualifierStanding.update({
      where: { id: latest.id, tournamentId },
      data: { published: action.published },
    });
    await audit(tx, actor, action, { standingId: record.id, sourceHash: record.sourceHash });
    return record;
  }
  if (locked)
    throw new AppError(
      'Finalized standings are immutable. A controlled downstream competition review is required to revise them.',
      409,
    );
  if (action.type === 'qualifier.policy.save') {
    const unsafe = await tx.qualifierLobby.count({
      where: {
        stageId: action.stageId,
        tournamentId,
        OR: [{ status: { not: 'SCHEDULED' } }, { scores: { some: {} } }],
      },
    });
    if (unsafe)
      throw new AppError(
        'Qualifier policy is locked after a session starts or records scores.',
        409,
      );
    await tx.tournamentStage.update({
      where: { id: action.stageId, tournamentId },
      data: { qualifierPolicy: json(action.policy) },
    });
    await tx.qualifierLobby.updateMany({
      where: { stageId: action.stageId, tournamentId, status: 'SCHEDULED' },
      data: { policy: json(action.policy), version: { increment: 1 } },
    });
    await audit(tx, actor, action, { before: calculation.policy, after: action.policy });
    return { saved: true };
  }
  let reviewed = calculation;
  let tieResolution: QualifierStandingSnapshot['tieResolution'] = null;
  if (
    action.type === 'qualifier.standings.resolve' ||
    action.type === 'qualifier.standings.finalize'
  ) {
    let order = action.tieOrder,
      reason = action.reason;
    const previous = latest ? qualifierStandingSnapshot(latest.snapshot) : null;
    if (!order.length && previous?.tieResolution && latest.sourceHash === calculation.sourceHash) {
      order = previous.tieResolution.order;
      reason = previous.tieResolution.reason;
    }
    if (order.length) {
      if (!reason.trim()) throw new AppError('Record the approved tiebreak decision.');
      try {
        reviewed = resolveQualifierTies(calculation, order);
      } catch (error) {
        throw new AppError(error instanceof Error ? error.message : 'Invalid tie resolution.');
      }
      tieResolution = { order, reason, actorId: actor.id };
    }
  }
  const finalizing = action.type === 'qualifier.standings.finalize';
  if (
    finalizing &&
    (!latest ||
      qualifierStandingSnapshot(latest.snapshot).state !== 'PROVISIONAL' ||
      latest.sourceHash !== calculation.sourceHash)
  )
    throw new AppError('Save and review a provisional calculation before finalizing.', 409);
  if (finalizing && !reviewed.canFinalize)
    throw new AppError(
      'Resolve missing scores, incompatible data and tied seeds before finalizing.',
      409,
    );
  const cutoff = finalizing ? (action.cutoff ?? null) : null;
  if (cutoff !== null && cutoff > reviewed.rows.filter((r) => r.seed !== null).length)
    throw new AppError('The cutoff exceeds the seeded cohort.');
  const now = new Date().toISOString();
  const snapshot: QualifierStandingSnapshot = {
    state: finalizing ? 'FINALIZED' : 'PROVISIONAL',
    calculation: reviewed,
    calculatedBy: actor.id,
    calculatedAt: now,
    finalizedAt: finalizing ? now : null,
    cutoff,
    tieResolution,
    seeds: finalizing
      ? reviewed.rows
          .filter((r) => r.seed !== null)
          .map((r) => ({
            teamId: r.participantId,
            seed: r.seed!,
            qualified: cutoff === null || r.seed! <= cutoff,
          }))
      : [],
  };
  const record = await tx.qualifierStanding.create({
    data: {
      tournamentId,
      stageId: action.stageId,
      version: action.baseVersion + 1,
      sourceHash: reviewed.sourceHash,
      snapshot: json(snapshot),
    },
  });
  await audit(tx, actor, action, {
    standingId: record.id,
    version: record.version,
    sourceHash: record.sourceHash,
    tieResolution,
    cutoff,
  });
  return record;
}

async function audit(
  tx: Prisma.TransactionClient,
  actor: Actor,
  action: QualifierStandingsAction,
  details: unknown,
) {
  await tx.auditLog.create({
    data: {
      tournamentId: actor.tournamentId || 'main',
      actorId: actor.id,
      action: action.type,
      entityType: 'qualifierStanding',
      entityId: action.stageId,
      details: json(details),
    },
  });
}

export async function finalizedQualifierSeeds(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  standingId: string,
) {
  tx = scopedDb(tx, tournamentId);
  const record = await tx.qualifierStanding.findFirst({ where: { id: standingId, tournamentId } });
  if (!record) throw new AppError('Qualifier standings not found.', 404);
  await lockStage(tx, record.stageId, tournamentId);
  const latest = await tx.qualifierStanding.findFirst({
    where: { stageId: record.stageId, tournamentId },
    orderBy: { version: 'desc' },
  });
  if (latest?.id !== record.id)
    throw new AppError(
      'Qualifier seeds were reopened or superseded. Review and explicitly rebuild or reconcile the affected bracket before starting it.',
      409,
    );
  const snapshot = qualifierStandingSnapshot(record.snapshot);
  if (snapshot.state !== 'FINALIZED' || !snapshot.calculation.canFinalize)
    throw new AppError('Use finalized, resolved qualifier seeds.', 409);
  const { calculation } = await loadQualifierCalculation(tx, record.stageId, tournamentId);
  if (record.sourceHash !== calculation.sourceHash)
    throw new AppError(
      'Finalized standings are stale. Review source and downstream competition changes.',
      409,
    );
  return snapshot.seeds.filter((s) => s.qualified).map(({ teamId, seed }) => ({ teamId, seed }));
}

export type PublishedQualifierStandings = {
  id: string;
  version: number;
  stageName: string;
  finalizedAt: string;
  cutoff: number | null;
  method: QualifierCalculation['policy']['method'];
  gameplayScoring: QualifierCalculation['gameplayScoring'];
  rows: QualifierCalculation['rows'];
};
export async function publishedQualifierStandings(
  tournamentId: string,
  stageId: string,
): Promise<PublishedQualifierStandings | null> {
  const tx = scopedDb(rootDb, tournamentId);
  const tournament = await tx.tournament.findFirst({
    where: { id: tournamentId, published: true, archivedAt: null },
    select: { id: true },
  });
  if (!tournament) return null;
  const record = await tx.qualifierStanding.findFirst({
    where: { tournamentId, stageId, published: true },
    orderBy: { version: 'desc' },
  });
  if (!record) return null;
  const latest = await tx.qualifierStanding.findFirst({
    where: { tournamentId, stageId },
    orderBy: { version: 'desc' },
  });
  if (latest?.id !== record.id) return null;
  const snapshot = qualifierStandingSnapshot(record.snapshot);
  if (snapshot.state !== 'FINALIZED' || !snapshot.finalizedAt) return null;
  const { stage, calculation } = await loadQualifierCalculation(tx, stageId, tournamentId);
  if (record.sourceHash !== calculation.sourceHash) return null;
  return {
    id: record.id,
    version: record.version,
    stageName: stage.name,
    finalizedAt: snapshot.finalizedAt,
    cutoff: snapshot.cutoff,
    method: snapshot.calculation.policy.method,
    gameplayScoring: snapshot.calculation.gameplayScoring,
    rows: snapshot.calculation.rows,
  };
}

function calculationWitness(calculation: QualifierCalculation) {
  const bySlot = <T extends { slotName: string }>(values: T[]) =>
    [...values].sort((a, b) => (a.slotName < b.slotName ? -1 : a.slotName > b.slotName ? 1 : 0));
  const byId = <T extends { id: string }>(values: T[]) =>
    [...values].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const references = (values: QualifierCalculation['references']) =>
    bySlot(values).map((r) => ({ ...r, participantIds: [...r.participantIds].sort() }));
  const maps = (values: QualifierCalculation['rows'][number]['selected']) =>
    bySlot(values).map((m) => ({
      ...m,
      scoreIds: [...m.scoreIds].sort(),
      players: [...m.players].sort((a, b) => a.osuId - b.osuId),
    }));
  return {
    calculationVersion: calculation.calculationVersion,
    formula: calculation.formula,
    formulaReference: calculation.formulaReference,
    policy: calculation.policy,
    gameplayScoring: calculation.gameplayScoring,
    source: {
      tournamentId: calculation.source.tournamentId,
      stageId: calculation.source.stageId,
      policy: calculation.source.policy,
      gameplayScoring: calculation.source.gameplayScoring,
      participants: byId(calculation.source.participants).map((p) => ({
        ...p,
        roster: [...p.roster].sort((a, b) => a - b),
      })),
      maps: bySlot(calculation.source.maps),
      scores: byId(calculation.source.scores).map((s) => ({ ...s, mods: [...s.mods].sort() })),
    },
    references: references(calculation.references),
    frozenRunReferences: references(calculation.frozenRunReferences),
    rows: [...calculation.rows]
      .sort((a, b) =>
        a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0,
      )
      .map((r) => ({
        ...r,
        selected: maps(r.selected),
        breakdown: bySlot(r.breakdown),
        runs: [...r.runs]
          .sort((a, b) => a.run - b.run)
          .map((run) => ({ ...run, maps: maps(run.maps) })),
      })),
    errors: calculation.issues
      .filter((i) => i.severity === 'ERROR')
      .map((i) => canonicalQualifierJson(i))
      .sort(),
  };
}

// Import-only reconciliation: recomputation is a witness, never a replacement for historical rank/tie decisions.
export async function rebindImportedQualifierStandings(
  tx: Prisma.TransactionClient,
  tournamentId: string,
) {
  tx = scopedDb(tx, tournamentId);
  const records = await tx.qualifierStanding.findMany({
    where: { tournamentId },
    orderBy: [{ stageId: 'asc' }, { version: 'asc' }],
  });
  const report = { rebound: 0, skipped: 0, warnings: [] as string[] };
  const calculations = new Map<string, QualifierCalculation>();
  for (const record of records) {
    try {
      const stored = qualifierStandingSnapshot(record.snapshot);
      if (stored.calculation.calculationVersion !== QUALIFIER_CALCULATION_VERSION)
        throw new Error('Unknown calculation formula/version.');
      let fresh = calculations.get(record.stageId);
      if (!fresh) {
        await lockStage(tx, record.stageId, tournamentId);
        fresh = (await loadQualifierCalculation(tx, record.stageId, tournamentId)).calculation;
        calculations.set(record.stageId, fresh);
      }
      if (record.sourceHash === fresh.sourceHash) {
        report.skipped++;
        continue;
      }
      const reviewed = stored.tieResolution
        ? resolveQualifierTies(fresh, stored.tieResolution.order)
        : fresh;
      if (stored.state === 'FINALIZED' && !reviewed.canFinalize)
        throw new Error('Restored sources cannot reproduce finalized seeds.');
      if (
        canonicalQualifierJson(calculationWitness(stored.calculation)) !==
        canonicalQualifierJson(calculationWitness(reviewed))
      )
        throw new Error(
          'Restored scores, selection, statistics or historical ranking values differ.',
        );
      const seeds = stored.calculation.rows
        .filter((r) => r.seed !== null)
        .map((r) => ({
          teamId: r.participantId,
          seed: r.seed!,
          qualified: stored.cutoff === null || r.seed! <= stored.cutoff,
        }));
      if (
        stored.state === 'FINALIZED' &&
        canonicalQualifierJson([...stored.seeds].sort((a, b) => a.seed - b.seed)) !==
          canonicalQualifierJson(seeds.sort((a, b) => a.seed - b.seed))
      )
        throw new Error(
          'Stored finalized seeds or cutoff do not match the preserved historical ranking.',
        );
      const snapshot: QualifierStandingSnapshot = {
        ...stored,
        calculation: { ...stored.calculation, sourceHash: fresh.sourceHash, source: fresh.source },
        importProvenance: [
          ...(stored.importProvenance || []),
          {
            originalSourceHash: record.sourceHash,
            reboundSourceHash: fresh.sourceHash,
            reboundAt: new Date().toISOString(),
            calculationVersion: QUALIFIER_CALCULATION_VERSION,
          },
        ],
      };
      await tx.qualifierStanding.update({
        where: { id: record.id, tournamentId },
        data: { sourceHash: fresh.sourceHash, snapshot: json(snapshot) },
      });
      report.rebound++;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError
      )
        throw error;
      report.skipped++;
      report.warnings.push(
        `Qualifier standings ${record.id} v${record.version} remain stale: ${error instanceof Error ? error.message : 'unverifiable snapshot'}`,
      );
    }
  }
  return report;
}
