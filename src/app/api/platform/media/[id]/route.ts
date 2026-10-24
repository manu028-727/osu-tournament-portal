import { db } from '@/lib/db';
import { getActor } from '@/lib/auth';
import { AppError, assertPermission } from '@/lib/permissions';
import { errorResponse, requireSameOrigin } from '@/lib/security';
import { getObject } from '@/lib/storage';
import { queueMediaCleanup, recoverMediaCleanup } from '@/lib/media-cleanup';
import { referencedMediaIds } from '@/lib/media-references';
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params,
      url = `/api/platform/media/${id}`;
    const [asset, p, actor] = await Promise.all([
      db.platformAsset.findUnique({ where: { id } }),
      db.platformSettings.findUnique({ where: { id: 'main' } }),
      getActor(),
    ]);
    if (!asset || (!actor?.platformAdmin && ![p?.logo, p?.favicon, p?.socialImage].includes(url)))
      throw new AppError('Image not found.', 404);
    return new Response(new Uint8Array(await getObject(asset.key)), {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        Vary: 'Cookie',
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    const actor = await getActor();
    assertPermission(actor, 'platform.manage');
    const { id } = await params;
    const asset = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
      if (!(await tx.user.count({ where: { id: actor.id, platformAdmin: true } })))
        throw new AppError('Platform access revoked.', 403);
      const p = await tx.platformSettings.findUnique({ where: { id: 'main' } });
      if (referencedMediaIds(p, 'platform').has(id))
        throw new AppError('Replace the platform branding reference before deleting.', 409);
      const a = await tx.platformAsset.findUniqueOrThrow({ where: { id } });
      await queueMediaCleanup(tx, a.key);
      await tx.platformAsset.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          tournamentId: null,
          action: 'platform.media.delete',
          entityType: 'PlatformAsset',
          entityId: id,
          details: {},
        },
      });
      return a;
    });
    await recoverMediaCleanup({ apply: true, keys: [asset.key] }).catch(() => {});
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
