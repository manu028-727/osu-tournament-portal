import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../src/generated/prisma/client';
import type { Actor } from '../src/lib/permissions';
import {
  normalizeStageLabel,
  resolveStageLabel,
  canRebindStageSnapshot,
  stageReconciliationActionSchema,
  sourceStageLabel,
  approvedStageMappings,
} from '../src/lib/stage-reconciliation';
import { matchRulesSchema } from '../src/lib/match-rules';
import { inheritedRules } from '../src/lib/gameplay-scoring';
import { validateSheetRecord } from '../src/lib/referee-workbook-state';
import { replayDraft } from '../src/lib/match-engine';
import { syntheticRecord } from './fixtures/referee-record';

const { root, competition } = vi.hoisted(() => ({
  root: {} as Record<string, unknown>,
  competition: { guard: vi.fn(), advance: vi.fn() },
}));
vi.mock('../src/lib/db', () => ({ db: root }));
vi.mock('../src/lib/competition-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/competition-service')>()),
  assertCompetitionResultCorrection: competition.guard,
  advanceConfirmedCompetitionResult: competition.advance,
}));
import { applyWorkbook, importApplySchema } from '../src/lib/referee-import';
import { AppError } from '../src/lib/permissions';
import {
  applyStageReconciliation,
  stageReconciliationPreview,
} from '../src/lib/stage-reconciliation-service';

const manager: Actor = {
  id: 'manager',
  tournamentId: 'tenant-a',
  osuId: 1,
  username: 'Manager',
  avatarUrl: '',
  roles: [],
  permissions: ['matches.manage'],
};
const stages = [
  { id: 'gf', name: 'Grand Finals', kind: 'ELIMINATION', archivedAt: null },
  { id: 'fake', name: 'Grand finals - Losers', kind: 'CUSTOM', archivedAt: null },
];

describe('explicit gameplay-stage normalization', () => {
  it.each([
    'Grand finals - Losers',
    'Grand-finals - Losers-bracket',
    'GRAND FINALS: losers bracket',
    'GF (LB)',
    'G.F. [L.B.]',
    'Grand final [Losers]',
  ])('maps %s to an existing stage and preserves bracket/round context', (label) => {
    const resolved = resolveStageLabel(label, stages);
    expect(resolved.stage?.id).toBe('gf');
    expect(resolved.bracket).toBe('Losers');
    expect(resolved.roundLabel).toBe(label);
    expect(resolved.candidates).toHaveLength(1);
  });
  it('supports case, punctuation, known aliases and exact custom names without inventing stages', () => {
    expect(resolveStageLabel('Semi-Finals', [{ id: 'sf', name: 'Semifinals' }]).stage?.id).toBe(
      'sf',
    );
    expect(resolveStageLabel('RO16', [{ id: 'r16', name: 'Round of 16' }]).stage?.id).toBe('r16');
    expect(resolveStageLabel('CUSTOM.round', [{ id: 'c', name: 'Custom Round' }]).stage?.id).toBe(
      'c',
    );
    for (const label of [
      'Grand finals - Losers exhibition',
      'Grand Finals reset',
      'GF2',
      'Grand Finals Losers',
      'Unknown - Losers',
    ])
      expect(resolveStageLabel(label, stages).stage).toBeNull();
    expect(normalizeStageLabel('Grand finals - arbitrary').stageLabel).toBe(
      'Grand finals - arbitrary',
    );
  });
  it('requires explicit choice for ambiguous aliases and ignores archived stages', () => {
    expect(
      resolveStageLabel('GF - Losers', [...stages, { id: 'gf2', name: 'Grand Final' }]),
    ).toMatchObject({ ambiguous: true, stage: null });
    expect(
      resolveStageLabel('Grand Finals', [{ ...stages[0], archivedAt: new Date() }]).stage,
    ).toBeNull();
  });
  it('reads historical workbook provenance without dropping the original round', () => {
    expect(
      sourceStageLabel(
        null,
        [{ data: { originalRecord: { stage: 'Grand finals - Losers' } } }],
        'Wrong Stage',
      ),
    ).toBe('Grand finals - Losers');
  });
  it('reuses only explicit audited source mappings and does not apply them to a different bracket', () => {
    const label = 'External final - Losers';
    const events = [
      {
        kind: 'sheet.import',
        data: { originalRecord: { stage: label }, stageMapping: { stageId: 'gf', approved: true } },
      },
    ];
    expect(
      resolveStageLabel(label.toUpperCase(), stages, approvedStageMappings(events)).stage?.id,
    ).toBe('gf');
    expect(
      resolveStageLabel('External final - Winners', stages, approvedStageMappings(events)).stage,
    ).toBeNull();
    expect(
      resolveStageLabel(label, stages, approvedStageMappings([{ ...events[0], kind: 'other' }]))
        .stage,
    ).toBeNull();
    expect(
      resolveStageLabel(
        label,
        stages,
        approvedStageMappings([
          { kind: 'stage.reconcile', data: { sourceLabel: label, stageId: 'gf' } },
        ]),
      ).stage?.id,
    ).toBe('gf');
  });
});

