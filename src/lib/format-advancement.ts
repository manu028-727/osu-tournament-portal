import { createHash } from 'node:crypto';
import type { CompetitionNode, CompetitionRound } from './competition-types';
import type { PhaseGraph, SeedPair } from './format-graph';
import { GROUP_TIEBREAKERS, type FormatPhase, type FormatSource } from './format-plan';
import { AppError } from './permissions';

export type GroupsPhase = Extract<FormatPhase, { kind: 'GROUPS' }>;
type EliminationPhase = Extract<FormatPhase, { kind: 'SINGLE_ELIMINATION' | 'DOUBLE_ELIMINATION' }>;
type Tiebreaker = (typeof GROUP_TIEBREAKERS)[number];

export type SourceEntrant = {
  teamId: string;
  seed: number;
  value?: number | null;
  status?: string;
};
export type DrawnGroup = {
  group: number;
  label: string;
  tier: string;
  teams: { teamId: string; seed: number; pot: number; seat: number }[];
};
export type RankedRow = {
  group: number;
  teamId: string;
  seed: number;
  status: string;
  played: number;
  wins: number;
  losses: number;
  mapsWon: number;
  mapsLost: number;
  mapDifference: number;
  placement: number;
  tied: boolean;
};
export type AdvancementSeat = {
  seed: number;
  lane: 'WINNERS' | 'LOSERS';
  teamId: string | null;
  sourcePhase: string;
  sourceRule: FormatSource['kind'];
  detail: string;
};
export type AdvancementIssue = {
  code: string;
  severity: 'ERROR' | 'WARNING';
  message: string;
  values?: (string | number)[];
};

