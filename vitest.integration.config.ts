import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { assertTestDatabase } from './src/lib/instance';
if (!process.env.TEST_DATABASE_URL)
  throw new Error('Set TEST_DATABASE_URL to an isolated, migrated, seeded PostgreSQL database.');
assertTestDatabase(process.env.TEST_DATABASE_URL);
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: [
      'tests/integration.test.ts',
      'tests/teams.integration.test.ts',
      'tests/matches.integration.test.ts',
      'tests/tournaments.integration.test.ts',
      'tests/referee-import.integration.test.ts',
      'tests/irc.integration.test.ts',
      'tests/setup.integration.test.ts',
    ],
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL },
    fileParallelism: false,
    testTimeout: 20000,
  },
});
