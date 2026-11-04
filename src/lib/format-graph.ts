import { generateCompetition, type CompetitionPlan } from './competition-engine';
import type { FormatPhase } from './format-plan';
import { automaticRoundStages, type StageRef } from './format-rounds';
import { AppError } from './permissions';

// Builds a phase's bracket before its entrants are known. Slots read `seed:N` or
// `group:G:seat:S` until an advancement binds them to real teams.
type GraphPhase = Extract<
  FormatPhase,
  { kind: 'GROUPS' | 'SINGLE_ELIMINATION' | 'DOUBLE_ELIMINATION' }
>;
export type PhaseGraph = CompetitionPlan;
export type SeedPair = [number | null, number | null];

const placeholders = (count: number) => Array.from({ length: count }, (_, i) => `seat-${i + 1}`);
const emptySeat = (entryRef: string | null) => ({
  teamId: null,
  resolved: false,
  mode: 'AUTO',
  sourceKey: null,
  outcome: null,
  entryRef,
});

// 1v8, 4v5, 2v7, 3v6: each round doubles the field while keeping best against worst.
export function standardBracketOrder(size: number) {
  let order = [1];
  while (order.length < size) order = order.flatMap((seed) => [seed, order.length * 2 + 1 - seed]);
  return order;
}

// Seats are paired by rank within the lane, so unfilled ranks leave byes for the best seeds.
export function lanePairs(
  size: number,
  pairing: 'STANDARD' | [number, number][],
  seats: readonly number[],
): SeedPair[] {
  if (pairing !== 'STANDARD') return pairing;
  const ranked = [...seats].sort((a, b) => a - b);
  const order = standardBracketOrder(size).map((rank) => ranked[rank - 1] ?? null);
  return Array.from({ length: size / 2 }, (_, i) => [order[i * 2], order[i * 2 + 1]]);
}

function seatNodes(nodes: PhaseGraph['nodes'], roundKey: string, pairs: SeedPair[]) {
  const seated = nodes
    .filter((node) => node.roundKey === roundKey)
    .sort((a, b) => a.position - b.position);
  if (seated.length !== pairs.length)
    throw new AppError('The bracket graph does not match the opening pairs.', 409);
  seated.forEach((node, index) => {
    node.slots = (['A', 'B'] as const).map((side, position) => {
      const seat = pairs[index][position];
      return { side, ...emptySeat(seat === null ? 'bye' : `seed:${seat}`) };
    });
  });
}

// A Losers lane fed from outside is a standard graph of twice the size whose first
// Winners round never happens: its winners and losers become external entrants instead.
function withoutFirstWinnersRound(graph: PhaseGraph): PhaseGraph {
  const removed = new Set(
    graph.nodes.filter((node) => node.roundKey === 'g1-r1').map((node) => node.key),
  );
  const renamed = (key: string) =>
    key.replace(/^g1-r(\d+)/, (_, round) => `g1-r${Number(round) - 1}`);
  const isWinners = (key: string) => key.startsWith('g1-');
  return {
    rounds: graph.rounds
      .filter((round) => round.key !== 'g1-r1')
      .map((round, position) => {
        const key = isWinners(round.key) ? renamed(round.key) : round.key;
        return {
          ...round,
          key,
          position,
          name: isWinners(round.key) ? `WINNERS ${key.split('-r')[1]}` : round.name,
        };
      }),
    nodes: graph.nodes
      .filter((node) => !removed.has(node.key))
      .map((node) => ({
        ...node,
        key: isWinners(node.key) ? renamed(node.key) : node.key,
        roundKey: isWinners(node.roundKey) ? renamed(node.roundKey) : node.roundKey,
        slots: node.slots.map((slot) =>
          slot.sourceKey && removed.has(slot.sourceKey)
            ? { ...slot, ...emptySeat(null) }
            : {
                ...slot,
                sourceKey:
                  slot.sourceKey && isWinners(slot.sourceKey)
                    ? renamed(slot.sourceKey)
                    : slot.sourceKey,
              },
        ),
      })),
  };
}

export type ResolvedSeats = { WINNERS: number[]; LOSERS: number[] };
export function plannedSeats(
  phases: readonly FormatPhase[],
  phase: Extract<GraphPhase, { kind: 'SINGLE_ELIMINATION' | 'DOUBLE_ELIMINATION' }>,
): ResolvedSeats {
  const seats: ResolvedSeats = { WINNERS: [], LOSERS: [] };
  for (const item of phase.entries) {
    const lane = 'lane' in item ? item.lane : 'WINNERS';
    const from = item.source;
    let count = 0;
    if (from.kind === 'RANK_RANGE') count = from.to - from.from + 1;
    else if (from.kind === 'EXPLICIT' || from.kind === 'REGISTRATION') count = from.count;
    else if (from.kind === 'PLACEMENT') {
      const origin = phases.find((other) => other.key === from.phase);
      if (origin?.kind === 'GROUPS')
        count = origin.tiers
          .filter((tier) => !from.tier || tier.key === from.tier)
          .reduce((total, tier) => total + tier.groupCount, 0);
    } else {
      const origin = phases.find((other) => other.key === from.phase);
      count =
        origin?.kind === 'TEAM_FORMATION'
          ? origin.teamCount
          : origin?.kind === 'QUALIFIER'
            ? (origin.advance ?? 0)
            : 0;
    }
    for (let offset = 0; offset < count; offset++) seats[lane].push(item.seedFrom + offset);
  }
  return seats;
}

