import { getActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { AppError } from '@/lib/permissions';
import { errorResponse, requireSameOrigin, rateLimit, jsonBody } from '@/lib/security';
import { multipartBody } from '@/lib/request-body';
import { MAX_ARCHIVE_BYTES } from '@/lib/tournament-archive-format';
import {
  assertImportPermission,
  inspectArchive,
  importTournament,
  recoverTransfer,
} from '@/lib/tournament-import';
import { z } from 'zod';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const actor = await getActor();
    assertImportPermission(actor);
    const jobs = await db.tournamentTransfer.findMany({
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        tournamentId: true,
        status: true,
        report: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return Response.json({ jobs }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const actor = await getActor();
    assertImportPermission(actor);
    await rateLimit(`tournament-import:${actor.id}`, 8, 300);
    const form = await multipartBody(
      request,
      MAX_ARCHIVE_BYTES + 100000,
      'Maximum archive size is 64 MB.',
    );
    const file = form.get('file');
    if (
      !(file instanceof File) ||
      !file.name.toLowerCase().endsWith('.zip') ||
      file.size > MAX_ARCHIVE_BYTES
    )
      throw new AppError('Choose a tournament ZIP archive up to 64 MB.');
    const { archive, preview } = await inspectArchive(Buffer.from(await file.arrayBuffer()));
    if (form.get('operation') === 'preview')
      return Response.json(preview, { headers: { 'Cache-Control': 'private, no-store' } });
    if (
      form.get('operation') !== 'import' ||
      form.get('acknowledgement') !== 'NEW_UNPUBLISHED' ||
      form.get('fingerprint') !== archive.fingerprint
    )
      throw new AppError(
        'Preview this exact archive and confirm a new unpublished tournament before importing.',
        409,
      );
    return Response.json(await importTournament(actor, archive, String(form.get('slug') || '')), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request);
    const actor = await getActor();
    assertImportPermission(actor);
    await rateLimit(`tournament-recovery:${actor.id}`, 10, 300);
    const { id } = z
      .object({ id: z.uuid() })
      .strict()
      .parse(await jsonBody(request));
    return Response.json(await recoverTransfer(actor, id), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
