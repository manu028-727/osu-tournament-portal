import { AppError } from './permissions';

import { type QualifierCalculation } from './qualifier-seeding';

export type QualifierStandingSnapshot = {
  state: 'PROVISIONAL' | 'FINALIZED' | 'REOPENED';
  calculation: QualifierCalculation;
  calculatedBy: string;
  calculatedAt: string;
  finalizedAt: string | null;
  cutoff: number | null;
  tieResolution: { order: string[]; reason: string; actorId: string } | null;
  seeds: { teamId: string; seed: number; qualified: boolean }[];
  correctionReview?: {
    standingId: string;
    reason: string;
    actorId: string;
    impact: QualifierCorrectionImpact;
  };
  importProvenance?: {
    originalSourceHash: string;
    reboundSourceHash: string;
    reboundAt: string;
    calculationVersion: string;
  }[];
};
export type QualifierStandingVersion = {
  id: string;
  version: number;
  published: boolean;
  sourceHash: string;
  createdAt: string;
  snapshot: QualifierStandingSnapshot;
  stale: boolean;
};
export type QualifierStandingsData = {
  stage: { id: string; name: string };
  preview: QualifierCalculation;
  versions: QualifierStandingVersion[];
  latest: QualifierStandingVersion | null;
  locked: boolean;
  canManage: boolean;
  correctionImpact: QualifierCorrectionImpact | null;
};
export type QualifierCorrectionImpact = {
  brackets: {
    id: string;
    name: string;
    version: number;
    published: boolean;
    sourceStandingId: string | null;
    sourceBracketId: string | null;
    nodes: {
      id: string;
      state: string;
      match: {
        id: string;
        code: string;
        matchNumber: number;
        status: string;
        version: number;
        startedAt: string | null;
        submittedAt: string | null;
        completedAt: string | null;
        scoreA: number;
        scoreB: number;
        winnerSide: string | null;
        resultCount: number;
        multiplayerGameCount: number;
      } | null;
    }[];
  }[];
  blockingMatches: { id: string; code: string; matchNumber: number; reason: string }[];
  impactHash: string;
  canReopen: boolean;
};
export function qualifierStandingSnapshot(value: unknown): QualifierStandingSnapshot {
  if (
    !value ||
    typeof value !== 'object' ||
    !('state' in value) ||
    !('calculation' in value) ||
    !['PROVISIONAL', 'FINALIZED', 'REOPENED'].includes(String(value.state))
  )
    throw new AppError('This standings snapshot needs a controlled historical review.', 409);
  return value as QualifierStandingSnapshot;
}
export type PublishedQualifierStandings = {
  id: string;
  version: number;
  stageName: string;
  finalizedAt: string;
  cutoff: number | null;
  method: QualifierCalculation['policy']['method'];
  gameplayScoring: QualifierCalculation['gameplayScoring'];
  rows: QualifierCalculation['rows'];
};
