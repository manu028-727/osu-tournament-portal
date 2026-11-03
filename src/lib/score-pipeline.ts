import { canonicalMods, type MatchRules, type Side } from './match-rules';
import { AppError } from './permissions';

// The one owner of how a performance becomes a map result. Bancho's scoring mode only
// describes the lobby; `winCondition` decides what a map is won on.
export type PlayerScore = {
  osuId: number;
  side: Side;
  score: number;
  accuracy?: number | null;
  maxCombo?: number | null;
  misses?: number | null;
  mods: string[];
};
export type WinCondition = MatchRules['winCondition'] & { legacy?: boolean };
export type ModViolation =
  'INCOMPATIBLE' | 'NOFAIL' | 'REQUIRED_MOD' | 'FREEMOD_MOD' | 'CATEGORY_MOD';

// Team averages of 0-100 values carry floating-point noise, not real differences.
const SAME_VALUE = 1e-9;

export function effectiveWinCondition(rules: MatchRules): WinCondition {
  // Older snapshots could only express a metric through the Bancho mode.
  if (
    rules.winCondition.metric === 'SCORE' &&
    (rules.scoreMode === 'ACCURACY' || rules.scoreMode === 'COMBO')
  )
    return {
      metric: rules.scoreMode,
      teamAggregation: 'SUM',
      applyMultipliers: true,
      legacy: true,
    };
  return rules.winCondition;
}

// The value stored as a player's `score`, which legacy metric modes reused for that metric.
export function reportedPlayerScore(
  rules: MatchRules,
  player: { score: number; accuracy: number; maxCombo: number },
) {
  const condition = effectiveWinCondition(rules);
  if (!condition.legacy) return player.score;
  return condition.metric === 'COMBO' ? player.maxCombo : player.accuracy * 100;
}

export function convertedScore(rules: MatchRules, raw: number, mods: readonly string[], slot = '') {
  if (!Number.isFinite(raw) || raw < 0 || raw > Number.MAX_SAFE_INTEGER)
    throw new AppError('Scores must be non-negative and within the supported score range.');
  // A mod every player must use cannot distinguish one performance from another.
  const key = canonicalMods(mods.filter((mod) => !rules.requiredMods.includes(mod as never)));
  let multiplier = 1;
  if (rules.multiplierMode === 'CUSTOM')
    multiplier =
      rules.slotModMultipliers.find((m) => m.slot === slot && m.mods === key)?.multiplier ?? 1;
  else if (rules.multiplierMode === 'UNIVERSAL') multiplier = rules.modMultipliers[key] ?? 1;
  else if (rules.multiplierMode === 'LEGACY_PRODUCT')
    multiplier =
      rules.modMultipliers[key] ??
      mods.filter((m) => m !== 'NF').reduce((n, m) => n * (rules.modMultipliers[m] ?? 1), 1);
  const adjusted = raw * multiplier;
  if (!Number.isFinite(adjusted) || adjusted > Number.MAX_SAFE_INTEGER)
    throw new AppError('The configured score multiplier exceeds the supported score range.');
  return {
    multiplier,
    adjusted: rules.multiplierMode === 'LEGACY_PRODUCT' ? Math.round(adjusted) : adjusted,
  };
}

function playerValue(
  rules: MatchRules,
  condition: WinCondition,
  player: PlayerScore,
  slotName: string,
) {
  if (condition.metric === 'SCORE' || condition.legacy)
    return condition.applyMultipliers
      ? convertedScore(rules, player.score, player.mods, slotName).adjusted
      : player.score;
  const value =
    condition.metric === 'ACCURACY'
      ? player.accuracy
      : condition.metric === 'COMBO'
        ? player.maxCombo
        : player.misses;
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0)
    throw new AppError(
      condition.metric === 'ACCURACY'
        ? 'Enter accuracy for every player to decide this map.'
        : condition.metric === 'COMBO'
          ? 'Enter max combo for every player to decide this map.'
          : 'Enter misses for every player to decide this map.',
    );
  if (condition.metric === 'ACCURACY' && value > 100)
    throw new AppError('Accuracy must be between 0 and 100.');
  return value;
}

export function teamMapValue(rules: MatchRules, players: PlayerScore[], slotName = '') {
  const condition = effectiveWinCondition(rules);
  const total = players.reduce(
    (sum, player) => sum + playerValue(rules, condition, player, slotName),
    0,
  );
  return condition.teamAggregation === 'AVERAGE' && players.length ? total / players.length : total;
}

// Null means a draw, which is replayed rather than awarded.
export function mapWinner(rules: MatchRules, valueA: number, valueB: number): Side | null {
  if (Math.abs(valueA - valueB) < SAME_VALUE) return null;
  const lowerWins = effectiveWinCondition(rules).metric === 'MISSES';
  return valueA > valueB !== lowerWins ? 'A' : 'B';
}

export function playerModViolation(
  rules: MatchRules,
  category: string,
  mods: readonly string[],
): ModViolation | null {
  if (
    (mods.includes('EZ') && mods.includes('HR')) ||
    ((mods.includes('DT') || mods.includes('NC')) && mods.includes('HT')) ||
    (mods.includes('NF') && (mods.includes('SD') || mods.includes('PF')))
  )
    return 'INCOMPATIBLE';
  if (rules.enforceNoFail && !mods.includes('NF')) return 'NOFAIL';
  if (rules.requiredMods.some((mod) => !mods.includes(mod))) return 'REQUIRED_MOD';
  const chosen = mods.filter((mod) => !rules.requiredMods.includes(mod as never));
  if (
    rules.freeModCategories.includes(category) &&
    chosen.some((mod) => !rules.freeModAllowed.includes(mod as never))
  )
    return 'FREEMOD_MOD';
  const allowed = rules.categoryAllowedMods[category];
  if (allowed && chosen.some((mod) => mod !== 'NF' && !allowed.includes(mod as never)))
    return 'CATEGORY_MOD';
  return null;
}

