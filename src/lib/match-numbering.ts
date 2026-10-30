import type { Prisma } from '@/generated/prisma/client';
import { AppError } from './permissions';

export const MAX_MATCH_NUMBER = 2_147_483_647;

export function numericMatchIdentifier(value: string): number | null {
  if (!/^\d{1,10}$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= MAX_MATCH_NUMBER ? number : null;
}

export function restoreArchiveMatchNumbers(
  matches: { id?: unknown; code?: unknown; matchNumber?: unknown }[],
  nodes: { matchId?: unknown; matchNumber?: unknown }[],
  previousSequence: unknown = 0,
) {
  const valid = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_MATCH_NUMBER;
  const used = new Set<number>();
  const reserved = new Set(
    nodes.flatMap((node) => (valid(node.matchNumber) ? [node.matchNumber] : [])),
  );
  for (const match of matches) {
    if (match.matchNumber == null) continue;
    if (!valid(match.matchNumber) || used.has(match.matchNumber))
      throw new AppError('Archived match numbers must be positive and unique.');
    used.add(match.matchNumber);
  }
  const sourceCounts = new Map<number, number>();
  for (const match of matches) {
    const number = numericMatchIdentifier(String(match.code));
    if (number) sourceCounts.set(number, (sourceCounts.get(number) || 0) + 1);
  }
  for (const match of matches) {
    if (match.matchNumber != null) continue;
    const nodeNumber = nodes.find((node) => node.matchId === match.id)?.matchNumber;
    const number = valid(nodeNumber) ? nodeNumber : numericMatchIdentifier(String(match.code));
    if (
      number &&
      !used.has(number) &&
      (!reserved.has(number) || nodeNumber === number) &&
      (valid(nodeNumber) || sourceCounts.get(number) === 1)
    ) {
      match.matchNumber = number;
      used.add(number);
    }
  }
  let sequence = valid(previousSequence) ? previousSequence : 0;
  for (const number of [...used, ...reserved]) sequence = Math.max(sequence, number);
  for (const match of matches) {
    if (match.matchNumber != null) continue;
    if (++sequence > MAX_MATCH_NUMBER)
      throw new AppError('Archived match numbers exceed the supported range.');
    match.matchNumber = sequence;
  }
  for (const node of nodes) {
    const match = matches.find((match) => match.id === node.matchId);
    if (match && node.matchNumber == null) node.matchNumber = match.matchNumber;
    if (match && node.matchNumber !== match.matchNumber)
      throw new AppError(
        'An archived bracket position has a different number from its linked match.',
      );
  }
  return sequence;
}

export type NumberableNode = {
  id: string;
  bracketId: string;
  roundId: string;
  key: string;
  position: number;
  state: string;
  matchId?: string | null;
  matchNumber?: number | null;
};

export type NumberableRound = {
  id: string;
  position: number;
  lane: string;
  key: string;
  stagePosition: number;
};

function laneOrder(lane: string) {
  if (lane === 'WINNERS') return 0;
  if (lane === 'LOSERS') return 1;
  if (lane === 'THIRD_PLACE') return 2;
  if (lane === 'FINALS') return 3;
  return 4;
}

export function bracketNumberingOrder<T extends NumberableNode>(
  nodes: T[],
  rounds: NumberableRound[],
): T[] {
  const roundOrder = new Map(rounds.map((round) => [round.id, round]));
  return [...nodes].sort((a, b) => {
    const roundA = roundOrder.get(a.roundId),
      roundB = roundOrder.get(b.roundId);
    if (!roundA || !roundB) throw new AppError('Bracket round ordering is incomplete.', 409);
    return (
      roundA.stagePosition - roundB.stagePosition ||
      laneOrder(roundA.lane) - laneOrder(roundB.lane) ||
      roundA.lane.localeCompare(roundB.lane, 'en', { numeric: true }) ||
      roundA.position - roundB.position ||
      a.position - b.position ||
      a.key.localeCompare(b.key) ||
      a.id.localeCompare(b.id)
    );
  });
}

export function numberBracketNodes<T extends NumberableNode>(
  nodes: T[],
  rounds: NumberableRound[],
  firstNumber: number,
): Map<string, number> {
  if (!Number.isSafeInteger(firstNumber) || firstNumber < 1)
    throw new AppError('The first bracket match number must be a positive integer.', 409);
  if (firstNumber + nodes.length - 1 > MAX_MATCH_NUMBER)
    throw new AppError('The tournament has exhausted its available match numbers.', 409);
  return new Map(
    bracketNumberingOrder(nodes, rounds).map((node, index) => [node.id, firstNumber + index]),
  );
}

export async function allocateMatchNumber(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  preferred?: number | null,
): Promise<number> {
  const rows = await tx.$queryRaw<{ matchNumberSequence: number }[]>`
    SELECT "matchNumberSequence"
    FROM "Tournament"
    WHERE "id" = ${tournamentId}
    FOR UPDATE
  `;
  const sequence = rows[0]?.matchNumberSequence;
  if (sequence === undefined) throw new AppError('Tournament not found.', 404);
  const number = preferred ?? sequence + 1;
  if (!Number.isSafeInteger(number) || number < 1 || number > MAX_MATCH_NUMBER)
    throw new AppError('The tournament has exhausted its available match numbers.', 409);
  if (preferred !== undefined && preferred !== null && preferred <= sequence)
    throw new AppError(
      'Match number {0} is already allocated or reserved in this tournament. Resolve the number conflict before importing.',
      409,
      [preferred],
    );
  await tx.tournament.update({
    where: { id: tournamentId },
    data: { matchNumberSequence: number },
  });
  return number;
}

export async function reserveBracketMatchNumbers(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  nodes: NumberableNode[],
  rounds: NumberableRound[],
): Promise<Map<string, number>> {
  const ordered = bracketNumberingOrder(
    nodes.filter(
      (node) =>
        !node.matchId && node.matchNumber == null && !['BYE', 'SKIPPED'].includes(node.state),
    ),
    rounds,
  );
  if (!ordered.length) return new Map();
  const count = ordered.length;
  const rows = await tx.$queryRaw<{ matchNumberSequence: number }[]>`
    UPDATE "Tournament"
    SET "matchNumberSequence" = "matchNumberSequence" + ${count}
    WHERE "id" = ${tournamentId}
      AND "matchNumberSequence" <= ${MAX_MATCH_NUMBER - count}
    RETURNING "matchNumberSequence"
  `;
  const last = rows[0]?.matchNumberSequence;
  if (last === undefined)
    throw new AppError('The tournament has exhausted its available match numbers.', 409);
  const first = last - count + 1,
    assignments = numberBracketNodes(ordered, rounds, first);
  for (const [nodeId, matchNumber] of assignments)
    await tx.bracketNode.updateMany({
      where: { id: nodeId, tournamentId, matchNumber: null },
      data: { matchNumber },
    });
  return assignments;
}
