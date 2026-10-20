import 'dotenv/config';
import pg from 'pg';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { assertInstanceDatabase } from '../src/lib/instance';

assertInstanceDatabase(process.env.DATABASE_URL);
const output = path.resolve(process.argv[2] || `.data/audits/${Date.now()}.json`);
if (!output.startsWith(path.resolve('.data') + path.sep))
  throw new Error(
    "Write private audit reports only inside this checkout's ignored .data directory.",
  );
const db = new pg.Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
assertInstanceDatabase(process.env.DIRECT_URL || process.env.DATABASE_URL);
await db.connect();
try {
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await db.query("SET LOCAL statement_timeout = '30s'");
  const tables = (
    await db.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    )
  ).rows;
  const rows = new Map<string, Record<string, unknown>[]>();
  const inventory: Record<string, { rows: number; sha256: string }> = {};
  for (const { tablename } of tables) {
    const data = (await db.query(`SELECT * FROM ${pg.escapeIdentifier(tablename)}`)).rows;
    rows.set(tablename, data);
    inventory[tablename] = {
      rows: data.length,
      sha256: createHash('sha256')
        .update(
          data
            .map((r) => JSON.stringify(r))
            .sort()
            .join('\n'),
        )
        .digest('hex'),
    };
  }
  const integrity: Record<string, number> = {};
  const checks = {
    matchStage:
      'SELECT count(*) FROM "Match" m JOIN "TournamentStage" s ON s.id=m."stageId" WHERE m."tournamentId"<>s."tournamentId"',
    matchActionResult:
      'SELECT count(*) FROM "MatchMapResult" r JOIN "MatchMapAction" a ON a.id=r."actionId" WHERE r."matchId"<>a."matchId"',
    poolStage:
      'SELECT count(*) FROM "Mappool" p JOIN "TournamentStage" s ON s.id=p."stageId" WHERE p."tournamentId"<>s."tournamentId"',
    roleMembership:
      'SELECT count(*) FROM "UserRole" u JOIN "Role" r ON r.id=u."roleId" WHERE u."tournamentId"<>r."tournamentId"',
    unvalidatedConstraints:
      "SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated",
  };
  for (const [key, sql] of Object.entries(checks))
    integrity[key] = Number((await db.query(sql)).rows[0].count);
  const cms = (rows.get('Page') || []).map((page) => ({
    tournamentId: page.tournamentId,
    slug: page.slug,
    state: page.state,
    revisions: (rows.get('PageRevision') || [])
      .filter((r) => r.pageId === page.id)
      .map((r) => ({
        id: r.id,
        createdBy: r.createdBy,
        published: r.id === page.publishedRevisionId,
        draft: r.id === page.draftRevisionId,
        title: r.title,
        html: r.html,
        blocks: (rows.get('ContentBlock') || []).filter((b) => b.revisionId === r.id),
      })),
  }));
  const media = [];
  for (const asset of rows.get('MediaAsset') || []) {
    const references = [];
    for (const [table, records] of rows) {
      if (table === 'MediaAsset') continue;
      const matching = records.filter((r) => JSON.stringify(r).includes(String(asset.id)));
      if (matching.length) references.push({ table, rows: matching.length });
    }
    let objectExists: boolean | null = null;
    if (process.env.STORAGE_DRIVER === 'filesystem' && process.env.STORAGE_LOCAL_DIR)
      objectExists = await stat(path.join(process.env.STORAGE_LOCAL_DIR, String(asset.key)))
        .then((s) => s.isFile())
        .catch((e: NodeJS.ErrnoException) => {
          if (e.code === 'ENOENT') return false;
          throw e;
        });
    media.push({
      id: asset.id,
      tournamentId: asset.tournamentId,
      key: asset.key,
      references,
      objectExists,
      orphanCandidate: !references.length,
    });
  }
  const catalog = new Set((rows.get('MediaAsset') || []).map((a) => a.key));
  const uncataloguedObjects =
    process.env.STORAGE_DRIVER === 'filesystem' && process.env.STORAGE_LOCAL_DIR
      ? (await readdir(process.env.STORAGE_LOCAL_DIR)).filter(
          (key) => key.endsWith('.webp') && !catalog.has(key),
        )
      : [];
  const indexes = (
    await db.query(
      "SELECT tablename,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname",
    )
  ).rows;
  await db.query('ROLLBACK');
  const report = {
    capturedAt: new Date().toISOString(),
    readOnly: true,
    inventory,
    integrity,
    indexes,
    cms,
    media,
    uncataloguedObjects,
    mediaPolicy:
      'Candidates only. Includes all stored revisions, snapshots and audit references. No object is deleted. Verify external/backup use before any deletion.',
    tournaments: rows.get('Tournament'),
    settings: rows.get('TournamentSettings'),
    migrations: (rows.get('_prisma_migrations') || []).map((m) => ({
      name: m.migration_name,
      finishedAt: m.finished_at,
      rolledBackAt: m.rolled_back_at,
    })),
  };
  await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  await writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
  console.log(
    `Read-only audit: ${tables.length} tables; ${media.length} media records; ${uncataloguedObjects.length} uncatalogued object candidates. Report: ${path.relative(process.cwd(), output)}`,
  );
  console.log('Integrity violations:', integrity);
} finally {
  await db.end();
}
