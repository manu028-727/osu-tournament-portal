import { z } from 'zod';
import { matchRulesSchema } from './match-rules';

// Punctuation separates words; it never removes arbitrary words from a stage name.
const labelKey = (label: string) =>
  label
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s._!,\-:;/'\u2019]+/g, ' ')
    .trim();
const aliases: Record<string, string> = {
  gf: 'grand finals',
  'g f': 'grand finals',
  gfs: 'grand finals',
  'grand final': 'grand finals',
  'grand finals': 'grand finals',
  f: 'finals',
  final: 'finals',
  finals: 'finals',
  sf: 'semifinals',
  's f': 'semifinals',
  sfs: 'semifinals',
  semifinal: 'semifinals',
  semifinals: 'semifinals',
  'semi final': 'semifinals',
  'semi finals': 'semifinals',
  qf: 'quarterfinals',
  'q f': 'quarterfinals',
  qfs: 'quarterfinals',
  quarterfinal: 'quarterfinals',
  quarterfinals: 'quarterfinals',
  'quarter final': 'quarterfinals',
  'quarter finals': 'quarterfinals',
  qualifier: 'qualifiers',
  qualifiers: 'qualifiers',
  quals: 'qualifiers',
};
for (const size of [2, 4, 8, 16, 32, 64, 128, 256]) {
  for (const alias of [`ro${size}`, `ro ${size}`, `round of ${size}`])
    aliases[alias] = `round of ${size}`;
}
const identity = (label: string) => aliases[labelKey(label)] || labelKey(label);
const bracketNames: Record<string, 'Winners' | 'Losers'> = {
  winner: 'Winners',
  winners: 'Winners',
  'winner bracket': 'Winners',
  'winners bracket': 'Winners',
  wb: 'Winners',
  'w b': 'Winners',
  loser: 'Losers',
  losers: 'Losers',
  'loser bracket': 'Losers',
  'losers bracket': 'Losers',
  lb: 'Losers',
  'l b': 'Losers',
};
const bracketToken = '(?:(?:winners?|losers?)(?:[\\s._-]+bracket)?|[wl][\\s._]*b[._]*)';
const bracketSuffix = new RegExp(
  `^(.*?)\\s*(?:[-\\u2013\\u2014:|/]\\s*(${bracketToken})|\\(\\s*(${bracketToken})\\s*\\)|\\[\\s*(${bracketToken})\\s*\\])\\s*$`,
  'i',
);

export function normalizeStageLabel(source: string) {
  const original = source.trim();
  const suffix = bracketSuffix.exec(original);
  const bracket = suffix
    ? bracketNames[labelKey(suffix[2] || suffix[3] || suffix[4] || '')]
    : undefined;
  const stageLabel = bracket && suffix?.[1].trim() ? suffix[1].trim() : original;
  return {
    original,
    stageLabel,
    key: identity(stageLabel),
    bracket: stageLabel !== original ? bracket! : null,
    roundLabel: original,
  };
}

export type StageIdentity = { id: string; name: string; kind?: string; archivedAt?: unknown };
export type ApprovedStageMapping = { sourceLabel: string; stageId: string };
export function resolveStageLabel<T extends StageIdentity>(
  label: string,
  stages: T[],
  approved: ApprovedStageMapping[] = [],
) {
  const normalized = normalizeStageLabel(label);
  const approvedIds = new Set(
    approved
      .filter((mapping) => mapping.sourceLabel.trim().toLowerCase() === label.trim().toLowerCase())
      .map((mapping) => mapping.stageId),
  );
  // A suffixed fake stage is not a canonical destination, even if it already exists.
  const candidates = stages.filter(
    (stage) =>
      !stage.archivedAt &&
      !normalizeStageLabel(stage.name).bracket &&
      (identity(stage.name) === normalized.key || approvedIds.has(stage.id)),
  );
  return {
    ...normalized,
    candidates,
    stage: candidates.length === 1 ? candidates[0] : null,
    ambiguous: candidates.length > 1,
  };
}

