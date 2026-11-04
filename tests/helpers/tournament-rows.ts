import type { PrismaClient } from '../../src/generated/prisma/client';

// Asks the database which tables name a tournament, so a table added later is covered without edits.
export async function tournamentRows(
  db: Pick<PrismaClient, '$queryRawUnsafe'>,
  tournamentId: string,
) {
  const tables = await db.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND column_name = 'tournamentId'`,
  );
  const rows: Record<string, number> = {};
  for (const { table_name: table } of tables) {
    const [{ count }] = await db.$queryRawUnsafe<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM "${table}" WHERE "tournamentId" = $1`,
      tournamentId,
    );
    if (count) rows[table] = count;
  }
  return rows;
}
