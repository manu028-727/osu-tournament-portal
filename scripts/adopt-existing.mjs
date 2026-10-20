import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) throw new Error('Configure the intended database explicitly.');
const name = decodeURIComponent(new URL(url).pathname.slice(1));
if (name !== process.env.APP_DATABASE_NAME)
  throw new Error('APP_DATABASE_NAME must explicitly match the adoption target.');
const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  await c.query('BEGIN READ ONLY');
  const tables = (
    await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")
  ).rows.map((x) => x.tablename);
  if (
    ![
      'Tournament',
      'PlatformSettings',
      'MatchMapAction',
      'MatchMapResult',
      'IrcLobbyRequest',
      '_prisma_migrations',
    ].every((t) => tables.includes(t))
  )
    throw new Error(
      'Expected an existing multi-tournament schema including the IRC migration. Upgrade the private installation first.',
    );
  const original = Number((await c.query('SELECT count(*) FROM "Tournament"')).rows[0].count);
  const applied = await c.query(
    'SELECT 1 FROM "_prisma_migrations" WHERE migration_name=$1 AND finished_at IS NOT NULL',
    ['20261020000000_baseline'],
  );
  await c.query('ROLLBACK');
  console.log(
    `Adoption preview: ${original} tournaments, ${tables.length} tables. No content will be rewritten.`,
  );
  if (applied.rowCount) {
    console.log('Generic baseline already adopted.');
    process.exitCode = 0;
  } else if (process.argv.includes('--apply')) {
    if (process.env.CONFIRM_DATABASE_ADOPTION !== name)
      throw new Error(
        'Set CONFIRM_DATABASE_ADOPTION to the exact reviewed database name after taking a backup.',
      );
    await c.query('BEGIN');
    try {
      await c.query(readFileSync('deploy/adopt-existing.sql', 'utf8'));
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
    const result = spawnSync(
      process.execPath,
      [
        'node_modules/prisma/build/index.js',
        'migrate',
        'resolve',
        '--applied',
        '20261020000000_baseline',
      ],
      { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url } },
    );
    if (result.status !== 0)
      throw new Error(
        'Structure upgraded; baseline marking failed. Do not run baseline DDL. Review and retry this adoption command.',
      );
    console.log(
      'Generic baseline adopted. Original migration ledger and tournament records retained.',
    );
  }
} finally {
  await c.end();
}
