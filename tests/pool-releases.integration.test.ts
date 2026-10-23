import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import { assertTestDatabase } from '../src/lib/instance';
import { executeAction } from '../src/lib/admin-service';
import { actionSchema } from '../src/lib/validation';
import { ALL_PERMISSIONS, type Actor } from '../src/lib/permissions';

assertTestDatabase(process.env.DATABASE_URL);
const id = `pool-releases-${randomUUID()}`;
let actor: Actor;
const stages: { id: string; poolId: string; revisionId: string }[] = [];
const apply = (operation: 'PUBLISH' | 'UNPUBLISH', pools: unknown[], who = actor) =>
  executeAction(who, actionSchema.parse({ type: 'pooling.pools.release', operation, pools }));
const snapshot = () =>
  db.mappool.findMany({
    where: { tournamentId: id },
    orderBy: { id: 'asc' },
    select: { id: true, state: true, draftRevisionId: true, publishedRevisionId: true },
  });
beforeAll(async () => {
  const user = await db.user.create({
    data: {
      osuId: randomInt(1_300_000_000, 1_400_000_000),
      username: id,
      avatarUrl: '',
      profileUrl: '',
      platformAdmin: true,
    },
  });
  actor = {
    id: user.id,
    tournamentId: id,
    osuId: user.osuId,
    username: id,
    avatarUrl: '',
    roles: [],
    permissions: [...ALL_PERMISSIONS],
  };
  await db.tournament.create({ data: { id, slug: id, name: id, acronym: 'QA', description: '' } });
  const map = await db.beatmap.findFirstOrThrow({ where: { mode: 'osu' } });
  for (let index = 0; index < 2; index++) {
    const stage = await db.tournamentStage.create({
      data: {
        tournamentId: id,
        name: `Stage ${index}`,
        slug: `stage-${index}`,
        mappool: { create: {} },
      },
      include: { mappool: true },
    });
    const revision = await db.mappoolRevision.create({
      data: {
        tournamentId: id,
        mappoolId: stage.mappool!.id,
        slots: {
          create: {
            name: 'NM1',
            category: 'NM',
            categoryName: 'No Mod',
            color: '#ffffff',
            position: 0,
            beatmapId: map.id,
            metadata: map.metadata!,
          },
        },
      },
    });
    await db.mappool.update({
      where: { id: stage.mappool!.id },
      data: { draftRevisionId: revision.id },
    });
    stages.push({ id: stage.id, poolId: stage.mappool!.id, revisionId: revision.id });
  }
});
afterAll(async () => {
  await db.auditLog.deleteMany({ where: { tournamentId: id } });
  await db.tournamentStage.deleteMany({ where: { tournamentId: id } });
  await db.tournament.deleteMany({ where: { id } });
  if (actor) await db.user.deleteMany({ where: { id: actor.id } });
  await db.$disconnect();
});
it('publishes and unpublishes an entire versioned selection without losing saved revisions', async () => {
  const before = await snapshot();
  expect(await apply('PUBLISH', before)).toMatchObject({ updated: 2 });
  const published = await snapshot();
  expect(
    published.every(
      (pool) => pool.state === 'PUBLISHED' && pool.publishedRevisionId === pool.draftRevisionId,
    ),
  ).toBe(true);
  await expect(apply('UNPUBLISH', before)).rejects.toMatchObject({ status: 409 });
  expect(await snapshot()).toEqual(published);
  expect(await apply('UNPUBLISH', published)).toMatchObject({ updated: 2 });
  const unpublished = await snapshot();
  expect(
    unpublished.every(
      (pool) => pool.state === 'UNPUBLISHED' && !pool.publishedRevisionId && pool.draftRevisionId,
    ),
  ).toBe(true);
  expect(await db.mappoolRevision.count({ where: { tournamentId: id } })).toBe(2);
});
it('rolls back all releases when a later selected pool has an incomplete plan', async () => {
  const pools = await snapshot();
  const target = stages.find((stage) => stage.poolId === pools[1].id)!;
  await db.poolPlan.create({
    data: { tournamentId: id, stageId: target.id, slots: [{ name: 'NM2', category: 'NM' }] },
  });
  await expect(apply('PUBLISH', pools)).rejects.toThrow('NM2');
  expect(await snapshot()).toEqual(pools);
  await expect(apply('PUBLISH', pools, { ...actor, permissions: [] })).rejects.toMatchObject({
    status: 403,
  });
  await expect(apply('UNPUBLISH', [{ ...pools[0], id: 'outside-pool' }])).rejects.toMatchObject({
    status: 404,
  });
  expect(await snapshot()).toEqual(pools);
});
