import { randomUUID } from 'node:crypto';
import { getActor } from '@/lib/auth';
import { db as rootDb } from '@/lib/db';
import { scopedDb } from '@/lib/scoped-db';
import { assertPermission, AppError } from '@/lib/permissions';
import { errorResponse, rateLimit, requireSameOrigin } from '@/lib/security';
import { putObject, deleteObject } from '@/lib/storage';
import { imageUpload } from '@/lib/image-upload';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const actor = await getActor();
    assertPermission(actor, 'media.upload');
    const db = scopedDb(rootDb, actor.tournamentId || 'main');
    await rateLimit(`media:${actor.id}`, 20);
    const { data, info, name } = await imageUpload(request);
    const key = `${randomUUID()}.webp`;
    await putObject(key, data);
    try {
      const asset = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
        if (
          !(await tx.user.findFirst({ where: { id: actor.id, platformAdmin: true } })) &&
          !(await tx.userRole.findFirst({
            where: {
              userId: actor.id,
              role: { permissions: { some: { permissionKey: 'media.upload' } } },
            },
          }))
        )
          throw new AppError('Permission was revoked.', 403);
        const asset = await tx.mediaAsset.create({
          data: {
            key,
            name,
            mimeType: 'image/webp',
            size: data.length,
            width: info.width,
            height: info.height,
            createdBy: actor.id,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: 'media.upload',
            entityType: 'media',
            entityId: asset.id,
            details: { name: asset.name },
          },
        });
        return asset;
      });
      return Response.json(
        { ...asset, url: `/api/media/${asset.id}` },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    } catch (error) {
      await deleteObject(key).catch(() => console.error('Uncommitted media cleanup needs retry.'));
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
