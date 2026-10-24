import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '../src/generated/prisma/client';
import { actorForTournament } from '../src/lib/auth';
import { db } from '../src/lib/db';
import { inheritedRules } from '../src/lib/gameplay-scoring';
import { assertTestDatabase } from '../src/lib/instance';
import { nextDraftStep, replayDraft } from '../src/lib/match-engine';
import { matchData } from '../src/lib/match-queries';
import { matchInclude, rosterSnapshot } from '../src/lib/match-record';
import { matchRulesSchema } from '../src/lib/match-rules';
import type { Actor } from '../src/lib/permissions';
import { validateSheetRecord } from '../src/lib/referee-workbook-state';
import {
  stageReconciliationActionSchema,
  type StageReconciliationAction,
} from '../src/lib/stage-reconciliation';
import {
  applyStageReconciliation,
  stageReconciliationPreview,
} from '../src/lib/stage-reconciliation-service';
import { teamInclude } from '../src/lib/teams-service';
import { syntheticRecord } from './fixtures/referee-record';

assertTestDatabase(process.env.DATABASE_URL);

const prefix = `stage-reconciliation-${randomUUID()}`;
const tournamentIds = [`${prefix}-a`, `${prefix}-b`];
const userId = `${prefix}-manager`;
const beatmapBase = randomInt(1_500_000_000, 1_900_000_000);
const record = syntheticRecord('1');
const maps = record.pool.map((slot, index) => ({
  ...slot,
  beatmapId: beatmapBase + index,
  category: slot.name.replace(/\d+$/, ''),
}));
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const resultInclude = {
  ...matchInclude,
  events: { orderBy: { version: 'asc' as const } },
  revisions: { orderBy: { version: 'asc' as const } },
};
let verifiedTestDatabase = false;
let manager: Actor;
let local: Awaited<ReturnType<typeof createTournamentFixture>>;
let foreign: Awaited<ReturnType<typeof createTournamentFixture>>;
let completedId = '';
let unstartedId = '';
let foreignMatchId = '';

async function createTournamentFixture(tournamentId: string) {
  await db.tournament.create({
    data: {
      id: tournamentId,
      slug: tournamentId,
      name: tournamentId,
      acronym: 'TEST',
      description: 'Test-owned stage reconciliation fixtures',
      gameMode: 'osu',
      settings: {
        create: {
          gameplayScoring: 'SCORE_V2',
          matchRules: json(inheritedRules({}, 'SCORE_V2')),
          socialLinks: [],
          importantDates: [],
          navigation: [],
          footer: '',
        },
      },
    },
  });
  const canonicalRules = inheritedRules(
    { bestOf: 5, bansPerTeam: 1, banOrder: 'AB', teamSize: 1 },
    'SCORE_V2',
  );
  const canonical = await db.tournamentStage.create({
    data: {
      tournamentId,
      name: 'Grand Finals',
      slug: 'grand-finals',
      kind: 'ELIMINATION',
      matchRules: json(canonicalRules),
      mappool: { create: {} },
    },
    include: { mappool: true },
  });
  const imported = await db.tournamentStage.create({
    data: {
      tournamentId,
      name: 'Grand finals - Losers',
      slug: 'grand-finals-losers',
      mappool: { create: {} },
    },
    include: { mappool: true },
  });
  const createPool = async (mappoolId: string) => {
    const revision = await db.mappoolRevision.create({
      data: {
        tournamentId,
        mappoolId,
        notes: prefix,
        slots: {
          create: maps.map((map, position) => ({
            name: map.name,
            beatmapId: map.beatmapId,
            category: map.category,
            categoryName: map.category,
            color: '#a6c7ef',
            position,
            metadata: { fixture: prefix, id: map.beatmapId },
          })),
        },
      },
      include: { slots: { orderBy: { position: 'asc' } } },
    });
    await db.mappool.update({
      where: { id: mappoolId },
      data: { state: 'PUBLISHED', publishedRevisionId: revision.id },
    });
    return revision;
  };
  const oldPool = await createPool(imported.mappool!.id);
  const targetPool = await createPool(canonical.mappool!.id);
  const teams = [];
  for (const side of ['a', 'b'])
    teams.push(
      await db.team.create({
        data: { tournamentId, name: `${prefix}-${side}`, slug: side, status: 'APPROVED' },
        include: teamInclude,
      }),
    );
  return { tournamentId, canonical, canonicalRules, imported, oldPool, targetPool, teams };
}