// A reproducible draw: the stored seed and entrants always give the same groups, so a
// draw can be audited without trusting whoever pressed the button.
function seededShuffle<T>(items: readonly T[], seed: string, scope: string) {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const digest = createHash('sha256').update(`${seed}:${scope}:${i}`).digest();
    const j = digest.readUInt32BE(0) % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function groupLabel(phase: Pick<GroupsPhase, 'labels'>, index: number) {
  return phase.labels === 'LETTERS'
    ? `Group ${String.fromCharCode(65 + index)}`
    : `Group ${index + 1}`;
}

// Pots hold consecutive seeds: with four groups of four, seeds 5-8 form the first pot.
export function drawGroups(
  phase: GroupsPhase,
  entrants: readonly SourceEntrant[],
  options: { randomSeed?: string; manual?: Record<string, string[][]> } = {},
): { groups: DrawnGroup[]; issues: AdvancementIssue[] } {
  const issues: AdvancementIssue[] = [];
  const groups: DrawnGroup[] = [];
  const bySeed = new Map(entrants.map((entrant) => [entrant.seed, entrant]));
  let group = 0;
  for (const tier of phase.tiers) {
    const seats: DrawnGroup[] = Array.from({ length: tier.groupCount }, () => {
      group++;
      return { group, label: '', tier: tier.key, teams: [] };
    });
    const pots = Array.from({ length: tier.groupSize }, (_, pot) =>
      Array.from({ length: tier.groupCount }, (_, offset) => {
        const seed = tier.seedFrom + pot * tier.groupCount + offset;
        return { seed, teamId: bySeed.get(seed)?.teamId ?? null, pot };
      }),
    );
    if (pots.flat().some((entry) => !entry.teamId)) {
      issues.push({
        code: 'MISSING_ENTRANT',
        severity: 'ERROR',
        message: 'Every seed in {0} needs an entrant before the draw.',
        values: [tier.name],
      });
      groups.push(...seats);
      continue;
    }
    if (phase.draw === 'MANUAL') {
      const manual = options.manual?.[tier.key];
      if (!manual || manual.length !== tier.groupCount) {
        issues.push({
          code: 'MANUAL_DRAW_REQUIRED',
          severity: 'ERROR',
          message: 'Enter the drawn groups for {0}.',
          values: [tier.name],
        });
        groups.push(...seats);
        continue;
      }
      const used = new Set<string>();
      manual.forEach((members, index) => {
        const potsInGroup = new Set<number>();
        members.forEach((teamId, seat) => {
          const entry = pots.flat().find((item) => item.teamId === teamId);
          if (!entry || used.has(teamId)) {
            issues.push({
              code: 'INVALID_MANUAL_DRAW',
              severity: 'ERROR',
              message: 'Each entrant in {0} must be drawn exactly once.',
              values: [tier.name],
            });
            return;
          }
          used.add(teamId);
          potsInGroup.add(entry.pot);
          seats[index].teams.push({ teamId, seed: entry.seed, pot: entry.pot, seat: seat + 1 });
        });
        if (members.length !== tier.groupSize || potsInGroup.size !== members.length)
          issues.push({
            code: 'POT_IMBALANCE',
            severity: 'WARNING',
            message: 'A group in {0} does not hold one entrant from each pot.',
            values: [tier.name],
          });
      });
      groups.push(...seats);
      continue;
    }
    pots.forEach((pot, potIndex) => {
      let order = pot;
      if (phase.draw === 'RANDOM_BY_POT') {
        if (!options.randomSeed) throw new AppError('A random draw needs a stored seed.', 409);
        order = seededShuffle(pot, options.randomSeed, `${tier.key}:${potIndex}`);
      } else if (potIndex % 2) order = [...pot].reverse();
      order.forEach((entry, index) =>
        seats[index].teams.push({
          teamId: entry.teamId!,
          seed: entry.seed,
          pot: entry.pot,
          seat: potIndex + 1,
        }),
      );
    });
    groups.push(...seats);
  }
  return { groups: labelGroups(phase, groups, entrants), issues };
}

// Letters run across tiers, so a stronger tier's groups always come first.
function labelGroups(
  phase: GroupsPhase,
  groups: DrawnGroup[],
  entrants: readonly SourceEntrant[],
): DrawnGroup[] {
  const average = (group: DrawnGroup) => {
    const values = group.teams.map(
      (team) => entrants.find((entrant) => entrant.teamId === team.teamId)?.value ?? 0,
    );
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
  };
  const labelled: DrawnGroup[] = [];
  for (const tier of phase.tiers) {
    const inTier = groups.filter((group) => group.tier === tier.key);
    const ordered =
      phase.labelOrder === 'SOURCE_AGGREGATE'
        ? [...inTier].sort((a, b) => average(b) - average(a) || a.group - b.group)
        : inTier;
    for (const group of ordered)
      labelled.push({ ...group, label: groupLabel(phase, labelled.length) });
  }
  return labelled.sort((a, b) => a.group - b.group);
}

function countResults(
  nodes: readonly CompetitionNode[],
  rounds: readonly CompetitionRound[],
  entries: readonly { teamId: string; seed: number; status?: string }[],
  phase: Pick<GroupsPhase, 'forfeitMapDifference'>,
) {
  const rows = new Map<string, RankedRow>();
  const key = (group: number, teamId: string) => `${group}:${teamId}`;
  const meetings: { group: number; a: string; b: string; winner: string }[] = [];
  let complete = true;
  for (const node of nodes) {
    const lane = rounds.find((round) => round.id === node.roundId)?.lane;
    if (!lane?.startsWith('GROUP_')) continue;
    const group = Number(lane.slice(6));
    for (const slot of node.slots)
      if (slot.teamId && !rows.has(key(group, slot.teamId))) {
        const entry = entries.find((item) => item.teamId === slot.teamId);
        rows.set(key(group, slot.teamId), {
          group,
          teamId: slot.teamId,
          seed: entry?.seed ?? Number.MAX_SAFE_INTEGER,
          status: entry?.status ?? 'ACTIVE',
          played: 0,
          wins: 0,
          losses: 0,
          mapsWon: 0,
          mapsLost: 0,
          mapDifference: 0,
          placement: 0,
          tied: false,
        });
      }
    const finished = node.match?.status === 'COMPLETED' && node.match.winnerSide;
    if (!finished) {
      if (node.state !== 'BYE' && node.state !== 'SKIPPED') complete = false;
      continue;
    }
    const match = node.match!;
    const [a, b] = (['A', 'B'] as const).map((side) =>
      node.slots.find((slot) => slot.side === side)!,
    );
    if (!a.teamId || !b.teamId) continue;
    meetings.push({
      group,
      a: a.teamId,
      b: b.teamId,
      winner: match.winnerSide === 'A' ? a.teamId : b.teamId,
    });
    const countsMaps = !(match.forfeitSide && phase.forfeitMapDifference === 'IGNORE');
    for (const slot of [a, b]) {
      const row = rows.get(key(group, slot.teamId!))!;
      const won = slot.side === 'A' ? match.scoreA : match.scoreB;
      const lost = slot.side === 'A' ? match.scoreB : match.scoreA;
      row.played++;
      row.wins += Number(match.winnerSide === slot.side);
      row.losses += Number(match.winnerSide !== slot.side);
      if (countsMaps) {
        row.mapsWon += won;
        row.mapsLost += lost;
        row.mapDifference += won - lost;
      }
    }
  }
  return { rows: [...rows.values()], meetings, complete };
}

// Each criterion splits only the entrants still level, so head-to-head reads just the
// tied mini-league. Whoever is still level after the whole chain needs a human decision.
function applyChain(
  rows: RankedRow[],
  chain: readonly Tiebreaker[],
  meetings: readonly { a: string; b: string; winner: string }[],
  reviewedOrder: readonly string[],
): { row: RankedRow; tied: boolean }[] {
  const metric = (criterion: Tiebreaker, row: RankedRow, level: readonly RankedRow[]) => {
    if (criterion === 'MATCH_WINS') return row.wins;
    if (criterion === 'MAP_DIFFERENCE') return row.mapDifference;
    if (criterion === 'MAPS_WON') return row.mapsWon;
    if (criterion === 'QUALIFIER_SEED') return -row.seed;
    const ids = new Set(level.map((other) => other.teamId));
    return meetings.filter(
      (meeting) => ids.has(meeting.a) && ids.has(meeting.b) && meeting.winner === row.teamId,
    ).length;
  };
  const split = (level: RankedRow[], index: number): { row: RankedRow; tied: boolean }[] => {
    if (level.length <= 1) return level.map((row) => ({ row, tied: false }));
    if (index >= chain.length) {
      const reviewed = level.every((row) => reviewedOrder.includes(row.teamId));
      const order = reviewed
        ? [...level].sort(
            (a, b) => reviewedOrder.indexOf(a.teamId) - reviewedOrder.indexOf(b.teamId),
          )
        : [...level].sort((a, b) => a.teamId.localeCompare(b.teamId));
      return order.map((row) => ({ row, tied: !reviewed }));
    }
    const values = new Map(level.map((row) => [row.teamId, metric(chain[index], row, level)]));
    const distinct = [...new Set(values.values())].sort((a, b) => b - a);
    return distinct.flatMap((value) =>
      split(
        level.filter((row) => values.get(row.teamId) === value),
        index + 1,
      ),
    );
  };
  return split(rows, 0);
}

export function rankGroups(
  phase: Pick<GroupsPhase, 'forfeitMapDifference' | 'tiebreakers'>,
  nodes: readonly CompetitionNode[],
  rounds: readonly CompetitionRound[],
  entries: readonly { teamId: string; seed: number; status?: string }[],
  reviewedOrder: readonly string[] = [],
) {
  const { rows, meetings, complete } = countResults(nodes, rounds, entries, phase);
  const ranked: RankedRow[] = [];
  for (const group of [...new Set(rows.map((row) => row.group))].sort((a, b) => a - b)) {
    const inGroup = rows.filter((row) => row.group === group);
    applyChain(
      inGroup,
      phase.tiebreakers,
      meetings.filter((meeting) => meeting.group === group),
      reviewedOrder,
    ).forEach(({ row, tied }, index) => {
      ranked.push({ ...row, placement: index + 1, tied });
    });
  }
  return { rows: ranked, complete };
}

// Entrants from different groups never met, so head-to-head has no meaning across them.
function crossGroupOrder(
  rows: RankedRow[],
  chain: readonly Tiebreaker[],
  reviewedOrder: readonly string[],
) {
  return applyChain(
    rows,
    chain.filter((criterion) => criterion !== 'HEAD_TO_HEAD'),
    [],
    reviewedOrder,
  );
}

export type AdvancementSources = {
  registered?: readonly SourceEntrant[];
  qualifiers?: Record<string, readonly SourceEntrant[]>;
  groups?: Record<
    string,
    {
      phase: GroupsPhase;
      drawn: readonly DrawnGroup[];
      rows: readonly RankedRow[];
      complete: boolean;
    }
  >;
  explicit?: Record<string, readonly string[]>;
  reviewedOrder?: readonly string[];
};

export function resolveEntries(
  phase: EliminationPhase,
  sources: AdvancementSources,
): { seats: AdvancementSeat[]; issues: AdvancementIssue[] } {
  const seats: AdvancementSeat[] = [];
  const issues: AdvancementIssue[] = [];
  const seat = (
    item: EliminationPhase['entries'][number],
    offset: number,
    teamId: string | null,
    detail: string,
  ) => {
    seats.push({
      seed: item.seedFrom + offset,
      lane: 'lane' in item ? item.lane : 'WINNERS',
      teamId,
      sourcePhase: 'phase' in item.source ? item.source.phase : 'registration',
      sourceRule: item.source.kind,
      detail,
    });
  };
  for (const item of phase.entries) {
    const from = item.source;
    if (from.kind === 'REGISTRATION') {
      const entrants = [...(sources.registered || [])].sort((a, b) => a.seed - b.seed);
      for (let offset = 0; offset < from.count; offset++) {
        if (!entrants[offset])
          issues.push({
            code: 'NOT_ENOUGH_ENTRANTS',
            severity: 'WARNING',
            message: 'Rank {0} has no entrant, so its opponent receives a bye.',
            values: [offset + 1],
          });
        seat(item, offset, entrants[offset]?.teamId ?? null, `Seed ${offset + 1}`);
      }
    } else if (from.kind === 'RANK_RANGE' || from.kind === 'ALL') {
      const entrants = sources.qualifiers?.[from.phase];
      if (!entrants) {
        issues.push({
          code: 'SOURCE_NOT_READY',
          severity: 'ERROR',
          message: 'Finalize {0} before advancing entrants.',
          values: [from.phase],
        });
        continue;
      }
      const start = from.kind === 'RANK_RANGE' ? from.from : 1;
      const end = from.kind === 'RANK_RANGE' ? from.to : entrants.length;
      for (let rank = start; rank <= end; rank++) {
        const entrant = entrants.find((candidate) => candidate.seed === rank);
        if (entrant?.status && entrant.status !== 'ACTIVE')
          issues.push({
            code: 'INACTIVE_ENTRANT',
            severity: 'ERROR',
            message: 'Seed {0} is no longer active. Choose a replacement or leave a bye.',
            values: [rank],
          });
        if (!entrant)
          issues.push({
            code: 'NOT_ENOUGH_ENTRANTS',
            severity: 'WARNING',
            message: 'Rank {0} has no entrant, so its opponent receives a bye.',
            values: [rank],
          });
        seat(item, rank - start, entrant?.teamId ?? null, `Rank ${rank}`);
      }
    } else if (from.kind === 'EXPLICIT') {
      const chosen = sources.explicit?.[from.phase];
      if (!chosen || chosen.length !== from.count) {
        issues.push({
          code: 'EXPLICIT_REQUIRED',
          severity: 'ERROR',
          message: 'Choose all {0} entrants from {1}.',
          values: [from.count, from.phase],
        });
        continue;
      }
      chosen.forEach((teamId, index) => seat(item, index, teamId, `Choice ${index + 1}`));
    } else {
      const source = sources.groups?.[from.phase];
      if (!source || !source.complete) {
        issues.push({
          code: 'SOURCE_NOT_READY',
          severity: 'ERROR',
          message: 'Complete every group in {0} before advancing entrants.',
          values: [from.phase],
        });
        continue;
      }
      const groups = source.drawn.filter((group) => !from.tier || group.tier === from.tier);
      const rows = source.rows.filter(
        (row) =>
          row.placement === from.placement && groups.some((group) => group.group === row.group),
      );
      if (rows.some((row) => row.tied))
        issues.push({
          code: 'UNRESOLVED_TIE',
          severity: 'ERROR',
          message: 'Review the tied group standings before advancing placement {0}.',
          values: [from.placement],
        });
      const labelOf = (row: RankedRow) =>
        source.drawn.find((group) => group.group === row.group)?.label || `Group ${row.group}`;
      let ordered: { row: RankedRow; tied: boolean }[];
      if (from.orderWithin === 'GROUP_LABEL') {
        ordered = [...rows]
          .sort((a, b) => labelOf(a).localeCompare(labelOf(b), 'en', { numeric: true }))
          .map((row) => ({ row, tied: false }));
      } else {
        ordered = crossGroupOrder(rows, source.phase.tiebreakers, sources.reviewedOrder || []);
        if (ordered.some((entry) => entry.tied))
          issues.push({
            code: 'UNRESOLVED_TIE',
            severity: 'ERROR',
            message: 'Review the tie between placement {0} entrants across groups.',
            values: [from.placement],
          });
      }
      ordered.forEach(({ row }, index) => {
        if (row.status !== 'ACTIVE')
          issues.push({
            code: 'INACTIVE_ENTRANT',
            severity: 'ERROR',
            message: 'An entrant advancing from {0} is no longer active.',
            values: [labelOf(row)],
          });
        seat(item, index, row.teamId, `${labelOf(row)} #${from.placement}`);
      });
    }
  }
  return { seats: seats.sort((a, b) => a.seed - b.seed), issues };
}

export type RematchChange = { seed: number; from: string; to: string };

// Keeps the better half of each pair fixed and moves their opponents. Better seeds are
// settled first and take the closest allowed opponent, so changes fall on weaker seeds;
// the search backtracks rather than strand a later pair, and reports when nothing fits.
export function avoidRematches(
  pairs: readonly SeedPair[],
  seats: readonly AdvancementSeat[],
  metBefore: (a: string, b: string) => boolean,
): {
  seats: AdvancementSeat[];
  changes: RematchChange[];
  issues: AdvancementIssue[];
} {
  const bySeed = new Map(seats.map((seat) => [seat.seed, seat]));
  const fixed = pairs
    .filter((pair): pair is [number, number] => pair[0] !== null && pair[1] !== null)
    .map(([a, b]) => (a < b ? ([a, b] as const) : ([b, a] as const)))
    .sort((x, y) => x[0] - y[0]);
  const opponents = fixed.map(([, b]) => b);
  const assignment: number[] = [];
  const used = new Set<number>();
  const clash = (a: number, b: number) => {
    const teamA = bySeed.get(a)?.teamId;
    const teamB = bySeed.get(b)?.teamId;
    return !!teamA && !!teamB && metBefore(teamA, teamB);
  };
  const search = (index: number): boolean => {
    if (index === fixed.length) return true;
    const wanted = fixed[index][1];
    const candidates = opponents
      .filter((seed) => !used.has(seed))
      // Between equally close seeds, displace the weaker one so better seeds stay put.
      .sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted) || b - a);
    for (const candidate of candidates) {
      if (clash(fixed[index][0], candidate)) continue;
      used.add(candidate);
      assignment[index] = candidate;
      if (search(index + 1)) return true;
      used.delete(candidate);
    }
    return false;
  };
  if (!search(0))
    return {
      seats: [...seats],
      changes: [],
      issues: [
        {
          code: 'REMATCH_INFEASIBLE',
          severity: 'ERROR',
          message: 'No pairing avoids every rematch. Set the opening matches manually.',
        },
      ],
    };
  // An entrant adopts the seed of the opponent slot they moved into.
  const moved = new Map<number, string | null>();
  fixed.forEach(([, wanted], index) => {
    if (assignment[index] !== wanted)
      moved.set(wanted, bySeed.get(assignment[index])?.teamId ?? null);
  });
  const changes: RematchChange[] = [];
  const next = seats.map((seat) => {
    if (!moved.has(seat.seed)) return seat;
    const teamId = moved.get(seat.seed) ?? null;
    if (seat.teamId && teamId) changes.push({ seed: seat.seed, from: seat.teamId, to: teamId });
    return { ...seat, teamId, detail: `${seat.detail} (moved to avoid a rematch)` };
  });
  return { seats: next, changes, issues: [] };
}

