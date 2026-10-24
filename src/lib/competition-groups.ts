import { Prisma } from '@/generated/prisma/client';
import { createHash } from 'node:crypto';
import { groupStandings } from './competition-engine';
import type { CompetitionNode, CompetitionRound } from './competition-types';
import { AppError } from './permissions';

export type GroupConfig = {
  advancePerGroup?: number;
  groupTieOrder?: string[];
  groupTieSourceHash?: string;
  sourceBracketId?: string;
  groupSource?: {
    bracketId: string;
    sourceHash: string;
    seeds: { teamId: string; seed: number }[];
  };
};
export function groupResultsHash(
  bracketId: string,
  nodes: CompetitionNode[],
  rounds: CompetitionRound[],
  count: number,
) {
  return createHash('sha256')
    .update(
      stable({
        bracketId,
        count,
        rounds: rounds.map((r) => [r.id, r.lane]).sort(),
        nodes: nodes
          .filter((n) => n.bracketId === bracketId)
          .map((n) => ({
            id: n.id,
            slots: [...n.slots]
              .sort((a, b) => a.side.localeCompare(b.side))
              .map((s) => [s.side, s.teamId, s.resolved]),
            result: n.match
              ? [n.match.status, n.match.winnerSide, n.match.scoreA, n.match.scoreB]
              : null,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      }),
    )
    .digest('hex');
}
export function reviewedGroupOrder(
  bracket: { id: string; config: Prisma.JsonValue; rounds: CompetitionRound[] },
  nodes: CompetitionNode[],
) {
  const config = bracket.config as GroupConfig;
  return config.groupTieSourceHash ===
    groupResultsHash(bracket.id, nodes, bracket.rounds, config.advancePerGroup || 2)
    ? config.groupTieOrder || []
    : [];
}
export function resolvedGroupSeeds(
  bracket: {
    id: string;
    format: string;
    config: Prisma.JsonValue;
    rounds: CompetitionRound[];
    entries: { teamId: string; seed: number; status: string }[];
  },
  nodes: CompetitionNode[],
) {
  if (bracket.format !== 'GROUPS') throw new AppError('Choose a group-stage competition.');
  const path = nodes.filter((n) => n.bracketId === bracket.id),
    config = bracket.config as GroupConfig;
  if (
    !path.length ||
    !path.every(
      (n) =>
        n.state === 'BYE' ||
        n.state === 'SKIPPED' ||
        (n.match?.status === 'COMPLETED' && n.match.winnerSide),
    )
  )
    throw new AppError(
      'Complete and confirm every group fixture before generating downstream brackets.',
      409,
    );
  const order = reviewedGroupOrder(bracket, path);
  const rows = groupStandings(
    path,
    bracket.rounds,
    bracket.entries,
    config.advancePerGroup || 2,
    order,
  );
  if (rows.some((r) => r.tied))
    throw new AppError(
      'Review and resolve tied group standings before generating a downstream bracket.',
      409,
    );
  const seeds = rows
    .filter(
      (r) => r.qualified && bracket.entries.find((e) => e.teamId === r.teamId)?.status === 'ACTIVE',
    )
    .sort((a, b) => a.rank - b.rank || a.group.localeCompare(b.group, 'en', { numeric: true }))
    .map((r, index) => ({ teamId: r.teamId, seed: index + 1 }));
  const sourceHash = createHash('sha256')
    .update(
      stable({
        results: groupResultsHash(bracket.id, path, bracket.rounds, config.advancePerGroup || 2),
        order,
        seeds,
      }),
    )
    .digest('hex');
  return { seeds, sourceHash };
}
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
