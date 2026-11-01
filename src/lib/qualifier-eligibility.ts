import { MODS, type MatchRules } from './match-rules';

export function qualifierDefaultMods(rules: MatchRules, category: string) {
  return [
    ...new Set([
      ...(rules.enforceNoFail ? ['NF'] : []),
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
  if (
    (mods.includes('EZ') && mods.includes('HR')) ||
    ((mods.includes('DT') || mods.includes('NC')) && mods.includes('HT')) ||
    (mods.includes('NF') && (mods.includes('SD') || mods.includes('PF')))
  )
    return 'Incompatible mods.';
  if (rules.enforceNoFail && !mods.includes('NF')) return 'NoFail is required.';
  if (
    rules.freeModCategories.includes(category) &&
    mods.some((mod) => !rules.freeModAllowed.includes(mod as never))
  )
    return 'This mod is not allowed in FreeMod.';
  if (
    !rules.freeModCategories.includes(category) &&
    rules.categoryMods[category] !== undefined &&
    !/\bfreemod\b/i.test(rules.categoryMods[category])
  ) {
    const normalize = (values: string[]) =>
      [
        ...new Set(
          values
            .filter((m) => !['NF', 'NM', 'NONE', ''].includes(m))
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
  return scores.filter((s) => s.mods.includes('HR')).length < rules.freeModRequiredHR ||
    scores.filter((s) => !s.mods.includes('HR') && (s.mods.includes('HD') || s.mods.includes('EZ')))
      .length < rules.freeModRequiredHD
    ? 'Team does not meet the FreeMod requirements.'
    : null;
}
