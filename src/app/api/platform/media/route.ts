import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { getActor } from '@/lib/auth';
import { AppError, assertPermission } from '@/lib/permissions';
import { requireSameOrigin, rateLimit, errorResponse } from '@/lib/security';
import { imageUpload } from '@/lib/image-upload';
import { putObject, deleteObject } from '@/lib/storage';
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const actor = await getActor();
    assertPermission(actor, 'platform.manage');
    await rateLimit(`platform-media:${actor.id}`, 20);
    const { data, name } = await imageUpload(request),
      key = `${randomUUID()}.webp`;
    await putObject(key, data);
    try {
      const asset = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
        if (!(await tx.user.count({ where: { id: actor.id, platformAdmin: true } })))
          throw new AppError('Platform access revoked.', 403);
        const a = await tx.platformAsset.create({ data: { name, key, size: data.length } });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            tournamentId: null,
            action: 'platform.media.upload',
            entityType: 'PlatformAsset',
            entityId: a.id,
            details: {},
          },
        });
        return a;
      });
      return Response.json(
        { ...asset, url: `/api/platform/media/${asset.id}` },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    } catch (e) {
      await deleteObject(key).catch(() => {});
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
