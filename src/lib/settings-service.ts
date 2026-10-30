import { Prisma } from '@/generated/prisma/client';
import type { AdminAction } from './validation';
import { AppError, assertPermission, type Actor } from './permissions';
import { inheritedRules } from './gameplay-scoring';
import { assertScoringChange } from './gameplay-scoring-service';
import { scopedDb } from './scoped-db';

// The dispatcher owns the transaction, global lock, refreshed actor and audit.
export async function applySettingsAction(
  transaction: Prisma.TransactionClient,
  actor: Actor,
  tournamentId: string,
  a: Extract<AdminAction, { type: 'settings.save' }>,
) {
  assertPermission(actor, 'settings.manage');
  if (actor.tournamentId !== tournamentId)
    throw new AppError('Choose settings from the current tournament.', 403);
  const tx = scopedDb(transaction, tournamentId);
  const tournament = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
  if (tournament.version !== a.baseVersion)
    throw new AppError('Tournament settings changed. Reload and review before saving.', 409);
  const {
    type,
    baseVersion,
    name,
    acronym,
    description,
    status,
    gameMode,
    timezone,
    format,
    startsAt,
    endsAt,
    scoringReview,
    ...settings
  } = a;
  void type;
  void baseVersion;
  const currentSettings = await tx.tournamentSettings.findUniqueOrThrow({
    where: { tournamentId },
  });
  if (a.gameplayScoring === null && currentSettings.gameplayScoring)
    throw new AppError(
      'An established gameplay scoring system cannot be cleared. Choose a supported mode and review its impact.',
      409,
    );
  if (a.gameplayScoring && a.gameplayScoring !== currentSettings.gameplayScoring) {
    await assertScoringChange(
      tx,
      tournamentId,
      currentSettings.gameplayScoring,
      a.gameplayScoring,
      !!scoringReview,
    );
    // Scheduled, unplayed snapshots may follow a configuration change.
    // Recorded competitive snapshots are never rewritten.
    for (const match of await tx.match.findMany({
      where: { status: 'SCHEDULED' },
      include: { actions: true, results: true },
    })) {
      if (match.actions.length || match.results.length) continue;
      await tx.match.update({
        where: { id: match.id },
        data: {
          rules: JSON.parse(
            JSON.stringify(
              inheritedRules(match.rules, a.gameplayScoring, gameMode ?? tournament.gameMode),
            ),
          ),
          version: { increment: 1 },
        },
      });
      await tx.matchEvent.create({
        data: {
          matchId: match.id,
          version: match.version + 1,
          actorId: actor.id,
          kind: 'scoring.configuration',
          data: { before: currentSettings.gameplayScoring, after: a.gameplayScoring },
        },
      });
    }
    for (const lobby of await tx.qualifierLobby.findMany({
      where: { status: 'SCHEDULED' },
      include: { scores: true },
    })) {
      if (lobby.scores.length) continue;
      await tx.qualifierLobby.update({
        where: { id: lobby.id },
        data: {
          gameplayScoring: a.gameplayScoring,
          rules: JSON.parse(
            JSON.stringify(
              inheritedRules(lobby.rules, a.gameplayScoring, gameMode ?? tournament.gameMode),
            ),
          ),
          version: { increment: 1 },
        },
      });
      await tx.qualifierEvent.create({
        data: {
          lobbyId: lobby.id,
          version: lobby.version + 1,
          actorId: actor.id,
          kind: 'scoring.configuration',
          data: { before: currentSettings.gameplayScoring, after: a.gameplayScoring },
        },
      });
    }
  }
  if (timezone)
    try {
      new Intl.DateTimeFormat('en', { timeZone: timezone });
    } catch {
      throw new AppError('Choose a valid IANA timezone.');
    }
  if (
    gameMode &&
    gameMode !== tournament.gameMode &&
    (await tx.mappool.count({ where: { state: 'PUBLISHED' } })) > 0
  )
    throw new AppError('Unpublish all mappools before changing the game mode.');
  await tx.tournament.update({
    where: { id: tournamentId, version: a.baseVersion },
    data: {
      name,
      acronym,
      description,
      status,
      gameMode,
      timezone,
      format,
      startsAt,
      endsAt,
      version: { increment: 1 },
      settings: {
        update: {
          ...settings,
          registrationPolicy:
            settings.registrationPolicy === null ? Prisma.DbNull : settings.registrationPolicy,
        },
      },
    },
  });
}
