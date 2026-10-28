import { describe, expect, it } from 'vitest';
import {
  competitionChanges,
  competitionEliminated,
  competitionOrder,
  generateCompetition,
  groupStandings,
  recalculateCompetition,
} from '../src/lib/competition-engine';
import { competitionActionSchema } from '../src/lib/competition-validation';
import { remapCompetitionConfig, remapCompetitionSeedOrder } from '../src/lib/competition-archive';
import {
  bracketNumberingOrder,
  numberBracketNodes,
  numericMatchIdentifier,
  restoreArchiveMatchNumbers,
} from '../src/lib/match-numbering';
import type { CompetitionNode, CompetitionRound } from '../src/lib/competition-types';

async function make(
  count: number,
  format: 'SINGLE_ELIMINATION' | 'DOUBLE_ELIMINATION' | 'GROUPS' = 'SINGLE_ELIMINATION',
  settings: Record<string, unknown> = {},
) {
  const action = competitionActionSchema.options[0].parse({
    type: 'competition.create',
    name: 'Cup',
    generationKey: 'create-1',
    stageId: 'stage-1',
    teamIds: Array.from({ length: count }, (_, i) => `team-${i + 1}`),
    format,
    ...settings,
  });
  const plan = await generateCompetition(action);
  const rounds: CompetitionRound[] = plan.rounds.map((r) => ({ ...r, id: r.key }));
  const nodes: CompetitionNode[] = plan.nodes.map((n) => ({
    id: n.key,
    key: n.key,
    bracketId: 'main',
    roundId: n.roundKey,
    position: n.position,
    matchNumber: null,
    state: 'WAITING',
    matchId: null,
    match: null,
    slots: n.slots.map(({ sourceKey, ...s }) => ({ ...s, sourceNodeId: sourceKey })),
  }));
  return { nodes: recalculateCompetition(nodes), rounds, plan, action };
}
function complete(node: CompetitionNode, winnerSide: 'A' | 'B' = 'A', status = 'COMPLETED') {
  node.matchId = node.id;
  node.match = {
    id: node.id,
    code: node.id,
    matchNumber: node.matchNumber || 1,
    teamAId: node.slots.find((s) => s.side === 'A')!.teamId,
    teamBId: node.slots.find((s) => s.side === 'B')!.teamId,
    scoreA: winnerSide === 'A' ? 4 : 1,
    scoreB: winnerSide === 'B' ? 4 : 1,
    winnerSide,
    status,
    version: 1,
  };
}