async function createMatchFixture(
  fixture: Awaited<ReturnType<typeof createTournamentFixture>>,
  code: string,
  completed: boolean,
) {
  const source = { ...record, stage: 'Grand finals - Losers', pool: maps };
  const validated = validateSheetRecord(
    source,
    inheritedRules({}, 'SCORE_V1'),
    fixture.oldPool.slots,
  );
  const now = new Date('2026-10-21T08:00:00Z');
  return db.$transaction(async (tx) => {
    const match = await tx.match.create({
      data: {
        tournamentId: fixture.tournamentId,
        code,
        stageId: fixture.imported.id,
        poolRevisionId: fixture.oldPool.id,
        teamAId: fixture.teams[0].id,
        teamBId: fixture.teams[1].id,
        participants: json({
          A: rosterSnapshot(fixture.teams[0]),
          B: rosterSnapshot(fixture.teams[1]),
        }),
        rules: json({ ...validated.rules, historicalFixture: prefix }),
        source: { originalStage: source.stage, fixture: prefix, preservedPayload: { sheet: code } },
        scheduledAt: new Date(now.getTime() + (completed ? 0 : 3_600_000)),
        status: completed ? 'COMPLETED' : 'SCHEDULED',
        version: completed ? 4 : 1,
        ...(completed
          ? {
              ...validated.starters,
              rollA: 71,
              rollB: 32,
              scoreA: 2,
              scoreB: 0,
              winnerSide: 'A',
              startedAt: now,
              submittedAt: now,
              completedAt: now,
            }
          : {}),
      },
    });
    if (completed) {
      for (const [index, action] of validated.actions.entries()) {
        const stored = await tx.matchMapAction.create({
          data: {
            matchId: match.id,
            actorId: userId,
            sequence: index + 1,
            kind: action.kind,
            side: action.side,
            slotName: action.slotName,
            category: action.category,
            provenance: { fixture: prefix, sourceRow: action.row, original: action.original },
          },
        });
        if (action.winner)
          await tx.matchMapResult.create({
            data: {
              matchId: match.id,
              actionId: stored.id,
              winnerSide: action.winner,
              scoreA: 450_000 + index,
              scoreB: 320_000 + index,
              notes: 'Test-owned original ScoreV1 result',
            },
          });
      }
      await tx.matchEvent.create({
        data: {
          matchId: match.id,
          actorId: userId,
          version: 2,
          kind: 'match.roll',
          data: { fixture: prefix, rollA: 71, rollB: 32 },
        },
      });
      await tx.matchEvent.create({
        data: {
          matchId: match.id,
          actorId: userId,
          version: 3,
          kind: 'sheet.import',
          data: {
            fixture: prefix,
            originalRecord: { stage: source.stage },
            record: { sheet: code, discord: 'Test-owned original history' },
          },
        },
      });
      await tx.matchResultRevision.create({
        data: {
          matchId: match.id,
          createdBy: userId,
          version: 4,
          kind: 'match.confirm',
          reason: prefix,
          snapshot: json(match),
        },
      });
    }
    return match.id;
  });
}

const apply = (actor: Actor, action: StageReconciliationAction) =>
  db.$transaction((tx) => applyStageReconciliation(tx, actor, action), { timeout: 30_000 });

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL);
  const [database] = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  expect(database.name).toBe('tournament_platform_test');
  verifiedTestDatabase = true;
  for (const map of maps)
    await db.beatmap.create({
      data: { id: map.beatmapId, mode: 'osu', metadata: { fixture: prefix } },
    });
  local = await createTournamentFixture(tournamentIds[0]);
  foreign = await createTournamentFixture(tournamentIds[1]);
  const role = await db.role.create({
    data: {
      tournamentId: local.tournamentId,
      name: `${prefix}-manager`,
      permissions: { create: { permission: { connect: { key: 'matches.manage' } } } },
    },
  });
  const user = await db.user.create({
    data: {
      id: userId,
      osuId: randomInt(1_500_000_000, 1_900_000_000),
      username: prefix,
      avatarUrl: '',
      profileUrl: '',
      platformAdmin: false,
      roles: { create: { tournamentId: local.tournamentId, roleId: role.id } },
    },
    include: { roles: { include: { role: { include: { permissions: true } } } } },
  });
  manager = actorForTournament(user, local.tournamentId);
  expect(manager.permissions).toEqual(['matches.manage']);
  completedId = await createMatchFixture(local, 'completed', true);
  unstartedId = await createMatchFixture(local, 'unstarted', false);
  foreignMatchId = await createMatchFixture(foreign, 'foreign', false);
}, 30_000);

