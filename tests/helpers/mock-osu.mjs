// Explicit E2E-only provider boundary. Application routes and domain writers remain real.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const database = process.env.DATABASE_URL;
if (
  !database ||
  new URL(database).pathname !== '/tournament_platform_test' ||
  !process.env.E2E_OSU_FIXTURE_DIR
)
  throw Error(
    'Mock osu! provider requires the isolated test database and explicit fixture directory.',
  );
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.hostname !== 'osu.ppy.sh') return original(input, init);
  if (url.pathname === '/oauth/token')
    return Response.json({ access_token: 'synthetic-e2e-public-token', expires_in: 3600 });
  const match = /^\/api\/v2\/matches\/(\d+)$/.exec(url.pathname);
  const user = /^\/api\/v2\/users\/(\d+)(?:\/\w+)?$/.exec(url.pathname);
  const filename = match ? `match-${match[1]}.json` : user ? `user-${user[1]}.json` : null;
  if (!filename) return Response.json({ error: 'No synthetic provider fixture' }, { status: 404 });
  try {
    const result = JSON.parse(
      await readFile(path.join(process.env.E2E_OSU_FIXTURE_DIR, filename), 'utf8'),
    );
    return Response.json(result);
  } catch {
    return Response.json({ error: 'No synthetic provider fixture' }, { status: 404 });
  }
};
