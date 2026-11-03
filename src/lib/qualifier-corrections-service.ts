import type { Prisma } from '@/generated/prisma/client';
import { AppError, assertPermission, type Actor } from './permissions';
import { scopedDb } from './scoped-db';
import { inheritedRules } from './gameplay-scoring';
import { matchRulesSchema } from './match-rules';
import { qualifierPolicySchema } from './qualifier-policy';
import { qualifierEffectiveScore, qualifierIndividualViolation } from './qualifier-score';
import { qualifierTeamModViolation } from './qualifier-eligibility';
import { qualifierScoreDecision } from './qualifier-score-decisions';
import { loadQualifierCalculation, lockStage, rosterSchema } from './qualifier-standings-sources';
import { assertQualifierMutable } from './qualifier-standings-service';
import { reconcileQualifierCompletion } from './qualifiers-service';
import {
  calculateQualifierStandings,
  qualifierSourceHash,
  canonicalQualifierJson,
} from './qualifier-seeding';
import type {
  QualifierCorrectionInput,
  QualifierCorrectionReview,
} from './qualifier-corrections-contract';
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

// Caller holds the root lock and refreshes the actor. Preview and application use
// the same projection, stage lock, reviewed source and exact session versions.
export async function reviewQualifierCorrections(
  root: Prisma.TransactionClient,
  actor: Actor,
  input: QualifierCorrectionInput,
): Promise<QualifierCorrectionReview> {
  assertPermission(actor, 'matches.manage');
  const tournamentId = actor.tournamentId!;
  const tx = scopedDb(root, tournamentId);
  await lockStage(tx, input.stageId, tournamentId);
  const before = (await loadQualifierCalculation(tx, input.stageId, tournamentId)).calculation;
  const latest = await tx.qualifierStanding.findFirst({
    where: { stageId: input.stageId },
    orderBy: { version: 'desc' },
  });
  const locked = (latest?.snapshot as { state?: string } | undefined)?.state === 'FINALIZED';
  if (input.apply) await assertQualifierMutable(tx, input.stageId, tournamentId);
  const stage = await tx.tournamentStage.findUniqueOrThrow({ where: { id: input.stageId } });
  const settings = await tx.tournamentSettings.findUniqueOrThrow({ where: { tournamentId } });
  const tournament = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
  const lobbies = await tx.qualifierLobby.findMany({
    where: { stageId: input.stageId },
    include: {
      scores: true,
      games: true,
      events: true,
      poolRevision: { include: { slots: true } },
    },
  });
  const selected = input.lobbies.map((choice) => {
    const lobby = lobbies.find((l) => l.id === choice.id);
    if (!lobby || lobby.version !== choice.baseVersion)
      throw new AppError('The qualifier session changed. Reload the preview.', 409);
    if (
      (lobby.deletedAt && input.operation !== 'REPROCESS') ||
      !['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'].includes(lobby.status)
    )
      throw new AppError('This qualifier session is read only.', 409);
    if (lobby.status === 'COMPLETED' && !lobby.autoCompleted && input.operation !== 'REPROCESS')
      throw new AppError('Reopen this session before correcting scores.', 409);
    const scoreIds = new Set(choice.scoreIds);
    if (
      scoreIds.size !== choice.scoreIds.length ||
      [...scoreIds].some((id) => !lobby.scores.some((s) => s.id === id))
    )
      throw new AppError('Score not found.', 404);
    if (input.operation !== 'REPROCESS' && !scoreIds.size)
      throw new AppError('Select scores before applying a correction.');
    return { lobby, scoreIds };
  });
  if (
    input.policy &&
    lobbies.some((l) => l.status !== 'CANCELLED' && !selected.some((s) => s.lobby.id === l.id))
  )
    throw new AppError('Select every active stage session before changing its scoring policy.');
  if (input.operation === 'EDIT' && selected.reduce((n, s) => n + s.scoreIds.size, 0) !== 1)
    throw new AppError('Edit one score at a time; use a bulk action for multiple scores.');
  const projected = new Map<string, (typeof lobbies)[number]['scores'][number]>();
  const proposedPolicies = new Map<string, ReturnType<typeof qualifierPolicySchema.parse>>();
  const proposedRules = new Map<string, ReturnType<typeof matchRulesSchema.parse>>();
  for (const { lobby, scoreIds } of selected) {
    const rules = input.useStageRules
      ? inheritedRules(
          stage.matchRules || settings.matchRules,
          settings.gameplayScoring,
          tournament.gameMode,
        )
      : matchRulesSchema.parse(lobby.rules);
    const policy =
      input.policy ||
      qualifierPolicySchema.parse(lobby.policy || { requiredPlayers: rules.teamSize });
    proposedPolicies.set(lobby.id, policy);
    proposedRules.set(lobby.id, rules);
    const roster = rosterSchema.parse(lobby.participants);
    for (const score of lobby.scores) {
      const change = input.operation === 'REPROCESS' || scoreIds.has(score.id);
      if (!change) {
        projected.set(score.id, { ...score });
        continue;
      }
      const next = { ...score };
      next.eligibilityOverride = qualifierScoreDecision(score, lobby.events);
      if (input.operation === 'EDIT') Object.assign(next, input.patch, { source: 'MANUAL' });
      if (input.operation === 'REMAP') Object.assign(next, input.destination);
      if (!roster.some((t) => t.members.some((p) => p.osuId === next.osuId)))
        throw new AppError('This player is not in the snapshotted qualifier roster.');
      const slot = lobby.poolRevision.slots.find((s) => s.name === next.slotName);
      if (!slot || next.run > policy.runs)
        throw new AppError('Select a configured qualifier map and run.');
      if (input.operation === 'INCLUDE') next.eligibilityOverride = 'INCLUDE';
      if (input.operation === 'EXCLUDE') next.eligibilityOverride = 'EXCLUDE';
      if (input.operation === 'RESTORE') next.eligibilityOverride = null;
      const mods = next.mods as string[];
      const violation = qualifierIndividualViolation(rules, policy, slot.category, {
        mods,
        passed: next.passed,
        accuracy: next.accuracy,
        maxCombo: next.maxCombo,
        actualScoring: next.actualScoring,
        actualMode: (
          lobby.games.find((g) => `${g.multiplayerId}:${g.gameId}` === next.gameId)?.evidence as
            { game?: { mode?: string } } | undefined
        )?.game?.mode,
      });
      next.eligible =
        next.eligibilityOverride === 'INCLUDE' ||
        (next.eligibilityOverride !== 'EXCLUDE' && !violation);
      next.eligibilityReason = next.eligibilityOverride
        ? next.eligibilityOverride === score.eligibilityOverride
          ? score.eligibilityReason
          : input.reason
        : violation || '';
      next.adjusted = qualifierEffectiveScore(rules, policy, next.raw, mods, next.slotName, next);
      projected.set(next.id, next);
    }
    const keys = new Set<string>();
    for (const score of lobby.scores.map((s) => projected.get(s.id)!)) {
      const key = `${score.osuId}:${score.slotName}:${score.run}`;
      if (keys.has(key))
        throw new AppError(
          'The destination already contains a score. Review the conflicting performance.',
          409,
        );
      keys.add(key);
    }
    if (input.operation === 'REMAP' && (input.destination?.slotName || input.destination?.run))
      for (const gameId of new Set(
        lobby.scores.filter((s) => scoreIds.has(s.id) && s.gameId).map((s) => s.gameId),
      )) {
        if (lobby.scores.some((s) => s.gameId === gameId && !scoreIds.has(s.id)))
          throw new AppError(
            'Select every player score from the game before remapping its map or run.',
          );
      }
  }
  const source = {
    ...before.source,
    policy: input.policy || before.policy,
    scores: before.source.scores.map((score) => {
      const next = projected.get(score.id);
      if (!next) return score;
      const lobby = lobbies.find((l) => l.id === next.lobbyId)!;
      const rules = proposedRules.get(lobby.id)!;
      const roster = rosterSchema.parse(lobby.participants);
      const team = roster.find((t) => t.members.some((p) => p.osuId === next.osuId));
      const slot = lobby.poolRevision.slots.find((s) => s.name === next.slotName)!;
      const peers = lobby.scores
        .map((s) => projected.get(s.id) || s)
        .filter(
          (s) =>
            s.eligible &&
            s.slotName === next.slotName &&
            s.run === next.run &&
            team?.members.some((p) => p.osuId === s.osuId),
        );
      const violation = qualifierTeamModViolation(
        rules,
        slot.category,
        peers.map((s) => ({ ...s, mods: s.mods as string[] })),
      );
      return {
        ...score,
        osuId: next.osuId,
        slotName: next.slotName,
        run: next.run,
        raw: next.raw,
        adjusted: next.adjusted,
        source: next.source,
        passed: next.passed,
        eligibilityOverride: next.eligibilityOverride,
        mods: next.mods as string[],
        participantId: team?.id || score.participantId,
        eligible: next.eligible && !violation,
        eligibilityReason: next.eligibilityReason || violation || '',
      };
    }),
    issues: (before.source.issues || []).filter(
      (issue) =>
        !(
          input.operation === 'REPROCESS' &&
          ['NORMALIZATION_MISMATCH', 'LOBBY_POLICY_MISMATCH'].includes(issue.code) &&
          selected.some(
            ({ lobby }) =>
              issue.message.startsWith(`${lobby.code}:`) ||
              issue.message.startsWith(`${lobby.code} does not match`),
          )
        ),
    ),
  };
  const after = calculateQualifierStandings(source);
  const { apply: _apply, reviewHash: _hash, ...decision } = input;
  void _apply;
  void _hash;
  const reviewHash = qualifierSourceHash({ source: before.sourceHash, decision });
  const changed = [...projected.values()].filter((next) => {
    const old = lobbies.flatMap((l) => l.scores).find((s) => s.id === next.id)!;
    const { updatedAt: _old, ...a } = old;
    const { updatedAt: _next, ...b } = next;
    void _old;
    void _next;
    return canonicalQualifierJson(a) !== canonicalQualifierJson(b);
  });
  const review: QualifierCorrectionReview = {
    reviewHash,
    changed: changed.length,
    locked,
    issues: after.issues,
    rows: after.rows.map((row) => {
      const old = before.rows.find((r) => r.participantId === row.participantId);
      return {
        id: row.participantId,
        name: row.name,
        before: old?.value ?? null,
        after: row.value,
        beforeSeed: old?.seed ?? null,
        afterSeed: row.seed,
      };
    }),
    affected: changed.map((s) => ({
      id: s.id,
      osuId: s.osuId,
      slotName: s.slotName,
      run: s.run,
      raw: s.raw,
      adjusted: s.adjusted,
      eligible: s.eligible,
      eligibilityReason: s.eligibilityReason,
    })),
  };
  if (!input.apply) return review;
  if (input.reviewHash !== reviewHash)
    throw new AppError(
      'Qualifier sources or correction choices changed. Refresh the impact preview.',
      409,
    );
  if (input.policy)
    await tx.tournamentStage.update({
      where: { id: stage.id },
      data: { qualifierPolicy: json(input.policy) },
    });
  for (const { lobby } of selected) {
    const changes = changed.filter((s) => s.lobbyId === lobby.id);
    for (const score of changes) {
      const { id, updatedAt: _time, lobbyId: _lobby, ...fields } = score;
      void _time;
      void _lobby;
      await tx.qualifierScore.update({
        where: { id },
        data: { ...fields, mods: json(fields.mods) },
      });
    }
    if (input.operation === 'REMAP')
      for (const gameId of new Set(changes.flatMap((s) => (s.gameId ? [s.gameId] : [])))) {
        const [mp, game] = gameId.split(':');
        const first = changes.find((s) => s.gameId === gameId)!;
        const receipt = lobby.games.find(
          (g) => g.multiplayerId === Number(mp) && g.gameId === game,
        );
        const previousMapping =
          (
            receipt?.evidence as
              { reviewedMapping?: { players?: Record<string, number> } } | undefined
          )?.reviewedMapping?.players || {};
        const players = { ...previousMapping };
        for (const next of changes.filter((s) => s.gameId === gameId)) {
          const old = lobby.scores.find((s) => s.id === next.id)!;
          const original =
            Object.keys(players).find((key) => players[key] === old.osuId) || String(old.osuId);
          players[original] = next.osuId;
        }
        if (receipt)
          await tx.qualifierGame.update({
            where: { id: receipt.id },
            data: {
              slotName: first.slotName,
              run: first.run,
              evidence: json({
                ...(receipt.evidence as object),
                reviewedMapping: { slotName: first.slotName, run: first.run, players },
              }),
              version: { increment: 1 },
            },
          });
      }
    if (['RESTORE', 'INCLUDE'].includes(input.operation))
      for (const gameId of new Set(changes.flatMap((s) => (s.gameId ? [s.gameId] : [])))) {
        const receipt = lobby.games.find((g) => `${g.multiplayerId}:${g.gameId}` === gameId);
        if (receipt?.status === 'IGNORED')
          await tx.qualifierGame.update({
            where: { id: receipt.id },
            data: { status: 'ACCEPTED', reason: input.reason, version: { increment: 1 } },
          });
      }
    const updated = await tx.qualifierLobby.update({
      where: { id: lobby.id, version: lobby.version },
      data: {
        version: { increment: 1 },
        ...(input.policy ? { policy: json(input.policy) } : {}),
        ...(input.useStageRules ? { rules: json(proposedRules.get(lobby.id)!) } : {}),
      },
    });
    await tx.qualifierEvent.create({
      data: {
        lobbyId: lobby.id,
        actorId: actor.id,
        version: updated.version,
        kind: 'qualifier.scores.correct',
        reason: input.reason,
        data: json({
          operation: input.operation,
          before: lobby.scores.filter((s) => changes.some((n) => n.id === s.id)),
          after: changes,
          beforePolicy: lobby.policy,
          afterPolicy: proposedPolicies.get(lobby.id),
          reviewHash,
        }),
      },
    });
    await reconcileQualifierCompletion(tx, actor, lobby.id);
  }
  await tx.auditLog.create({
    data: {
      tournamentId,
      actorId: actor.id,
      action: 'qualifier.scores.correct',
      entityType: 'TournamentStage',
      entityId: stage.id,
      details: json({
        operation: input.operation,
        reason: input.reason,
        reviewHash,
        scoreIds: changed.map((s) => s.id),
      }),
    },
  });
  return { ...review, applied: true };
}
