import { Prisma } from '@/generated/prisma/client';
import { z } from 'zod';
import { db as rootDb } from './db';
import { historicalScoring, tournamentScoring } from './gameplay-scoring';
import { convertedScore } from './match-engine';
import { qualifierEffectiveScore } from './qualifier-score';
import { matchRulesSchema } from './match-rules';
import { AppError, can, type Actor } from './permissions';
import { publicTournamentWhere } from './public-visibility';
import { qualifierPolicySchema } from './qualifier-policy';
import { qualifierTeamModViolation } from './qualifier-eligibility';
import { scopedDb } from './scoped-db';

import {
  calculateQualifierStandings,
  QUALIFIER_CALCULATION_VERSION,
  PREVIOUS_QUALIFIER_CALCULATION_VERSION,
  LEGACY_QUALIFIER_CALCULATION_VERSION,
  canonicalQualifierJson,
  qualifierSourceHash,
  type QualifierIssue,
  type QualifierSeedingInput,
} from './qualifier-seeding';

import type {
  PublishedQualifierStandings,
  QualifierCorrectionImpact,
  QualifierStandingsData,
} from './qualifier-standings-contract';
import { qualifierStandingSnapshot } from './qualifier-standings-contract';
export const rosterSchema = z.array(
  z.object({
    id: z.string().nullable(),
    name: z.string(),
    members: z.array(z.object({ osuId: z.number().int().positive() })),
  }),
);
export async function lockStage(
  tx: Prisma.TransactionClient,
  stageId: string,
  tournamentId: string,
) {
  // Qualifier capture and finalization acquire this same row lock before touching source records.
  const stages = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "TournamentStage" WHERE "id" = ${stageId} AND "tournamentId" = ${tournamentId} FOR UPDATE`;
  if (!stages.length) throw new AppError('Qualifier stage not found.', 404);
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
              matchNumber: true,
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
          {
            id: m.id,
            code: m.code,
            matchNumber: m.matchNumber,
            reason: 'Recorded competitive results or gameplay exist.',
          },
        ];
      return m.startedAt ||
        m.submittedAt ||
        m.completedAt ||
        !['SCHEDULED', 'CANCELLED'].includes(m.status)
        ? [
            {
              id: m.id,
              code: m.code,
              matchNumber: m.matchNumber,
              reason: 'The downstream match has started or progressed.',
            },
          ]
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
  requestedVersion?: string,
) {
  tx = scopedDb(tx, tournamentId);
  let calculationVersion = requestedVersion || QUALIFIER_CALCULATION_VERSION;
  if (!requestedVersion) {
    const latest = await tx.qualifierStanding.findFirst({
      where: { stageId, tournamentId },
      orderBy: { version: 'desc' },
    });
    if (latest) {
      const saved = qualifierStandingSnapshot(latest.snapshot);
      if (
        saved.state === 'FINALIZED' &&
        [LEGACY_QUALIFIER_CALCULATION_VERSION, PREVIOUS_QUALIFIER_CALCULATION_VERSION].includes(
          saved.calculation.calculationVersion,
        )
      )
        calculationVersion = saved.calculation.calculationVersion;
    }
  }
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
      games: { orderBy: { id: 'asc' } },
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
      originalScores: lobby.scores.map(
        ({ eligible, eligibilityReason, passed, eligibilityOverride, ...s }) => ({
          ...s,
          ...(calculationVersion === QUALIFIER_CALCULATION_VERSION
            ? { passed, eligibilityOverride }
            : {}),
          ...(eligible === false || eligibilityReason ? { eligible, eligibilityReason } : {}),
          updatedAt: s.updatedAt.toISOString(),
        }),
      ),
      ...(lobby.games.length
        ? {
            games: lobby.games.map((game) => ({
              ...game,
              createdAt: game.createdAt.toISOString(),
              updatedAt: game.updatedAt.toISOString(),
              startedAt: game.startedAt?.toISOString() || null,
            })),
          }
        : {}),
      ...((lobby.multiplayerSync as { complete?: boolean } | null)?.complete === false
        ? { incompleteHistory: true }
        : {}),
    });
    if (lobby.status === 'CANCELLED') continue;
    if (lobby.games.some((game) => game.status === 'PENDING'))
      add('PENDING_GAMES', `${lobby.code} has multiplayer games requiring review.`);
    if ((lobby.multiplayerSync as { complete?: boolean } | null)?.complete === false)
      add('INCOMPLETE_HISTORY', `${lobby.code} has incomplete multiplayer history.`);
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
      const slot = lobby.poolRevision.slots.find((s) => s.name === score.slotName);
      const team = parsed.data.find((team) => team.members.some((p) => p.osuId === score.osuId));
      const teamScores = lobby.scores.filter(
        (s) =>
          s.eligible &&
          s.slotName === score.slotName &&
          s.run === score.run &&
          team?.members.some((p) => p.osuId === s.osuId),
      );
      const teamViolation =
        calculationVersion === LEGACY_QUALIFIER_CALCULATION_VERSION || !slot
          ? null
          : qualifierTeamModViolation(
              rules,
              slot.category,
              teamScores.map((s) => ({ ...s, mods: s.mods as string[] })),
            );
      try {
        const expected =
          calculationVersion === QUALIFIER_CALCULATION_VERSION
            ? qualifierEffectiveScore(
                rules,
                lobbyPolicy.success ? lobbyPolicy.data : policy,
                score.raw,
                mods,
                score.slotName,
              )
            : convertedScore(rules, score.raw, mods, score.slotName).adjusted;
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
        ...(calculationVersion === QUALIFIER_CALCULATION_VERSION
          ? { passed: score.passed, eligibilityOverride: score.eligibilityOverride }
          : {}),
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
        ...(score.eligible === false || score.eligibilityReason || teamViolation
          ? {
              eligible: score.eligible && !teamViolation,
              eligibilityReason: score.eligibilityReason || teamViolation || '',
            }
          : {}),
      });
    }
  }
  const calculation = calculateQualifierStandings(
    {
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
    },
    calculationVersion,
  );
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
export async function publishedQualifierStandings(
  tournamentId: string,
  stageId: string,
): Promise<PublishedQualifierStandings | null> {
  const tx = scopedDb(rootDb, tournamentId);
  const tournament = await tx.tournament.findFirst({
    where: { id: tournamentId, ...publicTournamentWhere },
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
