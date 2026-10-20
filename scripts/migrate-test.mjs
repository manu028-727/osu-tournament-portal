import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parse } from 'dotenv';

const file = (() => {
  try {
    return parse(readFileSync('.env.test'));
  } catch {
    return {};
  }
})();
const url = process.env.TEST_DATABASE_URL || file.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/tournament_platform_test')
  throw new Error('TEST_DATABASE_URL must name the isolated tournament_platform_test database.');
// Pin BOTH URLs before Prisma loads dotenv. Never inherit the host migration URL.
const result = spawnSync(
  process.execPath,
  ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: url,
      DIRECT_URL: url,
      APP_DATABASE_NAME: 'tournament_platform_test',
    },
  },
);
process.exit(result.status || (result.error ? 1 : 0));
