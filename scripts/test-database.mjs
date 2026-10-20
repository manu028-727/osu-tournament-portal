import { config } from 'dotenv';
import { spawnSync } from 'node:child_process';
config({ path: '.env.test', quiet: true });
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/tournament_platform_test')
  throw new Error('Only the isolated tournament_platform_test database is allowed.');
const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url };
for (const args of [
  ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  ['node_modules/tsx/dist/cli.mjs', 'scripts/seed-test.ts'],
]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env });
  if (result.status !== 0) process.exit(result.status || 1);
}
