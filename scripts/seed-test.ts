import { db } from '../src/lib/db';
import { assertTestDatabase } from '../src/lib/instance';
import { ALL_PERMISSIONS, PERMISSIONS, DEFAULT_ROLES } from '../src/lib/permissions';
import { DEFAULT_COPY } from '../src/lib/copy';
assertTestDatabase(process.env.DATABASE_URL);
try {
  await db.$transaction(async (tx) => {
    for (const key of ALL_PERMISSIONS)
      await tx.permission.upsert({
        where: { key },
        create: { key, description: PERMISSIONS[key] },
        update: {},
      });
    await tx.tournament.upsert({
      where: { id: 'main' },
      create: {
        id: 'main',
        name: 'Test Cup',
        acronym: 'TEST',
        slug: 'test-cup',
        description: '',
        status: 'UPCOMING',
        published: true,
        timezone: 'UTC',
        settings: {
          create: {
            banner: '',
            registrationUrl: '',
            socialLinks: [],
            importantDates: [],
            navigation: [
              { label: 'Home', href: '/' },
              { label: 'Mappools', href: '/mappools' },
              { label: 'Staff', href: '/staff' },
              { label: 'Rules', href: '/rules' },
              { label: 'Teams', href: '/teams' },
              { label: 'Matches', href: '/matches' },
            ],
            footer: '',
            copy: DEFAULT_COPY,
          },
        },
      },
      update: {},
    });
    for (const [name, permissions] of Object.entries(DEFAULT_ROLES)) {
      const r = await tx.role.upsert({
        where: { systemKey: name },
        create: { name, systemKey: name, templateKey: name, tournamentId: 'main' },
        update: {},
      });
      await tx.rolePermission.createMany({
        data: permissions.map((permissionKey) => ({ roleId: r.id, permissionKey })),
        skipDuplicates: true,
      });
    }
    for (const [position, acronym] of ['NM', 'HD', 'HR', 'DT', 'FM', 'TB'].entries())
      await tx.modCategory.upsert({
        where: { tournamentId_acronym: { tournamentId: 'main', acronym } },
        create: { name: acronym, acronym, position, color: '#a6c7ef' },
        update: {},
      });
    for (const slug of ['home', 'rules'])
      if (
        !(await tx.page.findUnique({
          where: { tournamentId_slug: { tournamentId: 'main', slug } },
        }))
      ) {
        const p = await tx.page.create({
          data: { slug, title: slug === 'home' ? 'Test Cup' : 'Rules' },
        });
        const r = await tx.pageRevision.create({
          data: {
            pageId: p.id,
            title: p.title,
            html: slug === 'home' ? '<h1>Test Cup</h1>' : '<h1>Rules</h1>',
          },
        });
        await tx.page.update({
          where: { id: p.id },
          data: { draftRevisionId: r.id, publishedRevisionId: r.id, state: 'PUBLISHED' },
        });
      }
    await tx.platformSettings.upsert({
      where: { id: 'main' },
      create: {
        name: 'Test Platform',
        rootMode: 'FEATURED',
        defaultTournamentId: 'main',
        bootstrapOwnerOsuId: 900000001,
      },
      update: {},
    });
  });
  console.log('Synthetic isolated test fixture initialized.');
} finally {
  await db.$disconnect();
}
