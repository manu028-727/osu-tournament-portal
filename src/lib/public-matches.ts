import { db as rootDb } from './db';
import { scopedDb } from './scoped-db';
import { requestScope } from './tournament-context';
import { matchCredits, organizerRefereeCredit } from './match-display';
import type { MatchParticipants } from './matches-types';
import type { Prisma } from '@/generated/prisma/client';
import { numericMatchIdentifier } from './match-numbering';
import { isPublicTournament, publicTournamentWhere } from './public-visibility';
import { pageWindow } from './list-pagination';
import { z } from 'zod';

type PublicMatchFilters = { code?: string; teamId?: string; stage?: string; status?: string };
function publicMatchWhere(filters: PublicMatchFilters) {
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
    stage: { tournament: publicTournamentWhere, ...(filters.stage ? { slug: filters.stage } : {}) },
  };
  if (filters.status === 'completed') where.status = 'COMPLETED';
  if (filters.status === 'upcoming') where.status = { notIn: ['COMPLETED', 'CANCELLED'] };
  return where;
}

export async function publicMatches(
  filters: { code?: string; teamId?: string; stage?: string; status?: string } = {},
  tournamentId?: string,
  pagination?: { skip: number; take: number },
) {
  tournamentId ||= (await requestScope()).tournamentId;
  const db = scopedDb(rootDb, tournamentId);
  const tournament = await db.tournament.findUnique({
    where: { id: tournamentId },
    select: { published: true, archivedAt: true, timezone: true },
  });
  if (!tournament || !isPublicTournament(tournament)) return [];
  const where = publicMatchWhere(filters);
  const rows = await db.match.findMany({
    where,
    orderBy: [
      { stage: { position: 'asc' } },
      { scheduledAt: { sort: 'asc', nulls: 'last' } },
      { code: 'asc' },
      { id: 'asc' },
    ],
    ...(pagination ? { skip: pagination.skip, take: pagination.take } : {}),
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
      multiplayerId: true,
      participants: true,
      source: true,
      assignments: { select: { user: { select: { username: true } } } },
    },
  });
  return rows.map(({ source, participants, assignments, ...row }) => ({
    ...row,
    timezone: tournament.timezone,
    participants: participants as unknown as MatchParticipants,
    resultSource:
      z
        .object({ organizerResult: z.object({ origin: z.enum(['MANUAL', 'MULTIPLAYER']) }) })
        .safeParse(source).data?.organizerResult.origin || null,
    credits: {
      ...matchCredits(source),
      referee:
        organizerRefereeCredit(source) ||
        assignments.map((a) => a.user.username).join(', ') ||
        matchCredits(source).referee,
    },
  }));
}
export async function publicMatchesPage(
  filters: PublicMatchFilters,
  requested: number,
  tournamentId?: string,
) {
  tournamentId ||= (await requestScope()).tournamentId;
  const db = scopedDb(rootDb, tournamentId);
  const [total, groups, stages] = await Promise.all([
    db.match.count({ where: publicMatchWhere(filters) }),
    db.match.groupBy({ by: ['status'], where: publicMatchWhere({}), _count: { _all: true } }),
    db.tournamentStage.findMany({
      where: { matches: { some: publicMatchWhere({}) } },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { name: true, slug: true },
    }),
  ]);
  const window = pageWindow(requested, total, 50);
  return {
    ...window,
    stages,
    allTotal: groups.reduce((sum, row) => sum + row._count._all, 0),
    completedTotal: groups.find((row) => row.status === 'COMPLETED')?._count._all || 0,
    items: await publicMatches(filters, tournamentId, window),
  };
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
      multiplayerGames: {
        where: {
          multiplayerId: match.multiplayerId || 0,
          confirmedAt: { not: null },
          ignoredAt: null,
          proposal: { path: ['organizerReview', 'included'], equals: true },
        },
        orderBy: { gameId: 'asc' },
        select: { gameId: true, beatmapId: true, slotName: true, evidence: true, proposal: true },
      },
    },
  });
  let pointsA = 0,
    pointsB = 0;
  return {
    ...match,
    importedGames:
      match.status === 'COMPLETED'
        ? data.multiplayerGames
            .flatMap((game) => {
              const proposal = z
                .object({
                  scoreA: z.number().nullable().optional(),
                  scoreB: z.number().nullable().optional(),
                  winnerSide: z.enum(['A', 'B']).optional(),
                  organizerReview: z.object({
                    winnerSide: z.enum(['A', 'B']),
                    included: z.literal(true),
                  }),
                })
                .safeParse(game.proposal);
              const evidence = z
                .object({
                  eventId: z.number(),
                  startTime: z.string(),
                  endTime: z.string().nullable(),
                })
                .safeParse(game.evidence);
              if (!proposal.success || !evidence.success) return [];
              return [
                {
                  gameId: game.gameId,
                  beatmapId: data.stage.mappool?.state === 'PUBLISHED' ? game.beatmapId : null,
                  slotName: game.slotName,
                  ...evidence.data,
                  scoreA: proposal.data.scoreA ?? null,
                  scoreB: proposal.data.scoreB ?? null,
                  winnerSide: proposal.data.organizerReview.winnerSide,
                  corrected: proposal.data.winnerSide !== proposal.data.organizerReview.winnerSide,
                },
              ];
            })
            .sort((a, b) => a.eventId - b.eventId)
        : [],
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
