import type {
  CompetitionBracketData,
  CompetitionNode,
  CompetitionRound,
} from './competition-types';

type Translate = (message: string, ...values: (string | number)[]) => string;
type Round = Pick<CompetitionRound, 'key' | 'lane' | 'position'> & { stageName?: string };
type RoundContext = { format: string; rounds: readonly Round[] };
const ordered = <T extends Round>(rounds: readonly T[]) =>
  [...rounds].sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));

// Display metadata only. Stored lanes, routes, seed placement and match numbers are never rewritten.
export function bracketRoundDetails(bracket: RoundContext, round: Round, tr: Translate) {
  const laneRounds = ordered(bracket.rounds.filter((item) => item.lane === round.lane));
  const index = laneRounds.findIndex((item) => item.key === round.key);
  const last = index === laneRounds.length - 1;
  const role =
    round.lane === 'FINALS'
      ? index === 0
        ? tr('Grand Finals')
        : tr('Bracket reset')
      : round.lane === 'WINNERS' && last
        ? tr(bracket.format === 'DOUBLE_ELIMINATION' ? 'Winners Finals' : 'Final')
        : round.lane === 'LOSERS' && last
          ? tr('Losers Finals')
          : round.lane === 'THIRD_PLACE'
            ? tr('Third-place match')
            : tr('Round {0}', index + 1);
  const group =
    round.lane === 'WINNERS'
      ? tr('Winners Bracket')
      : round.lane === 'LOSERS'
        ? tr('Losers Bracket')
        : round.lane.startsWith('GROUP_')
          ? tr('Group {0}', round.lane.slice(6))
          : round.lane === 'FINALS'
            ? ''
            : tr('Third-place match');
  const stage = round.stageName || tr('Stage');
  return { stage, role, group, label: [group, stage, role].filter(Boolean).join(' / ') };
}

export function bracketSlotLabel(
  bracket: CompetitionBracketData,
  node: CompetitionNode,
  side: 'A' | 'B',
  tr: Translate,
) {
  const slot = node.slots.find((item) => item.side === side);
  const entry = bracket.entries.find((item) => item.teamId === slot?.teamId);
  if (entry) return entry.team.name;
  if (slot?.teamId) return tr('Participant');
  if (node.state === 'SKIPPED') return tr('Not required');
  if (slot?.resolved) return tr('Bye');
  const source = bracket.nodes.find((item) => item.id === slot?.sourceNodeId);
  const number = source?.match?.matchNumber || source?.matchNumber;
  if (number) {
    // The existing reset condition is a Grand Finals win by B: A is its loser,
    // B its winner. These conditional labels do not change the retained sides.
    if (slot?.outcome === 'LOSER' || slot?.outcome === 'RESET_A')
      return tr('Loser of Match #{0}', number);
    if (slot?.outcome === 'WINNER' || slot?.outcome === 'RESET_B')
      return tr('Winner of Match #{0}', number);
  }
  return slot?.sourceNodeId ? tr('Awaiting an earlier match') : tr('Pending');
}

export const BRACKET_CARD_WIDTH = 272;
const COLUMN = 320,
  ROW = 164,
  CARD_HEIGHT = 140,
  INSET = 20;
export function bracketPresentation(bracket: CompetitionBracketData) {
  const rounds = ordered(bracket.rounds);
  const positions = new Map<string, { x: number; y: number }>();
  const headers: { round: CompetitionRound; x: number; y: number }[] = [];
  const sections: { lane: string; x: number; y: number; width: number }[] = [];
  const nodes = (round: CompetitionRound) =>
    bracket.nodes
      .filter((node) => node.roundId === round.id)
      .sort((a, b) => a.position - b.position);
  let height = 0,
    width = BRACKET_CARD_WIDTH + INSET * 2;
  const de = bracket.format === 'DOUBLE_ELIMINATION';
  const lanes = de ? ['WINNERS', 'LOSERS'] : [...new Set(rounds.map((round) => round.lane))];
  const winners = rounds.filter((round) => round.lane === 'WINNERS');
  const losers = rounds.filter((round) => round.lane === 'LOSERS');
  const branchColumns = Math.max(winners.length, losers.length, 1);
  const bandCenters = new Map<string, number>();
  for (const lane of lanes) {
    const laneRounds = rounds.filter((round) => round.lane === lane);
    const count = Math.max(1, ...laneRounds.map((round) => nodes(round).length));
    const bandHeight = count * ROW;
    const columns = de ? branchColumns : laneRounds.length;
    sections.push({ lane, x: INSET, y: height + 12, width: Math.max(1, columns) * COLUMN - 48 });
    bandCenters.set(lane, height + 100 + bandHeight / 2);
    laneRounds.forEach((round, index) => {
      const column =
        de && laneRounds.length > 1
          ? Math.round((index * (branchColumns - 1)) / (laneRounds.length - 1))
          : de
            ? branchColumns - 1
            : index;
      const x = INSET + column * COLUMN;
      headers.push({ round, x, y: height + 48 });
      const entries = nodes(round);
      entries.forEach((node, i) =>
        positions.set(node.id, {
          x,
          y:
            height + 100 + ((i + 0.5) * bandHeight) / Math.max(1, entries.length) - CARD_HEIGHT / 2,
        }),
      );
    });
    width = Math.max(width, Math.max(1, columns) * COLUMN + INSET * 2);
    height += bandHeight + 120;
  }
  if (de) {
    const finals = rounds.filter((round) => round.lane === 'FINALS');
    const center = ((bandCenters.get('WINNERS') || 0) + (bandCenters.get('LOSERS') || 0)) / 2;
    finals.forEach((round, index) => {
      const x = INSET + (branchColumns + index) * COLUMN;
      const entries = nodes(round);
      const start = center - CARD_HEIGHT / 2 - (Math.max(0, entries.length - 1) * ROW) / 2;
      headers.push({ round, x, y: start - 48 });
      entries.forEach((node, i) => positions.set(node.id, { x, y: start + i * ROW }));
    });
    width = Math.max(width, (branchColumns + finals.length) * COLUMN + INSET * 2);
  }
  const byId = new Map(bracket.nodes.map((node) => [node.id, node]));
  const roundById = new Map(rounds.map((round) => [round.id, round]));
  const connectors = bracket.nodes.flatMap((node) =>
    node.slots.flatMap((slot) => {
      const source = slot.sourceNodeId ? byId.get(slot.sourceNodeId) : null;
      if (!source) return [];
      const lane = roundById.get(node.roundId)?.lane;
      if (!lane || lane !== roundById.get(source.roundId)?.lane || (de && lane === 'FINALS'))
        return [];
      return [
        { sourceId: source.id, targetId: node.id, side: slot.side, lane, outcome: slot.outcome },
      ];
    }),
  );
  return { rounds, positions, headers, sections, connectors, width, height: Math.max(220, height) };
}