describe('stable tournament match numbering', () => {
  it('restores transferred numbers and preserves unambiguous legacy numeric codes', () => {
    const matches = [
      { id: 'a', code: 'historic', matchNumber: 11 as unknown },
      { id: 'b', code: '2', matchNumber: undefined as unknown },
      { id: 'c', code: 'custom', matchNumber: undefined as unknown },
    ];
    const nodes = [
      { matchId: 'a', matchNumber: undefined as unknown },
      { matchId: null, matchNumber: 15 as unknown },
    ];
    expect(restoreArchiveMatchNumbers(matches, nodes, 15)).toBe(16);
    expect(matches.map((match) => match.matchNumber)).toEqual([11, 2, 16]);
    expect(nodes[0].matchNumber).toBe(11);
    expect(() =>
      restoreArchiveMatchNumbers(
        [
          { id: 'a', code: 'x', matchNumber: 3 },
          { id: 'b', code: 'y', matchNumber: 3 },
        ],
        [],
      ),
    ).toThrow('unique');
  });
  it('parses only positive signed-database integers and keeps source formatting separate', () => {
    expect(numericMatchIdentifier('001')).toBe(1);
    expect(numericMatchIdentifier('2147483647')).toBe(2147483647);
    for (const invalid of ['', '0', '-1', '1.5', '2a', '2147483648'])
      expect(numericMatchIdentifier(invalid)).toBeNull();
  });

  it('orders 32 matches by configured round and top-to-bottom bracket position', () => {
    const rounds = Array.from({ length: 5 }, (_, position) => ({
      id: `round-${position + 1}`,
      key: `round-${position + 1}`,
      lane: position === 4 ? 'FINALS' : 'WINNERS',
      position,
    }));
    const counts = [16, 8, 4, 2, 2];
    const nodes = rounds.flatMap((round, roundIndex) =>
      Array.from({ length: counts[roundIndex] }, (_, index) => ({
        id: `${round.id}-match-${index + 1}`,
        bracketId: 'bracket',
        roundId: round.id,
        key: `${round.key}-m${index + 1}`,
        position: index + 1,
        state: 'READY',
        matchId: null,
      })),
    );
    const ordered = bracketNumberingOrder(nodes.reverse(), rounds),
      numbers = numberBracketNodes(nodes, rounds, 1);
    expect([...numbers.values()].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 32 }, (_, index) => index + 1),
    );
    expect(ordered.map((node, index) => [node.key, index + 1])).toEqual(
      counts.flatMap((count, roundIndex) =>
        Array.from({ length: count }, (_, index) => [
          `round-${roundIndex + 1}-m${index + 1}`,
          counts.slice(0, roundIndex).reduce((sum, value) => sum + value, 0) + index + 1,
        ]),
      ),
    );
    expect(ordered.map((node) => numbers.get(node.id))).toEqual(
      Array.from({ length: 32 }, (_, index) => index + 1),
    );
  });

  it('retains round order across single- and double-elimination generation plans', async () => {
    for (const format of ['SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION'] as const) {
      const { nodes, rounds } = await make(8, format);
      const ordered = bracketNumberingOrder(nodes, rounds);
      expect(ordered.map((node) => node.key)).toEqual(
        [...ordered]
          .sort((a, b) => {
            const roundA = rounds.find((round) => round.id === a.roundId)!;
            const roundB = rounds.find((round) => round.id === b.roundId)!;
            return (
              roundA.position - roundB.position ||
              roundA.lane.localeCompare(roundB.lane) ||
              a.position - b.position ||
              a.key.localeCompare(b.key)
            );
          })
          .map((node) => node.key),
      );
    }
  });
});
function simulate(
  initial: CompetitionNode[],
  winner: (node: CompetitionNode) => 'A' | 'B' = () => 'A',
) {
  let nodes = structuredClone(initial),
    steps = 0;
  const losses = new Map<string, number>();
  while (true) {
    nodes = recalculateCompetition(nodes);
    const next = nodes.find((n) => n.state === 'READY' && n.match?.status !== 'COMPLETED');
    if (!next) break;
    expect(++steps).toBeLessThan(1000);
    complete(next, winner(next));
    const loser = next.slots.find((s) => s.side !== next.match!.winnerSide)!.teamId!;
    losses.set(loser, (losses.get(loser) || 0) + 1);
  }
  return { nodes: recalculateCompetition(nodes), losses, steps };
}
describe('native competition generation and progression', () => {
  it('remaps nested archive seed, tie, stage and source identities without fabricating hashes', () => {
    const ids = new Map([
      ['stage', 'new-stage'],
      ['round-stage', 'new-round-stage'],
      ['team-a', 'new-a'],
      ['team-b', 'new-b'],
      ['groups', 'new-groups'],
    ]);
    const config = {
      type: 'competition.create',
      name: 'Final',
      format: 'SINGLE_ELIMINATION',
      generationKey: 'stable-key',
      stageId: 'stage',
      roundStages: { 'g1-r1': 'round-stage' },
      teamIds: ['team-a', 'team-b'],
      sourceBracketId: 'groups',
      groupTieOrder: ['team-b', 'team-a'],
      groupSource: {
        bracketId: 'groups',
        sourceHash: '0'.repeat(64),
        seeds: [
          { teamId: 'team-a', seed: 1 },
          { teamId: 'team-b', seed: 2 },
        ],
      },
    };
    const mapped = remapCompetitionConfig(config, ids);
    expect(mapped.teamIds).toEqual(['new-a', 'new-b']);
    expect(mapped.groupTieOrder).toEqual(['new-b', 'new-a']);
    expect(mapped.roundStages).toEqual({ 'g1-r1': 'new-round-stage' });
    expect(mapped.sourceBracketId).toBe('new-groups');
    expect(mapped.groupSource?.seeds[0].teamId).toBe('new-a');
    expect(mapped.groupSource?.sourceHash).toBe(config.groupSource.sourceHash);
    expect(remapCompetitionSeedOrder(config.teamIds, ids)).toEqual(['new-a', 'new-b']);
    expect(() => remapCompetitionConfig(config, new Map())).toThrow(/identity/);
    expect(config.teamIds).toEqual(['team-a', 'team-b']);
  });
  it('places eight seeds deterministically and completes seven canonical matches', async () => {
    const a = await make(8),
      b = await make(8);
    expect(a.plan).toEqual(b.plan);
    expect(
      a.nodes.filter((n) => n.state === 'READY').map((n) => n.slots.map((s) => s.teamId)),
    ).toEqual([
      ['team-1', 'team-8'],
      ['team-4', 'team-5'],
      ['team-2', 'team-7'],
      ['team-3', 'team-6'],
    ]);
    const result = simulate(a.nodes);
    expect(result.steps).toBe(7);
    expect(result.nodes.every((n) => n.state === 'COMPLETED')).toBe(true);
    expect([...result.losses.values()].every((loss) => loss === 1)).toBe(true);
  });
  it('twelve seeds receive four structural byes without playable bye matches', async () => {
    const { nodes } = await make(12);
    expect(nodes.filter((n) => n.state === 'BYE')).toHaveLength(4);
    expect(nodes.filter((n) => n.state === 'BYE').every((n) => !n.matchId)).toBe(true);
    expect(simulate(nodes).steps).toBe(11);
  });
  for (const count of [2, 3, 4, 8, 12, 16]) {
    it(`completes ${count}-participant DE with winners-to-losers routing and no phantom losses`, async () => {
      const { nodes } = await make(count, 'DOUBLE_ELIMINATION');
      const { nodes: finished, losses, steps } = simulate(nodes);
      expect(steps).toBe(2 * count - 2);
      expect(finished.every((n) => ['COMPLETED', 'BYE', 'SKIPPED'].includes(n.state))).toBe(true);
      expect([...losses.values()].filter((n) => n === 2)).toHaveLength(count - 1);
      expect([...losses.values()].every((n) => n <= 2)).toBe(true);
    });
    it(`activates the ${count}-participant Grand Finals reset only after the lower finalist wins`, async () => {
      const { nodes, rounds } = await make(count, 'DOUBLE_ELIMINATION');
      const finals = rounds.filter((r) => r.lane === 'FINALS');
      const firstFinal = finals[0]?.id;
      const {
        nodes: finished,
        steps,
        losses,
      } = simulate(nodes, (n) => (n.roundId === firstFinal ? 'B' : 'A'));
      expect(steps).toBe(2 * count - 1);
      expect(finished.every((n) => ['COMPLETED', 'BYE', 'SKIPPED'].includes(n.state))).toBe(true);
      expect([...losses.values()].filter((n) => n === 2)).toHaveLength(count - 1);
    });
  }
  it('supports single-final DE and optional third place', async () => {
    const simple = await make(8, 'DOUBLE_ELIMINATION', { grandFinalReset: false });
    expect(simulate(simple.nodes).steps).toBe(14);
    const third = await make(8, 'SINGLE_ELIMINATION', { thirdPlace: true });
    expect(simulate(third.nodes).steps).toBe(8);
    expect(third.rounds.some((r) => r.lane === 'THIRD_PLACE')).toBe(true);
  });
  it('eliminates a single-final DE loser even after only one loss and preserves reset eligibility', async () => {
    const simple = await make(8, 'DOUBLE_ELIMINATION', { grandFinalReset: false });
    const finished = simulate(simple.nodes, (node) =>
      simple.rounds.find((r) => r.id === node.roundId)?.lane === 'FINALS' ? 'B' : 'A',
    ).nodes;
    const final = finished.find(
      (n) => simple.rounds.find((r) => r.id === n.roundId)?.lane === 'FINALS',
    )!;
    expect(
      competitionEliminated(finished, simple.rounds, 'DOUBLE_ELIMINATION', final.match!.teamAId!),
    ).toBe(true);
    const reset = await make(8, 'DOUBLE_ELIMINATION');
    let pending = reset.nodes;
    while (!pending.find((n) => n.key === 'g3-r2-m1')?.slots.every((s) => s.resolved)) {
      const ready = pending.find((n) => n.state === 'READY' && n.match?.status !== 'COMPLETED')!;
      complete(ready, ready.key === 'g3-r1-m1' ? 'B' : 'A');
      pending = recalculateCompetition(pending);
    }
    const resetFinal = pending.find((n) => n.key === 'g3-r2-m1')!;
    expect(resetFinal.state).toBe('READY');
    expect(
      resetFinal.slots.every(
        (s) => !competitionEliminated(pending, reset.rounds, 'DOUBLE_ELIMINATION', s.teamId!),
      ),
    ).toBe(true);
  });
  it('advances only confirmed results, including an intentional forfeit', async () => {
    const { nodes } = await make(4);
    complete(nodes[0], 'A', 'AWAITING_CONFIRMATION');
    expect(recalculateCompetition(nodes).find((n) => n.id === 'g1-r2-m1')!.slots[0].resolved).toBe(
      false,
    );
    nodes[0].match!.status = 'COMPLETED';
    expect(recalculateCompetition(nodes).find((n) => n.id === 'g1-r2-m1')!.slots[0].teamId).toBe(
      nodes[0].match!.teamAId,
    );
  });
  it('does not overwrite manual or locked positions during progression', async () => {
    for (const mode of ['MANUAL', 'LOCKED']) {
      const { nodes } = await make(4);
      const final = nodes.find((n) => n.id === 'g1-r2-m1')!;
      Object.assign(final.slots[0], { mode, teamId: 'manual-team', resolved: true });
      complete(nodes[0], 'B');
      expect(recalculateCompetition(nodes).find((n) => n.id === final.id)!.slots[0].teamId).toBe(
        'manual-team',
      );
    }
  });
  it('rejects duplicate seeds, self pairing, cycles, and foreign progression sources', async () => {
    const { nodes, action } = await make(4);
    await expect(generateCompetition({ ...action, teamIds: ['same', 'same'] })).rejects.toThrow(
      /once/,
    );
    nodes[0].slots[0].sourceNodeId = nodes.at(-1)!.id;
    expect(() => competitionOrder(nodes)).toThrow(/cycles/);
    nodes[0].slots[0].sourceNodeId = 'foreign-node';
    expect(() => competitionOrder(nodes)).toThrow(/outside/);
    nodes[0].slots[0].sourceNodeId = null;
    nodes[0].slots[1].teamId = nodes[0].slots[0].teamId;
    expect(() => recalculateCompetition(nodes)).toThrow(/both sides/);
  });
  it('previews safe corrections and marks downstream started or completed matches protected', async () => {
    const { nodes } = await make(4);
    complete(nodes[0]);
    complete(nodes[1]);
    const before = recalculateCompetition(nodes),
      final = before.at(-1)!;
    complete(final, 'A', 'SCHEDULED');
    const changed = structuredClone(before);
    changed[0].match!.winnerSide = 'B';
    expect(competitionChanges(before, recalculateCompetition(changed))).toEqual([
      {
        nodeId: final.id,
        matchId: final.id,
        code: final.id,
        matchNumber: final.match!.matchNumber,
        protected: false,
      },
    ]);
    final.match!.startedAt = new Date();
    expect(competitionChanges(before, recalculateCompetition(changed))[0].protected).toBe(true);
  });
  it('keeps independent paths independent and permits explicit connected progression', async () => {
    const a = await make(4),
      b = await make(4);
    b.nodes.forEach((n) => {
      n.id = `other-${n.id}`;
      n.bracketId = 'other';
      n.slots.forEach((s) => {
        if (s.sourceNodeId) s.sourceNodeId = `other-${s.sourceNodeId}`;
      });
    });
    complete(a.nodes[0]);
    expect(
      recalculateCompetition([...a.nodes, ...b.nodes]).filter((n) => n.bracketId === 'other'),
    ).toEqual(b.nodes);
    b.nodes[0].slots[0].sourceNodeId = a.nodes[0].id;
    b.nodes[0].slots[0].outcome = 'WINNER';
    expect(
      recalculateCompetition([...a.nodes, ...b.nodes]).find((n) => n.id === b.nodes[0].id)!.slots[0]
        .teamId,
    ).toBe(a.nodes[0].match!.teamAId);
  });
  it('generates complete nonduplicated groups with wins, map differential and explicit seed tiebreak', async () => {
    const { nodes, rounds, action } = await make(8, 'GROUPS', { groupCount: 2 });
    expect(nodes).toHaveLength(12);
    const pairs = nodes.map((n) =>
      n.slots
        .map((s) => s.teamId)
        .sort()
        .join(':'),
    );
    expect(new Set(pairs).size).toBe(12);
    const entries = action.teamIds.map((teamId, index) => ({ teamId, seed: index + 1 }));
    expect(groupStandings(nodes, rounds, entries, 2).every((s) => !s.qualified)).toBe(true);
    const finished = simulate(nodes).nodes;
    const unresolved = groupStandings(finished, rounds, entries, 2);
    expect(unresolved.filter((row) => row.tied).every((row) => !row.qualified)).toBe(true);
    const standings = groupStandings(finished, rounds, entries, 2, action.teamIds);
    expect(standings.filter((s) => s.qualified)).toHaveLength(4);
    expect(standings.every((s) => s.played === 3 && s.wins + s.losses === 3)).toBe(true);
    expect(standings.reduce((sum, s) => sum + s.mapDifference, 0)).toBe(0);
  });
  it('does not qualify cyclic group ties until an explicit complete tie order is reviewed', async () => {
    const { nodes, rounds, action } = await make(3, 'GROUPS');
    const beats = new Map([
      ['team-1', 'team-2'],
      ['team-2', 'team-3'],
      ['team-3', 'team-1'],
    ]);
    for (const node of nodes) {
      if (node.state !== 'READY') continue;
      complete(node, beats.get(node.slots[0].teamId!) === node.slots[1].teamId ? 'A' : 'B');
    }
    const finished = recalculateCompetition(nodes),
      entries = action.teamIds.map((teamId, index) => ({ teamId, seed: index + 1 }));
    const pending = groupStandings(finished, rounds, entries, 2);
    expect(pending.every((row) => row.tied && !row.qualified)).toBe(true);
    expect(
      groupStandings(finished, rounds, entries, 2, ['team-2']).every((row) => !row.qualified),
    ).toBe(true);
    const reviewed = groupStandings(finished, rounds, entries, 2, ['team-2', 'team-3', 'team-1']);
    expect(reviewed.filter((row) => row.qualified).map((row) => row.teamId)).toEqual([
      'team-2',
      'team-3',
    ]);
    expect(reviewed.every((row) => !row.tied && row.tieResolved)).toBe(true);
  });
});
