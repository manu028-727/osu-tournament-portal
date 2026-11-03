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

// Fills whatever a table required at that point in its history, so this reads as the data it
// is about rather than as a list of columns that later migrations keep adding to.
async function insertRow(client: pg.Client, table: string, values: Record<string, unknown>) {
  const { rows } = await client.query(
    `SELECT column_name, data_type, udt_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = $1
       AND is_nullable = 'NO' AND column_default IS NULL`,
    [table],
  );
  const row: Record<string, unknown> = { ...values };
  for (const column of rows) {
    if (column.column_name in row) continue;
    if (column.data_type === 'USER-DEFINED') {
      const labels = await client.query(
        `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = $1 ORDER BY e.enumsortorder LIMIT 1`,
        [column.udt_name],
      );
      row[column.column_name] = labels.rows[0].enumlabel;
    } else if (column.data_type.startsWith('timestamp')) row[column.column_name] = new Date();
    else if (column.data_type === 'jsonb') row[column.column_name] = '{}';
    else if (column.data_type === 'boolean') row[column.column_name] = false;
    else if (column.data_type === 'integer') row[column.column_name] = 1;
    else row[column.column_name] = `${table}-${column.column_name}`;
  }
  const names = Object.keys(row);
  await client.query(
    `INSERT INTO "${table}" (${names.map((name) => `"${name}"`).join(',')})
     VALUES (${names.map((_, index) => `$${index + 1}`).join(',')})`,
    Object.values(row),
  );
}

it('adds the format engine to a populated tournament without changing anything saved', async () => {
  await migrationFixture(async (client, apply) => {
    const names = (await readdir('prisma/migrations')).filter((name) => /^\d/.test(name)).sort();
    const firstNew = names.findIndex((name) => name.startsWith('20261103'));
    expect(firstNew).toBeGreaterThan(7);
    for (let index = 7; index < firstNew; index++) await apply(index);

    await insertRow(client, 'Tournament', { id: 'old', slug: 'old', name: 'Old', acronym: 'OLD' });
    await insertRow(client, 'Tournament', { id: 'other', slug: 'other', name: 'B', acronym: 'B' });
    await insertRow(client, 'TournamentSettings', {
      tournamentId: 'old',
      matchRules: JSON.stringify({ teamSize: 2, scoreMode: 'ACCURACY' }),
      registrationPolicy: JSON.stringify({ minRank: 5 }),
      copy: JSON.stringify({ artworkCaption: 'Kept', staffTitle: 'Crew' }),
    });
    await insertRow(client, 'TournamentStage', {
      id: 'stage',
      tournamentId: 'old',
      name: 'Finals',
      slug: 'finals',
      kind: 'ELIMINATION',
    });
    await insertRow(client, 'Participant', { osuId: 1, username: 'One', avatarUrl: '' });
    await insertRow(client, 'Team', {
      id: 'team',
      tournamentId: 'old',
      name: 'Team',
      slug: 'team',
      status: 'APPROVED',
    });
    await insertRow(client, 'TeamMember', {
      tournamentId: 'old',
      teamId: 'team',
      osuId: 1,
      position: 0,
      captain: true,
      registrationRank: 4242,
    });
    await insertRow(client, 'Match', {
      id: 'match',
      tournamentId: 'old',
      code: '1',
      stageId: 'stage',
      teamAId: 'team',
      rules: JSON.stringify({ teamSize: 2 }),
      participants: '{}',
    });
    const tables = [
      'Tournament',
      'TournamentSettings',
      'TournamentStage',
      'Team',
      'TeamMember',
      'Match',
    ];
    const snapshot = async () =>
      Object.fromEntries(
        await Promise.all(
          tables.map(async (table) => [
            table,
            (await client.query(`SELECT row_to_json(t) AS value FROM "${table}" t`)).rows.sort(
              (a, b) =>
                String(a.value.id ?? a.value.tournamentId).localeCompare(
                  String(b.value.id ?? b.value.tournamentId),
                ),
            ),
          ]),
        ),
      );
    const before = await snapshot();

    for (let index = firstNew; index < names.length; index++) await apply(index);

    // Every saved value reads back unchanged, with new columns empty rather than guessed.
    expect(await snapshot()).toMatchObject(JSON.parse(JSON.stringify(before)));
    const team = await client.query(`SELECT "supersededAt" FROM "Team" WHERE id = 'team'`);
    expect(team.rows).toEqual([{ supersededAt: null }]);
    const member = await client.query(
      `SELECT "registrationRank", "rankCapturedAt" FROM "TeamMember" WHERE "teamId" = 'team'`,
    );
    expect(member.rows).toEqual([{ registrationRank: 4242, rankCapturedAt: null }]);
    const settings = await client.query(
      `SELECT "resourcePolicy", "setupState" FROM "TournamentSettings" WHERE "tournamentId" = 'old'`,
    );
    expect(settings.rows).toEqual([{ resourcePolicy: null, setupState: null }]);
    for (const table of [
      'TournamentPhase',
      'FormationSession',
      'ResourceItem',
      'EligibilityException',
    ])
      expect((await client.query(`SELECT count(*)::int AS count FROM "${table}"`)).rows).toEqual([
        { count: 0 },
      ]);

    // New tables hold tenancy in the database itself, not only in the application.
    await insertRow(client, 'TournamentPhase', {
      id: 'phase',
      tournamentId: 'old',
      key: 'formation',
      position: 0,
      kind: 'TEAM_FORMATION',
      name: 'Formation',
      config: '{}',
    });
    const refused = async (table: string, values: Record<string, unknown>, code: string) => {
      await client.query('SAVEPOINT attempt');
      await expect(insertRow(client, table, values)).rejects.toMatchObject({ code });
      await client.query('ROLLBACK TO SAVEPOINT attempt');
    };
    await refused(
      'FormationSession',
      {
        id: 'session',
        tournamentId: 'other',
        phaseId: 'phase',
        method: 'MANUAL',
        rosterSize: 2,
        teamSeeding: 'CAPTAIN_SEED',
        settings: '{}',
      },
      '23503',
    );
    await refused(
      'FormationSession',
      {
        id: 'session',
        tournamentId: 'old',
        phaseId: 'phase',
        method: 'LOTTERY',
        rosterSize: 2,
        teamSeeding: 'CAPTAIN_SEED',
        settings: '{}',
      },
      '23514',
    );
    await refused(
      'ResourcePurchase',
      { id: 'purchase', tournamentId: 'other', itemId: 'nothing', teamId: 'team', price: 1 },
      '23503',
    );
    await refused(
      'EligibilityException',
      {
        id: 'exception',
        tournamentId: 'old',
        osuId: 1,
        username: 'One',
        kind: 'ANYTHING',
        reason: 'Not a limit that exists',
      },
      '23514',
    );
  });
});
