import { getActor } from '@/lib/auth';
import { AppError, assertPermission } from '@/lib/permissions';
import { requireSameOrigin, rateLimit, errorResponse } from '@/lib/security';
import { imageUpload } from '@/lib/image-upload';
import { uploadMedia } from '@/lib/media-cleanup';
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const actor = await getActor();
    assertPermission(actor, 'platform.manage');
    await rateLimit(`platform-media:${actor.id}`, 20);
    const { data, name } = await imageUpload(request);
    const asset = await uploadMedia(data, async (tx, key) => {
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
    return errorResponse(e);
  }
}
