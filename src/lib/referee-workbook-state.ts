import { AppError } from './permissions';
import { matchRulesSchema, firstTo } from './match-rules';
import { replayDraft, type DraftSlot } from './match-engine';
import type { RefereeRecord } from './referee-workbook';
export function validateSheetRecord(record: RefereeRecord, base: unknown, slots: DraftSlot[]) {
  if (record.issues.length) throw new AppError(record.issues.join(' '));
  const pairs = record.draftSequence;
  const inherited = matchRulesSchema.parse(base);
  if (inherited.gameMode !== record.gameMode)
    throw new AppError('Workbook game mode differs from this tournament match.');
  const rules = matchRulesSchema.parse({
    ...inherited,
    bestOf: record.bestOf,
    banOrder: record.banOrder,
    bansPerTeam: pairs.filter((k) => k === 'BAN').length,
    protectsPerTeam: pairs.filter((k) => k === 'PROTECT').length,
    pickOrder: 'ABAB',
    protectOrder: record.protectOrder,
    draftSequence: pairs,
    rollRequired: true,
    firstBanRule: 'CHOICE',
    firstPickRule: 'CHOICE',
    firstProtectRule: 'CHOICE',
  });
  const starters = {
    firstBanSide: record.firstBanSide,
    firstPickSide: record.firstPickSide,
    firstProtectSide: record.firstProtectSide,
  };
  const actions = record.actions.map((a, i) => ({
    ...a,
    id: `sheet-${i}`,
    category: slots.find((s) => s.name === a.slotName)?.category || '',
    voided: false,
  }));
  for (const a of actions) {
    const slot = slots.find((s) => s.name === a.slotName),
      source = record.pool.find((s) => s.name === a.slotName);
    if (!slot || !source || slot.beatmapId !== source.beatmapId)
      throw new AppError(
        `Source slot ${a.slotName} does not match the frozen website pool. Review the pool before importing.`,
      );
  }
  const results = actions.flatMap((a) =>
    a.winner ? [{ actionId: a.id, winnerSide: a.winner, voided: false }] : [],
  );
  const replay = replayDraft(rules, starters, slots, actions, results);
  if (!record.forfeitSide && (replay.scoreA !== record.scoreA || replay.scoreB !== record.scoreB))
    throw new AppError('Source map winners do not reproduce the stated final score.');
  if (record.forfeitSide && actions.length)
    throw new AppError('Forfeit records containing played actions require manual review.');
  const scoreA = record.forfeitSide ? record.scoreA : replay.scoreA,
    scoreB = record.forfeitSide ? record.scoreB : replay.scoreB;
  const winner =
    scoreA >= firstTo(rules) ? ('A' as const) : scoreB >= firstTo(rules) ? ('B' as const) : null;
  if (
    scoreA > firstTo(rules) ||
    scoreB > firstTo(rules) ||
    (scoreA === firstTo(rules) && scoreB === firstTo(rules)) ||
    (record.forfeitSide && record.forfeitSide === winner)
  )
    throw new AppError('Invalid source match result.');
  return { rules, starters, actions, results, scoreA, scoreB, winner };
}
