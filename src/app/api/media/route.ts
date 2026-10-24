import { requireTournamentActor } from '@/lib/auth';
import { scopedDb } from '@/lib/scoped-db';
import { assertPermission, AppError } from '@/lib/permissions';
import { errorResponse, rateLimit, requireSameOrigin } from '@/lib/security';
import { uploadMedia } from '@/lib/media-cleanup';
import { imageUpload } from '@/lib/image-upload';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const actor = await requireTournamentActor();
    assertPermission(actor, 'media.upload');
    await rateLimit(`media:${actor.id}`, 20);
    const { data, info, name } = await imageUpload(request);
    const asset = await uploadMedia(data, async (rawTx, key) => {
      const tx = scopedDb(rawTx, actor.tournamentId!);
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
    return errorResponse(error);
  }
}
