import { requireTournamentActor } from '@/lib/auth';
import { qualifierImportSchema } from '@/lib/qualifier-import-contract';
import { applyQualifierImport, previewQualifierImport } from '@/lib/qualifier-import-service';
import { errorResponse, jsonBody, requireSameOrigin, rateLimit } from '@/lib/security';

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const actor = await requireTournamentActor();
    await rateLimit(`qualifier-import:${actor.id}`, 12, 60);
    const input = qualifierImportSchema.parse(await jsonBody(request));
    const result = input.apply
      ? await applyQualifierImport(actor, input)
      : await previewQualifierImport(actor, input);
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