// Entrants who shared a round-robin group have already played each other.
export const sharedGroup = (drawn: readonly DrawnGroup[]) => (a: string, b: string) =>
  drawn.some(
    (group) =>
      group.teams.some((team) => team.teamId === a) &&
      group.teams.some((team) => team.teamId === b),
  );

// Best remaining seed meets worst, in the same tree order as an opening round.
export function reseededPairs(survivors: readonly { teamId: string; seed: number }[]) {
  const ranked = [...survivors].sort((a, b) => a.seed - b.seed);
  if (ranked.length % 2) throw new AppError('A reseeded round needs an even field.', 409);
  return Array.from({ length: ranked.length / 2 }, (_, index) => [
    ranked[index].teamId,
    ranked[ranked.length - 1 - index].teamId,
  ]);
}

// Binds real teams into a placeholder graph. An unfilled seat is a settled absence, so
// its opponent gets a bye instead of waiting for someone who will never arrive.
export function bindSeats(graph: PhaseGraph, seats: readonly AdvancementSeat[]): PhaseGraph {
  const bySeed = new Map(seats.map((seat) => [seat.seed, seat.teamId]));
  return {
    rounds: graph.rounds,
    nodes: graph.nodes.map((node) => ({
      ...node,
      slots: node.slots.map((slot) => {
        if (slot.entryRef === 'bye') return { ...slot, teamId: null, resolved: true };
        const seat = slot.entryRef?.match(/^seed:(\d+)$/);
        return seat
          ? { ...slot, teamId: bySeed.get(Number(seat[1])) ?? null, resolved: true }
          : slot;
      }),
    })),
  };
}

export function bindGroups(graph: PhaseGraph, drawn: readonly DrawnGroup[]): PhaseGraph {
  const seated = new Map<string, string>(
    drawn.flatMap((group) =>
      group.teams.map((team) => [`group:${group.group}:seat:${team.seat}`, team.teamId] as const),
    ),
  );
  const labels = new Map(drawn.map((group) => [`GROUP_${group.group}`, group.label]));
  return {
    rounds: graph.rounds.map((round) => {
      const label = labels.get(round.lane);
      return label ? { ...round, name: `${label} ${round.key.split('-r')[1]}` } : round;
    }),
    nodes: graph.nodes.map((node) => ({
      ...node,
      slots: node.slots.map((slot) => {
        const teamId = slot.entryRef ? seated.get(slot.entryRef) : undefined;
        return teamId ? { ...slot, teamId, resolved: true } : slot;
      }),
    })),
  };
}
