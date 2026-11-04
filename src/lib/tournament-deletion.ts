import type { Prisma } from '@/generated/prisma/client';
import { queueMediaCleanup, recoverMediaCleanup } from './media-cleanup';
import { AppError } from './permissions';
import { scopedDb } from './scoped-db';

const activeStatuses = ['IN_PROGRESS', 'AWAITING_CONFIRMATION', 'DISPUTED'] as const;
const cleanupBatch = 200;

// The same states that stop a bracket from being deleted. A room on Bancho outlives its records.
async function assertNothingActive(tx: Prisma.TransactionClient, tournamentId: string) {
  const live = { tournamentId, deletedAt: null, status: { in: [...activeStatuses] } };
  const matches = await tx.match.findMany({
    where: live,
    select: { code: true, matchNumber: true },
  });
  const lobbies = await tx.qualifierLobby.findMany({ where: live, select: { code: true } });
  if (matches.length || lobbies.length)
    throw new AppError(
      'Finish or cancel active matches and qualifier lobbies before deleting this tournament: {0}.',
      409,
      [
        [
          ...matches.map((match) => match.matchNumber ?? match.code),
          ...lobbies.map((lobby) => lobby.code),
        ].join(', '),
      ],
    );
  if (
    await tx.ircLobbyRequest.count({
      where: { tournamentId, status: { in: ['PENDING', 'UNKNOWN'] } },
    })
  )
    throw new AppError(
      'Resolve pending or uncertain lobby creation before deleting this tournament.',
      409,
    );
}

// The caller holds the root lock and has checked who is asking. Players, accounts and beatmaps are
// shared between tournaments, so they stay. Uploaded files are queued here and removed after commit.
export async function deleteTournamentRecords(
  root: Prisma.TransactionClient,
  tournamentId: string,
) {
  await assertNothingActive(root, tournamentId);
  const tx = scopedDb(root, tournamentId);
  const where = { tournamentId };
  const media = await tx.mediaAsset.findMany({ where, select: { key: true } });
  const counts = {
    teams: await tx.team.count({ where }),
    matches: await tx.match.count({ where }),
    files: media.length,
  };
  // This order follows the foreign keys that refuse a delete. Whatever is not named here goes with
  // its parent, or with the tournament itself, through a cascade.
  await tx.formationLot.deleteMany({ where });
  await tx.formationEvent.deleteMany({ where });
  await tx.formationTeam.deleteMany({ where });
  await tx.formationSession.deleteMany({ where });
  await tx.resourcePurchase.deleteMany({ where });
  await tx.resourceAdjustment.deleteMany({ where });
  await tx.resourceItem.deleteMany({ where });
  await tx.tournamentPhase.deleteMany({ where });
  await tx.bracketSlot.deleteMany({ where });
  await tx.bracketNode.deleteMany({ where });
  await tx.bracketRound.deleteMany({ where });
  await tx.bracketEntry.deleteMany({ where });
  await tx.bracket.deleteMany({ where });
  await tx.multiplayerGame.deleteMany({ where: { match: where } });
  await tx.match.deleteMany({ where });
  await tx.qualifierStanding.deleteMany({ where });
  await tx.qualifierLobby.deleteMany({ where });
  await tx.poolCandidate.deleteMany({ where });
  await tx.mappool.updateMany({
    where,
    data: { draftRevisionId: null, publishedRevisionId: null },
  });
  await tx.mappoolRevision.deleteMany({ where });
  await tx.mappool.deleteMany({ where });
  await tx.tournamentStage.updateMany({ where, data: { nextStageId: null } });
  await tx.tournamentStage.deleteMany({ where });
  await tx.team.deleteMany({ where });
  await tx.staffMember.deleteMany({ where });
  await tx.refereeImport.deleteMany({ where });
  await tx.auditLog.deleteMany({ where });
  await tx.role.deleteMany({ where });
  await tx.page.updateMany({
    where,
    data: { draftRevisionId: null, publishedRevisionId: null },
  });
  await tx.page.deleteMany({ where });
  await tx.mediaAsset.deleteMany({ where });
  for (const { key } of media) await queueMediaCleanup(root, key);
  // The site cannot feature a tournament that no longer exists, so it lists the others instead.
  await root.platformSettings.updateMany({
    where: { defaultTournamentId: tournamentId },
    data: { defaultTournamentId: null, rootMode: 'DIRECTORY' },
  });
  await root.tournamentTransfer.deleteMany({ where });
  await root.tournament.delete({ where: { id: tournamentId } });
  return { keys: media.map((asset) => asset.key), counts };
}

// Returns how many files are still in storage. Their keys stay journaled for scripts/recover-media.
export async function removeDeletedFiles(keys: string[]) {
  let removed = 0;
  for (let start = 0; start < keys.length; start += cleanupBatch) {
    const results = await recoverMediaCleanup({
      apply: true,
      limit: cleanupBatch,
      keys: keys.slice(start, start + cleanupBatch),
    }).catch(() => []);
    removed += results.filter((result) => result.state === 'REMOVED').length;
  }
  return keys.length - removed;
}
