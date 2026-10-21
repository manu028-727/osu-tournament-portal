import type { Prisma } from '@/generated/prisma/client';
import { AppError } from './permissions';

export const MAX_MATCH_NUMBER = 2_147_483_647;

export function numericMatchIdentifier(value: string): number | null {
  if (!/^\d{1,10}$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= MAX_MATCH_NUMBER ? number : null;
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
};

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
      roundA.position - roundB.position ||
      roundA.lane.localeCompare(roundB.lane) ||
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
      `Match number ${preferred} is already allocated or reserved in this tournament. Resolve the number conflict before importing.`,
      409,
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
    nodes.filter((node) => !node.matchId && !['BYE', 'SKIPPED'].includes(node.state)),
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
