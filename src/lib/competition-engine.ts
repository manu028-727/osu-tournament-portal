import {
  BracketsManager,
  helpers,
  type CrudInterface,
  type Database,
  type DataTypes,
  type Table,
  type OmitId,
} from 'brackets-manager';
import type { Id, Match as EngineMatch } from 'brackets-model';
import { AppError } from './permissions';
import type { CompetitionCreate } from './competition-validation';
import type {
  CompetitionNode,
  CompetitionRound,
  CompetitionSlot,
  GroupStanding,
} from './competition-types';

// The upstream manager owns seed placement and routing; this adapter never touches a database.
class MemoryStorage implements CrudInterface {
  data: Database = { participant: [], stage: [], group: [], round: [], match: [], match_game: [] };
  async insert<T extends Table>(table: T, value: OmitId<DataTypes[T]>): Promise<Id>;
  async insert<T extends Table>(table: T, value: OmitId<DataTypes[T]>[]): Promise<boolean>;
  async insert<T extends Table>(
    table: T,
    value: OmitId<DataTypes[T]> | OmitId<DataTypes[T]>[],
  ): Promise<Id | boolean> {
    if (Array.isArray(value)) {
      for (const item of value) await this.insert(table, item);
      return true;
    }
    const rows = this.data[table] as DataTypes[T][];
    const id = rows.reduce((max, row) => Math.max(max, Number(row.id) + 1), 0);
    rows.push({ ...structuredClone(value), id } as DataTypes[T]);
    return id;
  }
  async select<T extends Table>(table: T): Promise<DataTypes[T][]>;
  async select<T extends Table>(table: T, id: Id): Promise<DataTypes[T] | null>;
  async select<T extends Table>(table: T, filter: Partial<DataTypes[T]>): Promise<DataTypes[T][]>;
  async select<T extends Table>(
    table: T,
    query?: Id | Partial<DataTypes[T]>,
  ): Promise<DataTypes[T][] | DataTypes[T] | null> {
    const rows = this.data[table] as DataTypes[T][];
    if (query !== undefined && typeof query !== 'object')
      return structuredClone(rows.find((row) => row.id === query) ?? null);
    return structuredClone(
      rows.filter(
        (row) =>
          !query ||
          Object.entries(query).every(([key, value]) => row[key as keyof DataTypes[T]] === value),
      ),
    );
  }
  async update<T extends Table>(
    table: T,
    query: Id | Partial<DataTypes[T]>,
    value: Partial<DataTypes[T]>,
  ): Promise<boolean> {
    const filter = typeof query === 'object' ? query : { id: query };
    for (const row of this.data[table] as DataTypes[T][])
      if (Object.entries(filter).every(([key, item]) => row[key as keyof DataTypes[T]] === item))
        Object.assign(row, structuredClone(value));
    return true;
  }
  async delete<T extends Table>(table: T, filter?: Partial<DataTypes[T]>): Promise<boolean> {
    const rows = this.data[table] as DataTypes[T][];
    rows.splice(
      0,
      rows.length,
      ...rows.filter(
        (row) =>
          filter &&
          !Object.entries(filter).every(([key, value]) => row[key as keyof DataTypes[T]] === value),
      ),
    );
    return true;
  }
}
export type CompetitionPlan = {
  rounds: Omit<CompetitionRound, 'id'>[];
  nodes: {
    key: string;
    roundKey: string;
    position: number;
    slots: (Omit<CompetitionSlot, 'sourceNodeId'> & { sourceKey: string | null })[];
  }[];
};
export async function generateCompetition(
  input: Pick<
    CompetitionCreate,
    | 'teamIds'
    | 'format'
    | 'thirdPlace'
    | 'grandFinalReset'
    | 'groupCount'
    | 'stageId'
    | 'roundStages'
  >,
): Promise<CompetitionPlan> {
  if (new Set(input.teamIds).size !== input.teamIds.length)
    throw new AppError('Each participant can be seeded only once.');
  if (input.teamIds.length < 2 || input.teamIds.length > 128)
    throw new AppError('Choose between 2 and 128 participants.');
  if (input.format === 'GROUPS' && input.groupCount > Math.floor(input.teamIds.length / 2))
    throw new AppError('Every group needs at least two participants.');
  const storage = new MemoryStorage(),
    manager = new BracketsManager(storage);
  const type =
    input.format === 'GROUPS'
      ? 'round_robin'
      : input.format === 'DOUBLE_ELIMINATION'
        ? 'double_elimination'
        : 'single_elimination';
  const size =
    input.format === 'GROUPS'
      ? input.teamIds.length
      : 2 ** Math.ceil(Math.log2(input.teamIds.length));
  await manager.create.stage({
    tournamentId: 0,
    name: 'Competition',
    type,
    seeding: [...input.teamIds, ...Array<string | null>(size - input.teamIds.length).fill(null)],
    settings: {
      size,
      groupCount: input.groupCount,
      seedOrdering: type === 'round_robin' ? ['groups.seed_optimized'] : ['inner_outer'],
      balanceByes: true,
      grandFinal: input.grandFinalReset ? 'double' : 'simple',
      consolationFinal: input.thirdPlace && type === 'single_elimination',
    },
  });
  const data = await manager.export();
  const key = (m: EngineMatch) =>
    `g${data.group.find((g) => g.id === m.group_id)!.number}-r${data.round.find((r) => r.id === m.round_id)!.number}-m${m.number}`;
  const roundKey = (group: number, round: number) => `g${group}-r${round}`;
  const rounds: CompetitionPlan['rounds'] = data.round.map((r, index) => {
    const group = data.group.find((g) => g.id === r.group_id)!.number;
    const lane =
      type === 'round_robin'
        ? `GROUP_${group}`
        : group === 1
          ? 'WINNERS'
          : type === 'double_elimination' && group === 2
            ? 'LOSERS'
            : input.thirdPlace && type === 'single_elimination'
              ? 'THIRD_PLACE'
              : 'FINALS';
    const k = roundKey(group, r.number);
    return {
      key: k,
      name: `${lane.replaceAll('_', ' ')} ${r.number}`,
      lane,
      position: index,
      stageId: input.roundStages[k] || input.stageId,
    };
  });
  const nodes: CompetitionPlan['nodes'] = data.match.map((m) => ({
    key: key(m),
    roundKey: roundKey(
      data.group.find((g) => g.id === m.group_id)!.number,
      data.round.find((r) => r.id === m.round_id)!.number,
    ),
    position: m.number,
    slots: (['A', 'B'] as const).map((side, index) => {
      const opponent = index ? m.opponent2 : m.opponent1;
      return {
        side,
        teamId:
          opponent?.id == null ? null : data.participant.find((p) => p.id === opponent.id)!.name,
        resolved: true,
        mode: 'AUTO',
        sourceKey: null,
        outcome: null,
      };
    }),
  }));
  if (type !== 'round_robin')
    for (const m of data.match) {
      const group = data.group.find((g) => g.id === m.group_id)!,
        round = data.round.find((r) => r.id === m.round_id)!;
      const location = helpers.getMatchLocation(type, group.number);
      const count = data.round.filter((r) => r.group_id === group.id).length;
      const next = await manager.find.nextMatches(m.id);
      for (const target of next) {
        const targetNode = nodes.find((n) => n.key === key(target))!;
        const targetGroup = data.group.find((g) => g.id === target.group_id)!;
        if (location === 'final_group') {
          for (const slot of targetNode.slots)
            Object.assign(slot, {
              sourceKey: key(m),
              outcome: slot.side === 'A' ? 'RESET_A' : 'RESET_B',
              teamId: null,
              resolved: false,
            });
          continue;
        }
        const losingRoute =
          (type === 'single_elimination' && targetGroup.number !== 1) ||
          (location === 'winner_bracket' && targetGroup.number === 2);
        const targetSide =
          losingRoute && type === 'double_elimination'
            ? helpers.getNextSideLoserBracket(m.number, target, round.number)
            : helpers.getNextSide(m.number, round.number, count, location);
        const slot = targetNode.slots.find(
          (s) => s.side === (targetSide === 'opponent1' ? 'A' : 'B'),
        )!;
        Object.assign(slot, {
          sourceKey: key(m),
          outcome: losingRoute ? 'LOSER' : 'WINNER',
          teamId: null,
          resolved: false,
        });
      }
    }
  // Upstream intentionally simplifies two-player DE to SE. Retain the second-loss rule here.
  if (type === 'double_elimination' && size === 2) {
    rounds.push({
      key: 'g3-r1',
      name: 'FINALS 1',
      lane: 'FINALS',
      position: rounds.length,
      stageId: input.roundStages['g3-r1'] || input.stageId,
    });
    nodes.push({
      key: 'g3-r1-m1',
      roundKey: 'g3-r1',
      position: 1,
      slots: (['A', 'B'] as const).map((side) => ({
        side,
        teamId: null,
        resolved: false,
        mode: 'AUTO',
        sourceKey: nodes[0].key,
        outcome: side === 'A' ? 'WINNER' : 'LOSER',
      })),
    });
    if (input.grandFinalReset) {
      rounds.push({
        key: 'g3-r2',
        name: 'FINALS 2',
        lane: 'FINALS',
        position: rounds.length,
        stageId: input.roundStages['g3-r2'] || input.stageId,
      });
      nodes.push({
        key: 'g3-r2-m1',
        roundKey: 'g3-r2',
        position: 1,
        slots: (['A', 'B'] as const).map((side) => ({
          side,
          teamId: null,
          resolved: false,
          mode: 'AUTO',
          sourceKey: 'g3-r1-m1',
          outcome: side === 'A' ? 'RESET_A' : 'RESET_B',
        })),
      });
    }
  }
  return { rounds, nodes };
}

