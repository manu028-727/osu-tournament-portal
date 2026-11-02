import { createHash } from 'node:crypto';
import { assertScoreRepresentation, type GameplayScoring } from './gameplay-scoring';
import {
  qualifierPolicySchema,
  qualifierTeamAggregate,
  type QualifierPolicy,
} from './qualifier-policy';

export const QUALIFIER_CALCULATION_VERSION = 'qualifier-seeding/3';
export const PREVIOUS_QUALIFIER_CALCULATION_VERSION = 'qualifier-seeding/2';
export const LEGACY_QUALIFIER_CALCULATION_VERSION = 'qualifier-seeding/1';
export const MATCH_COST_REFERENCE = {
  variant: 'OSUPLUS_QUALIFIER_COHORT_V1',
  formula: '2 / (p + 2) * sum(score / cohortMapMean)',
  source:
    'https://github.com/limjeck/osuplus/blob/b143241ec202f624e58ba7326b5d0e8f5ad339ed/osuplus.user.js#L1108-L1197',
  adaptation:
    'Stage-wide selected entrant map scores replace multiplayer-room averages. No match bonuses. Zero means block finalization.',
} as const;

export type QualifierIssue = {
  code: string;
  severity: 'ERROR' | 'WARNING';
  message: string;
  participantId?: string;
  slotName?: string;
  scoreId?: string;
};
export type QualifierSourceScore = {
  passed?: boolean | null;
  eligibilityOverride?: string | null;
  eligible?: boolean;
  eligibilityReason?: string;
  id: string;
  lobbyId: string;
  participantId: string;
  osuId: number;
  slotName: string;
  run: number;
  raw: number;
  adjusted: number;
  mods: string[];
  actualScoring: string | null;
  representation: string;
  source: string;
  gameId: string | null;
  verified: boolean;
};
export type QualifierSeedingInput = {
  tournamentId: string;
  stageId: string;
  gameplayScoring: GameplayScoring;
  policy: QualifierPolicy;
  maps: { slotName: string; beatmapId: number }[];
  participants: { id: string; name: string; roster: number[]; eligible?: boolean }[];
  scores: QualifierSourceScore[];
  context?: unknown;
  issues?: QualifierIssue[];
};
export type QualifierMapSelection = {
  slotName: string;
  run: number;
  score: number;
  scoreIds: string[];
  players: { osuId: number; scoreId: string; raw: number; adjusted: number }[];
};
export type QualifierMapReference = {
  slotName: string;
  count: number;
  mean: number | null;
  sampleDeviation: number | null;
  participantIds: string[];
};
export type QualifierStandingRow = {
  participantId: string;
  name: string;
  rank: number | null;
  seed: number | null;
  value: number | null;
  complete: boolean;
  eligible: boolean;
  tied: boolean;
  selectedRun: number | null;
  playedMaps: number;
  selected: QualifierMapSelection[];
  runs: {
    run: number;
    complete: boolean;
    playedComplete?: boolean;
    maps: QualifierMapSelection[];
    comparisonValue: number | null;
  }[];
  breakdown: {
    slotName: string;
    score: number;
    mean: number | null;
    sampleDeviation: number | null;
    contribution: number | null;
  }[];
};
export type QualifierCalculation = {
  calculationVersion: string;
  sourceHash: string;
  source: QualifierSeedingInput;
  policy: QualifierPolicy;
  gameplayScoring: GameplayScoring;
  formula: string;
  formulaReference: typeof MATCH_COST_REFERENCE | null;
  references: QualifierMapReference[];
  frozenRunReferences: QualifierMapReference[];
  rows: QualifierStandingRow[];
  issues: QualifierIssue[];
  canFinalize: boolean;
};

