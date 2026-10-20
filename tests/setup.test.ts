import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'dotenv';
describe('portable configuration', () => {
  it('generates distinct private credentials and refuses overwrite', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'platform-setup-'));
    try {
      const script = path.resolve('scripts/provision-docker.mjs');
      const run = () => spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' });
      expect(run().status).toBe(0);
      const c = parse(readFileSync(path.join(dir, '.env.docker')));
      expect(c.S3_SECRET_ACCESS_KEY).not.toBe(c.RUSTFS_SECRET_KEY);
      expect(c.IRC_ENABLED).toBe('false');
      expect(run().status).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('pins the test migration child independently of inherited live URLs', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'platform-migration-'));
    try {
      mkdirSync(path.join(dir, 'node_modules/prisma/build'), { recursive: true });
      writeFileSync(
        path.join(dir, 'node_modules/prisma/build/index.js'),
        'console.log(JSON.stringify([process.env.DATABASE_URL,process.env.DIRECT_URL]));',
      );
      const url = 'postgresql://test:test@localhost/tournament_platform_test';
      const r = spawnSync(process.execPath, [path.resolve('scripts/migrate-test.mjs')], {
        cwd: dir,
        env: {
          ...process.env,
          TEST_DATABASE_URL: url,
          DIRECT_URL: 'postgresql://live:secret@localhost/production',
        },
        encoding: 'utf8',
      });
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual([url, url]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
