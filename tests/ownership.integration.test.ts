import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { db } from '../src/lib/db';
import { scopedDb } from '../src/lib/scoped-db';
import { assertTestDatabase } from '../src/lib/instance';
import type { Prisma } from '../src/generated/prisma/client';
import { Prisma as PrismaNamespace } from '../src/generated/prisma/client';

assertTestDatabase(process.env.DATABASE_URL);

it('classifies every generated model explicitly', () => {
  const scoped = scopedDb(db, 'main') as unknown as Record<string, unknown>;
  for (const name of Object.keys(PrismaNamespace.ModelName))
    expect(() => scoped[name[0].toLowerCase() + name.slice(1)]).not.toThrow();
});

async function isolated(check: (tx: Prisma.TransactionClient, ids: string[]) => Promise<void>) {
  const rollback = new Error('Rollback synthetic ownership fixtures');
  try {
    await db.$transaction(async (tx) => {
      const ids = [randomUUID(), randomUUID()];
      for (const id of ids)
        await tx.tournament.create({
          data: {
            id,
            slug: `ownership-${id}`,
            name: 'Synthetic',
            acronym: 'TEST',
            description: '',
          },
        });
      await check(tx, ids);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

it('rejects another page revision, including same-tenant pointers at the database boundary', async () => {
  await isolated(async (tx, [tournamentId]) => {
    const first = await tx.page.create({ data: { tournamentId, slug: 'one', title: 'One' } });
    const second = await tx.page.create({ data: { tournamentId, slug: 'two', title: 'Two' } });
    const revision = await tx.pageRevision.create({
      data: { tournamentId, pageId: second.id, title: 'Two' },
    });
    await expect(
      tx.page.update({ where: { id: first.id }, data: { draftRevisionId: revision.id } }),
    ).rejects.toThrow();
  });
});

it('rejects another pool revision at the database boundary', async () => {
  await isolated(async (tx, [tournamentId]) => {
    const pools = [];
    for (const slug of ['one', 'two']) {
      const stage = await tx.tournamentStage.create({
        data: { tournamentId, slug, name: slug, mappool: { create: {} } },
        include: { mappool: true },
      });
      pools.push(stage.mappool!);
    }
    const revision = await tx.mappoolRevision.create({
      data: { tournamentId, mappoolId: pools[1].id },
    });
    await expect(
      tx.mappool.update({ where: { id: pools[0].id }, data: { publishedRevisionId: revision.id } }),
    ).rejects.toThrow();
  });
});

it('rejects cross-match action/results even through the raw database client', async () => {
  await isolated(async (tx, ids) => {
    const matches = [];
    for (const tournamentId of ids) {
      const stage = await tx.tournamentStage.create({
        data: { tournamentId, slug: 'one', name: 'One' },
      });
      matches.push(
        await tx.match.create({
          data: { tournamentId, stageId: stage.id, code: 'one', participants: {}, rules: {} },
        }),
      );
    }
    const action = await tx.matchMapAction.create({
      data: {
        matchId: matches[1].id,
        sequence: 1,
        kind: 'PICK',
        side: 'A',
        slotName: 'NM1',
        category: 'NM',
      },
    });
    await expect(
      tx.matchMapResult.create({
        data: {
          matchId: matches[0].id,
          actionId: action.id,
          scoreA: 1,
          scoreB: 0,
          winnerSide: 'A',
        },
      }),
    ).rejects.toThrow();
  });
});

it('rejects parent-owned creates and unsupported nested connection operations before mutation', async () => {
  await isolated(async (tx, [a, b]) => {
    const foreign = await tx.page.create({ data: { tournamentId: b, slug: 'one', title: 'One' } });
    const scoped = scopedDb(tx, a);
    await expect(
      scoped.pageRevision.create({ data: { pageId: foreign.id, title: 'Foreign' } }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(async () =>
      scoped.page.create({
        data: {
          slug: 'one',
          title: 'One',
          tournament: { connect: { id: b } },
        },
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await tx.page.count({ where: { tournamentId: a } })).toBe(0);
  });
});
