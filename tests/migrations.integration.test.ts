import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { expect, it } from 'vitest';
import { assertTestDatabase } from '../src/lib/instance';

assertTestDatabase(process.env.DATABASE_URL);

async function migrationFixture(
  check: (client: pg.Client, apply: (index: number) => Promise<void>) => Promise<void>,
) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const schema = `migration_${randomUUID().replaceAll('-', '')}`;
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    const migrations = (await readdir('prisma/migrations'))
      .filter((name) => /^\d/.test(name))
      .sort();
    const apply = async (index: number) => {
      const sql = await readFile(`prisma/migrations/${migrations[index]}/migration.sql`, 'utf8');
      // The fixture owns the enclosing rollback; retain all migration statements inside it.
      await client.query(sql.replace(/^BEGIN;$/gm, '').replace(/^COMMIT;$/gm, ''));
    };
    for (let index = 0; index < 7; index++) await apply(index);
    await client.query(`INSERT INTO "Tournament" (id, slug, name, acronym, description, "updatedAt") VALUES ('test','test','Synthetic','TEST','',NOW());
      INSERT INTO "Page" (id,"tournamentId",slug,title,"updatedAt") VALUES ('one','test','one','One',NOW()),('two','test','two','Two',NOW());
      INSERT INTO "PageRevision" (id,"tournamentId","pageId",title) VALUES ('revision','test','one','One');
      UPDATE "Page" SET "draftRevisionId"='revision' WHERE id='one';`);
    await check(client, apply);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

it('upgrades a populated disposable schema without rewriting saved content', async () => {
  await migrationFixture(async (client, apply) => {
    const snapshot = async () =>
      (await client.query(`SELECT row_to_json(p) AS value FROM "Page" p ORDER BY id`)).rows;
    const before = await snapshot();
    await apply(7);
    await apply(8);
    await apply(9);
    await apply(10);
    await apply(11);
    expect((await client.query('SELECT count(*)::int AS count FROM "MediaCleanup"')).rows).toEqual([
      { count: 0 },
    ]);
    expect(await snapshot()).toEqual(before);
    await client.query(`UPDATE "Page" SET "draftRevisionId"=NULL WHERE id='one'`);
    await expect(
      client.query(`UPDATE "Page" SET "draftRevisionId"='revision' WHERE id='two'`),
    ).rejects.toMatchObject({ code: '23503' });
  });
});

it('keeps saved revision owners immutable even before a pointer is assigned', async () => {
  await migrationFixture(async (client, apply) => {
    for (const index of [7, 8, 9]) await apply(index);
    await client.query(`UPDATE "Page" SET "draftRevisionId"=NULL WHERE id='one'`);
    await expect(
      client.query(`UPDATE "PageRevision" SET "pageId"='two' WHERE id='revision'`),
    ).rejects.toThrow('Saved revision ownership is immutable');
  });
});

it('stops on pre-existing mismatched pointers and leaves the witness unchanged', async () => {
  await migrationFixture(async (client, apply) => {
    await client.query(
      `UPDATE "Page" SET "draftRevisionId"=NULL WHERE id='one'; UPDATE "Page" SET "draftRevisionId"='revision' WHERE id='two'; SAVEPOINT before_upgrade;`,
    );
    await expect(apply(7)).rejects.toThrow('Ownership mismatch detected');
    await client.query('ROLLBACK TO SAVEPOINT before_upgrade');
    expect(
      (await client.query(`SELECT "draftRevisionId" FROM "Page" WHERE id='two'`)).rows[0]
        .draftRevisionId,
    ).toBe('revision');
  });
});

it('adds edit versions to populated staff and categories without altering authored fields', async () => {
  await migrationFixture(async (client, apply) => {
    await client.query(`INSERT INTO "StaffMember" (id,"tournamentId","osuId",username,"avatarUrl","profileUrl",bio) VALUES ('member','test',123,'Synthetic','','','Keep biography');
      INSERT INTO "StaffCategory" (id,"tournamentId",name,description) VALUES ('category','test','Hosts','Keep description');`);
    for (const index of [7, 8, 9, 10]) await apply(index);
    expect(
      (await client.query(`SELECT bio,version FROM "StaffMember" WHERE id='member'`)).rows,
    ).toEqual([{ bio: 'Keep biography', version: 1 }]);
    expect(
      (await client.query(`SELECT description,version FROM "StaffCategory" WHERE id='category'`))
        .rows,
    ).toEqual([{ description: 'Keep description', version: 1 }]);
  });
});
