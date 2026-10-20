import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: [
      'tests/unit.test.ts',
      'tests/instance.test.ts',
      'tests/setup.test.ts',
      'tests/portal.test.ts',
      'tests/mappool-order.test.ts',
      'tests/match-access.test.ts',
      'tests/workspace.test.ts',
      'tests/teams-csv.test.ts',
      'tests/match-engine.test.ts',
      'tests/discord-result.test.ts',
      'tests/multiplayer.test.ts',
      'tests/referee-workbook.test.ts',
      'tests/storage.test.ts',
      'tests/irc.test.ts',
      'tests/container-proxy.test.ts',
    ],
  },
});
