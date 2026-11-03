import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { assertTestDatabase } from './src/lib/instance.ts';
if (!process.env.TEST_DATABASE_URL)
  throw new Error('Set TEST_DATABASE_URL to an isolated, migrated, seeded PostgreSQL database.');
assertTestDatabase(process.env.TEST_DATABASE_URL);
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: [
      'tests/lock.integration.test.ts',
      'tests/teams-export.integration.test.ts',
      'tests/media-cleanup.integration.test.ts',
      'tests/public-visibility.integration.test.ts',
      'tests/ownership.integration.test.ts',
      'tests/migrations.integration.test.ts',
      'tests/tournament-transfer.integration.test.ts',
      'tests/integration.test.ts',
      'tests/teams.integration.test.ts',
      'tests/matches.integration.test.ts',
      'tests/match-results-route.integration.test.ts',
      'tests/tournaments.integration.test.ts',
      'tests/referee-import.integration.test.ts',
      'tests/irc.integration.test.ts',
      'tests/gameplay-scoring.integration.test.ts',
      'tests/qualifier-capture.integration.test.ts',
      'tests/qualifier-workflows.integration.test.ts',
      'tests/competition.integration.test.ts',
      'tests/qualifiers-bulk.integration.test.ts',
      'tests/stage-workflows.integration.test.ts',
      'tests/pooling.integration.test.ts',
      'tests/pool-releases.integration.test.ts',
      'tests/matches-bulk.integration.test.ts',
      'tests/staff-bulk.integration.test.ts',
      'tests/qualifier-standings.integration.test.ts',
      'tests/qualifier-standings-archive.integration.test.ts',
      'tests/stage-reconciliation.integration.test.ts',
      'tests/setup.integration.test.ts',
      'tests/format-witnesses.integration.test.ts',
    ],
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL },
    fileParallelism: false,
    testTimeout: 20000,
  },
});
