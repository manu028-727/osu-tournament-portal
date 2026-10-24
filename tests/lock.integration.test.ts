import pg from 'pg';
import { expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { assertTestDatabase } from '../src/lib/instance';

assertTestDatabase(process.env.DATABASE_URL);
it('measures independent connections contending on the retained global write lock', async () => {
  const owner = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const contender = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await owner.connect();
  await contender.connect();
  try {
    await owner.query('BEGIN');
    await owner.query('SELECT pg_advisory_xact_lock(78214321)');
    await contender.query('BEGIN');
    expect(
      (await contender.query('SELECT pg_try_advisory_xact_lock(78214321) AS acquired')).rows[0]
        .acquired,
    ).toBe(false);
    const started = performance.now();
    let acquired = false;
    const waiting = contender.query('SELECT pg_advisory_xact_lock(78214321)').then(() => {
      acquired = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(acquired).toBe(false);
    await owner.query('COMMIT');
    await waiting;
    const waitMs = performance.now() - started;
    expect(waitMs).toBeGreaterThanOrEqual(140);
    await contender.query('COMMIT');
    await mkdir('.data/cleanup-20261024', { recursive: true });
    await writeFile(
      '.data/cleanup-20261024/lock-contention.json',
      JSON.stringify({
        controlledHoldMs: 150,
        waitMs,
        connections: 2,
        scope: 'synthetic isolated database; not a throughput benchmark',
      }),
    );
  } finally {
    await owner.query('ROLLBACK');
    await contender.query('ROLLBACK');
    await owner.end();
    await contender.end();
  }
});
