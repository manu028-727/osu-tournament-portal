import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { actorForTournament } from './auth';
import { AppError, DEFAULT_ROLES, assertPermission, type Actor } from './permissions';
import { scopedDb } from './scoped-db';
import { matchRulesSchema } from './match-rules';
import { DEFAULT_COPY } from './copy';
import { safeUrl, color } from './validation';
import { appUrl } from './security';
import { gameplayScoringSchema } from './gameplay-scoring';
import { publicTournamentWhere } from './public-visibility';

export const tournamentActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create'),
    gameplayScoring: gameplayScoringSchema.default('SCORE_V2'),
    name: z.string().trim().min(1).max(120),
    acronym: z.string().trim().min(1).max(20),
    slug: z
      .string()
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    gameMode: z.enum(['osu', 'taiko', 'fruits', 'mania']),
    description: z.string().max(2000).default(''),
    timezone: z.string().max(100).optional(),
    format: z.enum(['SOLO', 'TEAMS', 'CUSTOM']).default('TEAMS'),
  }),
  z.object({
    type: z.literal('lifecycle'),
    id: z.string().max(100),
    baseVersion: z.number().int().positive(),
    published: z.boolean(),
    archived: z.boolean(),
  }),
  z.object({
    type: z.literal('platform'),
    name: z.string().trim().min(1).max(120),
    rootMode: z.enum(['FEATURED', 'DIRECTORY']),
    defaultTournamentId: z.string().max(100).nullable().optional(),
    description: z.string().max(2000).optional(),
    logo: safeUrl.optional(),
    favicon: safeUrl.optional(),
    socialImage: safeUrl.optional(),
    footer: z.string().max(1000).optional(),
    contact: z.string().max(300).optional(),
    primaryDomain: z.string().max(2048).optional(),
    primaryColor: color.optional(),
    accentColor: color.optional(),
    timezone: z.string().max(100).optional(),
    locale: z.enum(['en', 'it', 'de', 'fr', 'es', 'ja']).optional(),
    socialLinks: z
      .array(z.object({ label: z.string().min(1).max(100), href: safeUrl }))
      .max(15)
      .optional(),
  }),
  z.object({
    type: z.literal('platform-admin'),
    userId: z.string().min(1).max(100),
    enabled: z.boolean(),
  }),
]);
export async function tournamentList(actor?: Actor | null, publicOnly = false) {
  const items = await db.tournament.findMany({
    where: publicOnly
      ? publicTournamentWhere
      : actor?.platformAdmin
        ? {}
        : {
            roles: {
              some: { users: { some: { userId: actor?.id || '' } }, permissions: { some: {} } },
            },
          },
    include: {
      settings: { select: { logo: true, banner: true } },
      _count: { select: { stages: true, teams: true } },
    },
    orderBy: [{ archivedAt: 'asc' }, { createdAt: 'desc' }],
  });
  const memberships = actor
    ? await db.userRole.findMany({
        where: { userId: actor.id },
        include: { role: { include: { permissions: true } } },
      })
    : [];
  const counts = publicOnly
    ? []
    : await db.match.groupBy({
        by: ['tournamentId'],
        where: { tournamentId: { in: items.map((t) => t.id) } },
        _count: { _all: true },
      });
  const matchCounts = new Map(counts.map((c) => [c.tournamentId, c._count._all]));
  return items.map((t) => ({
    ...t,
    canPublish:
      !!actor?.platformAdmin ||
      memberships.some(
        (m) =>
          m.tournamentId === t.id &&
          m.role.permissions.some((p) => p.permissionKey === 'tournament.publish'),
      ),
    matchCount: matchCounts.get(t.id) || 0,
  }));
}
export async function tournamentAction(
  original: Actor,
  rawInput: z.input<typeof tournamentActionSchema>,
) {
  const input = tournamentActionSchema.parse(rawInput);
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
      const user = await tx.user.findUniqueOrThrow({
        where: { id: original.id },
        include: { roles: { include: { role: { include: { permissions: true } } } } },
      });
      const actor = actorForTournament(user, 'id' in input ? input.id : 'main');
      let id = 'main';
      if (input.type === 'create') {
        assertPermission(actor, 'tournaments.create');
        try {
          new Intl.DateTimeFormat('en', { timeZone: input.timezone || 'UTC' });
        } catch {
          throw new AppError('Choose a valid IANA timezone.');
        }
        id = randomUUID();
        const { type, gameplayScoring, ...fields } = input;
        void type;
        const platform = await tx.platformSettings.findUnique({ where: { id: 'main' } });
        await tx.tournament.create({
          data: {
            id,
            ...fields,
            timezone: input.timezone || platform?.timezone || 'UTC',
            status: 'DRAFT',
            settings: {
              create: {
                gameplayScoring,
                banner: '',
                logo: '',
                favicon: '',
                primaryColor: platform?.primaryColor,
                accentColor: platform?.accentColor,
                registrationUrl: '',
                socialLinks: [],
                importantDates: [],
                navigation: [
                  { label: 'Home', href: '/' },
                  { label: 'Mappools', href: '/mappools' },
                  { label: 'Teams', href: '/teams' },
                  { label: 'Matches', href: '/matches' },
                  { label: 'Staff', href: '/staff' },
                  { label: 'Rules', href: '/rules' },
                ],
                footer: input.name,
                copy: DEFAULT_COPY,
                matchRules: matchRulesSchema.parse({
                  gameMode: input.gameMode,
                  teamSize: input.format === 'SOLO' ? 1 : 2,
                  teamMode: input.format === 'SOLO' ? 'HEAD_TO_HEAD' : 'TEAM_VS',
                }),
              },
            },
          },
        });
        const scoped = scopedDb(tx, id);
        for (const [name, permissions] of Object.entries(DEFAULT_ROLES)) {
          const role = await scoped.role.create({
            data: {
              name,
              templateKey: name,
              permissions: { create: permissions.map((permissionKey) => ({ permissionKey })) },
            },
          });
          if (name === 'Owner')
            await scoped.userRole.create({ data: { userId: actor.id, roleId: role.id } });
        }
        for (const slug of ['home', 'rules']) {
          await scoped.page.create({
            data: { slug, title: slug === 'home' ? input.name : 'Rules' },
          });
        }
        for (const [position, acronym] of ['NM', 'HD', 'HR', 'DT', 'FM', 'TB'].entries())
          await scoped.modCategory.create({
            data: {
              acronym,
              name: acronym,
              color: ['#a7d9bc', '#f1d68d', '#e9a6b1', '#a6c7ef', '#c7b8e9', '#eab9df'][position],
              position,
            },
          });
      } else if (input.type === 'lifecycle') {
        id = input.id;
        assertPermission(actor, 'tournament.publish');
        const changed = await tx.tournament.updateMany({
          where: { id, version: input.baseVersion },
          data: {
            published: input.published,
            archivedAt: input.archived ? new Date() : null,
            version: { increment: 1 },
          },
        });
        if (!changed.count) throw new AppError('Tournament changed. Reload before saving.', 409);
      } else if (input.type === 'platform') {
        assertPermission(actor, 'platform.manage');
        if (
          input.rootMode === 'FEATURED' &&
          (!input.defaultTournamentId ||
            !(await tx.tournament.findFirst({
              where: { id: input.defaultTournamentId, ...publicTournamentWhere },
            })))
        )
          throw new AppError('The featured tournament must be published and not archived.');
        if (input.timezone)
          try {
            new Intl.DateTimeFormat('en', { timeZone: input.timezone });
          } catch {
            throw new AppError('Choose a valid IANA timezone.');
          }
        if (input.primaryDomain && input.primaryDomain !== appUrl().origin)
          throw new AppError(
            'Primary domain must match the deployment APP_URL and OAuth callback origin.',
          );
        const ids = [
          ...JSON.stringify([input.logo, input.favicon, input.socialImage]).matchAll(
            /\/api\/platform\/media\/([a-zA-Z0-9_-]+)/g,
          ),
        ].map((m) => m[1]);
        if (
          [input.logo, input.favicon, input.socialImage].some((v) =>
            v?.startsWith('/api/media/'),
          ) ||
          (ids.length &&
            (await tx.platformAsset.count({ where: { id: { in: [...new Set(ids)] } } })) !==
              new Set(ids).size)
        )
          throw new AppError('Use platform-owned branding images.', 403);
        const { type, ...data } = input;
        void type;
        await tx.platformSettings.upsert({
          where: { id: 'main' },
          create: { id: 'main', ...data, defaultTournamentId: data.defaultTournamentId || null },
          update: { ...data, defaultTournamentId: data.defaultTournamentId || null },
        });
      } else {
        assertPermission(actor, 'platform.manage');
        if (input.userId === actor.id)
          throw new AppError('You cannot change your own platform access.', 403);
        if (!input.enabled && (await tx.user.count({ where: { platformAdmin: true } })) <= 1)
          throw new AppError('The last platform administrator cannot be removed.', 409);
        await tx.user.update({
          where: { id: input.userId },
          data: { platformAdmin: input.enabled },
        });
      }
      await tx.auditLog.create({
        data: {
          tournamentId: input.type === 'create' || input.type === 'lifecycle' ? id : null,
          actorId: actor.id,
          action: `tournament.${input.type}`,
          entityType: 'Tournament',
          entityId: id,
          details: {},
        },
      });
      return { id };
    },
    { timeout: 15000 },
  );
}