export function effectiveFreeModQuotas(rules: MatchRules) {
  // Without explicit quotas a saved snapshot keeps its original HDHR-as-HR, EZ-as-HD rule.
  return (
    rules.freeModQuotas ?? [
      { label: 'HR', min: rules.freeModRequiredHR, satisfiedBy: ['HR'] as const },
      { label: 'HD', min: rules.freeModRequiredHD, satisfiedBy: ['HD', 'EZ'] as const },
    ]
  );
}

// Each player fills the first requirement they satisfy, so HDHR counts once.
export function freeModQuotaMet(
  rules: MatchRules,
  category: string,
  players: readonly (readonly string[])[],
) {
  if (!rules.freeModCategories.includes(category)) return true;
  const quotas = effectiveFreeModQuotas(rules);
  const filled = quotas.map(() => 0);
  for (const mods of players) {
    const index = quotas.findIndex((quota) =>
      quota.satisfiedBy.some((mod: string) => mods.includes(mod)),
    );
    if (index >= 0) filled[index]++;
  }
  return quotas.every((quota, index) => filled[index] >= quota.min);
}

export function lobbyModTokens(rules: MatchRules, category: string) {
  const configured = (rules.categoryMods[category] || '').split(/\s+/).filter(Boolean);
  const optional = rules.categoryOptionalMods[category] ?? [];
  const hasFreemod = configured.some((token) => /^freemod$/i.test(token));
  // Under Freemod each player chooses their own mods, so required mods cannot be set for them.
  return [
    ...(rules.enforceNoFail ? ['NF'] : []),
    ...(hasFreemod || optional.length ? [] : rules.requiredMods),
    ...configured,
    ...(optional.length && !hasFreemod ? ['Freemod'] : []),
  ];
}

const MATCH_MOD_MESSAGES: Record<ModViolation, string> = {
  INCOMPATIBLE: 'This score contains incompatible mods.',
  NOFAIL: 'NoFail is required for individual score entries.',
  REQUIRED_MOD: 'A required mod is missing from this score.',
  FREEMOD_MOD: 'This mod is not allowed in FreeMod.',
  CATEGORY_MOD: 'This mod is not allowed on this map.',
};

export function aggregateScores(
  rules: MatchRules,
  category: string,
  players: PlayerScore[],
  roster: Record<Side, number[]>,
  manualA: number,
  manualB: number,
  slotName = '',
) {
  const condition = effectiveWinCondition(rules);
  const accuracy = condition.metric === 'ACCURACY';
  const validScore = (value: number) =>
    Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
  const validRaw = (value: number, team = false) =>
    validScore(value) &&
    (accuracy && condition.legacy
      ? value <= 100 * (team ? rules.teamSize : 1)
      : accuracy && team
        ? value <= 100
        : Number.isSafeInteger(value));
  if (!players.length) {
    if (!validRaw(manualA, true) || !validRaw(manualB, true))
      throw new AppError(
        accuracy
          ? 'Accuracy must be between 0 and 100.'
          : 'Scores must be non-negative, safe whole numbers.',
      );
    const winnerSide = mapWinner(rules, manualA, manualB);
    if (!winnerSide) throw new AppError('Tied maps must be replayed before awarding a point.');
    return { scoreA: manualA, scoreB: manualB, winnerSide };
  }
  if (new Set(players.map((p) => p.osuId)).size !== players.length)
    throw new AppError('A player score is duplicated.');
  const totals = { A: 0, B: 0 };
  for (const side of ['A', 'B'] as const) {
    const scores = players.filter((p) => p.side === side);
    if (scores.length !== rules.teamSize)
      throw new AppError(
        'Enter exactly {0} player scores for Team {1}, or use aggregate entry.',
        400,
        [rules.teamSize, side],
      );
    for (const p of scores) {
      if (!validRaw(p.score))
        throw new AppError('Scores must be non-negative, safe whole numbers.');
      const violation = playerModViolation(rules, category, p.mods);
      if (violation === 'INCOMPATIBLE') throw new AppError(MATCH_MOD_MESSAGES.INCOMPATIBLE);
      if (!roster[side].includes(p.osuId))
        throw new AppError('This player is not in the snapshotted match roster.');
      if (violation) throw new AppError(MATCH_MOD_MESSAGES[violation]);
    }
    if (
      !freeModQuotaMet(
        rules,
        category,
        scores.map((p) => p.mods),
      )
    )
      throw new AppError('The team does not meet the configured FreeMod requirements.');
    totals[side] = teamMapValue(rules, scores, slotName);
    if (!validScore(totals[side]))
      throw new AppError('The configured score multiplier exceeds the supported score range.');
  }
  const winnerSide = mapWinner(rules, totals.A, totals.B);
  if (!winnerSide) throw new AppError('Tied maps must be replayed before awarding a point.');
  return { scoreA: totals.A, scoreB: totals.B, winnerSide };
}

// Whole values read as scores; only metric decimals such as accuracy are ever shown.
export function formatMapValue(value: number, locale?: string) {
  return value.toLocaleString(locale, {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 4,
  });
}