export function competitionOrder(nodes: CompetitionNode[]): CompetitionNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n])),
    done = new Set<string>(),
    active = new Set<string>(),
    sorted: CompetitionNode[] = [];
  const visit = (node: CompetitionNode) => {
    if (done.has(node.id)) return;
    if (active.has(node.id)) throw new AppError('Progression must not contain cycles.', 409);
    active.add(node.id);
    for (const slot of node.slots)
      if (slot.sourceNodeId) {
        const source = byId.get(slot.sourceNodeId);
        if (!source) throw new AppError('The progression source is outside this tournament.', 409);
        visit(source);
      }
    active.delete(node.id);
    done.add(node.id);
    sorted.push(node);
  };
  nodes.forEach(visit);
  return sorted;
}
export function competitionOutput(
  node: CompetitionNode,
  outcome: string | null,
): { teamId: string | null; resolved: boolean } {
  const a = node.slots.find((s) => s.side === 'A')!,
    b = node.slots.find((s) => s.side === 'B')!;
  if (!a.resolved || !b.resolved) return { teamId: null, resolved: false };
  let winner: 'A' | 'B' | null = null;
  if (!a.teamId || !b.teamId) winner = a.teamId ? 'A' : b.teamId ? 'B' : null;
  else if (node.match?.status === 'COMPLETED') winner = node.match.winnerSide;
  else return { teamId: null, resolved: false };
  if (outcome === 'RESET_A' || outcome === 'RESET_B')
    return {
      teamId: winner === 'B' ? (outcome === 'RESET_A' ? a.teamId : b.teamId) : null,
      resolved: true,
    };
  return {
    teamId: !winner
      ? null
      : outcome === 'LOSER'
        ? winner === 'A'
          ? b.teamId
          : a.teamId
        : winner === 'A'
          ? a.teamId
          : b.teamId,
    resolved: true,
  };
}
export function recalculateCompetition(nodes: CompetitionNode[]): CompetitionNode[] {
  const cloned = structuredClone(nodes),
    sorted = competitionOrder(cloned),
    byId = new Map(cloned.map((n) => [n.id, n]));
  for (const node of sorted) {
    for (const slot of node.slots)
      if (slot.mode === 'AUTO' && slot.sourceNodeId)
        Object.assign(slot, competitionOutput(byId.get(slot.sourceNodeId)!, slot.outcome));
    const [a, b] = (['A', 'B'] as const).map((side) => node.slots.find((s) => s.side === side)!);
    if (a.teamId && a.teamId === b.teamId)
      throw new AppError('A participant cannot occupy both sides of a match.', 409);
    node.state =
      !a.resolved || !b.resolved
        ? 'WAITING'
        : !a.teamId && !b.teamId
          ? 'SKIPPED'
          : !a.teamId || !b.teamId
            ? 'BYE'
            : node.match?.status === 'COMPLETED'
              ? 'COMPLETED'
              : 'READY';
  }
  return cloned;
}
export function competitionChanges(before: CompetitionNode[], after: CompetitionNode[]) {
  return after.flatMap((node) => {
    const old = before.find((n) => n.id === node.id)!;
    const changed = node.slots.some((slot) => {
      const previous = old.slots.find((s) => s.side === slot.side)!;
      return slot.teamId !== previous.teamId || slot.resolved !== previous.resolved;
    });
    if (!changed || !old.match) return [];
    const protectedMatch = old.match.status !== 'SCHEDULED' || !!old.match.startedAt;
    return [
      {
        nodeId: node.id,
        matchId: old.match.id,
        code: old.match.code,
        matchNumber: old.match.matchNumber || null,
        protected: protectedMatch,
      },
    ];
  });
}
export function competitionEliminated(
  nodes: CompetitionNode[],
  rounds: CompetitionRound[],
  format: string,
  teamId: string,
): boolean {
  if (format === 'GROUPS') return false;
  const defeats = nodes.filter(
    (node) =>
      node.match?.status === 'COMPLETED' &&
      node.match.winnerSide &&
      (node.match.winnerSide === 'A' ? node.match.teamBId : node.match.teamAId) === teamId,
  );
  if (defeats.length >= (format === 'DOUBLE_ELIMINATION' ? 2 : 1)) return true;
  return defeats.some(
    (node) =>
      rounds.find((r) => r.id === node.roundId)?.lane === 'FINALS' &&
      !nodes.some((target) =>
        target.slots.some(
          (slot) =>
            slot.sourceNodeId === node.id &&
            slot.outcome?.startsWith('RESET_') &&
            slot.teamId === teamId,
        ),
      ),
  );
}
export function groupStandings(
  nodes: CompetitionNode[],
  rounds: CompetitionRound[],
  entries: { teamId: string; seed: number; status?: string }[],
  advancePerGroup: number,
  reviewedTieOrder: string[] = [],
): GroupStanding[] {
  const rows = new Map<string, GroupStanding>();
  for (const node of nodes) {
    const group = rounds.find((r) => r.id === node.roundId)?.lane;
    if (!group?.startsWith('GROUP_')) continue;
    for (const slot of node.slots)
      if (slot.teamId && !rows.has(`${group}:${slot.teamId}`))
        rows.set(`${group}:${slot.teamId}`, {
          group,
          teamId: slot.teamId,
          played: 0,
          wins: 0,
          losses: 0,
          mapDifference: 0,
          seed: entries.find((e) => e.teamId === slot.teamId)?.seed ?? 9999,
          rank: 0,
          qualified: false,
          tied: false,
        });
    if (node.match?.status !== 'COMPLETED' || !node.match.winnerSide) continue;
    for (const slot of node.slots)
      if (slot.teamId) {
        const row = rows.get(`${group}:${slot.teamId}`)!;
        row.played++;
        row.wins += Number(node.match.winnerSide === slot.side);
        row.losses += Number(node.match.winnerSide !== slot.side);
        row.mapDifference +=
          slot.side === 'A'
            ? node.match.scoreA - node.match.scoreB
            : node.match.scoreB - node.match.scoreA;
      }
  }
  const result: GroupStanding[] = [];
  for (const group of new Set([...rows.values()].map((r) => r.group))) {
    const sorted = [...rows.values()]
      .filter((r) => r.group === group)
      .sort(
        (a, b) =>
          b.wins - a.wins ||
          b.mapDifference - a.mapDifference ||
          (reviewedTieOrder.includes(a.teamId) && reviewedTieOrder.includes(b.teamId)
            ? reviewedTieOrder.indexOf(a.teamId) - reviewedTieOrder.indexOf(b.teamId)
            : 0) ||
          a.seed - b.seed ||
          a.teamId.localeCompare(b.teamId),
      );
    const complete = nodes
      .filter((n) => rounds.find((r) => r.id === n.roundId)?.lane === group)
      .every(
        (n) =>
          n.state === 'BYE' ||
          n.state === 'SKIPPED' ||
          (n.match?.status === 'COMPLETED' && !!n.match.winnerSide),
      );
    sorted.forEach((row, index) => {
      row.rank = index + 1;
      const peers = sorted.filter(
        (other) =>
          other.teamId !== row.teamId &&
          other.wins === row.wins &&
          other.mapDifference === row.mapDifference,
      );
      row.tieResolved =
        peers.length > 0 && [row, ...peers].every((peer) => reviewedTieOrder.includes(peer.teamId));
      row.tied = peers.length > 0 && !row.tieResolved;
      row.qualified =
        complete &&
        !row.tied &&
        index < advancePerGroup &&
        (entries.find((entry) => entry.teamId === row.teamId)?.status || 'ACTIVE') === 'ACTIVE';
    });
    result.push(...sorted);
  }
  return result;
}
