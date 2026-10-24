import { db as rootDb } from './db';
import { scopedDb } from './scoped-db';
import { requestScope } from './tournament-context';
import { matchCredits } from './match-display';
import type { MatchParticipants } from './matches-service';
import type { Prisma } from '@/generated/prisma/client';
import { numericMatchIdentifier } from './match-numbering';
import { isPublicTournament } from './public-visibility';

export async function publicMatches(
  filters: { code?: string; teamId?: string; stage?: string; status?: string } = {},
  tournamentId?: string,
) {
  tournamentId ||= (await requestScope()).tournamentId;
  const db = scopedDb(rootDb, tournamentId);
  const tournament = await db.tournament.findUnique({
    where: { id: tournamentId },
    select: { published: true, archivedAt: true, timezone: true },
  });
  if (!tournament || !isPublicTournament(tournament)) return [];
  const where: Prisma.MatchWhereInput = {
    published: true,
    AND: [
      { OR: [{ teamAId: null }, { teamA: { published: true, status: 'APPROVED' } }] },
      { OR: [{ teamBId: null }, { teamB: { published: true, status: 'APPROVED' } }] },
      ...(filters.code
        ? [
            numericMatchIdentifier(filters.code)
              ? { matchNumber: numericMatchIdentifier(filters.code)! }
              : { code: filters.code },
          ]
        : []),
      ...(filters.teamId
        ? [{ OR: [{ teamAId: filters.teamId }, { teamBId: filters.teamId }] }]
        : []),
    ],
    ...(filters.stage ? { stage: { slug: filters.stage } } : {}),
  };
  if (filters.status === 'completed') where.status = 'COMPLETED';
  if (filters.status === 'upcoming') where.status = { notIn: ['COMPLETED', 'CANCELLED'] };
  const rows = await db.match.findMany({
    where,
    orderBy: [
      { stage: { position: 'asc' } },
      { scheduledAt: { sort: 'asc', nulls: 'last' } },
      { code: 'asc' },
    ],
    take: 500,
    select: {
      id: true,
      code: true,
      matchNumber: true,
      stage: { select: { name: true, slug: true } },
      bracket: true,
      status: true,
      scheduledAt: true,
      scoreA: true,
      scoreB: true,
      winnerSide: true,
      forfeitSide: true,
      resultMode: true,
      lobbyUrl: true,
      participants: true,
      source: true,
      assignments: { select: { user: { select: { username: true } } } },
    },
  });
  return rows.map(({ source, participants, assignments, ...row }) => ({
    ...row,
    timezone: tournament.timezone,
    participants: participants as unknown as MatchParticipants,
    credits: {
      ...matchCredits(source),
      referee: assignments.map((a) => a.user.username).join(', ') || matchCredits(source).referee,
    },
  }));
}
export type PublicMatch = Awaited<ReturnType<typeof publicMatches>>[number];

export async function publicMatchHistory(code: string, tournamentId?: string) {
  tournamentId ||= (await requestScope()).tournamentId;
  const match = (await publicMatches({ code }, tournamentId))[0];
  if (!match) return null;
  const data = await scopedDb(rootDb, tournamentId).match.findUniqueOrThrow({
    where: { id: match.id },
    select: {
      actions: {
        where: { voided: false },
        orderBy: { sequence: 'asc' },
        select: {
          id: true,
          sequence: true,
          kind: true,
          side: true,
          slotName: true,
        },
      },
      results: {
        where: { voided: false },
        select: { actionId: true, winnerSide: true, scoreA: true, scoreB: true },
      },
      poolRevision: { select: { slots: { select: { name: true, beatmapId: true } } } },
      stage: { select: { mappool: { select: { state: true } } } },
    },
  });
  let pointsA = 0,
    pointsB = 0;
  return {
    ...match,
    history: data.actions.map(({ id, ...action }) => {
      const result = data.results.find((r) => r.actionId === id);
      if (result) result.winnerSide === 'A' ? pointsA++ : pointsB++;
      return {
        ...action,
        beatmapId:
          data.stage.mappool?.state === 'PUBLISHED'
            ? data.poolRevision?.slots.find((s) => s.name === action.slotName)?.beatmapId || null
            : null,
        winnerSide: result?.winnerSide || null,
        scoreA: result?.scoreA ?? null,
        scoreB: result?.scoreB ?? null,
        pointsA,
        pointsB,
      };
    }),
  };
}
