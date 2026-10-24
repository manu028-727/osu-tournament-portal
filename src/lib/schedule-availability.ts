import type { Prisma } from '@/generated/prisma/client';
import { AppError } from './permissions';
import { eligibleRefereeFor } from './match-access';

export type SchedulePlan = {
  label: string;
  scheduledAt: Date | null;
  refereeIds: string[];
  participants: unknown;
  teamIds?: (string | null)[];
};

export function scheduledEntrants(value: unknown, teamIds: (string | null)[] = []) {
  const sides = value && typeof value === 'object' ? Object.values(value) : [];
  const rosters = sides as { id?: string; members?: { osuId: number }[] }[];
  return {
    teams: new Set([
      ...teamIds.filter((id): id is string => !!id),
      ...rosters.flatMap((side) => (side?.id ? [side.id] : [])),
    ]),
    players: new Set(
      rosters.flatMap((side) => (side?.members || []).map((player) => player.osuId)),
    ),
  };
}
const intersects = <T>(a: Set<T>, b: Set<T>) => [...a].some((value) => b.has(value));

// Validate complete replacement plans before writing; exclusions permit atomic time swaps.
// The caller owns the mutation transaction and established global write lock.
export async function assertScheduleAvailability(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  plans: SchedulePlan[],
  exclude: { matchIds?: string[]; lobbyIds?: string[] } = {},
) {
  const refereeIds = [...new Set(plans.flatMap((plan) => plan.refereeIds))];
  if (
    refereeIds.length &&
    (await tx.user.count({
      where: {
        id: { in: refereeIds },
        AND: [eligibleRefereeFor(tournamentId)],
      },
    })) !== refereeIds.length
  )
    throw new AppError(
      'Every assigned referee needs match access and operational permissions in this tournament.',
    );
  const dates = [
    ...new Set(plans.flatMap((plan) => (plan.scheduledAt ? [plan.scheduledAt.toISOString()] : []))),
  ].map((date) => new Date(date));
  if (!dates.length) return;
  const matches = await tx.match.findMany({
    where: {
      tournamentId,
      id: { notIn: exclude.matchIds || [] },
      scheduledAt: { in: dates },
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
    },
    select: {
      matchNumber: true,
      scheduledAt: true,
      participants: true,
      teamAId: true,
      teamBId: true,
      assignments: { select: { userId: true } },
    },
  });
  const lobbies = await tx.qualifierLobby.findMany({
    where: {
      tournamentId,
      id: { notIn: exclude.lobbyIds || [] },
      scheduledAt: { in: dates },
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
    },
    select: {
      code: true,
      scheduledAt: true,
      participants: true,
      assignments: { select: { userId: true } },
    },
  });
  const existing: SchedulePlan[] = [
    ...matches.map((match) => ({
      ...match,
      label: `Match ${match.matchNumber}`,
      refereeIds: match.assignments.map((ref) => ref.userId),
      teamIds: [match.teamAId, match.teamBId],
    })),
    ...lobbies.map((lobby) => ({
      ...lobby,
      label: `qualifier lobby ${lobby.code}`,
      refereeIds: lobby.assignments.map((ref) => ref.userId),
    })),
  ];
  for (const [index, plan] of plans.entries()) {
    if (!plan.scheduledAt) continue;
    const entrants = scheduledEntrants(plan.participants, plan.teamIds);
    for (const other of [...plans.slice(0, index), ...existing]) {
      if (other.scheduledAt?.getTime() !== plan.scheduledAt.getTime()) continue;
      if (plan.refereeIds.some((id) => other.refereeIds.includes(id)))
        throw new AppError(
          `${plan.label}: a referee is already scheduled in ${other.label} at this time.`,
          409,
        );
      const resources = scheduledEntrants(other.participants, other.teamIds);
      if (
        intersects(entrants.teams, resources.teams) ||
        intersects(entrants.players, resources.players)
      )
        throw new AppError(
          `${plan.label}: a participant is already scheduled in ${other.label} at this time.`,
          409,
        );
    }
  }
}
