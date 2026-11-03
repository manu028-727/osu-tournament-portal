import { Prisma } from '@/generated/prisma/client';
import { z } from 'zod';
import { competitionEligibilityOptions } from './competition-queries';
import { db as rootDb } from './db';
import { gameplayScoringSchema, inheritedRules } from './gameplay-scoring';
import { eligibleRefereeFor, matchAccess } from './match-access';
import { matchWorkflow } from './match-engine';
import { numericMatchIdentifier } from './match-numbering';
import { matchRulesSchema, otherSide } from './match-rules';
import { AppError, assertPermission, can, type Actor } from './permissions';
import { scopedDb } from './scoped-db';
import { teamInclude } from './teams-service';

import { assertMatchView, matchScope } from './match-access';
import { draftState, matchInclude, profileSelect, rulesHash } from './match-record';
import { listPageSchema, pageWindow } from './list-pagination';
import type { MatchParticipants } from './matches-types';
export async function matchOptions(actor: Actor) {
  const tournamentId = actor.tournamentId || 'main',
    db = scopedDb(rootDb, tournamentId);
  if (!can(actor, 'matches.manage')) assertPermission(actor, 'matches.assign_referees');
  const [settings, stages, teams, referees, paths] = await Promise.all([
    db.tournamentSettings.findUniqueOrThrow({ where: { tournamentId } }),
    db.tournamentStage.findMany({
      where: { archivedAt: null },
      orderBy: { position: 'asc' },
      include: { mappool: { select: { state: true, publishedRevisionId: true } } },
    }),
    db.team.findMany({
      where: { tournamentId, status: 'APPROVED', supersededAt: null },
      orderBy: { name: 'asc' },
      include: teamInclude,
    }),
    db.user.findMany({
      where: eligibleRefereeFor(tournamentId),
      select: profileSelect,
      orderBy: { username: 'asc' },
    }),
    can(actor, 'matches.manage')
      ? competitionEligibilityOptions({ ...actor, tournamentId })
      : Promise.resolve([]),
  ]);
  const configuredScoring = gameplayScoringSchema.safeParse(settings.gameplayScoring);
  return {
    scoringNeedsReview: !configuredScoring.success,
    defaults: configuredScoring.success
      ? inheritedRules(settings.matchRules, configuredScoring.data)
      : matchRulesSchema.parse(settings.matchRules),
    defaultsHash: rulesHash(settings.matchRules),
    stages: stages.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      published: s.mappool?.state === 'PUBLISHED' && !!s.mappool.publishedRevisionId,
      rules: s.matchRules
        ? configuredScoring.success
          ? inheritedRules(s.matchRules, configuredScoring.data)
          : matchRulesSchema.parse(s.matchRules)
        : null,
      rulesHash: rulesHash(s.matchRules),
    })),
    teams: can(actor, 'matches.manage') ? teams : [],
    referees,
    paths,
  };
}
export async function matchData(actor: Actor, url: URL, section: string) {
  const tournamentId = actor.tournamentId || 'main',
    db = scopedDb(rootDb, tournamentId);
  assertMatchView(actor);
  if (section === 'multiplayer-history') {
    const id = z.string().min(1).max(100).parse(url.searchParams.get('id'));
    const match = await db.match.findFirst({
      where: { AND: [{ id }, matchScope(actor)] },
      select: { id: true, multiplayerId: true },
    });
    if (!match) throw new AppError('Match not found.', 404);
    const cursor = url.searchParams.get('cursor'),
      where = { matchId: id, multiplayerId: match.multiplayerId || 0 };
    const [games, count] = await Promise.all([
      db.multiplayerGame.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 101,
        ...(cursor ? { cursor: { id: z.string().max(100).parse(cursor) }, skip: 1 } : {}),
      }),
      db.multiplayerGame.count({ where }),
    ]);
    return {
      games: games.slice(0, 100),
      count,
      nextCursor: games.length > 100 ? games[99].id : null,
    };
  }
  if (section === 'match-revision' || section === 'match-events') {
    if (!can(actor, 'matches.view_history') && !can(actor, 'matches.manage'))
      throw new AppError('Match history permission is required.', 403);
    const id = z.string().min(1).max(100).parse(url.searchParams.get('id'));
    if (
      !(await db.match.findFirst({
        where: { AND: [{ id }, matchScope(actor)] },
        select: { id: true },
      }))
    )
      throw new AppError('Match not found.', 404);
    if (section === 'match-events')
      return db.matchEvent.findMany({
        where: {
          matchId: id,
          version: { lt: z.coerce.number().int().positive().parse(url.searchParams.get('before')) },
        },
        orderBy: { version: 'desc' },
        take: 250,
        include: { actor: { select: { username: true } } },
      });
    const revision = await db.matchResultRevision.findFirst({
      where: {
        matchId: id,
        id: z.string().min(1).max(100).parse(url.searchParams.get('revision')),
      },
    });
    if (!revision) throw new AppError('Revision not found.', 404);
    return revision;
  }
  if (section === 'match') {
    const id = z.string().min(1).max(100).parse(url.searchParams.get('id'));
    const number = numericMatchIdentifier(id);
    const history = can(actor, 'matches.view_history') || can(actor, 'matches.manage');
    const match = await db.match.findFirst({
      where: { AND: [number ? { matchNumber: number } : { id }, matchScope(actor)] },
      include: {
        ...matchInclude,
        ...(history
          ? {
              events: {
                orderBy: { version: 'desc' as const },
                take: 250,
                include: { actor: { select: { username: true } } },
              },
              revisions: {
                orderBy: { version: 'desc' as const },
                select: {
                  id: true,
                  version: true,
                  kind: true,
                  reason: true,
                  createdAt: true,
                  creator: { select: { username: true } },
                },
              },
            }
          : {}),
      },
    });
    if (!match) throw new AppError('Match not found or not assigned to you.', 404);
    const imported = await db.matchEvent.findFirst({
      where: { matchId: match.id, kind: 'sheet.import' },
      orderBy: { version: 'desc' },
      select: { data: true, version: true, createdAt: true },
    });
    const importedRecord = z
      .object({ record: z.object({ sheet: z.string(), discord: z.string() }) })
      .safeParse(imported?.data);
    const dependencies = [];
    for (const side of ['A', 'B'] as const) {
      if (side === 'A' ? match.teamAId : match.teamBId) continue;
      const label = (match.participants as unknown as MatchParticipants)[side].name;
      const reference = /^([WL])(.{1,80})$/.exec(label);
      if (!reference) continue;
      const source = await db.match.findFirst({
        where: { AND: [{ code: reference[2] }, matchScope(actor)] },
        select: {
          id: true,
          code: true,
          matchNumber: true,
          version: true,
          status: true,
          winnerSide: true,
          participants: true,
        },
      });
      if (source) {
        const selected =
          source.status === 'COMPLETED' && source.winnerSide
            ? reference[1] === 'W'
              ? source.winnerSide
              : otherSide(source.winnerSide)
            : null;
        dependencies.push({
          side,
          label,
          id: source.id,
          code: source.code,
          matchNumber: source.matchNumber,
          version: source.version,
          team: selected
            ? (source.participants as unknown as MatchParticipants)[selected].name
            : null,
        });
      }
    }
    const contacts = await db.teamMember.findMany({
      where: {
        osuId: {
          in: Object.values(match.participants as unknown as MatchParticipants).flatMap((team) =>
            team.members.map((p) => p.osuId),
          ),
        },
        teamId: { in: [match.teamAId, match.teamBId].filter((id): id is string => !!id) },
      },
      select: { discordId: true },
    });
    // Staff apply what teams bought by hand, so the referee needs to see it before the roll.
    const purchases = await db.resourcePurchase.findMany({
      where: {
        teamId: { in: [match.teamAId, match.teamBId].filter((id): id is string => !!id) },
        reversedAt: null,
        OR: [{ stageId: match.stageId }, { stageId: null }],
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        teamId: true,
        note: true,
        item: { select: { name: true, description: true } },
      },
    });
    const rules = matchRulesSchema.parse(match.rules);
    const pending = match.actions.find(
      (a) =>
        !a.voided &&
        a.kind === 'PICK' &&
        !match.results.some((r) => !r.voided && r.actionId === a.id),
    );
    return {
      match: {
        ...match,
        importedHistory:
          imported && importedRecord.success
            ? {
                worksheet: importedRecord.data.record.sheet,
                discord: importedRecord.data.record.discord,
                acceptedAt: imported.createdAt.toISOString(),
                version: imported.version,
              }
            : null,
        multiplayerGames: match.multiplayerGames.filter(
          (g) => g.multiplayerId === match.multiplayerId,
        ),
        rules,
        purchases: purchases.map((row) => ({
          id: row.id,
          side: row.teamId === match.teamAId ? 'A' : 'B',
          name: row.item.name,
          description: row.item.description,
          note: row.note,
        })),
        workflow: matchWorkflow(
          rules,
          draftState(match),
          match.poolRevision?.slots || [],
          match.status,
          pending?.id || null,
        ),
      },
      discordIds: contacts.map((p) => p.discordId).filter(Boolean),
      dependencies,
      access: matchAccess(actor, match),
      serverNow: new Date().toISOString(),
    };
  }
  const filters: Prisma.MatchWhereInput = {
    deletedAt: url.searchParams.get('status') === 'DELETED' ? { not: null } : null,
  };
  const status = url.searchParams.get('status');
  if (status && status !== 'DELETED')
    filters.status = z
      .enum([
        'SCHEDULED',
        'IN_PROGRESS',
        'AWAITING_CONFIRMATION',
        'COMPLETED',
        'DISPUTED',
        'CANCELLED',
      ])
      .parse(status);
  const stageId = url.searchParams.get('stage');
  if (stageId) filters.stageId = z.string().max(100).parse(stageId);
  const assigned = url.searchParams.get('assigned');
  if (assigned === 'unassigned') filters.assignments = { none: {} };
  else if (assigned)
    filters.assignments = {
      some: { userId: assigned === 'me' ? actor.id : z.string().max(100).parse(assigned) },
    };
  const q = (url.searchParams.get('q') || '').slice(0, 100);
  if (q) {
    const matchNumber = numericMatchIdentifier(q.replace(/^(?:#|match\s+)/i, ''));
    filters.OR = [
      { code: { contains: q, mode: 'insensitive' } },
      ...(matchNumber ? [{ matchNumber }] : []),
      { teamA: { name: { contains: q, mode: 'insensitive' } } },
      { teamB: { name: { contains: q, mode: 'insensitive' } } },
      { participants: { path: ['A', 'name'], string_contains: q, mode: 'insensitive' } },
      { participants: { path: ['B', 'name'], string_contains: q, mode: 'insensitive' } },
      { source: { path: ['referee'], string_contains: q, mode: 'insensitive' } },
      { assignments: { some: { user: { username: { contains: q, mode: 'insensitive' } } } } },
      { stage: { name: { contains: q, mode: 'insensitive' } } },
      { notes: { contains: q, mode: 'insensitive' } },
    ];
  }
  const from = url.searchParams.get('from'),
    to = url.searchParams.get('to');
  if (from || to)
    filters.scheduledAt = {
      ...(from ? { gte: new Date(z.iso.datetime().parse(from)) } : {}),
      ...(to ? { lte: new Date(z.iso.datetime().parse(to)) } : {}),
    };
  const where = { AND: [matchScope(actor), filters] };
  const pagination = pageWindow(
    listPageSchema.parse(url.searchParams.get('page') || undefined),
    await db.match.count({ where }),
    50,
  );
  const sort = z
    .enum(['number', 'schedule', 'stage', 'updated'])
    .catch('number')
    .parse(url.searchParams.get('sort'));
  const orderBy: Prisma.MatchOrderByWithRelationInput[] =
    sort === 'schedule'
      ? [{ scheduledAt: { sort: 'asc', nulls: 'last' } }, { matchNumber: 'asc' }]
      : sort === 'stage'
        ? [{ stage: { position: 'asc' } }, { matchNumber: 'asc' }]
        : sort === 'updated'
          ? [{ updatedAt: 'desc' }, { matchNumber: 'asc' }]
          : [{ matchNumber: 'asc' }];
  const [matches, counts] = await Promise.all([
    db.match.findMany({
      where,
      orderBy,
      skip: pagination.skip,
      take: pagination.take,
      select: {
        id: true,
        code: true,
        matchNumber: true,
        status: true,
        notes: true,
        deletedAt: true,
        lobbyUrl: true,
        scheduledAt: true,
        published: true,
        bracket: true,
        resultMode: true,
        source: true,
        scoreA: true,
        scoreB: true,
        winnerSide: true,
        forfeitSide: true,
        participants: true,
        version: true,
        stage: { select: { id: true, name: true } },
        assignments: { include: { user: { select: profileSelect } } },
      },
    }),
    db.match.groupBy({
      by: ['status'],
      where: { AND: [matchScope(actor), { deletedAt: null }] },
      _count: { _all: true },
    }),
  ]);
  const stages = await db.tournamentStage.findMany({
    where: { matches: { some: matchScope(actor) } },
    select: { id: true, name: true },
    orderBy: { position: 'asc' },
  });
  const numbering = can(actor, 'matches.manage')
    ? await db.tournament.findUniqueOrThrow({
        where: { id: tournamentId },
        select: { matchNumberSequence: true },
      })
    : null;
  return {
    matches,
    pagination: { page: pagination.page, pageSize: pagination.pageSize, total: pagination.total },
    nextCode: can(actor, 'matches.manage') ? String(numbering!.matchNumberSequence + 1) : undefined,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    stages,
    options:
      can(actor, 'matches.manage') || can(actor, 'matches.assign_referees')
        ? await matchOptions(actor)
        : null,
    serverNow: new Date().toISOString(),
  };
}
