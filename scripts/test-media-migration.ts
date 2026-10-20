import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, writeFile, unlink, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';
import { createStorage, contentHash } from '../src/lib/storage';

if (process.env.ALLOW_ISOLATED_CONTAINER_TESTS !== 'yes')
  throw new Error('Explicit isolated staging tests only.');
const url = new URL(process.env.DATABASE_URL!);
if (!['/tournament_platform_test', '/platform_onboarding_test'].includes(url.pathname))
  throw new Error('Only dedicated test databases are accepted.');
if (process.env.MIGRATION_DATABASE_HOST) url.hostname = process.env.MIGRATION_DATABASE_HOST;
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
const key = (await db.query<{ key: string }>('SELECT key FROM "MediaAsset" ORDER BY id LIMIT 1'))
  .rows[0]?.key;
await db.end();
if (!key) throw new Error('Restore the media catalog into staging first.');
const original = path.resolve(process.argv[2] || '.data/uploads');
const root = path.resolve(`.data/audits/media-tests-${randomUUID()}`),
  source = path.join(root, 'source'),
  backup = path.join(root, 'backup');
await mkdir(root, { recursive: true, mode: 0o700 });
await cp(original, source, { recursive: true });
const store = createStorage({ ...process.env, STORAGE_DRIVER: 's3' });
const collision = `${randomUUID()}.webp`,
  bytes = await readFile(path.join(source, key));
await writeFile(path.join(source, collision), bytes);
await store.put(collision, Buffer.from('retained destination bytes'));
function run(name: string, copy = false) {
  const report = path.join(root, `${name}.json`);
  const child = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      'scripts/migrate-media.ts',
      '--source',
      source,
      '--report',
      report,
      ...(copy ? ['--copy', '--backup', backup] : []),
    ],
    { env: process.env, encoding: 'utf8' },
  );
  return { status: child.status, report };
}
try {
  const conflict = run('collision', true);
  assert.equal(conflict.status, 1);
  assert.equal((await store.get(collision)).toString(), 'retained destination bytes');
  const conflictReport = JSON.parse(await readFile(conflict.report, 'utf8'));
  assert.ok(conflictReport.errors.some((e: string) => e.includes('Destination collision')));
  await unlink(path.join(source, collision));
  await symlink(path.join(original, key), path.join(source, 'symlink.webp'));
  await unlink(path.join(source, key));
  const missing = run('missing-and-symlink');
  assert.equal(missing.status, 1);
  const missingReport = JSON.parse(await readFile(missing.report, 'utf8'));
  assert.ok(missingReport.missing.includes(key));
  assert.ok(missingReport.errors.some((e: string) => e.includes('Symlink refused')));
  const local = createStorage({ STORAGE_DRIVER: 'filesystem', STORAGE_LOCAL_DIR: original });
  assert.equal(contentHash(await local.get(key)), contentHash(await store.get(key)));
  assert.equal(contentHash(await readFile(path.join(backup, key))), contentHash(bytes));
  console.log(
    'Migration collision, missing-reference, symlink, backup-integrity and filesystem rollback checks passed; original files retained.',
  );
} finally {
  await store.delete(collision);
}
