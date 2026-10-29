import type { Prisma } from '@/generated/prisma/client';
import { Prisma as PrismaValues } from '@/generated/prisma/client';
import {
  advanceConfirmedCompetitionResult,
  assertCompetitionResultCorrection,
  previewCompetitionCorrection,
} from './competition-service';
import { AppError, assertPermission, type Actor } from './permissions';
import { firstTo, matchRulesSchema } from './match-rules';
import { matchInclude, type MatchRecord } from './match-record';
import type { OrganizerResultAction } from './match-results-contract';
import { resultFingerprint, verifyMatchResultReview } from './match-result-review';
import { organizerRefereeCredit } from './match-display';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export async function resultCorrectionImpact(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  match: Pick<MatchRecord, 'id' | 'status' | 'winnerSide'>,
  winnerSide: 'A' | 'B' | null,
) {
  const impact = await previewCompetitionCorrection(tx, tournamentId, match.id, winnerSide);
  const matches = impact.affected.length
    ? await tx.match.findMany({
        where: { id: { in: impact.affected.map((row) => row.matchId) }, tournamentId },
        select: { id: true, matchNumber: true },
      })
    : [];
  return {
    hash: impact.hash,
    blocked: impact.blocked,
    requiresApproval: match.status === 'COMPLETED' && impact.affected.length > 0,
    affected: impact.affected.map((row) => ({
      matchNumber: matches.find((m) => m.id === row.matchId)!.matchNumber,
      protected: row.protected,
    })),
  };
}