afterAll(async () => {
  try {
    if (!verifiedTestDatabase) return;
    assertTestDatabase(process.env.DATABASE_URL);
    await db.$transaction(
      async (tx) => {
        const scope = { tournamentId: { in: tournamentIds } };
        expect(await tx.bracket.count({ where: scope })).toBe(0);
        await tx.match.deleteMany({ where: scope });
        await tx.team.deleteMany({ where: scope });
        await tx.mappool.updateMany({
          where: scope,
          data: { publishedRevisionId: null, draftRevisionId: null },
        });
        await tx.mappoolRevision.deleteMany({ where: scope });
        await tx.mappool.deleteMany({ where: scope });
        await tx.tournamentStage.deleteMany({ where: scope });
        await tx.auditLog.deleteMany({ where: scope });
        await tx.userRole.deleteMany({ where: { ...scope, userId } });
        await tx.role.deleteMany({ where: scope });
        await tx.tournament.deleteMany({ where: { id: { in: tournamentIds } } });
        await tx.user.deleteMany({ where: { id: userId } });
        await tx.beatmap.deleteMany({
          where: {
            id: { in: maps.map((map) => map.beatmapId) },
            metadata: { path: ['fixture'], equals: prefix },
          },
        });
      },
      { timeout: 30_000 },
    );
    expect(await db.tournament.count({ where: { id: { in: tournamentIds } } })).toBe(0);
    expect(await db.role.count({ where: { tournamentId: { in: tournamentIds } } })).toBe(0);
    expect(await db.user.count({ where: { id: userId } })).toBe(0);
    expect(
      await db.beatmap.count({ where: { metadata: { path: ['fixture'], equals: prefix } } }),
    ).toBe(0);
  } finally {
    await db.$disconnect();
  }
}, 30_000);

