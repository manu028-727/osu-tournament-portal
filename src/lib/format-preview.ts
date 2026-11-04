import { phaseGraph } from './format-graph';
import type { FormatPhase, FormatPlan, FormatSource } from './format-plan';
import { automaticRoundStages, type StageRef } from './format-rounds';

export type PhasePreview = {
  key: string;
  kind: FormatPhase['kind'];
  name: string;
  matchCount: number;
  rounds: {
    key: string;
    lane: string;
    name: string;
    stageId: string;
    automaticStageId: string;
    matches: number;
  }[];
  openings: { lane: string; pairs: [string, string][] }[];
};

export const sourceLabels = (phases: readonly FormatPhase[], phase: FormatPhase) => {
  const labels = new Map<number, string>();
  if (!('entries' in phase)) return labels;
  for (const item of phase.entries) {
    const from: FormatSource = item.source;
    const name = 'phase' in from ? phases.find((other) => other.key === from.phase)?.name : '';
    if (from.kind === 'RANK_RANGE')
      for (let rank = from.from; rank <= from.to; rank++)
        labels.set(item.seedFrom + rank - from.from, `${name} #${rank}`);
    else if (from.kind === 'REGISTRATION' || from.kind === 'EXPLICIT')
      for (let index = 0; index < from.count; index++)
        labels.set(item.seedFrom + index, `Seed ${item.seedFrom + index}`);
    else if (from.kind === 'PLACEMENT') {
      const origin = phases.find((other) => other.key === from.phase);
      const groups =
        origin?.kind === 'GROUPS'
          ? origin.tiers
              .filter((tier) => !from.tier || tier.key === from.tier)
              .reduce((total, tier) => total + tier.groupCount, 0)
          : 0;
      for (let index = 0; index < groups; index++)
        labels.set(item.seedFrom + index, `${name}: place ${from.placement} (${index + 1})`);
    }
  }
  return labels;
};

// What locking this plan would create, computed from the same builder locking will use.
export async function previewFormatPlan(plan: FormatPlan, stages: readonly StageRef[] = []) {
  const phases: PhasePreview[] = [];
  for (const phase of plan.phases) {
    if (phase.kind === 'QUALIFIER' || phase.kind === 'TEAM_FORMATION') {
      phases.push({
        key: phase.key,
        kind: phase.kind,
        name: phase.name,
        matchCount: 0,
        rounds: [],
        openings: [],
      });
      continue;
    }
    const graph = await phaseGraph(plan.phases, phase, stages);
    const automatic = automaticRoundStages(phase.stageId, graph.rounds, stages);
    const labels = sourceLabels(plan.phases, phase);
    const label = (entryRef: string | null | undefined) => {
      const seed = entryRef?.match(/^seed:(\d+)$/);
      if (seed) return labels.get(Number(seed[1])) ?? `Seed ${seed[1]}`;
      return entryRef === 'bye' ? 'Bye' : '';
    };
    const opening = (roundKey: string, lane: string) => ({
      lane,
      pairs: graph.nodes
        .filter((node) => node.roundKey === roundKey)
        .sort((a, b) => a.position - b.position)
        .map(
          (node) =>
            [label(node.slots[0].entryRef), label(node.slots[1].entryRef)] as [string, string],
        ),
    });
    phases.push({
      key: phase.key,
      kind: phase.kind,
      name: phase.name,
      matchCount: graph.nodes.length,
      rounds: graph.rounds.map((round) => ({
        key: round.key,
        lane: round.lane,
        name: round.name,
        stageId: round.stageId,
        automaticStageId: automatic[round.key],
        matches: graph.nodes.filter((node) => node.roundKey === round.key).length,
      })),
      openings:
        phase.kind === 'GROUPS'
          ? []
          : [
              opening('g1-r1', 'WINNERS'),
              ...(phase.kind === 'DOUBLE_ELIMINATION' && phase.losers
                ? [opening('g2-r1', 'LOSERS')]
                : []),
            ],
    });
  }
  return {
    phases,
    totalMatches: phases.reduce((total, phase) => total + phase.matchCount, 0),
  };
}
