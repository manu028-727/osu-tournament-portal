import { describe, expect, it } from 'vitest';
import {
  competitionEliminated,
  generateCompetition,
  recalculateCompetition,
} from '../src/lib/competition-engine';
import type { CompetitionNode, CompetitionRound } from '../src/lib/competition-types';
import {
  avoidRematches,
  bindGroups,
  bindSeats,
  drawGroups,
  rankGroups,
  reseededPairs,
  resolveEntries,
  sharedGroup,
  type AdvancementSeat,
  type DrawnGroup,
  type GroupsPhase,
  type SourceEntrant,
} from '../src/lib/format-advancement';
import {
  lanePairs,
  phaseGraph,
  phaseRoundStages,
  standardBracketOrder,
  type PhaseGraph,
} from '../src/lib/format-graph';
import { formatPlanSchema, type FormatPhase } from '../src/lib/format-plan';
import { COMPATIBILITY_PLANS } from './fixtures/format-plans';

type Elimination = Extract<FormatPhase, { kind: 'SINGLE_ELIMINATION' | 'DOUBLE_ELIMINATION' }>;
const plan = (name: keyof typeof COMPATIBILITY_PLANS) =>
  formatPlanSchema.parse(COMPATIBILITY_PLANS[name]).phases;
const phaseOf = <T extends FormatPhase>(phases: FormatPhase[], key: string) =>
  phases.find((phase) => phase.key === key) as T;
const entrants = (count: number): SourceEntrant[] =>
  Array.from({ length: count }, (_, i) => ({
    teamId: `team-${i + 1}`,
    seed: i + 1,
    value: 1000 - i,
    status: 'ACTIVE',
  }));

// An in-memory bracket driven by the same evaluation the database path uses.
function live(graph: PhaseGraph) {
  const rounds: CompetitionRound[] = graph.rounds.map((round) => ({ ...round, id: round.key }));
  let nodes: CompetitionNode[] = graph.nodes.map((node) => ({
    id: node.key,
    bracketId: 'bracket',
    roundId: node.roundKey,
    key: node.key,
    position: node.position,
    matchNumber: null,
    state: 'WAITING',
    matchId: null,
    match: null,
    slots: node.slots.map((slot) => ({
      side: slot.side,
      teamId: slot.teamId,
      resolved: slot.resolved,
      mode: slot.mode,
      sourceNodeId: slot.sourceKey,
      outcome: slot.outcome,
    })),
  }));
  nodes = recalculateCompetition(nodes);
  const pair = (key: string) => nodes.find((node) => node.key === key)!.slots.map((s) => s.teamId);
  const play = (
    key: string,
    winnerSide: 'A' | 'B',
    extra: { scoreA?: number; scoreB?: number; forfeitSide?: 'A' | 'B' | null } = {},
  ) => {
    nodes = recalculateCompetition(
      nodes.map((node) =>
        node.key !== key
          ? node
          : {
              ...node,
              match: {
                id: `m-${key}`,
                code: key,
                status: 'COMPLETED',
                teamAId: node.slots[0].teamId,
                teamBId: node.slots[1].teamId,
                scoreA: extra.scoreA ?? (winnerSide === 'A' ? 5 : 2),
                scoreB: extra.scoreB ?? (winnerSide === 'B' ? 5 : 2),
                winnerSide,
                forfeitSide: extra.forfeitSide ?? null,
                version: 1,
              },
            },
      ),
    );
  };
  return {
    rounds,
    get nodes() {
      return nodes;
    },
    pair,
    play,
  };
}
const inRound = (bracket: { nodes: CompetitionNode[] }, roundId: string) =>
  bracket.nodes
    .filter((node) => node.roundId === roundId)
    .sort((a, b) => a.position - b.position)
    .map((node) => node.slots.map((slot) => slot.teamId));

// Plays every group so the top seed in each wins, unless a result is overridden.
function playGroups(
  bracket: ReturnType<typeof live>,
  drawn: readonly DrawnGroup[],
  winner: (a: string, b: string) => string = (a, b) => {
    const seedOf = (id: string) =>
      drawn.flatMap((group) => group.teams).find((team) => team.teamId === id)!.seed;
    return seedOf(a) < seedOf(b) ? a : b;
  },
) {
  for (const node of bracket.nodes) {
    const [a, b] = node.slots.map((slot) => slot.teamId!);
    bracket.play(node.key, winner(a, b) === a ? 'A' : 'B');
  }
}

