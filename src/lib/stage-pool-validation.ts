import { firstTo, type MatchRules } from './match-rules';

export function stagePoolChecks(
  kind: string,
  rules: MatchRules,
  slots: { category: string }[],
): { code: string; message: string }[] {
  if (kind === 'QUALIFIERS' || kind === 'QUALIFIER') return [];
  const problems: { code: string; message: string }[] = [];
  const needsTB = rules.enableTiebreaker && firstTo(rules) > 1;
  const tbBans = rules.draftSequence.includes('TB_BAN') ? 2 : 0;
  const required = rules.bestOf + 2 * rules.bansPerTeam + tbBans;
  if (slots.length < required)
    problems.push({
      code: 'POOL_SIZE',
      message: `${required - slots.length} more maps are needed for BO${rules.bestOf} with ${rules.bansPerTeam} bans per team${tbBans ? ' and tiebreaker bans' : ''}.`,
    });
  const tiebreakers = slots.filter((slot) => slot.category === rules.tiebreakerCategory).length;
  if (needsTB && !tiebreakers)
    problems.push({
      code: 'TIEBREAKER',
      message: `Add a ${rules.tiebreakerCategory} slot for the tiebreaker.`,
    });
  if (tbBans && tiebreakers < 3)
    problems.push({
      code: 'TB_BANS',
      message: 'Tiebreaker bans need at least three tiebreaker slots.',
    });
  const regular = slots.length - (needsTB ? tiebreakers : 0);
  const regularNeeded = rules.bestOf - (needsTB ? 1 : 0) + 2 * rules.bansPerTeam;
  if (needsTB && regular < regularNeeded && slots.length >= required)
    problems.push({
      code: 'REGULAR_MAPS',
      message: `${regularNeeded - regular} more non-tiebreaker maps are needed for picks and bans.`,
    });
  const draftable = slots.filter(
    (slot) =>
      !(
        rules.enableTiebreaker &&
        firstTo(rules) > 1 &&
        !rules.allowTiebreakerBans &&
        slot.category === rules.tiebreakerCategory
      ),
  ).length;
  if (draftable < 2 * (rules.protectsPerTeam + rules.bansPerTeam))
    problems.push({
      code: 'DRAFT_CAPACITY',
      message: 'Add more non-tiebreaker maps or reduce the protect/ban counts.',
    });
  return problems;
}

export function stagePoolProblems(kind: string, rules: MatchRules, slots: { category: string }[]) {
  return stagePoolChecks(kind, rules, slots).map((problem) => problem.message);
}
