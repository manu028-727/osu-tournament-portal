// Older eligibility decisions live in audited events. Read them without a data
// backfill or guessing from an arbitrary human-written exclusion reason.
export function qualifierScoreDecision(
  score: {
    id: string;
    gameId: string | null;
    raw: number;
    eligible?: boolean;
    eligibilityReason?: string;
    eligibilityOverride?: string | null;
  },
  events: { kind: string; version: number; data: unknown }[],
) {
  if (score.eligibilityOverride) return score.eligibilityOverride;
  for (const event of [...events].sort((a, b) => b.version - a.version)) {
    if (!['qualifier.scores.resolve', 'qualifier.scores.correct'].includes(event.kind)) continue;
    const rows = (event.data as { after?: unknown[] } | null)?.after;
    if (!Array.isArray(rows)) continue;
    const after = rows.find(
      (row) => row && typeof row === 'object' && (row as { id?: string }).id === score.id,
    ) as typeof score | undefined;
    if (!after) continue;
    if (event.kind === 'qualifier.scores.correct') return after.eligibilityOverride || null;
    if (
      after.gameId === score.gameId &&
      after.raw === score.raw &&
      after.eligible === score.eligible &&
      after.eligibilityReason === score.eligibilityReason
    )
      return after.eligible ? 'INCLUDE' : 'EXCLUDE';
    return null;
  }
  return null;
}
