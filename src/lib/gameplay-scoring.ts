import { z } from 'zod';
import { matchRulesSchema, type MatchRules } from './match-rules';
import { AppError } from './permissions';

export const gameplayScoringSchema = z.enum(['SCORE_V1', 'SCORE_V2', 'LAZER']);
export type GameplayScoring = z.infer<typeof gameplayScoringSchema>;
export const SCORING_LABELS: Record<GameplayScoring, string> = {
  SCORE_V1: 'ScoreV1',
  SCORE_V2: 'ScoreV2',
  LAZER: 'osu!lazer',
};
export const SCORING_DESCRIPTIONS: Record<GameplayScoring, string> = {
  SCORE_V1: 'Original reported scores. Map length and maximum score can affect raw-score seeding.',
  SCORE_V2: 'Reported ScoreV2 values, without converting legacy scores.',
  LAZER:
    'Standardized lazer scores only. Classic-scaled display values are not interchangeable inputs. Legacy Bancho lobby setup and match API capture are unavailable.',
};

export function tournamentScoring(value: unknown): GameplayScoring {
  const parsed = gameplayScoringSchema.safeParse(value);
  if (!parsed.success)
    throw new AppError(
      'Gameplay scoring needs review in Tournament Settings before creating competition records.',
      409,
    );
  return parsed.data;
}

export function inheritedRules(base: unknown, scoring: unknown, gameMode?: string): MatchRules {
  const gameplayScoring = tournamentScoring(scoring);
  const inherited = matchRulesSchema.parse(base);
  return matchRulesSchema.parse({
    ...inherited,
    ...(gameMode ? { gameMode } : {}),
    scoreMode: gameplayScoring === 'SCORE_V1' ? 'SCORE' : 'SCORE_V2',
    gameplayScoring,
    multiplierMode:
      gameplayScoring === 'LAZER' && inherited.multiplierMode === 'LEGACY_PRODUCT'
        ? 'NONE'
        : inherited.multiplierMode,
  });
}

export function historicalScoring(rules: MatchRules): GameplayScoring | null {
  return (
    rules.gameplayScoring ||
    (rules.scoreMode === 'SCORE' ? 'SCORE_V1' : rules.scoreMode === 'SCORE_V2' ? 'SCORE_V2' : null)
  );
}

export function inferLegacyScoring(values: unknown[]): GameplayScoring | null {
  const modes = new Set(
    values.flatMap((value) => {
      if (!value || typeof value !== 'object' || !('scoreMode' in value) || value.scoreMode == null)
        return [];
      return [value.scoreMode];
    }),
  );
  if (modes.size !== 1) return null;
  return modes.has('SCORE') ? 'SCORE_V1' : modes.has('SCORE_V2') ? 'SCORE_V2' : null;
}

export function assertScoreRepresentation(
  scoring: GameplayScoring,
  actual: GameplayScoring,
  representation: string,
  value: number,
) {
  if (scoring !== actual)
    throw new AppError('The recorded scoring system differs from the tournament configuration.');
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000_000)
    throw new AppError('Enter an actual nonnegative integer score.');
  if (scoring === 'LAZER' && representation !== 'STANDARDIZED')
    throw new AppError(
      'Use the actual standardized lazer score; classic display values cannot be converted here.',
    );
  if (scoring !== 'LAZER' && representation !== 'LEGACY')
    throw new AppError('Use the original reported legacy score representation.');
}
