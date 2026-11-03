import type { FormatPhase, FormatPlan } from './format-plan';
import { formatSourceCount } from './format-plan';

// A client-safe description of who goes where, for drawing the phase flow.
export type FlowEdge = { from: string | null; to: string; lane: string | null; label: string };

export function formatFlow(plan: Pick<FormatPlan, 'phases'>): FlowEdge[] {
  const edges: FlowEdge[] = [];
  for (const phase of plan.phases) {
    if (!('entries' in phase)) continue;
    for (const item of phase.entries) {
      const from = item.source;
      const lane = 'lane' in item ? item.lane : null;
      const count = formatSourceCount(plan.phases, from);
      edges.push({
        from: 'phase' in from ? from.phase : null,
        to: phase.key,
        lane,
        label:
          from.kind === 'RANK_RANGE'
            ? `#${from.from}-${from.to}`
            : from.kind === 'PLACEMENT'
              ? `${from.tier ? `${from.tier}: ` : ''}#${from.placement}`
              : count === null
                ? ''
                : String(count),
      });
    }
  }
  return edges;
}

export const phaseEntrantCount = (phases: readonly FormatPhase[], phase: FormatPhase) =>
  'entries' in phase
    ? phase.entries.reduce(
        (total, item) => total + (formatSourceCount(phases, item.source) ?? 0),
        0,
      )
    : phase.kind === 'QUALIFIER'
      ? phase.advance
      : null;
