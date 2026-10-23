import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import { assertTestDatabase } from '../src/lib/instance';
import { inheritedRules } from '../src/lib/gameplay-scoring';
import type { Actor } from '../src/lib/permissions';
import { applyStageWorkflowAction, stageWorkflowData } from '../src/lib/stage-workflows';
import type { StageWorkflowAction } from '../src/lib/stage-workflows-validation';

assertTestDatabase(process.env.DATABASE_URL);
const prefix = `stage-workflows-${randomUUID()}`;
const beatmapId = randomInt(1_500_000_000, 1_900_000_000);
const tournamentId = `${prefix}-a`,
  foreignId = `${prefix}-b`;
const actor: Actor = {
  id: `${prefix}-user`,
  tournamentId,
  osuId: randomInt(1_500_000_000, 1_900_000_000),
  username: prefix,
  avatarUrl: '',
  roles: [],
  permissions: ['mappools.edit', 'matches.manage'],
};
const defaultRules = inheritedRules({ bestOf: 11 }, 'SCORE_V2', 'taiko');
const customRules = { ...defaultRules, bestOf: 13, timeoutSeconds: 180 };
let inheritedId = '',
  customId = '',
  qualifierId = '',
  foreignStageId = '',
  matchId = '';
let verified = false;
const data = () => stageWorkflowData(db, actor);
const selection = (snapshot: Awaited<ReturnType<typeof data>>, ids: string[]) =>
  ids.map((id) => ({
    id,
    baseConfigurationToken: snapshot.stages.find((stage) => stage.id === id)!.configurationToken,
  }));
const apply = (action: StageWorkflowAction, user = actor) =>
  db.$transaction((tx) => applyStageWorkflowAction(tx, user, action), { timeout: 15000 });

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL);
  const [database] = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  expect(database.name).toContain('test');
  verified = true;
  for (const id of [tournamentId, foreignId])
    await db.tournament.create({
      data: {
        id,
        slug: id,
        name: prefix,
        acronym: 'TEST',
        description: '',
        gameMode: 'taiko',
        settings: {
          create: {
            gameplayScoring: 'SCORE_V2',
            matchRules: defaultRules,
            navigation: [],
            importantDates: [],
            socialLinks: [],
            footer: '',
          },
        },
      },
    });
  await db.user.create({
    data: { id: actor.id, osuId: actor.osuId, username: prefix, avatarUrl: '', profileUrl: '' },
  });
  inheritedId = (
    await db.tournamentStage.create({
      data: {
        tournamentId,
        name: 'Round 1',
        slug: 'r1',
        kind: 'ELIMINATION',
        position: 0,
        description: 'Keep description',
        mappool: { create: {} },
      },
    })
  ).id;
  customId = (
    await db.tournamentStage.create({
      data: {
        tournamentId,
        name: 'Final',
        slug: 'final',
        kind: 'ELIMINATION',
        position: 1,
        matchRules: customRules,
        nextStageId: inheritedId,
      },
    })
  ).id;
  qualifierId = (
    await db.tournamentStage.create({
      data: {
        tournamentId,
        name: 'Qualifiers',
        slug: 'qualifiers',
        kind: 'QUALIFIERS',
        position: 2,
      },
    })
  ).id;
  foreignStageId = (
    await db.tournamentStage.create({
      data: { tournamentId: foreignId, name: 'Foreign', slug: 'foreign', kind: 'ELIMINATION' },
    })
  ).id;
  matchId = (
    await db.match.create({
      data: {
        tournamentId,
        code: 'historical',
        stageId: inheritedId,
        rules: defaultRules,
        participants: { A: [], B: [] },
        status: 'COMPLETED',
        scoreA: 6,
        scoreB: 1,
        winnerSide: 'A',
        actions: {
          create: { sequence: 1, kind: 'BAN', side: 'A', slotName: 'NM1', category: 'NM' },
        },
      },
    })
  ).id;
});

afterAll(async () => {
  try {
    if (!verified) return;
    assertTestDatabase(process.env.DATABASE_URL);
    await db.$transaction(async (tx) => {
      const scope = { tournamentId: { in: [tournamentId, foreignId] } };
      await tx.match.deleteMany({ where: scope });
      await tx.auditLog.deleteMany({ where: scope });
      await tx.mappool.updateMany({
        where: scope,
        data: { draftRevisionId: null, publishedRevisionId: null },
      });
      await tx.mappoolRevision.deleteMany({ where: scope });
      await tx.mappool.deleteMany({ where: scope });
      await tx.tournamentStage.updateMany({ where: scope, data: { nextStageId: null } });
      await tx.tournamentStage.deleteMany({ where: scope });
      await tx.mediaAsset.deleteMany({ where: scope });
      await tx.tournament.deleteMany({ where: { id: { in: [tournamentId, foreignId] } } });
      await tx.user.deleteMany({ where: { id: actor.id } });
      await tx.beatmap.deleteMany({
        where: { id: beatmapId, metadata: { path: ['fixture'], equals: prefix } },
      });
    });
  } finally {
    await db.$disconnect();
  }
});

