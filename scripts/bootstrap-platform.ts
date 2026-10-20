import 'dotenv/config';
import { db } from '../src/lib/db';
import { ALL_PERMISSIONS, PERMISSIONS } from '../src/lib/permissions';

const owner = process.env.OWNER_OSU_ID;
if (owner && !/^[1-9]\d{0,8}$/.test(owner))
  throw new Error('OWNER_OSU_ID must be a numeric osu! account ID.');
try {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
    for (const key of ALL_PERMISSIONS)
      await tx.permission.upsert({
        where: { key },
        create: { key, description: PERMISSIONS[key] },
        update: {},
      });
    const admins = await tx.user.count({ where: { platformAdmin: true } });
    const platform = await tx.platformSettings.upsert({
      where: { id: 'main' },
      create: {
        name: process.env.INITIAL_SITE_NAME || 'osu! Tournament Platform',
        bootstrapOwnerOsuId: owner ? Number(owner) : null,
        ownerBootstrappedAt: admins ? new Date() : null,
      },
      update: {},
    });
    if (!platform.ownerBootstrappedAt && !admins && owner) {
      if (platform.bootstrapOwnerOsuId && platform.bootstrapOwnerOsuId !== Number(owner))
        throw new Error(
          'Owner identity is already pinned. Explicit database recovery is required to change it.',
        );
      await tx.platformSettings.update({
        where: { id: 'main' },
        data: { bootstrapOwnerOsuId: Number(owner) },
      });
    } else if (!platform.ownerBootstrappedAt && admins) {
      await tx.platformSettings.update({
        where: { id: 'main' },
        data: { ownerBootstrappedAt: new Date(), bootstrapOwnerOsuId: null },
      });
    }
  });
  console.log(
    'System permissions initialized. No tournament or login account was created. Open /setup.',
  );
} finally {
  await db.$disconnect();
}