describe('bracket tree order', () => {
  it('matches the published double-elimination RO16 order', () => {
    expect(standardBracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(standardBracketOrder(16)).toEqual([
      1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11,
    ]);
  });

  it('gives byes to the best seeds, not alternating ones', () => {
    const seats = Array.from({ length: 12 }, (_, i) => i + 1);
    const byes = lanePairs(16, 'STANDARD', seats)
      .filter((pair) => pair.includes(null))
      .map((pair) => pair.find((seed) => seed !== null));
    expect(byes.sort()).toEqual([1, 2, 3, 4]);
  });
});

describe('byes in brackets created without a phase', () => {
  const firstRoundByes = async (byePlacement?: 'BALANCED' | 'TOP_SEEDS') => {
    const plan = await generateCompetition({
      format: 'SINGLE_ELIMINATION',
      teamIds: entrants(12).map((entrant) => entrant.teamId),
      stageId: 'stage',
      thirdPlace: false,
      grandFinalReset: false,
      groupCount: 1,
      roundStages: {},
      ...(byePlacement ? { byePlacement } : {}),
    });
    return plan.nodes
      .filter((node) => node.roundKey === 'g1-r1' && node.slots.some((slot) => !slot.teamId))
      .map((node) => node.slots.find((slot) => slot.teamId)!.teamId)
      .sort();
  };

  it('gives new brackets their byes on the best seeds', async () => {
    expect(await firstRoundByes('TOP_SEEDS')).toEqual(['team-1', 'team-2', 'team-3', 'team-4']);
  });

  it('keeps the saved placement of brackets generated before this choice existed', async () => {
    const saved = await firstRoundByes();
    expect(saved).toEqual(await firstRoundByes('BALANCED'));
    expect(saved).toEqual(['team-1', 'team-3', 'team-5', 'team-7']);
  });

  it('rejects a third-place match for two entrants instead of crashing', async () => {
    await expect(
      generateCompetition({
        format: 'SINGLE_ELIMINATION',
        teamIds: entrants(2).map((entrant) => entrant.teamId),
        stageId: 'stage',
        thirdPlace: true,
        grandFinalReset: false,
        groupCount: 1,
        roundStages: {},
      }),
    ).rejects.toThrow('third-place match');
  });
});

describe('standard double elimination', () => {
  it('keeps the library graph, only replacing who sits where', async () => {
    const phases = plan('oidc');
    const graph = await phaseGraph(phases, phaseOf<Elimination>(phases, 'main'));
    const standard = await generateCompetition({
      format: 'DOUBLE_ELIMINATION',
      teamIds: entrants(16).map((entrant) => entrant.teamId),
      stageId: 'stage-ro16',
      thirdPlace: false,
      grandFinalReset: true,
      groupCount: 1,
      roundStages: {},
    });
    expect(graph.nodes.map((node) => node.key)).toEqual(standard.nodes.map((node) => node.key));
    const routes = (nodes: PhaseGraph['nodes']) =>
      nodes.flatMap((node) =>
        node.slots
          .filter((slot) => slot.sourceKey)
          .map((slot) => `${slot.sourceKey}>${slot.outcome}>${node.key}:${slot.side}`),
      );
    expect(routes(graph.nodes)).toEqual(routes(standard.nodes));
  });

  it('seats sixteen qualifiers in published order and plays through a bracket reset', async () => {
    const phases = plan('oidc');
    const main = phaseOf<Elimination>(phases, 'main');
    const { seats, issues } = resolveEntries(main, { qualifiers: { qualifiers: entrants(16) } });
    expect(issues).toEqual([]);
    const bracket = live(bindSeats(await phaseGraph(phases, main), seats));
    expect(bracket.pair('g1-r1-m1')).toEqual(['team-1', 'team-16']);
    expect(bracket.pair('g1-r1-m8')).toEqual(['team-6', 'team-11']);
    // Reach Grand Finals with Winners and Losers champions decided by top sides.
    for (const node of bracket.nodes.filter((n) => !n.roundId.startsWith('g3')))
      if (node.state !== 'SKIPPED') bracket.play(node.key, 'A');
    const final = bracket.nodes.find((node) => node.roundId === 'g3-r1')!;
    expect(final.slots.every((slot) => slot.teamId)).toBe(true);
    const reset = () => bracket.nodes.find((node) => node.roundId === 'g3-r2')!;
    expect(reset().state).toBe('WAITING');
    bracket.play(final.key, 'B');
    expect(reset().state).toBe('READY');
    expect(
      reset()
        .slots.map((slot) => slot.teamId)
        .sort(),
    ).toEqual(final.slots.map((slot) => slot.teamId).sort());
  });

  it('skips the reset when the Winners finalist wins Grand Finals', async () => {
    const phases = plan('oidc');
    const main = phaseOf<Elimination>(phases, 'main');
    const { seats } = resolveEntries(main, { qualifiers: { qualifiers: entrants(16) } });
    const bracket = live(bindSeats(await phaseGraph(phases, main), seats));
    for (const node of bracket.nodes.filter((n) => !n.roundId.startsWith('g3')))
      if (node.state !== 'SKIPPED') bracket.play(node.key, 'A');
    bracket.play('g3-r1-m1', 'A');
    expect(bracket.nodes.find((node) => node.roundId === 'g3-r2')!.state).toBe('SKIPPED');
  });

  it('awards byes to the best seeds when fewer entrants arrive than the bracket seats', async () => {
    const phases = plan('oidc');
    const main = phaseOf<Elimination>(phases, 'main');
    const { seats, issues } = resolveEntries(main, { qualifiers: { qualifiers: entrants(12) } });
    expect(issues.filter((issue) => issue.code === 'NOT_ENOUGH_ENTRANTS')).toHaveLength(4);
    const bracket = live(bindSeats(await phaseGraph(phases, main), seats));
    expect(bracket.nodes.find((node) => node.key === 'g1-r1-m1')!.state).toBe('BYE');
    // The bye advances without anyone playing.
    expect(bracket.pair('g1-r2-m1')[0]).toBe('team-1');
  });
});

describe('OWC 2025 compatibility', () => {
  const phases = plan('owc');
  const groups = phaseOf<GroupsPhase>(phases, 'groups');
  const main = phaseOf<Elimination>(phases, 'main');
  const pool = entrants(40);

  // Draws are live events, so these are entered by hand. Average %MAX then orders the
  // labels, so this table is built to produce A-D and E-H in a known order.
  const manual = {
    challengers: [
      ['team-9', 'team-13', 'team-17', 'team-21'],
      ['team-10', 'team-14', 'team-18', 'team-22'],
      ['team-11', 'team-15', 'team-19', 'team-23'],
      ['team-12', 'team-16', 'team-20', 'team-24'],
    ],
    contenders: [
      ['team-25', 'team-29', 'team-33', 'team-37'],
      ['team-26', 'team-30', 'team-34', 'team-38'],
      ['team-27', 'team-31', 'team-35', 'team-39'],
      ['team-28', 'team-32', 'team-36', 'team-40'],
    ],
  };

  it('splits two tiers into pots and labels groups by average qualifier value', () => {
    const { groups: drawn, issues } = drawGroups(groups, pool, { manual });
    expect(issues).toEqual([]);
    expect(drawn.map((group) => group.label)).toEqual([
      'Group A',
      'Group B',
      'Group C',
      'Group D',
      'Group E',
      'Group F',
      'Group G',
      'Group H',
    ]);
    expect(drawn[0].teams.map((team) => team.pot)).toEqual([0, 1, 2, 3]);
  });

  it('labels by qualifier strength, not draw order', () => {
    const reversed = {
      ...manual,
      challengers: [...manual.challengers].reverse(),
    };
    const { groups: drawn } = drawGroups(groups, pool, { manual: reversed });
    const strongest = drawn.find((group) => group.label === 'Group A')!;
    expect(strongest.teams.map((team) => team.seed)).toEqual([9, 13, 17, 21]);
    expect(strongest.group).toBe(4);
  });

  it('produces the exact published Round of 16 table', async () => {
    const { groups: drawn } = drawGroups(groups, pool, { manual });
    const groupBracket = live(bindGroups(await phaseGraph(phases, groups), drawn));
    playGroups(groupBracket, drawn);
    const ranked = rankGroups(groups, groupBracket.nodes, groupBracket.rounds, pool);
    expect(ranked.complete).toBe(true);
    const { seats, issues } = resolveEntries(main, {
      qualifiers: { qualifiers: pool },
      groups: { groups: { phase: groups, drawn, rows: ranked.rows, complete: true } },
    });
    expect(issues).toEqual([]);
    const label = (seed: number) => seats.find((seat) => seat.seed === seed)!.detail;
    // Published seeds, from the wiki's table.
    expect(label(9)).toBe('Group A #1');
    expect(label(12)).toBe('Group D #1');
    expect(label(13)).toBe('Group A #2');
    expect(label(16)).toBe('Group D #2');
    expect(label(17)).toBe('Group A #3');
    expect(label(22)).toBe('Group B #4');
    expect(label(25)).toBe('Group E #1');
    expect(label(27)).toBe('Group G #1');
    expect(label(30)).toBe('Group F #2');
    expect(label(32)).toBe('Group H #2');

    const graph = await phaseGraph(phases, main);
    expect(graph.nodes.filter((node) => node.roundKey === 'g1-r1')).toHaveLength(8);
    expect(graph.nodes.filter((node) => node.roundKey === 'g2-r1')).toHaveLength(8);
    const opening = (roundKey: string) =>
      graph.nodes
        .filter((node) => node.roundKey === roundKey)
        .sort((a, b) => a.position - b.position)
        .map((node) => node.slots.map((slot) => Number(slot.entryRef!.split(':')[1])));
    expect(opening('g1-r1')).toEqual([
      [1, 16],
      [8, 9],
      [4, 13],
      [5, 12],
      [2, 15],
      [7, 10],
      [3, 14],
      [6, 11],
    ]);
    expect(opening('g2-r1')).toEqual([
      [22, 27],
      [19, 30],
      [23, 26],
      [18, 31],
      [21, 28],
      [20, 29],
      [24, 25],
      [17, 32],
    ]);
    const bracket = live(bindSeats(graph, seats));
    expect(bracket.nodes.filter((node) => node.state === 'READY')).toHaveLength(16);
  });

  it('eliminates contender bottom two by giving them no seat', async () => {
    const { groups: drawn } = drawGroups(groups, pool, { manual });
    const groupBracket = live(bindGroups(await phaseGraph(phases, groups), drawn));
    playGroups(groupBracket, drawn);
    const ranked = rankGroups(groups, groupBracket.nodes, groupBracket.rounds, pool);
    const { seats } = resolveEntries(main, {
      qualifiers: { qualifiers: pool },
      groups: { groups: { phase: groups, drawn, rows: ranked.rows, complete: true } },
    });
    expect(seats).toHaveLength(32);
    const out = ranked.rows.filter(
      (row) =>
        drawn.find((group) => group.group === row.group)!.tier === 'contenders' &&
        row.placement > 2,
    );
    expect(out).toHaveLength(8);
    for (const row of out) expect(seats.some((seat) => seat.teamId === row.teamId)).toBe(false);
  });
});

describe('Italian Cup 9 compatibility', () => {
  const phases = plan('italianCup');
  const groups = phaseOf<GroupsPhase>(phases, 'groups');
  const main = phaseOf<Elimination>(phases, 'main');
  const pool = entrants(20);
  const draw = () => drawGroups(groups, pool, { randomSeed: 'audited-seed' });

  it('draws one entrant from each pot reproducibly', () => {
    const { groups: drawn, issues } = draw();
    expect(issues).toEqual([]);
    expect(drawn).toHaveLength(4);
    for (const group of drawn) {
      expect(group.teams.map((team) => team.pot)).toEqual([0, 1, 2, 3]);
      const seeds = group.teams.map((team) => team.seed);
      expect(seeds[0]).toBeGreaterThanOrEqual(5);
      expect(seeds[0]).toBeLessThanOrEqual(8);
      expect(seeds[3]).toBeGreaterThanOrEqual(17);
    }
    expect(draw().groups).toEqual(drawn);
    expect(drawGroups(groups, pool, { randomSeed: 'other' }).groups).not.toEqual(drawn);
  });

  it('refuses a random draw without a stored seed', () => {
    expect(() => drawGroups(groups, pool)).toThrow('stored seed');
  });

  it('routes each placement to its lane with reseeding by cross-group rank', async () => {
    const { groups: drawn } = draw();
    const groupBracket = live(bindGroups(await phaseGraph(phases, groups), drawn));
    playGroups(groupBracket, drawn);
    const ranked = rankGroups(groups, groupBracket.nodes, groupBracket.rounds, pool);
    const { seats, issues } = resolveEntries(main, {
      qualifiers: { qualifiers: pool },
      groups: { groups: { phase: groups, drawn, rows: ranked.rows, complete: true } },
    });
    expect(issues).toEqual([]);
    expect(seats).toHaveLength(16);
    const lane = (name: string) => seats.filter((seat) => seat.lane === name);
    expect(lane('WINNERS').map((seat) => seat.seed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(lane('LOSERS').map((seat) => seat.seed)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
    expect(seats.slice(0, 4).map((seat) => seat.teamId)).toEqual([
      'team-1',
      'team-2',
      'team-3',
      'team-4',
    ]);
    // Winners are equal on results here, so qualifier seed orders them into seeds 5-8.
    expect(seats.slice(4, 8).map((seat) => seat.teamId)).toEqual([
      'team-5',
      'team-6',
      'team-7',
      'team-8',
    ]);
    const fourth = ranked.rows.filter((row) => row.placement === 4).map((row) => row.teamId);
    for (const teamId of fourth) expect(seats.some((seat) => seat.teamId === teamId)).toBe(false);
  });

  it('pairs seed 5 against 4 through to seed 8 against 1', async () => {
    const graph = await phaseGraph(phases, main);
    const opening = graph.nodes
      .filter((node) => node.roundKey === 'g1-r1')
      .sort((a, b) => a.position - b.position)
      .map((node) => node.slots.map((slot) => Number(slot.entryRef!.split(':')[1])));
    expect(opening).toEqual([
      [1, 8],
      [4, 5],
      [2, 7],
      [3, 6],
    ]);
  });

  it('always pairs a second place against a third place', async () => {
    const graph = await phaseGraph(phases, main);
    const opening = graph.nodes
      .filter((node) => node.roundKey === 'g2-r1')
      .map((node) => node.slots.map((slot) => Number(slot.entryRef!.split(':')[1])));
    for (const [a, b] of opening) {
      expect(a).toBeLessThanOrEqual(12);
      expect(b).toBeGreaterThanOrEqual(13);
    }
  });

  it('counts a forfeit as a win but leaves map difference unchanged', async () => {
    const { groups: drawn } = draw();
    const bracket = live(bindGroups(await phaseGraph(phases, groups), drawn));
    const target = bracket.nodes.find((node) => node.roundId.startsWith('g1-'))!;
    bracket.play(target.key, 'A', { scoreA: 5, scoreB: 0, forfeitSide: 'B' });
    const counted = rankGroups(groups, bracket.nodes, bracket.rounds, pool).rows;
    const winner = counted.find((row) => row.teamId === target.slots[0].teamId)!;
    expect(winner).toMatchObject({ wins: 1, mapDifference: 0, mapsWon: 0 });
    const usual = rankGroups(
      { ...groups, forfeitMapDifference: 'COUNT' },
      bracket.nodes,
      bracket.rounds,
      pool,
    ).rows;
    expect(usual.find((row) => row.teamId === winner.teamId)).toMatchObject({ mapDifference: 5 });
  });

  it('breaks group ties by wins, then map difference, then qualifier seed', async () => {
    const { groups: drawn } = draw();
    const first = drawn[0].teams.map((team) => team.teamId);
    const bracket = live(bindGroups(await phaseGraph(phases, groups), drawn));
    const inGroup = bracket.nodes.filter((node) => node.roundId.startsWith('g1-'));
    // A three-way cycle, then each beats the fourth by the same margin.
    const beats: Record<string, string> = {
      [first[0]]: first[1],
      [first[1]]: first[2],
      [first[2]]: first[0],
    };
    for (const node of inGroup) {
      const [a, b] = node.slots.map((slot) => slot.teamId!);
      const aWins = beats[a] === b || (b === first[3] && a !== first[3]);
      bracket.play(node.key, aWins ? 'A' : 'B', { scoreA: aWins ? 5 : 3, scoreB: aWins ? 3 : 5 });
    }
    const rows = rankGroups(groups, bracket.nodes, bracket.rounds, pool).rows.filter(
      (row) => row.group === 1,
    );
    expect(rows.map((row) => row.teamId)).toEqual(first);
    expect(rows.every((row) => !row.tied)).toBe(true);
  });

  describe('rematch limits', () => {
    const seat = (seed: number, teamId: string): AdvancementSeat => ({
      seed,
      lane: 'LOSERS',
      teamId,
      sourcePhase: 'groups',
      sourceRule: 'PLACEMENT',
      detail: `Seed ${seed}`,
    });
    const seats = [9, 10, 11, 12, 13, 14, 15, 16].map((seed) => seat(seed, `t${seed}`));
    const pairs = lanePairs(8, 'STANDARD', [9, 10, 11, 12, 13, 14, 15, 16]);

    it('changes nothing when no pair has met', () => {
      const result = avoidRematches(pairs, seats, () => false);
      expect(result.changes).toEqual([]);
      expect(result.seats).toEqual(seats);
    });

    it('swaps the nearest weaker opponent, leaving better seeds in place', () => {
      const met = (a: string, b: string) =>
        (a === 't9' && b === 't16') || (a === 't16' && b === 't9');
      const result = avoidRematches(pairs, seats, met);
      expect(result.issues).toEqual([]);
      const at = (seed: number) => result.seats.find((item) => item.seed === seed)!.teamId;
      // Seed 9 takes the closest allowed opponent; seeds 13 and 14 are untouched.
      expect(at(16)).toBe('t15');
      expect(at(15)).toBe('t16');
      expect(at(14)).toBe('t14');
      expect(at(13)).toBe('t13');
      expect(result.changes).toHaveLength(2);
    });

    it('backtracks rather than strand a later pair', () => {
      // Seed 9 may only face 13, and 12 may only face 16 afterwards.
      const allowed = new Set(['t9:t13', 't10:t15', 't11:t14', 't12:t16']);
      const result = avoidRematches(pairs, seats, (a, b) => !allowed.has(`${a}:${b}`));
      expect(result.issues).toEqual([]);
      const at = (seed: number) => result.seats.find((item) => item.seed === seed)!.teamId;
      expect(at(16)).toBe('t13');
      expect(at(13)).toBe('t16');
    });

    it('asks for a manual decision when no pairing can work', () => {
      const result = avoidRematches(pairs, seats, (a) => a === 't9');
      expect(result.issues[0].code).toBe('REMATCH_INFEASIBLE');
      expect(result.seats).toEqual(seats);
    });

    it('recognizes entrants who shared a group', () => {
      const { groups: drawn } = draw();
      const met = sharedGroup(drawn);
      expect(met(drawn[0].teams[0].teamId, drawn[0].teams[3].teamId)).toBe(true);
      expect(met(drawn[0].teams[0].teamId, drawn[1].teams[0].teamId)).toBe(false);
    });
  });

  describe('Losers-only entrants', () => {
    it('joins external Losers entrants with Winners drops and allows them one loss', async () => {
      const graph = await phaseGraph(phases, main);
      expect(graph.nodes).toHaveLength(7 + 14 + 2);
      const drop = graph.nodes.find((node) => node.roundKey === 'g2-r2')!;
      const outcomes = drop.slots.map((slot) => [slot.sourceKey?.slice(0, 2), slot.outcome]).sort();
      expect(outcomes).toEqual([
        ['g1', 'LOSER'],
        ['g2', 'WINNER'],
      ]);

      const seats: AdvancementSeat[] = entrants(16).map((entrant) => ({
        seed: entrant.seed,
        lane: entrant.seed <= 8 ? 'WINNERS' : 'LOSERS',
        teamId: entrant.teamId,
        sourcePhase: 'x',
        sourceRule: 'EXPLICIT',
        detail: '',
      }));
      const bracket = live(bindSeats(graph, seats));
      const lower = bracket.nodes.find((node) => node.key === 'g2-r1-m1')!;
      const [a, b] = lower.slots.map((slot) => slot.teamId!);
      bracket.play(lower.key, 'A');
      // Without a per-entry allowance this entrant would still count as alive.
      expect(competitionEliminated(bracket.nodes, bracket.rounds, 'DOUBLE_ELIMINATION', b, 1)).toBe(
        true,
      );
      expect(competitionEliminated(bracket.nodes, bracket.rounds, 'DOUBLE_ELIMINATION', b)).toBe(
        false,
      );
      expect(competitionEliminated(bracket.nodes, bracket.rounds, 'DOUBLE_ELIMINATION', a, 1)).toBe(
        false,
      );
    });
  });

  it('assigns rounds to stages without running the Losers final into Grand Finals', async () => {
    const stageIds = ['qf', 'sf', 'f', 'gf'];
    const graph = await phaseGraph(phases, { ...main, stageId: 'qf' }, stageIds);
    const stageOf = (key: string) => graph.rounds.find((round) => round.key === key)!.stageId;
    expect(stageOf('g1-r1')).toBe('qf');
    expect(stageOf('g1-r3')).toBe('f');
    expect(stageOf('g2-r1')).toBe('qf');
    expect(stageOf('g2-r6')).toBe('f');
    expect(stageOf('g3-r1')).toBe('gf');
    const overridden = phaseRoundStages(
      { stageId: 'qf', roundStages: { 'g2-r6': 'gf' } },
      graph.rounds,
      stageIds,
    );
    expect(overridden['g2-r6']).toBe('gf');
  });
});

describe('remaining compatibility formats', () => {
  it('runs the MIR Cup rules document straight into a 16-team bracket', async () => {
    const phases = plan('mirCupRulesDocument');
    const main = phaseOf<Elimination>(phases, 'main');
    const { seats, issues } = resolveEntries(main, { qualifiers: { qualifiers: entrants(16) } });
    expect(issues).toEqual([]);
    const bracket = live(bindSeats(await phaseGraph(phases, main), seats));
    expect(bracket.nodes.filter((node) => node.state === 'READY')).toHaveLength(8);
  });

  it('runs the MIR Cup brief through groups into an eight-team bracket', async () => {
    const phases = plan('mirCupBriefVariant');
    const groups = phaseOf<GroupsPhase>(phases, 'groups');
    const main = phaseOf<Elimination>(phases, 'main');
    const pool = entrants(16);
    const { groups: drawn, issues: drawIssues } = drawGroups(groups, pool);
    expect(drawIssues).toEqual([]);
    const groupBracket = live(bindGroups(await phaseGraph(phases, groups), drawn));
    expect(groupBracket.nodes).toHaveLength(24);
    playGroups(groupBracket, drawn);
    const ranked = rankGroups(groups, groupBracket.nodes, groupBracket.rounds, pool);
    const { seats, issues } = resolveEntries(main, {
      groups: { groups: { phase: groups, drawn, rows: ranked.rows, complete: true } },
    });
    expect(issues).toEqual([]);
    expect(seats).toHaveLength(8);
    const bracket = live(bindSeats(await phaseGraph(phases, main), seats));
    expect(bracket.nodes.filter((node) => node.state === 'READY')).toHaveLength(4);
  });

  it('seats formed draft teams by the organizer’s chosen order', async () => {
    const phases = plan('draftCup');
    const main = phaseOf<Elimination>(phases, 'main');
    const order = entrants(8).map((entrant) => entrant.teamId);
    expect(resolveEntries(main, {}).issues[0].code).toBe('EXPLICIT_REQUIRED');
    const { seats, issues } = resolveEntries(main, { explicit: { auction: order } });
    expect(issues).toEqual([]);
    const bracket = live(bindSeats(await phaseGraph(phases, main), seats));
    // Quarterfinals through Grand Finals, as the rules describe.
    expect(bracket.nodes.filter((node) => node.roundId === 'g1-r1')).toHaveLength(4);
    expect(bracket.pair('g1-r1-m1')).toEqual(['team-1', 'team-8']);
  });

  it('runs a novel league into reseeded playoffs with a third-place match', async () => {
    const phases = plan('novel');
    const league = phaseOf<GroupsPhase>(phases, 'league');
    const playoffs = phaseOf<Elimination>(phases, 'playoffs');
    const pool = entrants(6);
    const { groups: drawn } = drawGroups(league, pool);
    const leagueBracket = live(bindGroups(await phaseGraph(phases, league), drawn));
    expect(leagueBracket.nodes).toHaveLength(15);
    playGroups(leagueBracket, drawn);
    const ranked = rankGroups(league, leagueBracket.nodes, leagueBracket.rounds, pool);
    expect(ranked.rows.slice(0, 4).map((row) => row.teamId)).toEqual([
      'team-1',
      'team-2',
      'team-3',
      'team-4',
    ]);
    const { seats, issues } = resolveEntries(playoffs, {
      groups: { league: { phase: league, drawn, rows: ranked.rows, complete: true } },
    });
    expect(issues).toEqual([]);
    const graph = await phaseGraph(phases, playoffs);
    expect(graph.rounds.some((round) => round.lane === 'THIRD_PLACE')).toBe(true);
    const bracket = live(bindSeats(graph, seats));
    expect(bracket.pair('g1-r1-m1')).toEqual(['team-1', 'team-4']);
    bracket.play('g1-r1-m1', 'B');
    bracket.play('g1-r1-m2', 'A');
    expect(bracket.pair('g1-r2-m1').sort()).toEqual(['team-2', 'team-4']);
    expect(inRound(bracket, 'g2-r1')[0].sort()).toEqual(['team-1', 'team-3']);
  });

  it('uses head-to-head among only the entrants still level', async () => {
    const phases = plan('novel');
    const league = phaseOf<GroupsPhase>(phases, 'league');
    const pool = entrants(6);
    const { groups: drawn } = drawGroups(league, pool);
    const bracket = live(bindGroups(await phaseGraph(phases, league), drawn));
    // Seeds 2 and 3 level on match wins, where 3 beat 2 directly despite the seed order.
    const wins: Record<string, string[]> = {
      'team-1': ['team-2', 'team-3', 'team-4', 'team-5', 'team-6'],
      'team-3': ['team-2', 'team-4', 'team-5', 'team-6'],
      'team-2': ['team-4', 'team-5', 'team-6', 'team-1'],
    };
    for (const node of bracket.nodes) {
      const [a, b] = node.slots.map((slot) => slot.teamId!);
      const aBeatsB = wins[a]?.includes(b) && !wins[b]?.includes(a);
      const bBeatsA = wins[b]?.includes(a) && !wins[a]?.includes(b);
      bracket.play(node.key, aBeatsB ? 'A' : bBeatsA ? 'B' : a < b ? 'A' : 'B');
    }
    const rows = rankGroups(league, bracket.nodes, bracket.rounds, pool).rows;
    expect(rows.findIndex((row) => row.teamId === 'team-3')).toBeLessThan(
      rows.findIndex((row) => row.teamId === 'team-2'),
    );
  });

  it('leaves an unbreakable tie for a reviewed human order', async () => {
    const phases = plan('novel');
    const league = {
      ...phaseOf<GroupsPhase>(phases, 'league'),
      tiebreakers: ['MATCH_WINS'] as GroupsPhase['tiebreakers'],
    };
    const pool = entrants(6);
    const { groups: drawn } = drawGroups(league, pool);
    const bracket = live(bindGroups(await phaseGraph(phases, league), drawn));
    for (const node of bracket.nodes) bracket.play(node.key, node.position % 2 ? 'A' : 'B');
    const unresolved = rankGroups(league, bracket.nodes, bracket.rounds, pool).rows;
    const tied = unresolved.filter((row) => row.tied);
    expect(tied.length).toBeGreaterThan(1);
    const reviewed = [...tied].reverse().map((row) => row.teamId);
    const resolved = rankGroups(league, bracket.nodes, bracket.rounds, pool, reviewed).rows;
    expect(resolved.every((row) => !row.tied)).toBe(true);
  });

  it('reseeds the surviving field best against worst', () => {
    expect(
      reseededPairs([
        { teamId: 'c', seed: 7 },
        { teamId: 'a', seed: 1 },
        { teamId: 'd', seed: 8 },
        { teamId: 'b', seed: 4 },
      ]),
    ).toEqual([
      ['a', 'd'],
      ['b', 'c'],
    ]);
  });

  it('holds later rounds for reseeding but keeps the final and third place routed', async () => {
    const phases = formatPlanSchema.parse({
      version: 1,
      phases: [
        { kind: 'QUALIFIER', key: 'q', name: 'Q', stageId: 's', advance: 8 },
        {
          kind: 'SINGLE_ELIMINATION',
          key: 'bracket',
          name: 'B',
          stageId: 's',
          size: 8,
          reseed: 'EACH_ROUND',
          thirdPlace: true,
          entries: [{ source: { kind: 'RANK_RANGE', phase: 'q', from: 1, to: 8 }, seedFrom: 1 }],
        },
      ],
    }).phases;
    const graph = await phaseGraph(phases, phaseOf<Elimination>(phases, 'bracket'));
    const semi = graph.nodes.find((node) => node.key === 'g1-r2-m1')!;
    expect(semi.slots.every((slot) => slot.entryRef?.startsWith('reseed:'))).toBe(true);
    const final = graph.nodes.find((node) => node.key === 'g1-r3-m1')!;
    expect(final.slots.every((slot) => slot.sourceKey)).toBe(true);
  });
});

describe('engine safety', () => {
  it('reports a manual draw that breaks the pots without rejecting a staff decision', () => {
    const phases = plan('owc');
    const groups = phaseOf<GroupsPhase>(phases, 'groups');
    const pool = entrants(40);
    const challengers = [
      ['team-9', 'team-10', 'team-17', 'team-21'],
      ['team-13', 'team-14', 'team-18', 'team-22'],
      ['team-11', 'team-15', 'team-19', 'team-23'],
      ['team-12', 'team-16', 'team-20', 'team-24'],
    ];
    const contenders = [
      ['team-25', 'team-29', 'team-33', 'team-37'],
      ['team-26', 'team-30', 'team-34', 'team-38'],
      ['team-27', 'team-31', 'team-35', 'team-39'],
      ['team-28', 'team-32', 'team-36', 'team-40'],
    ];
    const { issues } = drawGroups(groups, pool, { manual: { challengers, contenders } });
    expect(issues.map((issue) => issue.code)).toContain('POT_IMBALANCE');
    expect(issues.every((issue) => issue.severity === 'WARNING')).toBe(true);
    const repeat = drawGroups(groups, pool, {
      manual: {
        challengers: [challengers[0], challengers[0], challengers[2], challengers[3]],
        contenders,
      },
    });
    expect(repeat.issues.some((issue) => issue.severity === 'ERROR')).toBe(true);
  });

  it('blocks advancement from incomplete sources instead of guessing', () => {
    const phases = plan('italianCup');
    const groups = phaseOf<GroupsPhase>(phases, 'groups');
    const main = phaseOf<Elimination>(phases, 'main');
    const { issues } = resolveEntries(main, {
      qualifiers: { qualifiers: entrants(20) },
      groups: { groups: { phase: groups, drawn: [], rows: [], complete: false } },
    });
    expect(issues.every((issue) => issue.severity === 'ERROR')).toBe(true);
    expect(issues.map((issue) => issue.code)).toContain('SOURCE_NOT_READY');
  });

  it('flags a withdrawn entrant instead of silently promoting someone else', () => {
    const phases = plan('oidc');
    const main = phaseOf<Elimination>(phases, 'main');
    const pool = entrants(16).map((entrant) =>
      entrant.seed === 3 ? { ...entrant, status: 'WITHDRAWN' } : entrant,
    );
    const { issues, seats } = resolveEntries(main, { qualifiers: { qualifiers: pool } });
    expect(issues.map((issue) => issue.code)).toEqual(['INACTIVE_ENTRANT']);
    expect(seats.find((seat) => seat.seed === 3)!.teamId).toBe('team-3');
  });

  it('never lets a placeholder read as a bye', async () => {
    const phases = plan('italianCup');
    const main = phaseOf<Elimination>(phases, 'main');
    const graph = await phaseGraph(phases, main);
    const unbound = live(graph);
    expect(unbound.nodes.every((node) => node.state === 'WAITING')).toBe(true);
  });
});
