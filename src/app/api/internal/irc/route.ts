import { db } from '@/lib/db';
import { AppError } from '@/lib/permissions';
import { errorResponse } from '@/lib/security';
import { ircSecret, verifyRpc } from '@/lib/irc-security';
import { gatewayRequest, executeGateway } from '@/lib/irc-service';

export async function POST(request: Request) {
  try {
    if (process.env.IRC_ENABLED !== 'true') throw new AppError('Not found.', 404);
    const reader = request.body?.getReader();
    if (!reader) throw new AppError('Missing gateway request.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8000) {
        await reader.cancel();
        throw new AppError('Request too large.', 413);
      }
      chunks.push(value);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    let nonce: string;
    try {
      nonce = verifyRpc(body, request.headers, ircSecret());
    } catch {
      throw new AppError('Gateway authentication failed.', 403);
    }
    try {
      await db.rateLimit.create({
        data: { key: `irc-nonce:${nonce}`, count: 1, expiresAt: new Date(Date.now() + 60000) },
      });
    } catch {
      throw new AppError('Gateway request already used or unavailable.', 403);
    }
    await db.rateLimit.deleteMany({
      where: { key: { startsWith: 'irc-nonce:' }, expiresAt: { lt: new Date() } },
    });
    const input = gatewayRequest.parse(JSON.parse(body));
    return Response.json(await executeGateway(input), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