function fixture() {
  const record = syntheticRecord();
  const slots = record.pool.map((slot) => ({ ...slot, category: slot.name.replace(/\d+$/, '') }));
  const validated = validateSheetRecord(record, inheritedRules({}, 'SCORE_V1'), slots);
  const historicalRules = { ...validated.rules, customHistoricalMarker: 'preserve verbatim' };
  const match = {
    id: 'match-a',
    tournamentId: 'tenant-a',
    code: '1',
    version: 7,
    stageId: 'fake',
    stage: stages[1],
    rules: historicalRules,
    poolRevisionId: 'old-pool',
    poolRevision: { id: 'old-pool', slots },
    source: { stage: 'Grand finals - Losers', originalPayload: { untouched: true } },
    bracket: '',
    participants: { A: { name: 'Team Alpha' }, B: { name: 'Team Beta' } },
    status: 'COMPLETED',
    scoreA: 2,
    scoreB: 0,
    winnerSide: 'A',
    forfeitSide: null,
    rollA: 56,
    rollB: 28,
    firstPickSide: 'A',
    firstBanSide: 'A',
    firstProtectSide: 'A',
    startedAt: new Date(),
    completedAt: new Date(),
    submittedAt: new Date(),
    scheduledAt: new Date(),
    timerStartedAt: null,
    timerKind: null,
    timerRemainingSeconds: 0,
    actions: validated.actions,
    results: validated.results,
    multiplayerGames: [],
    events: [],
  };
  const targets = stages.map((stage) => ({
    ...stage,
    matchRules: {},
    mappool: { state: 'PUBLISHED', publishedRevision: { id: 'new-pool', slots } },
  }));
  const user = {
    ...manager,
    platformAdmin: false,
    roles: [
      {
        role: {
          id: 'role',
          name: 'Manager',
          tournamentId: 'tenant-a',
          systemKey: null,
          templateKey: null,
          permissions: [{ permissionKey: 'matches.manage' }],
        },
      },
    ],
  };
  const events: { version: number; data: Record<string, unknown> }[] = [];
  const tx = {
    user: { findUniqueOrThrow: vi.fn(async () => user) },
    tournamentStage: { findMany: vi.fn(async () => targets) },
    tournamentSettings: {
      findUniqueOrThrow: vi.fn(async () => ({ matchRules: {}, gameplayScoring: 'SCORE_V2' })),
    },
    tournament: {
      findUniqueOrThrow: vi.fn(async () => ({
        id: 'tenant-a',
        slug: 'tenant-a',
        name: 'A',
        gameMode: 'osu',
      })),
    },
    match: {
      findMany: vi.fn(async () => [match]),
      findUnique: vi.fn(async (args: { where: { id: string; AND: unknown[] } }) => {
        expect(args.where.AND).toContainEqual({ tournamentId: 'tenant-a' });
        return args.where.id === match.id ? structuredClone(match) : null;
      }),
      updateMany: vi.fn(
        async (args: { where: { version: number }; data: Record<string, unknown> }) => {
          if (args.where.version !== match.version) return { count: 0 };
          const { version: _, ...values } = args.data;
          Object.assign(match, values, { version: match.version + 1 });
          match.stage = targets.find((stage) => stage.id === match.stageId)!;
          if (args.data.poolRevisionId === 'new-pool')
            match.poolRevision = { id: 'new-pool', slots };
          return { count: 1 };
        },
      ),
    },
    matchEvent: {
      findFirst: vi.fn(async () => events.at(-1) || null),
      create: vi.fn(async ({ data }: { data: (typeof events)[number] }) => {
        events.push(data);
        return data;
      }),
    },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  Object.assign(root, tx);
  const action = stageReconciliationActionSchema.parse({
    type: 'stage.reconcile',
    reason: 'Reviewed Grand Finals mapping',
    changes: [{ matchId: match.id, baseVersion: match.version, stageId: 'gf', rebindPool: false }],
  });
  return { tx, match, action, targets, record, slots, historicalRules, user };
}

describe('reviewed stage repair (mock transaction, no database writes)', () => {
  it('repairs the canonical record while preserving completed actions, results, pool and rules verbatim; retry is a no-op', async () => {
    const { tx, match, action, historicalRules } = fixture();
    const before = structuredClone(match);
    const transaction = tx as unknown as Prisma.TransactionClient;
    expect((await stageReconciliationPreview(manager)).matches[0].suggestedStageId).toBe('gf');
    const first = await applyStageReconciliation(transaction, manager, action);
    expect(first.changed).toBe(1);
    expect(match.stageId).toBe('gf');
    expect(match.bracket).toBe('Losers');
    for (const key of [
      'rules',
      'poolRevisionId',
      'actions',
      'results',
      'participants',
      'status',
      'scheduledAt',
      'scoreA',
      'scoreB',
      'completedAt',
    ] as const)
      expect(match[key]).toEqual(before[key]);
    expect(match.rules).toEqual(historicalRules);
    expect(
      replayDraft(
        matchRulesSchema.parse(match.rules),
        match as never,
        match.poolRevision.slots,
        match.actions,
        match.results,
      ).scoreA,
    ).toBe(2);
    expect(match.source).toMatchObject({
      originalPayload: { untouched: true },
      stageReconciliation: { originalStageLabel: 'Grand finals - Losers', resolvedStageId: 'gf' },
    });
    expect((await stageReconciliationPreview(manager)).matches).toEqual([]);
    expect((await applyStageReconciliation(transaction, manager, action)).changed).toBe(0);
    expect(tx.match.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.matchEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it('rejects stale versions, cross-tenant/nonexistent matches and revoked manager permission before writes', async () => {
    const { tx, action, user } = fixture();
    const transaction = tx as unknown as Prisma.TransactionClient;
    await expect(
      applyStageReconciliation(transaction, manager, {
        ...action,
        changes: [{ ...action.changes[0], baseVersion: 6 }],
      }),
    ).rejects.toThrow('changed after preview');
    await expect(
      applyStageReconciliation(transaction, manager, {
        ...action,
        changes: [{ ...action.changes[0], matchId: 'foreign-match' }],
      }),
    ).rejects.toThrow('not found in this tournament');
    user.roles = [];
    await expect(applyStageReconciliation(transaction, manager, action)).rejects.toThrow();
    expect(tx.match.updateMany).not.toHaveBeenCalled();
  });
  it('never rebinds a started match, even when its old actions were voided', async () => {
    const { tx, action, match } = fixture();
    expect(canRebindStageSnapshot(match)).toBe(false);
    await expect(
      applyStageReconciliation(tx as unknown as Prisma.TransactionClient, manager, {
        ...action,
        changes: [{ ...action.changes[0], rebindPool: true, targetSnapshotKey: 'a'.repeat(64) }],
      }),
    ).rejects.toThrow('retain frozen');
    expect(tx.match.updateMany).not.toHaveBeenCalled();
  });
  it('can bind only an unstarted match to an already-published target pool and canonical new rules', async () => {
    const { tx, action, match } = fixture();
    Object.assign(match, {
      status: 'SCHEDULED',
      startedAt: null,
      completedAt: null,
      submittedAt: null,
      actions: [],
      results: [],
      scoreA: 0,
      scoreB: 0,
      winnerSide: null,
      rollA: null,
      rollB: null,
      firstPickSide: null,
      firstBanSide: null,
      firstProtectSide: null,
    });
    expect(canRebindStageSnapshot(match)).toBe(true);
    const preview = await stageReconciliationPreview(manager);
    const targetSnapshotKey = preview.stages.find((stage) => stage.id === 'gf')!.snapshotKey!;
    const input = {
      ...action,
      changes: [{ ...action.changes[0], rebindPool: true, targetSnapshotKey }],
    };
    await applyStageReconciliation(tx as unknown as Prisma.TransactionClient, manager, input);
    expect(match.poolRevisionId).toBe('new-pool');
    expect(match.rules).toMatchObject({ gameplayScoring: 'SCORE_V2', scoreMode: 'SCORE_V2' });
  });
  it('rejects unpublished pools without creating a stage or touching history', async () => {
    const { tx, action, match, targets } = fixture();
    Object.assign(match, {
      status: 'SCHEDULED',
      startedAt: null,
      completedAt: null,
      submittedAt: null,
      actions: [],
      results: [],
      scoreA: 0,
      scoreB: 0,
      winnerSide: null,
      rollA: null,
      rollB: null,
      firstPickSide: null,
      firstBanSide: null,
      firstProtectSide: null,
    });
    targets[0].mappool.state = 'DRAFT';
    await expect(
      applyStageReconciliation(tx as unknown as Prisma.TransactionClient, manager, {
        ...action,
        changes: [{ ...action.changes[0], rebindPool: true, targetSnapshotKey: 'a'.repeat(64) }],
      }),
    ).rejects.toThrow('already have a published');
    expect(tx.match.updateMany).not.toHaveBeenCalled();
  });
  it('requires manual choice for ambiguous mappings and remembers the reviewed choice', async () => {
    const { tx, action, targets } = fixture();
    targets.push({ ...targets[0], id: 'gf2', name: 'Grand Final' });
    const preview = await stageReconciliationPreview(manager);
    expect(preview.matches[0]).toMatchObject({ ambiguous: true, suggestedStageId: null });
    await applyStageReconciliation(tx as unknown as Prisma.TransactionClient, manager, action);
    expect((await stageReconciliationPreview(manager)).matches).toEqual([]);
  });
  it('does not re-propose an unknown source label after explicit manual reconciliation', async () => {
    const { tx, action, match } = fixture();
    match.source.stage = 'Unrecognized external final - Losers';
    expect((await stageReconciliationPreview(manager)).matches[0].suggestedStageId).toBeNull();
    await applyStageReconciliation(tx as unknown as Prisma.TransactionClient, manager, action);
    expect((await stageReconciliationPreview(manager)).matches).toEqual([]);
  });
  it('can restore missing bracket metadata on an already-canonical stage without changing its history', async () => {
    const { tx, action, match, targets } = fixture();
    match.stageId = 'gf';
    match.stage = targets[0];
    expect((await stageReconciliationPreview(manager)).matches[0].reasons.join(' ')).toContain(
      'bracket context',
    );
    await applyStageReconciliation(tx as unknown as Prisma.TransactionClient, manager, action);
    expect(match.stageId).toBe('gf');
    expect(match.bracket).toBe('Losers');
    expect((await stageReconciliationPreview(manager)).matches).toEqual([]);
  });
  it('rejects a target snapshot changed after review without changing the match', async () => {
    const { tx, action, match, targets } = fixture();
    Object.assign(match, {
      status: 'SCHEDULED',
      startedAt: null,
      completedAt: null,
      submittedAt: null,
      actions: [],
      results: [],
      scoreA: 0,
      scoreB: 0,
      winnerSide: null,
      rollA: null,
      rollB: null,
      firstPickSide: null,
      firstBanSide: null,
      firstProtectSide: null,
    });
    const preview = await stageReconciliationPreview(manager);
    const targetSnapshotKey = preview.stages.find((stage) => stage.id === 'gf')!.snapshotKey!;
    Object.assign(targets[0].matchRules, { bestOf: 7 });
    await expect(
      applyStageReconciliation(tx as unknown as Prisma.TransactionClient, manager, {
        ...action,
        changes: [{ ...action.changes[0], rebindPool: true, targetSnapshotKey }],
      }),
    ).rejects.toThrow('changed after preview');
    expect(tx.match.updateMany).not.toHaveBeenCalled();
  });
});

function workbookFixture(
  options: { status?: string; changedWinner?: boolean; alreadyImported?: boolean } = {},
) {
  const state = fixture();
  const source = { ...state.record, stage: 'Grand finals - Losers', fingerprint: 'source-fixture' };
  if (options.changedWinner) {
    source.scoreA = 0;
    source.scoreB = 2;
    source.actions = source.actions.map((action) => ({
      ...action,
      winner: action.winner ? ('B' as const) : null,
    }));
  }
  Object.assign(state.match, {
    stageId: 'gf',
    stage: state.targets[0],
    status: options.status || 'COMPLETED',
    actions: [],
    results: [],
  });
  state.user.roles[0].role.permissions.push({ permissionKey: 'matches.import' });
  competition.guard.mockReset().mockResolvedValue({ affected: [], blocked: false, hash: '' });
  competition.advance.mockReset().mockResolvedValue(undefined);
  const tx = {
    ...state.tx,
    $executeRaw: vi.fn(async () => 1),
    refereeImport: {
      findUnique: vi.fn(async () => ({
        id: 'workbook',
        expiresAt: new Date(Date.now() + 60_000),
        records: [source],
        filename: 'fixture.xlsx',
        fingerprint: 'workbook-fixture',
      })),
    },
    match: { ...state.tx.match, findUniqueOrThrow: vi.fn(async () => state.match) },
    matchEvent: { ...state.tx.matchEvent, findMany: vi.fn(async () => []) },
    matchMapAction: {
      updateMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: `action-${data.sequence}`,
        ...data,
      })),
    },
    matchMapResult: {
      updateMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async (_input: { data: Record<string, unknown> }) => ({})),
    },
    multiplayerGame: { updateMany: vi.fn(async () => ({ count: 0 })) },
    matchResultRevision: { create: vi.fn(async () => ({})) },
  };
  if (options.alreadyImported) {
    state.match.actions = state.record.actions.map((action, index) => ({
      ...state.match.actions[index],
      ...action,
      id: `same-${index}`,
      voided: false,
      category: '',
    }));
    state.match.results = source.actions.flatMap((action, index) =>
      action.winner
        ? [{ actionId: `same-${index}`, winnerSide: action.winner, voided: false }]
        : [],
    );
    Object.assign(state.match, { lobbyUrl: source.mp });
    tx.matchEvent.findFirst.mockResolvedValue({ version: state.match.version, data: {} });
  }
  Object.assign(root, tx, {
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  });
  const actor: Actor = { ...manager, permissions: ['matches.manage', 'matches.import'] };
  const input = importApplySchema.parse({
    importId: 'workbook',
    sheet: source.sheet,
    matchId: state.match.id,
    baseVersion: state.match.version,
    replace: true,
    confirmResults: true,
    reason: 'Reviewed source history',
  });
  return { ...state, tx, actor, input };
}

