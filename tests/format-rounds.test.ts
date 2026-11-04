import { describe, expect, it } from 'vitest';
import { generateCompetition } from '../src/lib/competition-engine';
import {
  automaticRoundStages,
  roundStageConflict,
  winnersRoundEntrants,
} from '../src/lib/format-rounds';
import { poolForBestOf, poolPlanSlots } from '../src/lib/format-templates';
import {
  mapsNeeded,
  newMapTypeOperations,
  poolCounts,
  resizedPool,
} from '../src/lib/setup-operations';

const stages = (...names: string[]) =>
  names.map((name) => ({ id: name.toLowerCase().replace(/\s/g, '-'), name, kind: 'ELIMINATION' }));
const FIVE = stages('Round of 16', 'Quarterfinals', 'Semifinals', 'Finals', 'Grand Finals');

const roundsOf = async (format: 'SINGLE_ELIMINATION' | 'DOUBLE_ELIMINATION', size: number) =>
  (
    await generateCompetition({
      format,
      teamIds: Array.from({ length: size }, (_, index) => `team-${index}`),
      groupCount: 1,
      stageId: 'anchor',
      thirdPlace: format === 'SINGLE_ELIMINATION',
      grandFinalReset: true,
      roundStages: {},
    })
  ).rounds.map(({ key, lane }) => ({ key, lane }));

