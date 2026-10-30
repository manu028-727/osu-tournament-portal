export type CompetitionFormat = 'SINGLE_ELIMINATION' | 'DOUBLE_ELIMINATION' | 'GROUPS';
export type CompetitionOutcome = 'WINNER' | 'LOSER' | 'RESET_A' | 'RESET_B';
export type CompetitionSlot = {
  id?: string;
  side: 'A' | 'B';
  teamId: string | null;
  resolved: boolean;
  mode: string;
  sourceNodeId: string | null;
  outcome: string | null;
};
export type CompetitionMatch = {
  id: string;
  code: string;
  matchNumber?: number;
  status: string;
  teamAId: string | null;
  teamBId: string | null;
  scoreA: number;
  scoreB: number;
  winnerSide: 'A' | 'B' | null;
  forfeitSide?: 'A' | 'B' | null;
  version: number;
  startedAt?: Date | string | null;
  scheduledAt?: Date | string | null;
  deletedAt?: Date | string | null;
};
export type CompetitionNode = {
  id: string;
  bracketId: string;
  roundId: string;
  key: string;
  position: number;
  matchNumber: number | null;
  state: string;
  matchId: string | null;
  match: CompetitionMatch | null;
  slots: CompetitionSlot[];
};
export type CompetitionRound = {
  id: string;
  key: string;
  name: string;
  lane: string;
  stageId: string;
  stageName?: string;
  position: number;
};
export type CompetitionEntry = {
  teamId: string;
  seed: number;
  status: string;
  team: { id: string; name: string; slug: string };
};
export type CompetitionBracketData = {
  id: string;
  name: string;
  format: string;
  version: number;
  published: boolean;
  configuration?: import('./competition-validation').CompetitionCreate;
  manualMatches?: boolean;
  sourceStandingId?: string | null;
  rounds: CompetitionRound[];
  nodes: CompetitionNode[];
  entries: CompetitionEntry[];
  standings?: GroupStanding[];
};
export type GroupStanding = {
  group: string;
  teamId: string;
  played: number;
  wins: number;
  losses: number;
  mapDifference: number;
  seed: number;
  rank: number;
  qualified: boolean;
  tied: boolean;
  tieResolved?: boolean;
};
export type CompetitionOptions = {
  stages: { id: string; name: string; ready: boolean }[];
  teams: { id: string; name: string; seed: number | null }[];
  standings: { id: string; stageId: string; version: number; snapshot: unknown }[];
  groupSources?: {
    id: string;
    name: string;
    seeds: { teamId: string; seed: number }[];
    sourceHash: string;
  }[];
  linkableMatches?: {
    id: string;
    matchNumber: number;
    version: number;
    code: string;
    stageId: string;
    stageName: string;
    status: string;
    teamAId: string;
    teamAName: string;
    teamBId: string;
    teamBName: string;
    scoreA: number;
    scoreB: number;
  }[];
};
export type CompetitionData = {
  brackets: CompetitionBracketData[];
  options: CompetitionOptions | null;
};
export type CompetitionGenerationPreview = import('./competition-engine').CompetitionPlan & {
  reviewHash: string;
  assignments: {
    roundKey: string;
    stageId: string;
    stageName: string;
    suggestedStageId: string;
    suggestedStageName: string;
    firstMatchNumber: number | null;
    lastMatchNumber: number | null;
    matchCount: number;
  }[];
};
export type CompetitionLifecyclePreview = {
  hash: string;
  blocked: boolean;
  reasons: string[];
  matches: { matchNumber: number; status: string }[];
  historical: number;
  numberingRestarts: boolean;
  affected: { matchNumber: number | null; protected: boolean }[];
};