describe('workbook imports respect native bracket result corrections', () => {
  it('honors explicit confirmation of an already-imported provisional record instead of returning a no-op', async () => {
    const { tx, actor, input } = workbookFixture({
      status: 'AWAITING_CONFIRMATION',
      alreadyImported: true,
    });
    const result = await applyWorkbook(actor, input);
    expect(result).toMatchObject({ alreadyApplied: false, status: 'COMPLETED' });
    expect(tx.match.updateMany).toHaveBeenCalledTimes(1);
    expect(competition.advance).toHaveBeenCalledTimes(1);
  });
  it('preserves source scoring and kept website action provenance on the accepted action', async () => {
    const { tx, actor, input, match } = workbookFixture({ alreadyImported: true });
    tx.matchEvent.findFirst.mockResolvedValue(null);
    const row = match.actions[0].row;
    Object.assign(match.actions[0], {
      provenance: { type: 'MANUAL', reason: 'Original reviewed action' },
    });
    await applyWorkbook(actor, { ...input, choices: [{ row, use: 'WEBSITE' }] });
    expect(tx.matchMapAction.create.mock.calls[0][0]).toMatchObject({
      data: {
        provenance: {
          sourceScoring: null,
          sourceGameMode: 'osu',
          resolution: 'WEBSITE',
          retainedWebsiteAction: {
            id: 'same-0',
            provenance: { type: 'MANUAL', reason: 'Original reviewed action' },
          },
        },
      },
    });
  });
  it('rejects duplicate or unavailable conflict-choice rows', async () => {
    const { tx, actor, input } = workbookFixture();
    expect(() =>
      importApplySchema.parse({
        ...input,
        choices: [
          { row: 9, use: 'WEBSITE' },
          { row: 9, use: 'SOURCE' },
        ],
      }),
    ).toThrow('Resolve each source row only once');
    await expect(
      applyWorkbook(actor, { ...input, choices: [{ row: 499, use: 'SOURCE' }] }),
    ).rejects.toThrow('source row is unavailable');
    expect(tx.matchMapAction.updateMany).not.toHaveBeenCalled();
  });
  it('preserves exact website scores and player details when a played map is explicitly kept', async () => {
    const { tx, actor, input, match } = workbookFixture({ alreadyImported: true });
    tx.matchEvent.findFirst.mockResolvedValue(null);
    const action = match.actions[4];
    const result = match.results.find((result) => result.actionId === action.id)!;
    Object.assign(result, {
      id: 'original-result',
      entryMode: 'SCORES',
      scoreA: 345_678,
      scoreB: 123_456,
      notes: 'Verified website score',
      playerScores: [{ osuId: 42, side: 'A', score: 345_678, accuracy: 98.5, mods: ['HD'] }],
    });
    await applyWorkbook(actor, { ...input, choices: [{ row: action.row, use: 'WEBSITE' }] });
    expect(tx.matchMapResult.create.mock.calls[0][0]).toMatchObject({
      data: {
        entryMode: 'SCORES',
        scoreA: 345_678,
        scoreB: 123_456,
        notes: 'Verified website score',
        playerScores: {
          create: [{ osuId: 42, side: 'A', score: 345_678, accuracy: 98.5, mods: ['HD'] }],
        },
      },
    });
    expect(tx.matchMapAction.create.mock.calls[4][0]).toMatchObject({
      data: {
        provenance: {
          resolution: 'WEBSITE',
          retainedWebsiteResultId: 'original-result',
        },
      },
    });
  });
  it('blocks a changed completed winner before mutating history when downstream impact was not separately reviewed', async () => {
    const { tx, actor, input, match } = workbookFixture({ changedWinner: true });
    competition.guard.mockRejectedValue(
      new AppError(
        'Review the downstream correction impact and explicitly approve it before saving.',
        409,
      ),
    );
    await expect(applyWorkbook(actor, input)).rejects.toMatchObject({ status: 409 });
    expect(competition.guard).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-a',
      match.id,
      'B',
      false,
    );
    expect(tx.matchMapAction.updateMany).not.toHaveBeenCalled();
    expect(tx.matchMapResult.updateMany).not.toHaveBeenCalled();
    expect(tx.match.updateMany).not.toHaveBeenCalled();
    expect(competition.advance).not.toHaveBeenCalled();
  });
  it('checks loss of completed status using a null confirmed winner and does not auto-confirm provisional data', async () => {
    const { tx, actor, input, match } = workbookFixture({ changedWinner: true });
    const result = await applyWorkbook(actor, { ...input, confirmResults: false });
    expect(competition.guard).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-a',
      match.id,
      null,
      false,
    );
    expect(result.status).toBe('AWAITING_CONFIRMATION');
    expect(competition.guard.mock.invocationCallOrder[0]).toBeLessThan(
      tx.matchMapAction.updateMany.mock.invocationCallOrder[0],
    );
    expect(competition.advance).not.toHaveBeenCalled();
  });
  it('permits a reviewed correction with no downstream changes and advances only after persisting confirmation', async () => {
    const { tx, actor, input, match } = workbookFixture({ changedWinner: true });
    const result = await applyWorkbook(actor, input);
    expect(result.status).toBe('COMPLETED');
    expect(competition.guard).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-a',
      match.id,
      'B',
      false,
    );
    expect(competition.advance).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-a',
      match.id,
      actor.id,
    );
    expect(competition.guard.mock.invocationCallOrder[0]).toBeLessThan(
      tx.matchMapAction.updateMany.mock.invocationCallOrder[0],
    );
    expect(tx.match.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      competition.advance.mock.invocationCallOrder[0],
    );
  });
  it('keeps same-outcome timeline imports confirmed without issuing a correction or editing child participants', async () => {
    const { tx, actor, input, match } = workbookFixture();
    expect((await applyWorkbook(actor, { ...input, confirmResults: false })).status).toBe(
      'COMPLETED',
    );
    expect(competition.guard).not.toHaveBeenCalled();
    expect(competition.advance).toHaveBeenCalledTimes(1);
    expect(tx.match.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.match.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: match.id } });
    expect(tx.match.updateMany.mock.calls[0][0].data).not.toHaveProperty('participants');
  });
  it('advances a newly confirmed result but never a provisional import', async () => {
    const confirmed = workbookFixture({ status: 'SCHEDULED' });
    expect((await applyWorkbook(confirmed.actor, confirmed.input)).status).toBe('COMPLETED');
    expect(competition.guard).not.toHaveBeenCalled();
    expect(competition.advance).toHaveBeenCalledTimes(1);
    const provisional = workbookFixture({ status: 'SCHEDULED' });
    expect(
      (await applyWorkbook(provisional.actor, { ...provisional.input, confirmResults: false }))
        .status,
    ).toBe('AWAITING_CONFIRMATION');
    expect(competition.guard).not.toHaveBeenCalled();
    expect(competition.advance).not.toHaveBeenCalled();
  });
  it('does not re-run advancement for an idempotent completed reimport', async () => {
    const { tx, actor, input } = workbookFixture({ alreadyImported: true });
    expect((await applyWorkbook(actor, input)).alreadyApplied).toBe(true);
    expect(tx.match.updateMany).not.toHaveBeenCalled();
    expect(competition.guard).not.toHaveBeenCalled();
    expect(competition.advance).not.toHaveBeenCalled();
  });
});