async function groupGraph(phase: Extract<GraphPhase, { kind: 'GROUPS' }>): Promise<PhaseGraph> {
  const rounds: PhaseGraph['rounds'] = [];
  const nodes: PhaseGraph['nodes'] = [];
  let group = 0;
  for (const tier of phase.tiers)
    for (let index = 0; index < tier.groupCount; index++) {
      group++;
      const plan = await generateCompetition({
        format: 'GROUPS',
        teamIds: placeholders(tier.groupSize),
        groupCount: 1,
        stageId: phase.stageId,
        thirdPlace: false,
        grandFinalReset: false,
        roundStages: {},
      });
      const prefix = (key: string) => key.replace(/^g1-/, `g${group}-`);
      for (const round of plan.rounds)
        rounds.push({
          ...round,
          key: prefix(round.key),
          lane: `GROUP_${group}`,
          name: `GROUP ${group} ${round.key.split('-r')[1]}`,
          position: rounds.length,
        });
      for (const node of plan.nodes)
        nodes.push({
          ...node,
          key: prefix(node.key),
          roundKey: prefix(node.roundKey),
          slots: node.slots.map((slot) => ({
            side: slot.side,
            ...emptySeat(`group:${group}:seat:${Number(String(slot.teamId).split('-')[1])}`),
          })),
        });
    }
  return { rounds, nodes };
}

// A phase can reassign any round. Anything it does not choose, or that points at a stage which
// no longer exists, follows the automatic mapping.
export function phaseRoundStages(
  phase: Pick<Extract<GraphPhase, { roundStages: unknown }>, 'stageId' | 'roundStages'>,
  rounds: PhaseGraph['rounds'],
  stages: readonly (string | StageRef)[],
) {
  const automatic = automaticRoundStages(phase.stageId, rounds, stages);
  const exists = (id: string) =>
    !stages.length || stages.some((stage) => (typeof stage === 'string' ? stage : stage.id) === id);
  return Object.fromEntries(
    rounds.map((round) => {
      const chosen = phase.roundStages[round.key];
      return [round.key, chosen && exists(chosen) ? chosen : automatic[round.key]];
    }),
  );
}

export async function phaseGraph(
  phases: readonly FormatPhase[],
  phase: GraphPhase,
  stages: readonly (string | StageRef)[] = [],
): Promise<PhaseGraph> {
  let graph: PhaseGraph;
  if (phase.kind === 'GROUPS') graph = await groupGraph(phase);
  else {
    const seats = plannedSeats(phases, phase);
    if (phase.kind === 'SINGLE_ELIMINATION') {
      graph = await generateCompetition({
        format: 'SINGLE_ELIMINATION',
        teamIds: placeholders(phase.size),
        groupCount: 1,
        stageId: phase.stageId,
        thirdPlace: phase.thirdPlace,
        grandFinalReset: false,
        roundStages: {},
      });
      seatNodes(graph.nodes, 'g1-r1', lanePairs(phase.size, phase.pairing, seats.WINNERS));
      if (phase.reseed === 'EACH_ROUND') {
        // Later rounds wait for the reseeded field, except a single final and third place.
        const counts = new Map<string, number>();
        for (const node of graph.nodes)
          counts.set(node.roundKey, (counts.get(node.roundKey) || 0) + 1);
        for (const node of graph.nodes)
          if (
            node.roundKey.startsWith('g1-') &&
            node.roundKey !== 'g1-r1' &&
            (counts.get(node.roundKey) || 0) > 1
          )
            node.slots = (['A', 'B'] as const).map((side) => ({
              side,
              ...emptySeat(`reseed:${node.key}:${side}`),
            }));
      }
    } else {
      const twoLanes = !!phase.losers;
      const base = await generateCompetition({
        format: 'DOUBLE_ELIMINATION',
        teamIds: placeholders(phase.winners.size * (twoLanes ? 2 : 1)),
        groupCount: 1,
        stageId: phase.stageId,
        thirdPlace: false,
        grandFinalReset: phase.grandFinalReset,
        roundStages: {},
      });
      graph = twoLanes ? withoutFirstWinnersRound(base) : base;
      seatNodes(
        graph.nodes,
        'g1-r1',
        lanePairs(phase.winners.size, phase.winners.pairing, seats.WINNERS),
      );
      if (phase.losers)
        seatNodes(
          graph.nodes,
          'g2-r1',
          lanePairs(phase.losers.size, phase.losers.pairing, seats.LOSERS),
        );
    }
  }
  const assigned = phaseRoundStages(
    { stageId: phase.stageId, roundStages: 'roundStages' in phase ? phase.roundStages : {} },
    graph.rounds,
    stages,
  );
  return {
    nodes: graph.nodes,
    rounds: graph.rounds.map((round) => ({ ...round, stageId: assigned[round.key] })),
  };
}