describe('which stage each round plays in', () => {
  it('uses every stage of a 16-team double elimination, by name', async () => {
    const rounds = await roundsOf('DOUBLE_ELIMINATION', 16);
    const map = automaticRoundStages('round-of-16', rounds, FIVE);
    // Winners: one stage per round.
    expect(['g1-r1', 'g1-r2', 'g1-r3', 'g1-r4'].map((key) => map[key])).toEqual([
      'round-of-16',
      'quarterfinals',
      'semifinals',
      'finals',
    ]);
    // Losers rounds share the stage of the Winners round played alongside them.
    expect(map['g2-r1']).toBe('round-of-16');
    expect(map['g2-r2']).toBe('quarterfinals');
    expect(map['g2-r3']).toBe('quarterfinals');
    expect(map['g2-r6']).toBe('finals');
    expect(map['g3-r1']).toBe('grand-finals');
    expect(map['g3-r2']).toBe('grand-finals');
    expect(new Set(Object.values(map)).size).toBe(5);
  });

  it('starts at the right stage whatever the bracket size, not at the first in the list', async () => {
    const rounds = await roundsOf('DOUBLE_ELIMINATION', 8);
    const map = automaticRoundStages('round-of-16', rounds, FIVE);
    expect(['g1-r1', 'g1-r2', 'g1-r3'].map((key) => map[key])).toEqual([
      'quarterfinals',
      'semifinals',
      'finals',
    ]);
    expect(map['g3-r1']).toBe('grand-finals');
  });

  it('does not run a single elimination final into Grand Finals', async () => {
    const rounds = await roundsOf('SINGLE_ELIMINATION', 16);
    const map = automaticRoundStages('round-of-16', rounds, FIVE);
    expect(map['g1-r4']).toBe('finals');
    expect(Object.values(map)).not.toContain('grand-finals');
    // The third-place match is played alongside the final.
    const third = rounds.find((round) => round.lane === 'THIRD_PLACE')!;
    expect(map[third.key]).toBe('finals');
  });

  it.each([
    [['RO16', 'QF', 'SF', 'F', 'GF']],
    [['Ottavi', 'Quarti', 'Semifinali', 'Finale', 'Finalissima']],
    [['round of 16', 'QUARTERFINALS', 'semifinals', 'finals', 'GRAND FINALS']],
  ])('recognizes the stage names %j', async (names) => {
    const list = stages(...names);
    const map = automaticRoundStages(list[0].id, await roundsOf('DOUBLE_ELIMINATION', 16), list);
    expect(map['g1-r1']).toBe(list[0].id);
    expect(map['g1-r2']).toBe(list[1].id);
    expect(map['g1-r3']).toBe(list[2].id);
    expect(map['g1-r4']).toBe(list[3].id);
    expect(map['g3-r1']).toBe(list[4].id);
  });

  it('runs through the list in order when names say nothing', async () => {
    const list = stages('Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5');
    const map = automaticRoundStages(list[0].id, await roundsOf('DOUBLE_ELIMINATION', 16), list);
    expect(['g1-r1', 'g1-r2', 'g1-r3', 'g1-r4', 'g3-r1'].map((key) => map[key])).toEqual(
      list.map((stage) => stage.id),
    );
  });

  it('shares the earliest stage when there are fewer stages than rounds', async () => {
    const list = stages('Quarterfinals', 'Semifinals', 'Finals', 'Grand Finals');
    const map = automaticRoundStages(list[0].id, await roundsOf('DOUBLE_ELIMINATION', 16), list);
    expect(map['g1-r1']).toBe('quarterfinals');
    expect(map['g1-r2']).toBe('quarterfinals');
    expect(map['g1-r3']).toBe('semifinals');
  });

  it('never plays a bracket in a group stage', async () => {
    const list = [{ id: 'groups', name: 'Group stage', kind: 'GROUPS' }, ...FIVE];
    const map = automaticRoundStages('groups', await roundsOf('DOUBLE_ELIMINATION', 16), list);
    expect(Object.values(map)).not.toContain('groups');
  });

  it('keeps group rounds in the stage their phase names', () => {
    const rounds = [{ key: 'g1-r1', lane: 'GROUP_1' }];
    expect(automaticRoundStages('groups', rounds, FIVE)).toEqual({ 'g1-r1': 'groups' });
  });

  it('never moves backwards, even if stages are listed out of order', async () => {
    const list = stages('Finals', 'Semifinals', 'Quarterfinals', 'Round of 16');
    const rounds = await roundsOf('SINGLE_ELIMINATION', 16);
    const map = automaticRoundStages(list[0].id, rounds, list);
    const lane = rounds.filter((round) => round.lane === 'WINNERS');
    const order = lane.map((round) => list.findIndex((stage) => stage.id === map[round.key]));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('counts the entrants a Winners round starts with', async () => {
    const rounds = await roundsOf('DOUBLE_ELIMINATION', 16);
    const winners = rounds.filter((round) => round.lane === 'WINNERS');
    expect(winners.map((round) => winnersRoundEntrants(round, rounds))).toEqual([16, 8, 4, 2]);
  });
});

describe('a chosen stage that runs backwards', () => {
  const rounds = (first: string, second: string) => [
    { key: 'g1-r1', lane: 'WINNERS', stageId: first },
    { key: 'g1-r2', lane: 'WINNERS', stageId: second },
  ];
  it('is reported', () => {
    expect(roundStageConflict(rounds('finals', 'semifinals'), FIVE)?.key).toBe('g1-r2');
  });
  it('allows two rounds to share a stage, or skip ahead', () => {
    expect(roundStageConflict(rounds('finals', 'finals'), FIVE)).toBeNull();
    expect(roundStageConflict(rounds('round-of-16', 'finals'), FIVE)).toBeNull();
  });
});

describe('map counts on the stage grid', () => {
  it('counts any map type a tournament uses, and keeps ones a saved plan already has', () => {
    expect(poolCounts([{ category: 'RX' }, { category: 'NM' }], ['NM', 'RX', 'HD'])).toEqual({
      NM: 1,
      RX: 1,
      HD: 0,
    });
    expect(poolCounts([{ category: 'ZZ' }], ['NM'])).toEqual({ NM: 0, ZZ: 1 });
  });

  it('names slots for any map type, in the order given', () => {
    expect(poolPlanSlots({ RX: 2, TB: 1 })).toEqual([
      { name: 'RX1', category: 'RX' },
      { name: 'RX2', category: 'RX' },
      { name: 'TB', category: 'TB' },
    ]);
  });

  it('works out how many maps a stage needs from its Best of and bans', () => {
    expect(mapsNeeded(9, 1)).toBe(11);
    expect(mapsNeeded(13, 2)).toBe(17);
    expect(mapsNeeded(null, null)).toBe(0);
  });

  it('resizes a pool still on the defaults, and leaves one changed by hand alone', () => {
    const standard = { ...poolForBestOf(9), RX: 0 };
    expect(resizedPool(standard, 9, 13)).toEqual({ ...poolForBestOf(13), RX: 0 });
    const edited = { ...standard, DT: 7 };
    expect(resizedPool(edited, 9, 13)).toEqual(edited);
    const withRelax = { ...standard, RX: 2 };
    expect(resizedPool(withRelax, 9, 13)).toEqual(withRelax);
  });
});

describe('adding a map type', () => {
  const data = {
    categories: ['NM', 'HD'],
    rules: { categoryMods: { NM: '', HD: 'HD' } },
    stages: [],
    defaultsHash: 'a'.repeat(64),
  } as never;
  const rulesOf = (operations: readonly unknown[]) =>
    (
      operations.find((item) => (item as { type: string }).type === 'match.rules.save') as {
        rules: { categoryMods: Record<string, string> };
      }
    ).rules.categoryMods;

  it('creates the category and tells the rules about it, with its mod if it is one', () => {
    const operations = newMapTypeOperations('RX', data);
    expect(operations[0]).toMatchObject({ type: 'category.save', acronym: 'RX', position: 2 });
    expect(rulesOf(operations)).toEqual({ NM: '', HD: 'HD', RX: 'RX' });
  });

  it('adds a type that is not a mod with no forced mods', () => {
    expect(rulesOf(newMapTypeOperations('SPECIAL', data)).SPECIAL).toBe('');
  });
});
