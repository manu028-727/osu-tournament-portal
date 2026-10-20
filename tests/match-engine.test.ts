import { describe, it, expect } from 'vitest';
import { matchRulesSchema, firstTo } from '../src/lib/match-rules';
import {
  nextDraftStep,
  validateDraftAction,
  aggregateScores,
  convertedScore,
  lobbyCommands,
  matchWorkflow,
  replayDraft,
  startingSide,
  type DraftState,
  type DraftAction,
} from '../src/lib/match-engine';
const rules = (extra = {}) => matchRulesSchema.parse({ ...extra });
const action = (
  kind: DraftAction['kind'],
  side: 'A' | 'B',
  slotName: string,
  category = 'NM',
): DraftAction => ({ id: slotName, kind, side, slotName, category, voided: false });
const state = (extra: Partial<DraftState> = {}): DraftState => ({
  firstPickSide: 'A',
  firstBanSide: 'A',
  scoreA: 0,
  scoreB: 0,
  actions: [],
  pendingPick: false,
  ...extra,
});
const slots = ['NM1', 'NM2', 'HR1', 'HR2', 'HD1', 'TB'].map((name, i) => ({
  name,
  category: name.replace(/\d+$/, ''),
  beatmapId: i + 1,
}));
describe('configured referee match engine', () => {
  it.each(['AB', 'ABAB', 'ABBA'] as const)(
    'enforces %s bans with either relative starter',
    (order) => {
      for (const first of ['A', 'B'] as const) {
        const r = rules({ banOrder: order, bansPerTeam: order === 'AB' ? 1 : 2 }),
          actions: DraftAction[] = [];
        for (const [index, letter] of [...order].entries()) {
          const side = letter === 'A' ? first : first === 'A' ? 'B' : 'A';
          expect(nextDraftStep(r, state({ actions, firstBanSide: first }))).toEqual({
            kind: 'BAN',
            side,
          });
          actions.push(action('BAN', side, `NM${index + 1}`));
        }
        expect(nextDraftStep(r, state({ actions, firstBanSide: first }))).toEqual({
          kind: 'PICK',
          side: 'A',
        });
      }
    },
  );
  it('publishes one authoritative phase, eligibility and pending-result state', () => {
    const r = rules({ bansPerTeam: 0, bestOf: 3 }),
      s = state();
    expect(matchWorkflow(r, s, slots, 'SCHEDULED', null).phase).toBe('PREPARATION');
    expect(matchWorkflow(r, state({ firstBanSide: null }), slots, 'IN_PROGRESS', null).phase).toBe(
      'ROLL',
    );
    const w = matchWorkflow(r, s, slots, 'IN_PROGRESS', null);
    expect(w.phase).toBe('PICK');
    expect(w.eligibleSlots).not.toContain('TB');
    expect(
      matchWorkflow(r, state({ scoreA: 1, scoreB: 1 }), slots, 'IN_PROGRESS', null),
    ).toMatchObject({ phase: 'TIEBREAKER', eligibleSlots: ['TB'] });
    expect(
      matchWorkflow(r, state({ pendingPick: true }), slots, 'IN_PROGRESS', 'pick'),
    ).toMatchObject({ phase: 'RESULT', currentActionId: 'pick', eligibleSlots: [] });
    expect(matchWorkflow(r, state({ scoreA: 2 }), slots, 'IN_PROGRESS', null).phase).toBe('REVIEW');
  });
  it('applies fixed and roll-relative starting rules and rejects impossible no-roll settings', () => {
    expect(startingSide('ROLL_LOSER', 80, 20, 'A')).toBe('B');
    expect(startingSide('ROLL_WINNER', 20, 80, 'A')).toBe('B');
    expect(startingSide('BLUE', 80, 20, 'A')).toBe('B');
    expect(() => rules({ rollRequired: false })).toThrow('Without a roll');
    expect(() => rules({ banOrder: 'AB', bansPerTeam: 2 })).toThrow('one ban');
  });
  it('rejects a corrected winner that makes a later tiebreaker illegal', () => {
    const r = rules({ bestOf: 3, bansPerTeam: 0, pickOrder: 'ABAB' }),
      actions = [
        action('PICK', 'A', 'NM1'),
        action('PICK', 'B', 'NM2'),
        action('PICK', 'A', 'TB', 'TB'),
      ];
    const result = (actionId: string, winnerSide: 'A' | 'B') => ({
      actionId,
      winnerSide,
      voided: false,
    });
    expect(
      replayDraft(r, state(), slots, actions, [result('NM1', 'A'), result('NM2', 'B')]).pendingPick,
    ).toBe(true);
    expect(() =>
      replayDraft(r, state(), slots, actions, [result('NM1', 'A'), result('NM2', 'A')]),
    ).toThrow('turn');
  });
  it('uses separate protect starts and interleaved spreadsheet action pairs', () => {
    const r = rules({
      bestOf: 3,
      bansPerTeam: 1,
      protectsPerTeam: 1,
      draftSequence: ['PROTECT', 'PICK', 'BAN'],
      pickOrder: 'ABAB',
    });
    const actions: DraftAction[] = [];
    const expected = [
      ['PROTECT', 'B'],
      ['PROTECT', 'A'],
      ['PICK', 'A'],
      ['PICK', 'B'],
      ['BAN', 'A'],
      ['BAN', 'B'],
      ['PICK', 'A'],
    ] as const;
    for (const [kind, side] of expected) {
      expect(nextDraftStep(r, state({ firstProtectSide: 'B', actions }))).toEqual({ kind, side });
      actions.push(action(kind, side, `NM${actions.length + 1}`));
    }
    expect(() => rules({ bestOf: 9, draftSequence: ['PICK'] })).toThrow('Best-of');
  });
  it('supports a separate pair of tiebreaker bans and enforces its map category', () => {
    const r = rules({ bestOf: 1, bansPerTeam: 0, draftSequence: ['TB_BAN'] });
    const s = state();
    expect(nextDraftStep(r, s)).toMatchObject({ kind: 'BAN', tiebreakerOnly: true });
    expect(nextDraftStep(r, state({ firstBanSide: 'B' }))).toMatchObject({
      kind: 'BAN',
      side: 'A',
      tiebreakerOnly: true,
    });
    expect(() =>
      validateDraftAction(r, s, slots, { kind: 'BAN', side: 'A', slotName: 'NM1' }),
    ).toThrow('tiebreaker map');
  });
  it('matches complete combinations without multiplying or rounding spreadsheet modes', () => {
    const r = rules({
      multiplierMode: 'UNIVERSAL',
      modMultipliers: { HD: 2, HR: 3, HDHR: 1 / 1.06 },
    });
    expect(convertedScore(r, 101, ['HD', 'HR', 'NF'])).toEqual({
      multiplier: 1 / 1.06,
      adjusted: 101 / 1.06,
    });
    expect(convertedScore(r, 101, ['EZ', 'HD'])).toEqual({ multiplier: 1, adjusted: 101 });
    const custom = rules({
      multiplierMode: 'CUSTOM',
      slotModMultipliers: [{ slot: 'FM2', mods: 'HDHR', multiplier: 1.25 }],
    });
    expect(convertedScore(custom, 101, ['HR', 'HD'], 'FM2').adjusted).toBe(126.25);
    expect(convertedScore(custom, 101, ['HR', 'HD'], 'FM1').adjusted).toBe(101);
    expect(
      convertedScore(rules({ modMultipliers: { HD: 1.3, HR: 1.1 } }), 101, ['HD', 'HR']).adjusted,
    ).toBe(144);
  });
  it('validates odd best-of formats and calculates the win target', () => {
    expect(() => rules({ bestOf: 8 })).toThrow();
    expect(firstTo(rules({ bestOf: 13 }))).toBe(7);
  });
  it('requires rolls and enforces ABBA ban order for either starting team', () => {
    expect(nextDraftStep(rules(), state({ firstPickSide: null }))).toEqual({
      kind: 'ROLL',
      side: null,
    });
    const actions: DraftAction[] = [];
    for (const [i, side] of (['B', 'A', 'A', 'B'] as const).entries()) {
      expect(nextDraftStep(rules(), state({ firstBanSide: 'B', actions }))).toEqual({
        kind: 'BAN',
        side,
      });
      actions.push(action('BAN', side, 'NM' + i));
    }
    expect(nextDraftStep(rules(), state({ actions }))).toEqual({ kind: 'PICK', side: 'A' });
  });
  it('protects maps from bans while allowing a protected map to be picked', () => {
    const r = rules({ protectsPerTeam: 1, bansPerTeam: 0 });
    expect(nextDraftStep(r, state())).toEqual({ kind: 'PROTECT', side: 'A' });
    const protectedState = state({
      actions: [action('PROTECT', 'A', 'HR1'), action('PROTECT', 'B', 'HD1')],
    });
    expect(
      validateDraftAction(r, protectedState, slots, { kind: 'PICK', side: 'A', slotName: 'HR1' })
        .name,
    ).toBe('HR1');
    expect(() =>
      validateDraftAction(rules({ protectsPerTeam: 1 }), protectedState, slots, {
        kind: 'BAN',
        side: 'A',
        slotName: 'HR1',
      }),
    ).toThrow('protected');
  });
  it('rejects unavailable maps, out-of-turn picks, and duplicate category picks', () => {
    const r = rules({ bansPerTeam: 0, pickOrder: 'ABAB' });
    const s = state({
      actions: [action('PICK', 'A', 'HR1', 'HR'), action('PICK', 'B', 'HD1', 'HD')],
    });
    expect(() =>
      validateDraftAction(r, s, slots, { kind: 'PICK', side: 'B', slotName: 'NM1' }),
    ).toThrow('turn');
    expect(() =>
      validateDraftAction(r, s, slots, { kind: 'PICK', side: 'A', slotName: 'HR1' }),
    ).toThrow('already');
    expect(() =>
      validateDraftAction(r, s, slots, { kind: 'PICK', side: 'A', slotName: 'HR2' }),
    ).toThrow('Consecutive');
    expect(
      validateDraftAction(r, s, slots, { kind: 'PICK', side: 'A', slotName: 'NM1' }).name,
    ).toBe('NM1');
    expect(nextDraftStep(r, state({ ...s, pendingPick: true }))).toBeNull();
  });
  it('only unlocks the tiebreaker at match point and stops after a winning score', () => {
    const r = rules({ bestOf: 3, bansPerTeam: 0 });
    expect(() =>
      validateDraftAction(r, state(), slots, { kind: 'PICK', side: 'A', slotName: 'TB' }),
    ).toThrow('not available');
    const s = state({ scoreA: 1, scoreB: 1 });
    expect(() =>
      validateDraftAction(r, s, slots, { kind: 'PICK', side: 'A', slotName: 'NM1' }),
    ).toThrow('tiebreaker');
    expect(validateDraftAction(r, s, slots, { kind: 'PICK', side: 'A', slotName: 'TB' }).name).toBe(
      'TB',
    );
    expect(nextDraftStep(r, state({ scoreA: 2 }))).toBeNull();
  });
  it('keeps manual aggregate scoring independent and rejects ties', () => {
    expect(aggregateScores(rules(), 'NM', [], { A: [], B: [] }, 100, 90)).toMatchObject({
      winnerSide: 'A',
      scoreA: 100,
    });
    expect(() => aggregateScores(rules(), 'NM', [], { A: [], B: [] }, 100, 100)).toThrow('Tied');
  });
  it('applies individual multipliers, checks rosters, NoFail and FreeMod requirements', () => {
    const r = rules(),
      roster = { A: [1, 2], B: [3, 4] };
    const players = [
      { osuId: 1, side: 'A' as const, score: 300, mods: ['EZ', 'NF'] },
      { osuId: 2, side: 'A' as const, score: 400, mods: ['HR', 'NF'] },
      { osuId: 3, side: 'B' as const, score: 500, mods: ['HD', 'NF'] },
      { osuId: 4, side: 'B' as const, score: 400, mods: ['HR', 'NF'] },
    ];
    expect(aggregateScores(r, 'FM', players, roster, 0, 0)).toEqual({
      scoreA: 1000,
      scoreB: 900,
      winnerSide: 'A',
    });
    expect(() =>
      aggregateScores(
        r,
        'FM',
        players.map((p) => ({ ...p, mods: p.mods.filter((m) => m !== 'NF') })),
        roster,
        0,
        0,
      ),
    ).toThrow('NoFail');
    expect(() =>
      aggregateScores(
        r,
        'FM',
        players.map((p) => ({ ...p, mods: ['HD', 'NF'] })),
        roster,
        0,
        0,
      ),
    ).toThrow('FreeMod');
    expect(() => aggregateScores(r, 'FM', players, { A: [9, 2], B: [3, 4] }, 0, 0)).toThrow(
      'roster',
    );
  });
  it('produces clipboard commands with real map IDs, game mode and safe single-line names', () => {
    const commands = lobbyCommands(
      rules(),
      'TEST',
      { code: 'R1', teamA: 'A\n!mp abort', teamB: 'B' },
      slots[2],
    );
    expect(commands.settings).toBe('!mp set 2 3 5');
    expect(commands.map).toBe('!mp map 3 0');
    expect(commands.mods).toBe('!mp mods NF HR');
    expect(commands.make).not.toContain('\n');
    for (const [index, gameMode] of ['osu', 'taiko', 'fruits', 'mania'].entries())
      expect(
        lobbyCommands(rules({ gameMode }), 'CUP', { code: '1', teamA: 'A', teamB: 'B' }, slots[0])
          .map,
      ).toBe(`!mp map 1 ${index}`);
    expect(
      lobbyCommands(
        rules({ enforceNoFail: false }),
        'CUP',
        { code: '1', teamA: 'A', teamB: 'B' },
        slots[0],
      ).mods,
    ).toBe('!mp mods None');
    expect(
      lobbyCommands(rules({ teamMode: 'TAG_TEAM_VS', scoreMode: 'ACCURACY', teamSize: 8 }), 'CUP', {
        code: '1',
        teamA: 'A',
        teamB: 'B',
      }).settings,
    ).toBe('!mp set 3 1 16');
  });
  it('rejects invalid score ranges and incompatible mod combinations', () => {
    expect(() => aggregateScores(rules(), 'NM', [], { A: [], B: [] }, -1, 1)).toThrow(
      'non-negative',
    );
    expect(() => aggregateScores(rules(), 'NM', [], { A: [], B: [] }, Infinity, 1)).toThrow(
      'non-negative',
    );
    const players = [
      { osuId: 1, side: 'A' as const, score: 100, mods: ['NF', 'EZ', 'HR'] },
      { osuId: 2, side: 'B' as const, score: 99, mods: ['NF'] },
    ];
    expect(() =>
      aggregateScores(rules({ teamSize: 1 }), 'NM', players, { A: [1], B: [2] }, 0, 0),
    ).toThrow('incompatible');
    expect(() =>
      aggregateScores(
        rules({ teamSize: 1, modMultipliers: { NM: 10 } }),
        'NM',
        players.map((p) => ({ ...p, score: Number.MAX_SAFE_INTEGER, mods: ['NF'] })),
        { A: [1], B: [2] },
        0,
        0,
      ),
    ).toThrow('score range');
  });
});