export function canonicalQualifierJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new Error('Non-finite qualifier data.');
  if (Array.isArray(value)) return `[${value.map(canonicalQualifierJson).join(',')}]`;
  if (typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => compareId(a, b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalQualifierJson(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export const qualifierSourceHash = (value: unknown) =>
  createHash('sha256').update(canonicalQualifierJson(value)).digest('hex');
const compareId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const mean = (values: number[]) => sum(values) / values.length;

export function qualifierMapStatistics(
  slotName: string,
  values: { id: string; score: number }[],
): QualifierMapReference {
  const average = values.length ? mean(values.map((v) => v.score)) : null;
  return {
    slotName,
    count: values.length,
    mean: average,
    sampleDeviation:
      average === null || values.length < 2
        ? null
        : Math.sqrt(sum(values.map((v) => (v.score - average) ** 2)) / (values.length - 1)),
    participantIds: values.map((v) => v.id),
  };
}

function mapContribution(
  score: number,
  reference: QualifierMapReference,
  method: QualifierPolicy['method'],
) {
  if (method === 'Z_SUM')
    return reference.sampleDeviation === null
      ? null
      : reference.sampleDeviation === 0
        ? 0
        : (score - reference.mean!) / reference.sampleDeviation;
  if (method === 'MATCH_COST')
    return reference.mean === null || reference.mean === 0 ? null : score / reference.mean;
  return score;
}
function evaluate(
  maps: QualifierMapSelection[],
  references: QualifierMapReference[],
  policy: QualifierPolicy,
) {
  if (!maps.length) return null;
  const contributions = maps.map((map) =>
    mapContribution(
      map.score,
      references.find((r) => r.slotName === map.slotName)!,
      policy.method,
    ),
  );
  if (contributions.some((v) => v === null)) return null;
  const total = sum(contributions as number[]);
  if (policy.method === 'MATCH_COST') return (2 * total) / (maps.length + 2);
  if (
    policy.method === 'TEAM_AVERAGE' ||
    (policy.method === 'RAW_SCORE' && policy.rawAggregation === 'AVERAGE')
  )
    return total / maps.length;
  return total;
}

export function calculateQualifierStandings(
  input: QualifierSeedingInput,
  calculationVersion = QUALIFIER_CALCULATION_VERSION,
): QualifierCalculation {
  const legacy = calculationVersion === LEGACY_QUALIFIER_CALCULATION_VERSION;
  const playedCompletion = calculationVersion === QUALIFIER_CALCULATION_VERSION;
  const policy = qualifierPolicySchema.parse(input.policy);
  const source: QualifierSeedingInput = {
    ...input,
    policy,
    maps: [...input.maps].sort((a, b) => compareId(a.slotName, b.slotName)),
    participants: input.participants
      .map((p) => ({ ...p, roster: [...p.roster].sort((a, b) => a - b) }))
      .sort((a, b) => compareId(a.id, b.id)),
    scores: input.scores
      .map((s) => ({ ...s, mods: [...s.mods].sort(compareId) }))
      .sort((a, b) => compareId(a.id, b.id)),
    issues: [...(input.issues || [])].sort((a, b) =>
      compareId(canonicalQualifierJson(a), canonicalQualifierJson(b)),
    ),
  };
  const issues: QualifierIssue[] = [...source.issues!];
  const issue = (code: string, message: string, extra: Partial<QualifierIssue> = {}) =>
    issues.push({ code, message, severity: 'ERROR', ...extra });
  const mapNames = source.maps.map((m) => m.slotName);
  if (!mapNames.length) issue('EMPTY_POOL', 'A published qualifier pool is required.');
  if (new Set(mapNames).size !== mapNames.length)
    issue('DUPLICATE_MAP', 'Pool slot names must be unique.');
  if (!source.participants.length) issue('EMPTY_COHORT', 'No qualifier participants.');
  if (new Set(source.participants.map((p) => p.id)).size !== source.participants.length)
    issue('DUPLICATE_PARTICIPANT', 'Participant identities must be unique.');
  if (new Set(source.scores.map((s) => s.id)).size !== source.scores.length)
    issue('DUPLICATE_SCORE_ID', 'Score identities must be unique.');
  const owners = new Map<number, string>();
  for (const participant of source.participants) {
    if (participant.roster.length < policy.requiredPlayers)
      issue('ROSTER_SIZE', `${participant.name} has too few eligible players.`, {
        participantId: participant.id,
      });
    for (const osuId of participant.roster) {
      if (owners.has(osuId))
        issue('DUPLICATE_ROSTER', `Player ${osuId} appears more than once in the cohort.`, {
          participantId: participant.id,
        });
      owners.set(osuId, participant.id);
    }
  }
  const valid: QualifierSourceScore[] = [];
  const scoreKeys = new Set<string>(),
    events = new Set<string>();
  for (const score of source.scores) {
    const extra = {
      participantId: score.participantId,
      slotName: score.slotName,
      scoreId: score.id,
    };
    if (score.eligible === false) {
      issue('EXCLUDED_SCORE', score.eligibilityReason || 'Score excluded by qualifier rules.', {
        ...extra,
        severity: 'WARNING',
      });
      continue;
    }
    const key = canonicalQualifierJson([
      score.participantId,
      score.osuId,
      score.slotName,
      score.run,
    ]);
    if (scoreKeys.has(key)) {
      issue(
        'DUPLICATE_PLAY',
        'Multiple plays exist for one player, map and run; resolve the duplicate.',
        extra,
      );
      continue;
    }
    scoreKeys.add(key);
    if (score.gameId) {
      const event = canonicalQualifierJson([score.gameId, score.osuId]);
      if (events.has(event)) {
        issue('DUPLICATE_GAME', 'An API game score was counted more than once.', extra);
        continue;
      }
      events.add(event);
    }
    if (owners.get(score.osuId) !== score.participantId) {
      issue('ROSTER_MISMATCH', 'Score player is not in the snapshotted entrant roster.', extra);
      continue;
    }
    if (!mapNames.includes(score.slotName)) {
      issue('UNKNOWN_MAP', 'Score is not in the qualifier pool.', extra);
      continue;
    }
    if (!Number.isInteger(score.run) || score.run < 1 || score.run > policy.runs) {
      issue('INVALID_RUN', 'Score run is outside the configured playthroughs.', extra);
      continue;
    }
    if (!score.verified) {
      issue('UNVERIFIED_SCORE', 'A source score needs referee verification.', extra);
      continue;
    }
    try {
      assertScoreRepresentation(
        source.gameplayScoring,
        score.actualScoring as GameplayScoring,
        score.representation,
        score.raw,
      );
      if (
        !Number.isFinite(score.adjusted) ||
        score.adjusted < 0 ||
        score.adjusted > Number.MAX_SAFE_INTEGER
      )
        throw new Error('Invalid normalized score.');
    } catch (error) {
      issue(
        'SCORING_MISMATCH',
        error instanceof Error ? error.message : 'Invalid score provenance.',
        extra,
      );
      continue;
    }
    valid.push(score);
  }
  if (
    source.gameplayScoring === 'SCORE_V1' &&
    ['RAW_SCORE', 'TEAM_AVERAGE'].includes(policy.method)
  )
    issue('SCORE_V1_RANGE_BIAS', 'Raw ScoreV1 values retain map-length and maximum-score bias.', {
      severity: 'WARNING',
    });
  const candidates = source.participants.map((participant) => {
    const runs = Array.from({ length: policy.runs }, (_, i) => {
      const run = i + 1;
      const maps = source.maps.flatMap(({ slotName }) => {
        const scores = valid.filter(
          (s) => s.participantId === participant.id && s.slotName === slotName && s.run === run,
        );
        const aggregate = qualifierTeamAggregate(scores, policy);
        if (!aggregate) return [];
        const { chosen, total } = aggregate;
        if (!Number.isFinite(total) || total > Number.MAX_SAFE_INTEGER) {
          issue('SCORE_OVERFLOW', 'Aggregated team score exceeds the supported precision range.', {
            participantId: participant.id,
            slotName,
          });
          return [];
        }
        return [
          {
            slotName,
            run,
            score: aggregate.value,
            scoreIds: chosen.map((s) => s.id),
            players: chosen.map((s) => ({
              osuId: s.osuId,
              scoreId: s.id,
              raw: s.raw,
              adjusted: s.adjusted,
            })),
          },
        ];
      });
      return {
        run,
        complete: maps.length === mapNames.length && mapNames.length > 0,
        ...(playedCompletion
          ? {
              playedComplete:
                mapNames.length > 0 &&
                mapNames.every(
                  (slotName) =>
                    new Set(
                      source.scores
                        .filter(
                          (score) =>
                            score.participantId === participant.id &&
                            score.slotName === slotName &&
                            score.run === run &&
                            score.verified &&
                            Number.isSafeInteger(score.raw) &&
                            score.raw >= 0 &&
                            participant.roster.includes(score.osuId),
                        )
                        .map((score) => score.osuId),
                    ).size >= policy.requiredPlayers,
                ),
            }
          : {}),
        maps,
        comparisonValue: null as number | null,
      };
    });
    if (legacy && participant.eligible !== false)
      for (const run of runs)
        if (!run.complete)
          issue(
            'INCOMPLETE_RUN',
            `${participant.name}: Run ${run.run} does not contain a complete eligible mappool.`,
            { participantId: participant.id },
          );
    if (
      !legacy &&
      participant.eligible !== false &&
      !runs.some((run) => (playedCompletion ? run.playedComplete : run.complete))
    )
      issue(
        'INCOMPLETE_RUN',
        `${participant.name} does not contain a complete ${playedCompletion ? 'played' : 'eligible'} run.`,
        {
          participantId: participant.id,
        },
      );
    return { participant, runs };
  });
  // One equal-weight reference per entrant, averaged over their complete runs, is frozen before choosing runs.
  const frozenRunReferences = source.maps.map(({ slotName }) =>
    qualifierMapStatistics(
      slotName,
      candidates.flatMap(({ participant, runs }) => {
        const complete = runs.filter((r) => r.complete);
        return participant.eligible === false || !complete.length
          ? []
          : [
              {
                id: participant.id,
                score: mean(
                  complete.map((r) => r.maps.find((m) => m.slotName === slotName)!.score),
                ),
              },
            ];
      }),
    ),
  );
  const selected = candidates.map(({ participant, runs }) => {
    for (const run of runs)
      if (run.complete) run.comparisonValue = evaluate(run.maps, frozenRunReferences, policy);
    let maps: QualifierMapSelection[] = [],
      selectedRun: number | null = null;
    if (
      policy.runs === 1 ||
      policy.runSelection === 'FIRST_RUN' ||
      policy.runSelection === 'SECOND_RUN'
    ) {
      selectedRun = policy.runs === 2 && policy.runSelection === 'SECOND_RUN' ? 2 : 1;
      maps = runs.find((r) => r.run === selectedRun)!.maps;
    } else if (policy.runSelection === 'BEST_PER_MAP') {
      maps = source.maps.flatMap(({ slotName }) => {
        const options = runs
          .flatMap((r) => r.maps.filter((m) => m.slotName === slotName))
          .sort((a, b) => b.score - a.score || a.run - b.run);
        return options.length ? [options[0]] : [];
      });
    } else {
      const choices = runs
        .filter((r) => r.complete && r.comparisonValue !== null)
        .sort((a, b) => b.comparisonValue! - a.comparisonValue! || a.run - b.run);
      if (choices.length) {
        selectedRun = choices[0].run;
        maps = choices[0].maps;
      }
    }
    const eligibleRun = runs.some(
      (run) =>
        (playedCompletion ? run.playedComplete : run.complete) &&
        (policy.runSelection === 'FIRST_RUN'
          ? run.run === 1
          : policy.runSelection === 'SECOND_RUN' && policy.runs === 2
            ? run.run === 2
            : true),
    );
    const complete =
      maps.length === mapNames.length && mapNames.length > 0 && (legacy || eligibleRun);
    if (!complete && participant.eligible !== false)
      issue(
        'INCOMPLETE_POOL',
        `${participant.name} is missing eligible team/map scores for the selected run policy.`,
        { participantId: participant.id },
      );
    if (participant.eligible === false)
      issue(
        'INELIGIBLE_PARTICIPANT',
        `${participant.name} is excluded from the calculation cohort.`,
        { participantId: participant.id, severity: 'WARNING' },
      );
    return { participant, runs, maps, selectedRun, complete };
  });
  const cohort = selected.filter((s) => s.participant.eligible !== false && s.complete);
  const references = source.maps.map(({ slotName }) =>
    qualifierMapStatistics(
      slotName,
      cohort.map((s) => ({
        id: s.participant.id,
        score: s.maps.find((m) => m.slotName === slotName)!.score,
      })),
    ),
  );
  for (const reference of references) {
    if (policy.method === 'Z_SUM') {
      if (reference.count < 2)
        issue(
          'INSUFFICIENT_COHORT',
          'Sample Z-Sum requires at least two complete eligible entrants.',
          { slotName: reference.slotName },
        );
      else if (reference.sampleDeviation === 0)
        issue(
          'ZERO_DEVIATION',
          'Identical map scores contribute zero Z-points for every entrant.',
          { slotName: reference.slotName, severity: 'WARNING' },
        );
    }
    if (policy.method === 'MATCH_COST' && (reference.mean === null || reference.mean === 0))
      issue('ZERO_REFERENCE', 'Match cost requires a positive cohort map average.', {
        slotName: reference.slotName,
      });
  }
  const rows: QualifierStandingRow[] = selected
    .map(({ participant, maps, runs, selectedRun, complete }) => ({
      participantId: participant.id,
      name: participant.name,
      rank: null,
      seed: null,
      value:
        participant.eligible === false
          ? null
          : complete || policy.method === 'MATCH_COST'
            ? evaluate(maps, references, policy)
            : null,
      complete,
      eligible: participant.eligible !== false,
      tied: false,
      selectedRun,
      playedMaps: maps.length,
      selected: maps,
      runs,
      breakdown: maps.map((map) => {
        const reference = references.find((r) => r.slotName === map.slotName)!;
        return {
          slotName: map.slotName,
          score: map.score,
          mean: reference.mean,
          sampleDeviation: reference.sampleDeviation,
          contribution: mapContribution(map.score, reference, policy.method),
        };
      }),
    }))
    .sort(
      (a, b) =>
        (a.value === null
          ? b.value === null
            ? 0
            : 1
          : b.value === null
            ? -1
            : b.value - a.value) || compareId(a.participantId, b.participantId),
    );
  const ranked = rows.filter((r) => r.complete && r.eligible && r.value !== null);
  for (let start = 0; start < ranked.length;) {
    let end = start + 1;
    while (end < ranked.length && ranked[end].value === ranked[start].value) end++;
    const tied = end - start > 1;
    for (let i = start; i < end; i++) {
      ranked[i].rank = start + 1;
      ranked[i].tied = tied;
      ranked[i].seed = tied ? null : i + 1;
    }
    if (tied)
      issue(
        'UNRESOLVED_TIE',
        `Entrants tied at rank ${start + 1} require an explicit ordered tiebreak decision.`,
        { severity: 'WARNING' },
      );
    start = end;
  }
  const formula =
    policy.method === 'Z_SUM'
      ? 'sum((selectedMapScore - mean) / sampleDeviation)'
      : policy.method === 'MATCH_COST'
        ? MATCH_COST_REFERENCE.formula
        : policy.method === 'TEAM_AVERAGE' || policy.rawAggregation === 'AVERAGE'
          ? 'sum(selectedTeamMapScore) / mapCount'
          : 'sum(selectedTeamMapScore)';
  return {
    calculationVersion,
    sourceHash: qualifierSourceHash({ calculationVersion, source }),
    source,
    policy,
    gameplayScoring: source.gameplayScoring,
    formula,
    formulaReference: policy.method === 'MATCH_COST' ? MATCH_COST_REFERENCE : null,
    references,
    frozenRunReferences:
      policy.runSelection === 'BEST_COMPLETE_RUN' && policy.runs === 2 ? frozenRunReferences : [],
    rows,
    issues,
    canFinalize:
      !issues.some((i) => i.severity === 'ERROR') &&
      ranked.length > 0 &&
      ranked.every((r) => r.seed !== null),
  };
}

export function resolveQualifierTies(calculation: QualifierCalculation, order: string[]) {
  const rows = calculation.rows.map((row) => ({ ...row }));
  const tied = rows.filter((r) => r.tied);
  if (
    new Set(order).size !== order.length ||
    order.length !== tied.length ||
    tied.some((r) => !order.includes(r.participantId))
  )
    throw new Error('Supply each tied entrant exactly once, in approved seed order.');
  const ranks = new Set(tied.map((r) => r.rank!));
  for (const rank of ranks) {
    const group = tied
      .filter((r) => r.rank === rank)
      .sort((a, b) => order.indexOf(a.participantId) - order.indexOf(b.participantId));
    group.forEach((r, i) => {
      r.seed = rank + i;
    });
  }
  rows.sort(
    (a, b) =>
      (a.seed ?? Number.MAX_SAFE_INTEGER) - (b.seed ?? Number.MAX_SAFE_INTEGER) ||
      compareId(a.participantId, b.participantId),
  );
  return {
    ...calculation,
    rows,
    canFinalize:
      !calculation.issues.some((i) => i.severity === 'ERROR') &&
      rows.some((r) => r.seed !== null) &&
      rows.filter((r) => r.eligible).every((r) => r.complete && r.seed !== null),
  };
}
