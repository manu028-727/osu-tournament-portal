import { MODS, type MatchRules } from './match-rules';
import { freeModQuotaMet, playerModViolation, type ModViolation } from './score-pipeline';

// Stored as eligibility reasons on saved scores, so these keep their original wording.
const QUALIFIER_MOD_MESSAGES: Record<ModViolation, string> = {
  INCOMPATIBLE: 'Incompatible mods.',
  NOFAIL: 'NoFail is required.',
  REQUIRED_MOD: 'A required mod is missing.',
  FREEMOD_MOD: 'This mod is not allowed in FreeMod.',
  CATEGORY_MOD: 'This mod is not allowed on this map.',
};

export function qualifierDefaultMods(rules: MatchRules, category: string) {
  return [
    ...new Set([
      ...(rules.enforceNoFail ? ['NF'] : []),
      ...rules.requiredMods,
      ...(!rules.freeModCategories.includes(category)
        ? (rules.categoryMods[category] || '')
            .toUpperCase()
            .split(/\s+/)
            .filter((m) => MODS.includes(m as never))
        : []),
    ]),
  ];
}

// The raw performance is evidence even when tournament rules exclude it.
export function qualifierScoreViolation(rules: MatchRules, category: string, mods: string[]) {
  const violation = playerModViolation(rules, category, mods);
  if (violation) return QUALIFIER_MOD_MESSAGES[violation];
  if (
    !rules.freeModCategories.includes(category) &&
    rules.categoryMods[category] !== undefined &&
    !/\bfreemod\b/i.test(rules.categoryMods[category])
  ) {
    const normalize = (values: string[]) =>
      [
        ...new Set(
          values
            .filter(
              (m) =>
                !['NF', 'NM', 'NONE', ''].includes(m) &&
                !rules.requiredMods.includes(m as never) &&
                !rules.categoryOptionalMods[category]?.includes(m as never),
            )
            .map((m) => (m === 'NC' ? 'DT' : m === 'PF' ? 'SD' : m)),
        ),
      ]
        .sort()
        .join(' ');
    const expected = rules.categoryMods[category].toUpperCase().split(/\s+/);
    if (normalize(mods) !== normalize(expected))
      return 'Player mods differ from the configured category mods.';
  }
  return null;
}

export function qualifierTeamModViolation(
  rules: MatchRules,
  category: string,
  scores: { mods: string[]; eligible?: boolean; eligibilityReason?: string }[],
) {
  if (!rules.freeModCategories.includes(category)) return null;
  if (scores.length && scores.every((s) => s.eligible === true && !!s.eligibilityReason))
    return null;
  return freeModQuotaMet(
    rules,
    category,
    scores.map((s) => s.mods),
  )
    ? null
    : 'Team does not meet the FreeMod requirements.';
}
