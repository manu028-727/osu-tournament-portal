import { Prisma } from '@/generated/prisma/client';
import { AppError, assertPermission, type Actor } from './permissions';
import { eligibleRefereeFor } from './matches-service';
import type { AdminAction } from './validation';

type BulkScheduleAction = Extract<AdminAction, { type: 'matches.bulk.schedule' }>;

export async function applyBulkScheduleAction(
  tx: Prisma.TransactionClient,
  actor: Actor,
  tournamentId: string,
  action: BulkScheduleAction,
) {
  assertPermission(actor, 'matches.manage');

  const ids = action.matches.map((match) => match.id);
  const records = await tx.match.findMany({
    where: { tournamentId, id: { in: ids } },
    select: {
      id: true,
      version: true,
      status: true,
      scheduledAt: true,
      assignments: { select: { userId: true } },
    },
  });
  if (records.length !== ids.length)
    throw new AppError('Some selected matches no longer exist.', 404);
  const requested = new Map(action.matches.map((match) => [match.id, match.baseVersion]));
  for (const record of records) {
    if (record.version !== requested.get(record.id))
      throw new AppError('A selected match changed. Reload and review the selection.', 409);
    if (record.status !== 'SCHEDULED')
      throw new AppError('Bulk scheduling only applies to scheduled matches.', 409);
  }

  const proposed = records.map((record) => {
    const scheduledAt =
      action.scheduledAt !== undefined
        ? action.scheduledAt
          ? new Date(action.scheduledAt)
          : null
        : action.shiftMinutes !== undefined
          ? record.scheduledAt
            ? new Date(record.scheduledAt.getTime() + action.shiftMinutes * 60_000)
            : null
          : record.scheduledAt;
    if (action.shiftMinutes !== undefined && !record.scheduledAt)
      throw new AppError('A selected match has no scheduled time to shift.', 409);
    return {
      record,
      scheduledAt,
      refereeIds: action.refereeIds ?? record.assignments.map((assignment) => assignment.userId),
    };
  });

  const refereeIds = [...new Set(proposed.flatMap((item) => item.refereeIds))];
  if (refereeIds.length) {
    const eligible = await tx.user.count({
      where: { id: { in: refereeIds }, AND: [eligibleRefereeFor(tournamentId)] },
    });
    if (eligible !== refereeIds.length)
      throw new AppError(
        'Every assigned referee must have match access and operational permissions.',
      );
  }

  const planned = new Map<string, string>();
  for (const item of proposed) {
    if (!item.scheduledAt) continue;
    const instant = item.scheduledAt.toISOString();
    for (const refereeId of item.refereeIds) {
      const key = `${refereeId}:${instant}`;
      if (planned.has(key))
        throw new AppError(
          'The bulk change assigns a referee to two matches at the same time.',
          409,
        );
      planned.set(key, item.record.id);
    }
  }

  const dates = [
    ...new Set(proposed.flatMap((item) => (item.scheduledAt ? [item.scheduledAt] : []))),
  ];
  if (dates.length && refereeIds.length) {
    const outsideMatch = await tx.matchAssignment.findFirst({
      where: {
        userId: { in: refereeIds },
        match: {
          tournamentId,
          id: { notIn: ids },
          scheduledAt: { in: dates },
          status: { notIn: ['CANCELLED', 'COMPLETED'] },
        },
      },
      select: { user: { select: { username: true } } },
    });
    if (outsideMatch)
      throw new AppError(
        `${outsideMatch.user.username} already has a match at one of those times.`,
        409,
      );

    const outsideLobby = await tx.qualifierAssignment.findFirst({
      where: {
        userId: { in: refereeIds },
        lobby: {
          tournamentId,
          scheduledAt: { in: dates },
          status: { notIn: ['CANCELLED', 'COMPLETED'] },
        },
      },
      select: { user: { select: { username: true } } },
    });
    if (outsideLobby)
      throw new AppError(
        `${outsideLobby.user.username} already has a qualifier lobby at one of those times.`,
        409,
      );
  }

  for (const item of proposed) {
    const beforeReferees = item.record.assignments.map((assignment) => assignment.userId);
    if (action.refereeIds !== undefined) {
      await tx.matchAssignment.deleteMany({ where: { matchId: item.record.id } });
      if (item.refereeIds.length)
        await tx.matchAssignment.createMany({
          data: item.refereeIds.map((userId, index) => ({
            matchId: item.record.id,
            userId,
            primary: index === 0,
          })),
        });
    }
    const updated = await tx.match.updateMany({
      where: {
        id: item.record.id,
        tournamentId,
        version: item.record.version,
        status: 'SCHEDULED',
      },
      data: {
        ...(action.scheduledAt !== undefined || action.shiftMinutes !== undefined
          ? { scheduledAt: item.scheduledAt }
          : {}),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1)
      throw new AppError('A selected match changed during this update.', 409);
    await tx.matchEvent.create({
      data: {
        matchId: item.record.id,
        version: item.record.version + 1,
        actorId: actor.id,
        kind: 'bulk.schedule',
        data: {
          before: {
            scheduledAt: item.record.scheduledAt?.toISOString() || null,
            refereeIds: beforeReferees,
          },
          after: {
            scheduledAt: item.scheduledAt?.toISOString() || null,
            refereeIds: item.refereeIds,
          },
        },
      },
    });
  }

  return { updated: proposed.length };
}
