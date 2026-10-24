import type { Prisma } from '@/generated/prisma/client';
import { AppError } from './permissions';
import { historicalScoring, type GameplayScoring } from './gameplay-scoring';
import { matchRulesSchema } from './match-rules';

export async function scoringImpact(tx: Prisma.TransactionClient, tournamentId: string) {
  const matches = await tx.match.findMany({
    where: { tournamentId },
    select: {
      id: true,
      code: true,
      status: true,
      rules: true,
      actions: { select: { id: true }, take: 1 },
      results: { select: { id: true }, take: 1 },
    },
  });
  const qualifiers = await tx.qualifierLobby.findMany({
    where: { tournamentId },
    select: {
      id: true,
      code: true,
      status: true,
      rules: true,
      scores: { select: { actualScoring: true }, distinct: ['actualScoring'] },
    },
  });
  const affected = [
    ...matches
      .filter(
        (m) =>
          !['SCHEDULED', 'CANCELLED'].includes(m.status) || m.actions.length || m.results.length,
      )
      .map((m) => ({
        id: m.id,
        code: m.code,
        kind: 'match',
        scoring: historicalScoring(matchRulesSchema.parse(m.rules)),
      })),
    ...qualifiers
      .filter((m) => !['SCHEDULED', 'CANCELLED'].includes(m.status) || m.scores.length)
      .map((m) => ({
        id: m.id,
        code: m.code,
        kind: 'qualifier',
        scoring: m.scores.some(
          (score) =>
            score.actualScoring &&
            score.actualScoring !== historicalScoring(matchRulesSchema.parse(m.rules)),
        )
          ? null
          : historicalScoring(matchRulesSchema.parse(m.rules)),
      })),
  ];
  return {
    locked: affected.length > 0,
    affected,
    scheduledMatches: matches.filter(
      (m) => m.status === 'SCHEDULED' && !m.actions.length && !m.results.length,
    ).length,
    scheduledQualifiers: qualifiers.filter((m) => m.status === 'SCHEDULED' && !m.scores.length)
      .length,
  };
}

export async function assertScoringChange(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  previous: string | null,
  next: GameplayScoring,
  reviewed = false,
) {
  if (previous === next) return;
  const impact = await scoringImpact(tx, tournamentId);
  if (
    previous === null &&
    reviewed &&
    impact.affected.length &&
    impact.affected.every((record) => record.scoring === next)
  )
    return;
  if (impact.locked)
    throw new AppError(
      `Gameplay scoring is locked: ${impact.affected.length} match/session records have begun or contain results. Historical scores will not be converted.`,
      409,
    );
}