export const stageReconciliationActionSchema = z.object({
  type: z.literal('stage.reconcile'),
  reason: z.string().trim().min(3).max(2000),
  changes: z
    .array(
      z
        .object({
          matchId: z.string().min(1).max(100),
          baseVersion: z.number().int().positive(),
          stageId: z.string().min(1).max(100),
          rebindPool: z.boolean().default(false),
          targetSnapshotKey: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
        })
        .refine(
          (row) => !row.rebindPool || !!row.targetSnapshotKey,
          'Review the published target pool and inherited rules before rebinding.',
        ),
    )
    .min(1)
    .max(100)
    .refine(
      (rows) => new Set(rows.map((row) => row.matchId)).size === rows.length,
      'Review each match only once.',
    ),
});
export type StageReconciliationAction = z.infer<typeof stageReconciliationActionSchema>;

export type RepairMatchState = {
  status: string;
  startedAt: unknown;
  submittedAt: unknown;
  completedAt: unknown;
  scoreA: number;
  scoreB: number;
  winnerSide: unknown;
  forfeitSide: unknown;
  rollA: number | null;
  rollB: number | null;
  firstPickSide: unknown;
  firstBanSide: unknown;
  firstProtectSide: unknown;
  timerStartedAt: unknown;
  timerKind: unknown;
  timerRemainingSeconds: number;
  actions: unknown[];
  results: unknown[];
  multiplayerGames: unknown[];
};
export function canRebindStageSnapshot(match: RepairMatchState) {
  return (
    match.status === 'SCHEDULED' &&
    !match.startedAt &&
    !match.submittedAt &&
    !match.completedAt &&
    !match.scoreA &&
    !match.scoreB &&
    !match.winnerSide &&
    !match.forfeitSide &&
    match.rollA === null &&
    match.rollB === null &&
    !match.firstPickSide &&
    !match.firstBanSide &&
    !match.firstProtectSide &&
    !match.timerStartedAt &&
    !match.timerKind &&
    !match.timerRemainingSeconds &&
    !match.actions.length &&
    !match.results.length &&
    !match.multiplayerGames.length
  );
}

export function objectMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function approvedStageMappings(
  events: { kind: string; data: unknown }[],
): ApprovedStageMapping[] {
  return events.flatMap((event) => {
    const data = objectMetadata(event.data);
    const mapping = objectMetadata(data.stageMapping);
    const sourceLabel =
      event.kind === 'stage.reconcile'
        ? data.sourceLabel
        : event.kind === 'sheet.import' && mapping.approved === true
          ? objectMetadata(data.originalRecord).stage
          : undefined;
    const stageId = event.kind === 'stage.reconcile' ? data.stageId : mapping.stageId;
    return typeof sourceLabel === 'string' && typeof stageId === 'string'
      ? [{ sourceLabel, stageId }]
      : [];
  });
}

export function sourceStageLabel(source: unknown, events: { data: unknown }[], fallback: string) {
  const data = objectMetadata(source);
  const repair = objectMetadata(data.stageReconciliation);
  for (const candidate of [
    repair.originalStageLabel,
    data.originalStage,
    data.stageLabel,
    data.stage,
    objectMetadata(data.record).stage,
    objectMetadata(data.refereeWorkbook).originalStage,
  ])
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  for (const event of events) {
    const entry = objectMetadata(event.data);
    const label = objectMetadata(entry.originalRecord).stage || objectMetadata(entry.record).stage;
    if (typeof label === 'string' && label.trim()) return label;
  }
  return fallback;
}

export function snapshotProblems(
  rules: unknown,
  slots: { name: string; category: string }[] | undefined,
) {
  const problems: string[] = [];
  const parsed = matchRulesSchema.safeParse(rules);
  if (!parsed.success)
    problems.push('Frozen match rules are invalid; manual rule review is required.');
  if (!slots?.length) problems.push('No usable frozen mappool is linked to this match.');
  if (
    parsed.success &&
    slots?.length &&
    parsed.data.enableTiebreaker &&
    !slots.some((slot) => slot.category === parsed.data.tiebreakerCategory)
  )
    problems.push('Frozen mappool has no configured tiebreaker.');
  return problems;
}
