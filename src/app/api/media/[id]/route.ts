import { db as rootDb } from '@/lib/db';
import { scopedDb } from '@/lib/scoped-db';
import { isPublicAsset } from '@/lib/media-access';
import { canAccessWorkspace } from '@/lib/workspace';
import { getActor, requireTournamentActor } from '@/lib/auth';
import { assertPermission, AppError } from '@/lib/permissions';
import { errorResponse, requireSameOrigin } from '@/lib/security';
import { getObject } from '@/lib/storage';
import { queueMediaCleanup, recoverMediaCleanup } from '@/lib/media-cleanup';
import { isMediaReferenced } from '@/lib/media-references';
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const asset = await rootDb.mediaAsset.findUnique({ where: { id } });
    if (!asset) throw new AppError('Image not found.', 404);
    const actor = await getActor(asset.tournamentId);
    if (!canAccessWorkspace(actor) && !(await isPublicAsset(id, asset.tournamentId)))
      throw new AppError('Image not found.', 404);
    return new Response(new Uint8Array(await getObject(asset.key)), {
      headers: {
        'Content-Type': 'image/webp',
        'Content-Length': String(asset.size),
        'Cache-Control': 'private, no-store',
        Vary: 'Cookie',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    const actor = await requireTournamentActor();
    assertPermission(actor, 'media.upload');
    const db = scopedDb(rootDb, actor.tournamentId || 'main');
    const { id } = await params;
    const asset = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
      const permission = await tx.userRole.findFirst({
        where: {
          userId: actor.id,
          role: { permissions: { some: { permissionKey: 'media.upload' } } },
        },
      });
      if (
        !permission &&
        !(await tx.user.findFirst({ where: { id: actor.id, platformAdmin: true } }))
      )
        throw new AppError('Permission was revoked.', 403);
      const asset = await tx.mediaAsset.findUniqueOrThrow({ where: { id } });
      if (await isMediaReferenced(tx, actor.tournamentId!, id))
        throw new AppError(
          'This image is used in content or revision history. Replace its references before deleting.',
          409,
        );
      await queueMediaCleanup(tx, asset.key);
      await tx.mediaAsset.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'media.delete',
          entityType: 'media',
          entityId: id,
          details: { name: asset.name },
        },
      });
      return asset;
    });
    await recoverMediaCleanup({ apply: true, keys: [asset.key] }).catch(() => {});
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
