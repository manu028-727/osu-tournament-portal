import { defineConfig, devices } from '@playwright/test';
import { assertTestDatabase } from './src/lib/instance';
import path from 'node:path';
import { cpSync } from 'node:fs';
if (!process.env.TEST_DATABASE_URL)
  throw new Error('Set TEST_DATABASE_URL to an isolated, migrated, seeded PostgreSQL database.');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
assertTestDatabase(process.env.TEST_DATABASE_URL);
if (process.env.E2E_PRODUCTION === '1') {
  cpSync('.next/static', '.next/standalone/.next/static', { recursive: true });
  cpSync('public', '.next/standalone/public', { recursive: true });
}
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: { baseURL: 'http://localhost:3001', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      process.env.E2E_PRODUCTION === '1'
        ? 'node .next/standalone/server.js'
        : 'npm run dev -- --port 3001',
    url: 'http://localhost:3001',
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      PORT: '3001',
      HOSTNAME: '127.0.0.1',
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      APP_URL: 'http://localhost:3001',
      STORAGE_DRIVER: 'filesystem',
      STORAGE_LOCAL_DIR: path.resolve('.data/test-uploads'),
    },
  },
});
