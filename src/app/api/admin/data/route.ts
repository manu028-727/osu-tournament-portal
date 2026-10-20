import { getActor } from '@/lib/auth';
import { db as rootDb } from '@/lib/db';
import { scopedDb } from '@/lib/scoped-db';
import { AppError, assertPermission, can, PERMISSIONS } from '@/lib/permissions';
import { getTournament, revisionInclude, poolRevisionInclude } from '@/lib/queries';
import { errorResponse } from '@/lib/security';
import { canAccessSection } from '@/lib/workspace';
import { teamInclude } from '@/lib/teams-service';
import { matchData } from '@/lib/matches-service';
import { qualifierData } from '@/lib/qualifiers-service';
import { matchRulesSchema } from '@/lib/match-rules';
export async function GET(request: Request) {
  try {
    const actor = await getActor();
    if (!actor) throw new AppError('Sign in to continue.', 401);
    const tournamentId = actor.tournamentId || 'main';
    const db = scopedDb(rootDb, tournamentId);
    const url = new URL(request.url),
      section = url.searchParams.get('section');
    let data: unknown;
    switch (section) {
      case 'stages':
        if (!canAccessSection(actor, 'stages')) throw new AppError('Forbidden.', 403);
        data = {
          stages: await db.tournamentStage.findMany({ orderBy: { position: 'asc' } }),
          defaults: matchRulesSchema.parse((await getTournament()).settings?.matchRules || {}),
        };
        break;
      case 'qualifiers':
        data = await qualifierData(actor, url);
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
        data = await db.team.findMany({
          where: { tournamentId },
          include: teamInclude,
          orderBy: [{ position: 'asc' }, { name: 'asc' }],
          take: 500,
        });
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
        data = await db.mediaAsset.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
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
        data = await getTournament();
        break;
      case 'audit':
        assertPermission(actor, 'audit.view');
        data = await db.auditLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: 150,
          include: { actor: { select: { username: true } } },
        });
        break;
      case 'overview': {
        if (!actor.permissions.length)
          throw new AppError('No administration permissions assigned.', 403);
        data = {
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
                include: { actor: { select: { username: true } } },
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
