import { db as rootDb } from '@/lib/db';
import { scopedDb } from '@/lib/scoped-db';
import { isPublicAsset } from '@/lib/media-access';
import { canAccessWorkspace } from '@/lib/workspace';
import { getActor, requireTournamentActor } from '@/lib/auth';
import { assertPermission, AppError } from '@/lib/permissions';
import { errorResponse, requireSameOrigin } from '@/lib/security';
import { deleteObject, getObject } from '@/lib/storage';
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
    const url = `/api/media/${id}`;
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
      const settings = await tx.tournamentSettings.findFirst({
        where: { OR: [{ logo: url }, { banner: url }, { favicon: url }] },
      });
      const members = await tx.staffMember.count({ where: { customImage: url } });
      const revisions = await tx.pageRevision.count({ where: { html: { contains: url } } });
      const blocks = await tx.contentBlock.findMany({ select: { content: true } });
      const stages = await tx.tournamentStage.count({ where: { bannerImageId: id } });
      const teams = await tx.team.count({ where: { logoImageId: id } });
      const qualifierHistory = await tx.qualifierLobby.count({
        where: { participants: { array_contains: [{ logoImageId: id }] } },
      });
      const historical = await tx.match.count({
        where: {
          OR: [
            { participants: { path: ['A', 'logoImageId'], equals: id } },
            { participants: { path: ['B', 'logoImageId'], equals: id } },
          ],
        },
      });
      if (
        settings ||
        members ||
        revisions ||
        stages ||
        teams ||
        historical ||
        qualifierHistory ||
        blocks.some((b) => JSON.stringify(b.content).includes(url))
      )
        throw new AppError(
          'This image is used in content or revision history. Replace its references before deleting.',
          409,
        );
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
    // Database commit happens first. A failed storage cleanup leaves an orphan, never broken published references.
    try {
      await deleteObject(asset.key);
    } catch {
      console.error('Media object cleanup failed for asset', asset.id);
    }
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