/** Organizer confirmation preserves referee actions/results and records a separate overall decision. */
export async function applyOrganizerResult(
  tx: Prisma.TransactionClient,
  actor: Actor,
  match: MatchRecord,
  action: OrganizerResultAction,
) {
  assertPermission(actor, 'matches.manage');
  const tournamentId = actor.tournamentId || 'main';
  if (match.tournamentId !== tournamentId) throw new AppError('Match not found.', 404);
  if (!match.teamAId || !match.teamBId)
    throw new AppError('Resolve both opponents before recording a result.', 409);
  if (match.status === 'CANCELLED')
    throw new AppError('Reopen a cancelled match before recording a result.', 409);
  const rules = matchRulesSchema.parse(match.rules),
    target = firstTo(rules);
  let scoreA = 0,
    scoreB = 0,
    winnerSide: 'A' | 'B' | null = null,
    forfeitSide: 'A' | 'B' | null = null;
  let imported: ReturnType<typeof verifyMatchResultReview> | null = null;
  const beforeGames: unknown[] = [];
  if (action.type === 'match.result.set') {
    ({ scoreA, scoreB, winnerSide, forfeitSide } = action);
    if (
      Math.max(scoreA, scoreB) > target ||
      Math.min(scoreA, scoreB) >= target ||
      winnerSide !== (scoreA === target ? 'A' : scoreB === target ? 'B' : null) ||
      (!!forfeitSide && (!winnerSide || forfeitSide === winnerSide))
    )
      throw new AppError(
        'The result must contain exactly one match winner at the configured win target.',
      );
  } else {
    imported = verifyMatchResultReview(action.token, actor, match.id, action.baseVersion);
    if (
      new Set(action.decisions.map((row) => row.gameId)).size !== action.decisions.length ||
      action.decisions.length !== imported.games.length
    )
      throw new AppError('Review every multiplayer game exactly once.');
    if (
      action.decisions.some(
        (row) => !imported!.games.some((game) => game.evidence.gameId === row.gameId),
      )
    )
      throw new AppError('A selected game is not part of the reviewed lobby.');
    for (const game of imported.games) {
      const decision = action.decisions.find((row) => row.gameId === game.evidence.gameId)!;
      if (!decision.included) continue;
      if (!game.evidence.endTime || !decision.winnerSide)
        throw new AppError('Select a winner only for a completed multiplayer game.');
      if (
        (!game.proposal || game.proposal.winnerSide !== decision.winnerSide) &&
        decision.reason.trim().length < 3
      )
        throw new AppError('Explain each manual game winner or correction.');
      if (Math.max(scoreA, scoreB) >= target)
        throw new AppError('Exclude warmups or games after the match-winning point.');
      decision.winnerSide === 'A' ? scoreA++ : scoreB++;
    }
    if (!scoreA && !scoreB) throw new AppError('Include at least one completed game.');
    winnerSide = scoreA >= target ? 'A' : scoreB >= target ? 'B' : null;
    if (action.confirm && !winnerSide)
      throw new AppError(
        'The selected games do not contain a complete match result. Save the history without confirmation or correct the selection.',
      );
  }
  const source = (
    match.source && typeof match.source === 'object' && !Array.isArray(match.source)
      ? match.source
      : {}
  ) as Record<string, unknown>;
  const importHash =
    imported &&
    resultFingerprint({
      metadata: imported.metadata,
      games: imported.games,
      decisions:
        action.type === 'match.result.import'
          ? imported.games.map((game) =>
              action.decisions.find((row) => row.gameId === game.evidence.gameId),
            )
          : [],
    });
  const status =
    action.confirm && winnerSide
      ? 'COMPLETED'
      : winnerSide
        ? 'AWAITING_CONFIRMATION'
        : 'IN_PROGRESS';
  if (
    importHash &&
    (source.organizerResult as { importHash?: string } | undefined)?.importHash === importHash &&
    match.status === status &&
    match.scoreA === scoreA &&
    match.scoreB === scoreB
  )
    return { id: match.id, version: match.version, unchanged: true };
  const proposedWinner = action.confirm ? winnerSide : null;
  const impact = await assertCompetitionResultCorrection(
    tx,
    tournamentId,
    match.id,
    proposedWinner,
    match.status !== 'COMPLETED' || action.approveProgression,
  );
  if (impact.affected.length && action.correctionHash !== impact.hash)
    throw new AppError('Downstream progression changed since the preview. Review it again.', 409);
  if (imported && action.type === 'match.result.import') {
    const missing = await tx.multiplayerGame.findMany({
      where: {
        matchId: match.id,
        multiplayerId: imported.metadata.id,
        gameId: { notIn: imported.games.map((game) => game.evidence.gameId) },
        ignoredAt: null,
      },
    });
    for (const game of missing) {
      beforeGames.push(game);
      await tx.multiplayerGame.update({ where: { id: game.id }, data: { ignoredAt: new Date() } });
    }
    // These rows record games, not invented picks, bans, rolls or pick ownership.
    for (const game of imported.games) {
      const decision = action.decisions.find((row) => row.gameId === game.evidence.gameId)!;
      const where = {
        matchId_multiplayerId_gameId: {
          matchId: match.id,
          multiplayerId: imported.metadata.id,
          gameId: game.evidence.gameId,
        },
      };
      const previous = await tx.multiplayerGame.findUnique({ where });
      if (previous) beforeGames.push(previous);
      const proposal = {
        ...game.proposal,
        organizerReview: { ...decision, actorId: actor.id, importedAt: new Date().toISOString() },
      };
      const values = {
        beatmapId: game.evidence.beatmapId,
        slotName: game.evidence.slotName,
        evidence: json(game.evidence),
        proposal: json(proposal),
        confirmedAt: new Date(),
        ignoredAt: decision.included ? null : new Date(),
      };
      await tx.multiplayerGame.upsert({
        where,
        create: {
          matchId: match.id,
          multiplayerId: imported.metadata.id,
          gameId: game.evidence.gameId,
          ...values,
        },
        update: values,
      });
    }
  }
  const updated = await tx.match.updateMany({
    where: { id: match.id, tournamentId, version: action.baseVersion },
    data: {
      scoreA,
      scoreB,
      winnerSide,
      forfeitSide,
      resultMode: 'SUMMARY',
      status,
      timerStartedAt: null,
      timerRemainingSeconds: 0,
      submittedAt: winnerSide ? new Date() : null,
      completedAt: action.confirm && winnerSide ? new Date() : null,
      source: json({
        ...source,
        ...(action.type === 'match.result.set' ? { referee: action.externalReferee } : {}),
        organizerResult: {
          origin: imported ? 'MULTIPLAYER' : 'MANUAL',
          externalReferee:
            action.type === 'match.result.set'
              ? action.externalReferee
              : organizerRefereeCredit(source),
          reason: action.reason,
          importHash,
          metadata: imported?.metadata || null,
          redSide: imported?.redSide || 'A',
          warmups: imported?.warmups || 0,
          playerSides: imported?.playerSides || {},
        },
      }),
      ...(imported
        ? {
            multiplayerId: imported.metadata.id,
            lobbyUrl: `https://osu.ppy.sh/community/matches/${imported.metadata.id}`,
            multiplayerSync: PrismaValues.DbNull,
            multiplayerError: null,
            multiplayerSyncedAt: new Date(),
          }
        : {}),
      version: { increment: 1 },
    },
  });
  if (updated.count !== 1) throw new AppError('The match changed. Reload before saving.', 409);
  const snapshot = await tx.match.findUniqueOrThrow({
    where: { id: match.id },
    include: matchInclude,
  });
  await tx.matchEvent.create({
    data: {
      matchId: match.id,
      version: snapshot.version,
      actorId: actor.id,
      kind: action.type,
      notes: action.reason,
      data: json({
        before: match,
        beforeGames,
        result: { scoreA, scoreB, winnerSide, forfeitSide, status },
        ...(action.type === 'match.result.import'
          ? { metadata: imported!.metadata, decisions: action.decisions }
          : { externalReferee: action.externalReferee }),
      }),
    },
  });
  await tx.matchResultRevision.create({
    data: {
      matchId: match.id,
      version: snapshot.version,
      createdBy: actor.id,
      kind: action.type,
      reason: action.reason,
      snapshot: json(snapshot),
    },
  });
  await advanceConfirmedCompetitionResult(tx, tournamentId, match.id, actor.id);
  // Also retract unstarted downstream positions when an imported history is deliberately left unconfirmed.
  if (status !== 'COMPLETED' && match.status === 'COMPLETED') {
    const { synchronizeCompetitionResults } = await import('./competition-service');
    await synchronizeCompetitionResults(tx, tournamentId, actor.id);
  }
  return { id: match.id, version: snapshot.version };
}
