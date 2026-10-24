import { requireTournamentActor } from '@/lib/auth';
import { db as rootDb } from '@/lib/db';
import { scopedDb } from '@/lib/scoped-db';
import { AppError, assertPermission, can, PERMISSIONS } from '@/lib/permissions';
import { getTournament, revisionInclude, poolRevisionInclude } from '@/lib/queries';
import { errorResponse } from '@/lib/security';
import { canAccessSection } from '@/lib/workspace';
import { teamInclude } from '@/lib/teams-service';
import { matchData, matchOptions } from '@/lib/matches-service';
import { qualifierData } from '@/lib/qualifiers-service';
import { scoringImpact } from '@/lib/gameplay-scoring-service';
import { competitionData, previewCompetitionCorrection } from '@/lib/competition-service';
import { qualifierStandingsData } from '@/lib/qualifier-standings-service';
import { stageReconciliationPreview } from '@/lib/stage-reconciliation-service';
import { poolingData } from '@/lib/pooling-service';
import { stageWorkflowData } from '@/lib/stage-workflows';
import { listPageSchema, pageWindow } from '@/lib/list-pagination';
import { z } from 'zod';
const auditSummary = {
  id: true,
  action: true,
  entityType: true,
  entityId: true,
  createdAt: true,
  actor: { select: { username: true } },
} as const;
export async function GET(request: Request) {
  try {
    const actor = await requireTournamentActor();
    const tournamentId = actor.tournamentId!;
    const db = scopedDb(rootDb, tournamentId);
    const url = new URL(request.url),
      section = url.searchParams.get('section');
    let data: unknown;
    switch (section) {
      case 'pooling':
        data = await poolingData(actor);
        break;
      case 'competition':
        data = await competitionData(actor);
        break;
      case 'competition-correction':
        assertPermission(actor, 'matches.manage');
        data = await previewCompetitionCorrection(
          db,
          tournamentId,
          url.searchParams.get('id') || '',
          null,
        );
        break;
      case 'qualifier-standings':
        data = await qualifierStandingsData(actor, url.searchParams.get('stageId') || '');
        break;
      case 'qualifier-stages':
        if (
          !['matches.manage', 'matches.view', 'matches.view_all'].some((p) =>
            actor.permissions.includes(p as 'matches.manage'),
          )
        )
          throw new AppError('Forbidden.', 403);
        data = await db.tournamentStage.findMany({
          where: { kind: 'QUALIFIERS' },
          select: { id: true, name: true },
          orderBy: { position: 'asc' },
        });
        break;
      case 'stage-reconciliation':
        data = await stageReconciliationPreview(actor);
        break;
      case 'stages': {
        if (!canAccessSection(actor, 'stages')) throw new AppError('Forbidden.', 403);
        data = await stageWorkflowData(db, actor);
        break;
      }
      case 'qualifiers':
        data = await qualifierData(actor, url);
        break;
      case 'referees':
        data = (await matchOptions(actor)).referees;
        break;
      case 'referee':
      case 'matches':
      case 'match':
      case 'match-revision':
      case 'match-events':
      case 'multiplayer-history':
        data = await matchData(actor, url, section);
        break;
      case 'teams':
        if (!canAccessSection(actor, 'teams')) throw new AppError('Forbidden.', 403);
        {
          const q = z
            .string()
            .max(100)
            .parse(url.searchParams.get('q') || '');
          const where = q
            ? {
                OR: [
                  { name: { contains: q, mode: 'insensitive' as const } },
                  {
                    members: {
                      some: {
                        OR: [
                          { registeredUsername: { contains: q, mode: 'insensitive' as const } },
                          {
                            participant: {
                              username: { contains: q, mode: 'insensitive' as const },
                            },
                          },
                        ],
                      },
                    },
                  },
                ],
              }
            : {};
          const window =
            url.searchParams.get('paged') === '1'
              ? pageWindow(
                  listPageSchema.parse(url.searchParams.get('page') || undefined),
                  await db.team.count({ where }),
                )
              : undefined;
          const items = await db.team.findMany({
            where,
            include: teamInclude,
            orderBy: [{ position: 'asc' }, { name: 'asc' }, { id: 'asc' }],
            ...(window ? { skip: window.skip, take: window.take } : {}),
          });
          data = window ? { ...window, items } : items;
        }
        break;
      case 'homepage':
      case 'rules': {
        const slug = section === 'homepage' ? 'home' : 'rules';
        if (
          !can(actor, section === 'homepage' ? 'homepage.edit' : 'rules.edit') &&
          !can(actor, section === 'homepage' ? 'homepage.publish' : 'rules.publish')
        )
          throw new AppError('Forbidden.', 403);
        data = await db.page.findFirst({
          where: { slug },
          include: {
            draftRevision: { include: revisionInclude },
            publishedRevision: { include: revisionInclude },
            revisions: {
              orderBy: { createdAt: 'desc' },
              take: 50,
              select: { id: true, title: true, createdAt: true, createdBy: true },
            },
          },
        });
        if (!data)
          data = {
            id: null,
            slug,
            title: slug === 'home' ? (await getTournament()).name : 'Rules',
            state: 'DRAFT',
            draftRevisionId: null,
            publishedRevisionId: null,
            draftRevision: null,
            publishedRevision: null,
            revisions: [],
          };
        break;
      }
      case 'mappools': {
        if (
          ![
            'mappools.view_drafts',
            'mappools.edit',
            'mappools.create',
            'mappools.publish',
            'mappools.delete',
          ].some((p) => actor.permissions.includes(p as never))
        )
          throw new AppError('Forbidden.', 403);
        const drafts =
          can(actor, 'mappools.view_drafts') ||
          can(actor, 'mappools.edit') ||
          can(actor, 'mappools.publish');
        data = {
          stages: await db.tournamentStage.findMany({
            orderBy: { position: 'asc' },
            include: {
              ...(drafts ? { poolPlan: true } : {}),
              mappool: {
                select: {
                  id: true,
                  state: true,
                  updatedAt: true,
                  ...(drafts
                    ? { draftRevisionId: true, draftRevision: { include: poolRevisionInclude } }
                    : {}),
                  publishedRevisionId: true,
                  publishedRevision: { include: poolRevisionInclude },
                },
              },
            },
          }),
          categories: await db.modCategory.findMany({ orderBy: { position: 'asc' } }),
        };
        break;
      }
      case 'staff':
        assertPermission(actor, 'staff.edit');
        data = {
          members: await db.staffMember.findMany({
            orderBy: { position: 'asc' },
            include: { assignments: true },
          }),
          categories: await db.staffCategory.findMany({ orderBy: { position: 'asc' } }),
        };
        break;
      case 'media':
        assertPermission(actor, 'media.upload');
        {
          const window =
            url.searchParams.get('paged') === '1'
              ? pageWindow(
                  listPageSchema.parse(url.searchParams.get('page') || undefined),
                  await db.mediaAsset.count(),
                )
              : undefined;
          const items = await db.mediaAsset.findMany({
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            ...(window ? { skip: window.skip, take: window.take } : {}),
          });
          data = window ? { ...window, items } : items;
        }
        break;
      case 'users':
        assertPermission(actor, 'users.manage');
        {
          const q = (url.searchParams.get('q') || '').slice(0, 100);
          data = {
            users: await db.user.findMany({
              where: q
                ? {
                    OR: [
                      { username: { contains: q, mode: 'insensitive' } },
                      ...(/^\d+$/.test(q) && Number(q) <= 2147483647 ? [{ osuId: Number(q) }] : []),
                    ],
                  }
                : {},
              orderBy: { lastLoginAt: 'desc' },
              take: 100,
              include: {
                roles: {
                  where: { tournamentId },
                  include: { role: { include: { permissions: true } } },
                },
              },
            }),
            roles: await db.role.findMany({ include: { permissions: true } }),
          };
          break;
        }
      case 'roles':
        assertPermission(actor, 'roles.manage');
        data = {
          roles: await db.role.findMany({
            include: { permissions: true, _count: { select: { users: true } } },
            orderBy: { createdAt: 'asc' },
          }),
          permissions: Object.fromEntries(
            Object.entries(PERMISSIONS).filter(
              ([key]) =>
                !['platform.manage', 'tournaments.create', 'tournaments.manage_all'].includes(key),
            ),
          ),
        };
        break;
      case 'settings':
        assertPermission(actor, 'settings.manage');
        data = { ...(await getTournament()), scoringImpact: await scoringImpact(db, tournamentId) };
        break;
      case 'audit':
        assertPermission(actor, 'audit.view');
        data = await db.auditLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: 150,
          select: auditSummary,
        });
        break;
      case 'overview': {
        if (!actor.permissions.length)
          throw new AppError('No administration permissions assigned.', 403);
        const pages = await db.page.findMany({
          where: { slug: { in: ['home', 'rules'] } },
          select: { slug: true, draftRevisionId: true, publishedRevisionId: true },
        });
        data = {
          setup: {
            homeSaved: pages.some(
              (p) => p.slug === 'home' && !!(p.draftRevisionId || p.publishedRevisionId),
            ),
            rulesSaved: pages.some(
              (p) => p.slug === 'rules' && !!(p.draftRevisionId || p.publishedRevisionId),
            ),
            homePublished: pages.some((p) => p.slug === 'home' && !!p.publishedRevisionId),
            pendingPages: pages.filter(
              (p) => p.draftRevisionId && p.draftRevisionId !== p.publishedRevisionId,
            ).length,
            teams: await db.team.count(),
            matches: (await db.match.count()) + (await db.qualifierLobby.count()),
          },
          tournament: await getTournament(),
          users: can(actor, 'users.manage')
            ? await db.user.count({ where: { roles: { some: { tournamentId } } } })
            : null,
          staff: await db.staffMember.count(),
          published: await db.mappool.count({ where: { state: 'PUBLISHED' } }),
          drafts: actor.permissions.some((p) => p.startsWith('mappools.'))
            ? await db.mappool.count({ where: { draftRevisionId: { not: null } } })
            : null,
          recent: can(actor, 'audit.view')
            ? await db.auditLog.findMany({
                take: 8,
                orderBy: { createdAt: 'desc' },
                select: auditSummary,
              })
            : [],
          stages: await db.tournamentStage.findMany({
            where: actor.permissions.some((p) => p.startsWith('mappools.'))
              ? {}
              : { mappool: { state: 'PUBLISHED' } },
            orderBy: { position: 'asc' },
            include: { mappool: { select: { state: true, updatedAt: true } } },
          }),
        };
        break;
      }
      case 'sheet-data':
        assertPermission(actor, 'tournament.data.read');
        data = {
          tournament: { name: (await getTournament()).name },
          mappools: await db.tournamentStage.findMany({
            where: { mappool: { state: 'PUBLISHED' } },
            select: { name: true, slug: true },
          }),
        };
        break;
      default:
        throw new AppError('Unknown section.', 404);
    }
    const normalized = JSON.parse(JSON.stringify(data), (key, value) =>
      key === 'role' && value?.templateKey ? { ...value, systemKey: value.templateKey } : value,
    );
    if ((section === 'roles' || section === 'users') && normalized.roles)
      normalized.roles = normalized.roles.map(
        (r: { systemKey: string | null; templateKey?: string | null }) => ({
          ...r,
          systemKey: r.templateKey || r.systemKey,
        }),
      );
    return Response.json(normalized, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
