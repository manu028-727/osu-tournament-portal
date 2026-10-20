import { mkdir, readdir, readFile, writeFile, copyFile, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { parseArgs } from 'node:util';
import { createStorage, contentHash, assertStorageKey } from '../src/lib/storage';
import { assertInstanceDatabase } from '../src/lib/instance';

const { values } = parseArgs({
  options: {
    source: { type: 'string' },
    backup: { type: 'string' },
    report: { type: 'string' },
    copy: { type: 'boolean', default: false },
  },
});
if (!values.source || !values.report || (values.copy && !values.backup))
  throw new Error(
    'Usage: migrate-media.ts --source /uploads --report /private/report.json [--copy --backup /private/backup]',
  );
const source = path.resolve(values.source);
const backup = values.backup ? path.resolve(values.backup) : undefined;
if (backup && (backup === source || backup.startsWith(source + path.sep)))
  throw new Error('Backup must be outside source.');
const connectionString = new URL(process.env.DIRECT_URL || process.env.DATABASE_URL!);
if (process.env.MIGRATION_DATABASE_HOST)
  connectionString.hostname = process.env.MIGRATION_DATABASE_HOST;
assertInstanceDatabase(connectionString.toString());
const db = new pg.Client({ connectionString: connectionString.toString() });
await db.connect();
const report: {
  dryRun: boolean;
  at: string;
  source: string;
  files: Record<string, unknown>[];
  missing: string[];
  errors: string[];
} = {
  dryRun: !values.copy,
  at: new Date().toISOString(),
  source,
  files: [],
  missing: [],
  errors: [],
};
try {
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const assets = (
    await db.query<{ id: string; key: string; size: number; tournamentId: string }>(
      'SELECT id,key,size,"tournamentId" FROM "MediaAsset"',
    )
  ).rows;
  if (
    (await db.query('SELECT to_regclass(\'public."PlatformAsset"\') AS table_name')).rows[0]
      .table_name
  ) {
    assets.push(
      ...(await db.query('SELECT id,key,size,NULL::text AS "tournamentId" FROM "PlatformAsset"'))
        .rows,
    );
  }
  const tables = (
    await db.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'MediaAsset' ORDER BY tablename",
    )
  ).rows;
  const references: Record<string, Record<string, number>> = {};
  for (const { tablename } of tables) {
    const rows = (
      await db.query(`SELECT to_jsonb(t)::text AS row FROM ${pg.escapeIdentifier(tablename)} t`)
    ).rows as { row: string }[];
    for (const asset of assets) {
      const count = rows.filter(
        (r) =>
          r.row.includes(`/api/media/${asset.id}`) ||
          r.row.includes(`/api/platform/media/${asset.id}`) ||
          r.row.includes(`"${asset.id}"`),
      ).length;
      if (count) (references[asset.id] ||= {})[tablename] = count;
    }
  }
  await db.query('ROLLBACK');
  const discovered: string[] = [];
  async function inventory(directory: string, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = path.join(prefix, entry.name);
      if (entry.isSymbolicLink()) {
        report.errors.push(`Symlink refused: ${relative}`);
        continue;
      }
      if (entry.isDirectory()) await inventory(path.join(directory, entry.name), relative);
      else if (entry.isFile()) discovered.push(relative);
      else report.errors.push(`Unsupported filesystem entry: ${relative}`);
    }
  }
  await inventory(source);
  report.missing = assets.filter((a) => !discovered.includes(a.key)).map((a) => a.key);
  const destination = values.copy ? createStorage({ ...process.env, STORAGE_DRIVER: 's3' }) : null;
  for (const key of discovered.sort()) {
    const file = path.join(source, key);
    try {
      if ((await lstat(file)).isSymbolicLink()) throw new Error('Source changed to symlink');
      const body = await readFile(file);
      const sha256 = contentHash(body);
      const asset = assets.find((a) => a.key === key);
      const item: Record<string, unknown> = {
        key,
        size: body.length,
        sha256,
        asset: asset ? { ...asset, references: references[asset.id] || {} } : null,
        state: 'inventoried',
      };
      report.files.push(item);
      if (asset && asset.size !== body.length) throw new Error('Database size differs from source');
      if (values.copy && backup) {
        const target = path.join(backup, key);
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        try {
          await copyFile(file, target, constants.COPYFILE_EXCL);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        if (contentHash(await readFile(target)) !== sha256)
          throw new Error('Backup content mismatch; nothing overwritten');
      }
      try {
        assertStorageKey(key);
      } catch {
        item.state = 'backup-only-unsupported-key';
        continue;
      }
      if (destination) {
        const existing = await destination.head(key);
        if (existing) {
          if (existing.size !== body.length || contentHash(await destination.get(key)) !== sha256)
            throw new Error('Destination collision; existing object was not overwritten');
          item.state = 'already-verified';
        } else {
          await destination.put(key, body);
          if (
            (await destination.head(key))?.size !== body.length ||
            contentHash(await destination.get(key)) !== sha256
          )
            throw new Error('Destination readback verification failed');
          item.state = 'copied-and-verified';
        }
      }
      if (contentHash(await readFile(file)) !== sha256)
        throw new Error('Source changed during copy; reconcile before cutover');
    } catch (error) {
      report.errors.push(`${key}: ${error instanceof Error ? error.message : 'Failed'}`);
    }
  }
  await mkdir(path.dirname(path.resolve(values.report)), { recursive: true, mode: 0o700 });
  await writeFile(values.report, JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
  console.log(
    `${report.dryRun ? 'Preview' : 'Copy'}: ${report.files.length} files, ${report.missing.length} missing, ${report.errors.length} errors. Database references and source files were not changed.`,
  );
  if (report.missing.length || report.errors.length) process.exitCode = 1;
} finally {
  await db.end();
}
