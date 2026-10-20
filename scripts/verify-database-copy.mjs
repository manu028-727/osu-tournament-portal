import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const [source, sourceUser, sourceDb, destination, destinationUser, destinationDb] =
  process.argv.slice(2);
const names = [source, sourceUser, sourceDb, destination, destinationUser, destinationDb];
if (names.some((s) => !s || !/^[a-zA-Z0-9_-]+$/.test(s)))
  throw new Error(
    'Usage: verify-database-copy.mjs source-container user db destination-container user db',
  );
function query(container, user, database, sql) {
  return execFileSync(
    'docker',
    ['exec', '-i', container, 'psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', database],
    {
      input: `BEGIN READ ONLY;\n${sql}\nROLLBACK;\n`,
      maxBuffer: 64 * 1024 * 1024,
    },
  )
    .toString()
    .split('\n')
    .filter((s) => !['BEGIN', 'ROLLBACK', ''].includes(s))
    .join('\n');
}
const tables = query(
  source,
  sourceUser,
  sourceDb,
  "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;",
).split('\n');
for (const table of tables) {
  if (!/^[a-zA-Z0-9_]+$/.test(table)) throw new Error('Unexpected table identifier');
  const sql = `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') FROM "${table}" t;`;
  const original = query(source, sourceUser, sourceDb, sql);
  const restored = query(destination, destinationUser, destinationDb, sql);
  const digest = (value) => createHash('sha256').update(value).digest('hex');
  if (digest(original) !== digest(restored)) throw new Error(`Restored table differs: ${table}`);
}
console.log(
  `Verified identical contents in ${tables.length} tables (read-only SHA-256 comparison).`,
);