describe.sequential('persistent reviewed stage reconciliation (isolated test database)', () => {
  it('repairs Grand finals - Losers to existing Grand Finals, preserving the completed record and referee history idempotently', async () => {
    const before = await db.match.findUniqueOrThrow({
      where: { id: completedId },
      include: resultInclude,
    });
    const preview = await stageReconciliationPreview(manager);
    const proposal = preview.matches.find((match) => match.matchId === completedId)!;
    expect(proposal).toMatchObject({
      suggestedStageId: local.canonical.id,
      sourceLabel: 'Grand finals - Losers',
      bracket: 'Losers',
      canRebindPool: false,
    });
    const action = stageReconciliationActionSchema.parse({
      type: 'stage.reconcile',
      reason: prefix,
      changes: [
        { matchId: completedId, baseVersion: proposal.baseVersion, stageId: local.canonical.id },
      ],
    });
    expect(await apply(manager, action)).toMatchObject({
      changed: 1,
      results: [{ matchId: completedId, refereeReady: true, alreadyApplied: false }],
    });
    const after = await db.match.findUniqueOrThrow({
      where: { id: completedId },
      include: resultInclude,
    });
    expect(after.stageId).toBe(local.canonical.id);
    expect(after.bracket).toBe('Losers');
    for (const field of [
      'rules',
      'poolRevisionId',
      'participants',
      'actions',
      'results',
      'revisions',
      'status',
      'scoreA',
      'scoreB',
      'winnerSide',
      'rollA',
      'rollB',
      'firstPickSide',
      'firstBanSide',
      'firstProtectSide',
      'startedAt',
      'submittedAt',
      'completedAt',
      'scheduledAt',
    ] as const)
      expect(after[field]).toEqual(before[field]);
    expect(after.events.filter((event) => event.kind !== 'stage.reconcile')).toEqual(before.events);
    expect(after.source).toMatchObject({
      preservedPayload: { sheet: 'completed' },
      stageReconciliation: {
        originalStageLabel: 'Grand finals - Losers',
        originalStageId: local.imported.id,
        originalSource: before.source,
        bracket: 'Losers',
        resolvedStageId: local.canonical.id,
      },
    });
    expect(
      replayDraft(
        matchRulesSchema.parse(after.rules),
        after,
        after.poolRevision!.slots,
        after.actions,
        after.results,
      ).scoreA,
    ).toBe(2);
    const detail = await matchData(
      manager,
      new URL(`http://localhost/api/admin/data?section=match&id=${completedId}`),
      'match',
    );
    expect(detail).toMatchObject({
      match: { id: completedId, stage: { id: local.canonical.id }, status: 'COMPLETED' },
      access: { manager: true },
    });
    expect(await apply(manager, action)).toMatchObject({
      changed: 0,
      results: [{ matchId: completedId, alreadyApplied: true, version: after.version }],
    });
    expect(
      await db.match.findUniqueOrThrow({ where: { id: completedId }, include: resultInclude }),
    ).toEqual(after);
    expect(
      await db.matchEvent.count({ where: { matchId: completedId, kind: 'stage.reconcile' } }),
    ).toBe(1);
    expect(
      await db.auditLog.count({
        where: {
          tournamentId: local.tournamentId,
          entityId: completedId,
          action: 'stage.reconcile',
        },
      }),
    ).toBe(1);
    expect(
      (await stageReconciliationPreview(manager)).matches.some(
        (match) => match.matchId === completedId,
      ),
    ).toBe(false);
    expect(await db.tournamentStage.count({ where: { tournamentId: local.tournamentId } })).toBe(2);
  });

  it('scopes the preview and denies foreign matches, foreign target stages and forged tournament permissions without writes', async () => {
    const before = await db.match.findMany({
      where: { tournamentId: { in: tournamentIds } },
      orderBy: { id: 'asc' },
    });
    const preview = await stageReconciliationPreview(manager);
    expect(preview.matches.some((match) => match.matchId === foreignMatchId)).toBe(false);
    expect(preview.stages.some((stage) => stage.id === foreign.canonical.id)).toBe(false);
    const proposal = preview.matches.find((match) => match.matchId === unstartedId)!;
    const action = stageReconciliationActionSchema.parse({
      type: 'stage.reconcile',
      reason: prefix,
      changes: [{ matchId: foreignMatchId, baseVersion: 1, stageId: local.canonical.id }],
    });
    await expect(apply(manager, action)).rejects.toMatchObject({ status: 404 });
    await expect(
      apply(manager, {
        ...action,
        changes: [
          {
            matchId: unstartedId,
            baseVersion: proposal.baseVersion,
            stageId: foreign.canonical.id,
            rebindPool: false,
          },
        ],
      }),
    ).rejects.toThrow('existing active');
    await expect(stageReconciliationPreview({ ...manager, permissions: [] })).rejects.toMatchObject(
      { status: 403 },
    );
    await expect(
      apply(
        { ...manager, tournamentId: foreign.tournamentId },
        {
          ...action,
          changes: [
            {
              matchId: foreignMatchId,
              baseVersion: 1,
              stageId: foreign.canonical.id,
              rebindPool: false,
            },
          ],
        },
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      await db.match.findMany({
        where: { tournamentId: { in: tournamentIds } },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
    expect(await db.auditLog.count({ where: { tournamentId: foreign.tournamentId } })).toBe(0);
    expect(await db.matchEvent.count({ where: { matchId: foreignMatchId } })).toBe(0);
  });

  it('rebinds only a reviewed unstarted match to the published pool and canonical rules, preserving its identity and schedule', async () => {
    const before = await db.match.findUniqueOrThrow({
      where: { id: unstartedId },
      include: resultInclude,
    });
    const preview = await stageReconciliationPreview(manager);
    const proposal = preview.matches.find((match) => match.matchId === unstartedId)!;
    const target = preview.stages.find((stage) => stage.id === local.canonical.id)!;
    expect(proposal.canRebindPool).toBe(true);
    expect(target).toMatchObject({ canRebindPool: true, poolRevisionId: local.targetPool.id });
    const action = stageReconciliationActionSchema.parse({
      type: 'stage.reconcile',
      reason: prefix,
      changes: [
        {
          matchId: unstartedId,
          baseVersion: proposal.baseVersion,
          stageId: target.id,
          rebindPool: true,
          targetSnapshotKey: target.snapshotKey,
        },
      ],
    });
    await expect(
      apply(manager, {
        ...action,
        changes: [{ ...action.changes[0], targetSnapshotKey: '0'.repeat(64) }],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await db.match.findUniqueOrThrow({ where: { id: unstartedId }, include: resultInclude }),
    ).toEqual(before);
    await apply(manager, action);
    const after = await db.match.findUniqueOrThrow({
      where: { id: unstartedId },
      include: resultInclude,
    });
    expect(after.poolRevisionId).toBe(local.targetPool.id);
    expect(after.rules).toEqual(local.canonicalRules);
    expect(after.rules).toMatchObject({
      bestOf: 5,
      scoreMode: 'SCORE_V2',
      gameplayScoring: 'SCORE_V2',
    });
    for (const field of [
      'id',
      'participants',
      'teamAId',
      'teamBId',
      'scheduledAt',
      'status',
      'actions',
      'results',
    ] as const)
      expect(after[field]).toEqual(before[field]);
    expect(after.bracket).toBe('Losers');
    expect(
      nextDraftStep(matchRulesSchema.parse(after.rules), {
        scoreA: after.scoreA,
        scoreB: after.scoreB,
        firstPickSide: after.firstPickSide,
        firstBanSide: after.firstBanSide,
        firstProtectSide: after.firstProtectSide,
        actions: after.actions,
        pendingPick: false,
      }),
    ).toMatchObject({ kind: 'ROLL' });
    expect(
      await matchData(
        manager,
        new URL(`http://localhost/api/admin/data?section=match&id=${unstartedId}`),
        'match',
      ),
    ).toMatchObject({
      match: { id: unstartedId, stage: { id: local.canonical.id }, status: 'SCHEDULED' },
    });
    expect(await apply(manager, action)).toMatchObject({ changed: 0 });
    expect(
      await db.match.findUniqueOrThrow({ where: { id: unstartedId }, include: resultInclude }),
    ).toEqual(after);
    expect((await stageReconciliationPreview(manager)).matches).toEqual([]);
  });
});