describe('transactional stage workflows', () => {
  it('patches only selected rules and preserves match histories and global game mode', async () => {
    const snapshot = await data();
    const before = await db.match.findUnique({
      where: { id: matchId },
      include: { actions: true },
    });
    const result = await apply({
      type: 'stage.rules.patch',
      stages: selection(snapshot, [inheritedId, customId]),
      defaultsToken: snapshot.defaultsToken,
      patch: { bestOf: 9 },
    });
    expect(result.updated).toBe(2);
    expect(result.warnings).toHaveLength(2);
    const saved = await data();
    expect(saved.stages.find((s) => s.id === inheritedId)).toMatchObject({
      description: 'Keep description',
      matchRules: { bestOf: 9, gameMode: 'taiko' },
    });
    expect(saved.stages.find((s) => s.id === customId)).toMatchObject({
      nextStageId: inheritedId,
      matchRules: { bestOf: 9, timeoutSeconds: 180 },
    });
    expect(
      await db.match.findUnique({ where: { id: matchId }, include: { actions: true } }),
    ).toEqual(before);
    expect(await db.auditLog.count({ where: { tournamentId, action: 'stage.rules.patch' } })).toBe(
      2,
    );
  });

  it('rejects stale target tokens atomically', async () => {
    const snapshot = await data();
    await db.tournamentStage.update({
      where: { id: customId },
      data: { description: 'Concurrent edit' },
    });
    const before = await db.tournamentStage.findUnique({ where: { id: inheritedId } });
    await expect(
      apply({
        type: 'stage.rules.patch',
        stages: selection(snapshot, [inheritedId, customId]),
        defaultsToken: snapshot.defaultsToken,
        patch: { bestOf: 15 },
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await db.tournamentStage.findUnique({ where: { id: inheritedId } })).toEqual(before);
  });

  it('rejects qualifiers, archived stages, and foreign stage IDs before writes', async () => {
    let snapshot = await data();
    const before = await db.tournamentStage.findUnique({ where: { id: inheritedId } });
    await expect(
      apply({
        type: 'stage.rules.patch',
        stages: selection(snapshot, [inheritedId, qualifierId]),
        defaultsToken: snapshot.defaultsToken,
        patch: { bestOf: 7 },
      }),
    ).rejects.toThrow('qualifier policy');
    await db.tournamentStage.update({ where: { id: customId }, data: { archivedAt: new Date() } });
    snapshot = await data();
    await expect(
      apply({
        type: 'stage.rules.patch',
        stages: selection(snapshot, [inheritedId, customId]),
        defaultsToken: snapshot.defaultsToken,
        patch: { bestOf: 7 },
      }),
    ).rejects.toThrow('archived');
    await expect(
      apply({
        type: 'stage.rules.patch',
        stages: [{ id: foreignStageId, baseConfigurationToken: 'a'.repeat(64) }],
        defaultsToken: snapshot.defaultsToken,
        patch: { bestOf: 7 },
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await db.tournamentStage.findUnique({ where: { id: inheritedId } })).toEqual(before);
    await db.tournamentStage.update({ where: { id: customId }, data: { archivedAt: null } });
  });

  it('rejects a changed defaults token and a changed source stage', async () => {
    let snapshot = await data();
    await db.tournamentSettings.update({
      where: { tournamentId },
      data: { matchRules: { ...defaultRules, readySeconds: 75 } },
    });
    await expect(
      apply({
        type: 'stage.rules.patch',
        stages: selection(snapshot, [inheritedId]),
        defaultsToken: snapshot.defaultsToken,
        patch: { bestOf: 7 },
      }),
    ).rejects.toThrow('defaults changed');
    snapshot = await data();
    const source = snapshot.stages.find((s) => s.id === customId)!;
    await db.tournamentStage.update({
      where: { id: customId },
      data: { name: 'Concurrent renamed source' },
    });
    await expect(
      apply({
        type: 'stage.rules.apply',
        stages: selection(snapshot, [inheritedId]),
        defaultsToken: snapshot.defaultsToken,
        source: { kind: 'STAGE', id: customId, baseConfigurationToken: source.configurationToken },
      }),
    ).rejects.toThrow('source stage changed');
  });

  it('copies source rules independently and resets inheritance explicitly', async () => {
    let snapshot = await data();
    await apply({
      type: 'stage.rules.apply',
      stages: selection(snapshot, [inheritedId]),
      defaultsToken: snapshot.defaultsToken,
      source: {
        kind: 'STAGE',
        id: customId,
        baseConfigurationToken: snapshot.stages.find((s) => s.id === customId)!.configurationToken,
      },
    });
    expect(
      (await data()).stages.find((s) => s.id === inheritedId)?.matchRules?.timeoutSeconds,
    ).toBe(180);
    await db.tournamentStage.update({
      where: { id: customId },
      data: { matchRules: { ...customRules, timeoutSeconds: 250 } },
    });
    expect(
      (await data()).stages.find((s) => s.id === inheritedId)?.matchRules?.timeoutSeconds,
    ).toBe(180);
    snapshot = await data();
    await apply({
      type: 'stage.rules.apply',
      stages: selection(snapshot, [inheritedId]),
      defaultsToken: snapshot.defaultsToken,
      source: { kind: 'TOURNAMENT' },
    });
    const saved = (await data()).stages.find((s) => s.id === inheritedId)!;
    expect(saved.matchRules).toBeNull();
    expect(saved.rulesOrigin).toBe('INHERITED');
  });

  it('only reorders display positions and catches incomplete lists', async () => {
    const snapshot = await data();
    await expect(
      apply({ type: 'stage.reorder', stages: selection(snapshot, [customId]) }),
    ).rejects.toMatchObject({ status: 409 });
    const before = await db.match.findUnique({ where: { id: matchId } });
    await apply({
      type: 'stage.reorder',
      stages: selection(snapshot, [qualifierId, customId, inheritedId]),
    });
    const saved = await data();
    expect(saved.stages.map((stage) => stage.id)).toEqual([qualifierId, customId, inheritedId]);
    expect(saved.stages.map((stage) => stage.position)).toEqual([0, 1, 2]);
    expect(saved.stages.find((stage) => stage.id === customId)?.nextStageId).toBe(inheritedId);
    expect(await db.match.findUnique({ where: { id: matchId } })).toEqual(before);
  });

  it('enforces tournament context and both independent permissions', async () => {
    const snapshot = await data();
    const action: StageWorkflowAction = {
      type: 'stage.rules.patch',
      stages: selection(snapshot, [inheritedId]),
      defaultsToken: snapshot.defaultsToken,
      patch: { bestOf: 3 },
    };
    for (const permissions of [['mappools.edit'], ['matches.manage'], []] as Actor['permissions'][])
      await expect(apply(action, { ...actor, permissions })).rejects.toMatchObject({ status: 403 });
    await expect(
      stageWorkflowData(db, { ...actor, tournamentId: foreignId }, tournamentId),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('serializes simultaneous stale edits so exactly one succeeds', async () => {
    const snapshot = await data();
    const action = (bestOf: number): StageWorkflowAction => ({
      type: 'stage.rules.patch',
      stages: selection(snapshot, [inheritedId]),
      defaultsToken: snapshot.defaultsToken,
      patch: { bestOf },
    });
    const results = await Promise.allSettled([apply(action(5)), apply(action(7))]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((result) => result.status === 'rejected');
    expect(failed && failed.status === 'rejected' && failed.reason.status).toBe(409);
  });

  it('keeps fresh stages editable before global scoring is configured', async () => {
    await db.tournamentSettings.update({
      where: { tournamentId },
      data: { gameplayScoring: null },
    });
    const snapshot = await data();
    expect(snapshot.defaults.gameMode).toBe('taiko');
    await apply({
      type: 'stage.rules.patch',
      stages: selection(snapshot, [inheritedId]),
      defaultsToken: snapshot.defaultsToken,
      patch: { bestOf: 3 },
    });
    expect(
      (await data()).stages.find((stage) => stage.id === inheritedId)?.matchRules?.bestOf,
    ).toBe(3);
    expect(
      (await db.tournamentSettings.findUniqueOrThrow({ where: { tournamentId } })).gameplayScoring,
    ).toBeNull();
  });

  it('duplicates empty, structure, or contents independently without publishing or copying progression', async () => {
    const creator = {
      ...actor,
      permissions: [...actor.permissions, 'mappools.create'] as Actor['permissions'],
    };
    await db.beatmap.create({
      data: { id: beatmapId, mode: 'taiko', metadata: { fixture: prefix } },
    });
    const banner = await db.mediaAsset.create({
      data: {
        tournamentId,
        key: `${prefix}/banner.png`,
        name: 'Fixture banner',
        mimeType: 'image/png',
        size: 1,
        width: 1,
        height: 1,
      },
    });
    await db.tournamentStage.update({ where: { id: customId }, data: { nextStageId: null } });
    await db.tournamentStage.update({
      where: { id: inheritedId },
      data: {
        description: 'Source description',
        bannerImageId: banner.id,
        nextStageId: customId,
        archivedAt: new Date(),
        startsAt: new Date(),
      },
    });
    await db.poolPlan.create({
      data: {
        tournamentId,
        stageId: inheritedId,
        slots: [
          { name: 'NM1', category: 'NM' },
          { name: 'HD1', category: 'HD' },
        ],
        minStars: 5,
        maxStars: 6,
        reviewState: 'APPROVED',
        version: 3,
      },
    });
    const sourcePool = await db.mappool.findFirstOrThrow({
      where: { tournamentId, stageId: inheritedId },
    });
    const published = await db.mappoolRevision.create({
      data: {
        tournamentId,
        mappoolId: sourcePool.id,
        notes: 'Published original',
        slots: {
          create: {
            name: 'NM1',
            category: 'NM',
            categoryName: 'No Mod',
            color: '#a6c7ef',
            position: 0,
            beatmapId,
            metadata: { fixture: prefix, title: 'Original saved metadata' },
          },
        },
      },
    });
    const draft = await db.mappoolRevision.create({
      data: {
        tournamentId,
        mappoolId: sourcePool.id,
        notes: 'Saved private notes',
        slots: {
          create: {
            name: 'NM1',
            category: 'NM',
            categoryName: 'No Mod',
            color: '#a6c7ef',
            position: 0,
            beatmapId,
            metadata: { fixture: prefix, title: 'Latest saved draft metadata' },
          },
        },
      },
    });
    await db.mappool.update({
      where: { id: sourcePool.id },
      data: { state: 'PUBLISHED', publishedRevisionId: published.id, draftRevisionId: draft.id },
    });
    const snapshot = await data();
    const source = snapshot.stages.find((stage) => stage.id === inheritedId)!;
    const before = await db.tournamentStage.findUniqueOrThrow({
      where: { id: inheritedId },
      include: {
        poolPlan: true,
        mappool: { include: { revisions: { include: { slots: true } } } },
      },
    });
    for (const poolMode of ['EMPTY', 'STRUCTURE', 'CONTENTS'] as const) {
      const result = await apply(
        {
          type: 'stage.duplicate',
          sourceId: inheritedId,
          baseConfigurationToken: source.configurationToken,
          name: `Copy ${poolMode}`,
          slug: `copy-${poolMode.toLowerCase()}`,
          copyRules: true,
          copyAppearance: true,
          poolMode,
        },
        creator,
      );
      if (!('id' in result)) throw new Error('Expected duplicated stage ID');
      const copied = await db.tournamentStage.findUniqueOrThrow({
        where: { id: result.id },
        include: {
          poolPlan: true,
          mappool: { include: { draftRevision: { include: { slots: true } } } },
        },
      });
      expect(copied).toMatchObject({
        name: `Copy ${poolMode}`,
        description: 'Source description',
        kind: 'ELIMINATION',
        nextStageId: null,
        archivedAt: null,
        startsAt: null,
        bannerImageId: banner.id,
        matchRules: source.matchRules,
      });
      expect(copied.mappool).toMatchObject({ state: 'DRAFT', publishedRevisionId: null });
      if (poolMode === 'EMPTY') expect(copied.poolPlan).toBeNull();
      else
        expect(copied.poolPlan).toMatchObject({
          slots: before.poolPlan!.slots,
          minStars: 5,
          maxStars: 6,
          reviewState: 'DRAFT',
          version: 1,
        });
      if (poolMode === 'CONTENTS') {
        expect(copied.mappool!.draftRevisionId).not.toBe(draft.id);
        expect(copied.mappool!.draftRevision).toMatchObject({
          notes: 'Saved private notes',
          slots: [{ beatmapId, metadata: { title: 'Latest saved draft metadata' } }],
        });
        await db.poolPlan.update({ where: { id: copied.poolPlan!.id }, data: { minStars: 1 } });
      } else expect(copied.mappool!.draftRevisionId).toBeNull();
    }
    expect(
      await db.tournamentStage.findUniqueOrThrow({
        where: { id: inheritedId },
        include: {
          poolPlan: true,
          mappool: { include: { revisions: { include: { slots: true } } } },
        },
      }),
    ).toEqual(before);
  });

  it('enforces rule and policy copy permissions and supports structure fallback from saved maps', async () => {
    const snapshot = await data();
    const qualifier = snapshot.stages.find((stage) => stage.id === qualifierId)!;
    const request: StageWorkflowAction = {
      type: 'stage.duplicate',
      sourceId: qualifierId,
      baseConfigurationToken: qualifier.configurationToken,
      name: 'Qualifier copy',
      slug: 'qualifier-copy',
      copyRules: true,
      copyAppearance: false,
      poolMode: 'EMPTY',
    };
    await expect(
      apply(request, { ...actor, permissions: ['mappools.create'] }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(apply(request)).rejects.toMatchObject({ status: 403 });
    const creator = {
      ...actor,
      permissions: ['mappools.create', 'matches.manage'] as Actor['permissions'],
    };
    const result = await apply(request, creator);
    if (!('id' in result)) throw new Error('Expected duplicated stage ID');
    expect(await db.tournamentStage.findUniqueOrThrow({ where: { id: result.id } })).toMatchObject({
      matchRules: null,
      qualifierPolicy: { runs: 1 },
      bannerImageId: null,
    });
    const source = snapshot.stages.find((stage) => stage.id === inheritedId)!;
    const pooler = {
      ...actor,
      permissions: ['mappools.create', 'mappools.view_drafts'] as Actor['permissions'],
    };
    await db.poolPlan.deleteMany({ where: { tournamentId, stageId: inheritedId } });
    const copied = await apply(
      {
        type: 'stage.duplicate',
        sourceId: inheritedId,
        baseConfigurationToken: source.configurationToken,
        name: 'Structure without plan',
        slug: 'structure-without-plan',
        copyRules: false,
        copyAppearance: false,
        poolMode: 'STRUCTURE',
      },
      pooler,
    );
    if (!('id' in copied)) throw new Error('Expected duplicated stage ID');
    expect(await db.poolPlan.findUniqueOrThrow({ where: { stageId: copied.id } })).toMatchObject({
      slots: [{ name: 'NM1', category: 'NM' }],
      minStars: null,
      maxStars: null,
      version: 1,
    });
    expect(await db.tournamentStage.findUniqueOrThrow({ where: { id: copied.id } })).toMatchObject({
      matchRules: null,
      bannerImageId: null,
    });
    await expect(
      apply(
        { ...request, copyRules: false, slug: 'no-pool-access', poolMode: 'STRUCTURE' },
        { ...actor, permissions: ['mappools.create'] },
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects changed or foreign sources and duplicate slugs, and rolls back a late copy failure', async () => {
    const snapshot = await data();
    const source = snapshot.stages.find((stage) => stage.id === inheritedId)!;
    const creator = {
      ...actor,
      permissions: [...actor.permissions, 'mappools.create'] as Actor['permissions'],
    };
    const request: Extract<StageWorkflowAction, { type: 'stage.duplicate' }> = {
      type: 'stage.duplicate',
      sourceId: inheritedId,
      baseConfigurationToken: source.configurationToken,
      name: 'Rollback copy',
      slug: 'rollback-copy',
      copyRules: false,
      copyAppearance: false,
      poolMode: 'CONTENTS',
    };
    const beforeCount = await db.tournamentStage.count({ where: { tournamentId } });
    await expect(
      apply(
        {
          ...request,
          sourceId: qualifierId,
          baseConfigurationToken: snapshot.stages.find((stage) => stage.id === qualifierId)!
            .configurationToken,
        },
        creator,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      apply({ ...request, baseConfigurationToken: 'f'.repeat(64) }, creator),
    ).rejects.toMatchObject({ status: 409 });
    await expect(apply({ ...request, sourceId: foreignStageId }, creator)).rejects.toMatchObject({
      status: 404,
    });
    await expect(apply({ ...request, slug: source.slug }, creator)).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      apply(request, { ...creator, id: `${prefix}-nonexistent-user` }),
    ).rejects.toMatchObject({ code: 'P2003' });
    expect(await db.tournamentStage.count({ where: { tournamentId } })).toBe(beforeCount);
    expect(await db.tournamentStage.count({ where: { tournamentId, slug: request.slug } })).toBe(0);
  });
});
