import { requireTournamentActor } from '@/lib/auth';
import { AppError, assertPermission } from '@/lib/permissions';
import { errorResponse, jsonBody, requireSameOrigin, rateLimit } from '@/lib/security';
import { multipartBody } from '@/lib/request-body';
import {
  previewWorkbook,
  importPreview,
  applyWorkbook,
  importApplySchema,
  importDestinations,
  applyWorkbookBatch,
  importBatchSchema,
} from '@/lib/referee-import';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    const actor = await requireTournamentActor();
    assertPermission(actor, 'matches.import');
    if (new URL(request.url).searchParams.get('destinations') === '1')
      return Response.json(await importDestinations(actor), {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    const id = new URL(request.url).searchParams.get('id');
    if (!id || id.length > 100) throw new AppError('Choose an import preview.');
    return Response.json(await importPreview(actor, id), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const actor = await requireTournamentActor();
    assertPermission(actor, 'matches.import');
    await rateLimit(`referee-import:${actor.id}`, 10, 60);
    if (request.headers.get('content-type')?.includes('application/json')) {
      const body = await jsonBody(request);
      return Response.json(
        body && typeof body === 'object' && 'type' in body && body.type === 'batch'
          ? await applyWorkbookBatch(actor, importBatchSchema.parse(body))
          : await applyWorkbook(actor, importApplySchema.parse(body)),
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    const max = 4 * 1024 * 1024 + 100000;
    const form = await multipartBody(request, max, 'Maximum workbook size is 4 MB.');
    const file = form.get('file');
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.xlsx'))
      throw new AppError('Choose an XLSX workbook.');
    return Response.json(
      await previewWorkbook(actor, Buffer.from(await file.arrayBuffer()), file.name),
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
