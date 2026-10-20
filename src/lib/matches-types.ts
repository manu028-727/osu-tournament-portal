import type { MatchParticipants } from './matches-service';
import type { MatchRules, Side } from './match-rules';
import type { BeatmapMetadata } from './osu';
import type { DraftAction } from './match-engine';
export type RefereeProfile = { id: string; username: string; osuId: number; avatarUrl: string };
export type MatchStatus =
  'SCHEDULED' | 'IN_PROGRESS' | 'AWAITING_CONFIRMATION' | 'COMPLETED' | 'DISPUTED' | 'CANCELLED';
export type MatchSummary = {
  id: string;
  code: string;
  status: MatchStatus;
  notes: string;
  scheduledAt: string | null;
  published: boolean;
  bracket: string;
  resultMode: 'MAPS' | 'SUMMARY';
  source: {
    referee?: string;
    streamer?: string;
    commentators?: string[];
    red?: string;
    blue?: string;
  } | null;
  scoreA: number;
  scoreB: number;
  version: number;
  participants: MatchParticipants;
  stage: { id: string; name: string };
  assignments: { userId: string; primary: boolean; user: RefereeProfile }[];
};
export type MatchResultView = {
  id: string;
  actionId: string;
  scoreA: number | null;
  scoreB: number | null;
  entryMode?: string;
  winnerSide: Side;
  notes: string;
  voided: boolean;
  playerScores: {
    osuId: number;
    side: Side;
    score: number;
    accuracy: number | null;
    mods: string[];
  }[];
};
export type MatchView = MatchSummary & {
  importedHistory?: {
    worksheet: string;
    discord: string;
    acceptedAt: string;
    version: number;
  } | null;
  workflow: import('./match-engine').MatchWorkflow;
  multiplayerSync: import('./multiplayer').MultiplayerCheckpoint | null;
  multiplayerSyncedAt: string | null;
  multiplayerError: string | null;
  multiplayerGames?: {
    id: string;
    gameId: string;
    slotName: string;
    beatmapId: number;
    actionId: string | null;
    evidence: import('./multiplayer').MultiplayerEvidence | null;
    ignoredAt: string | null;
    proposal: import('./multiplayer').MultiplayerProposal | null;
    confirmedAt: string | null;
  }[];
  rules: MatchRules;
  poolRevision: {
    id: string;
    slots: {
      name: string;
      category: string;
      categoryName: string;
      categoryPriority?: number | null;
      color: string;
      beatmapId: number;
      metadata: BeatmapMetadata;
    }[];
  } | null;
  actions: (DraftAction & {
    sequence: number;
    createdAt?: string;
    actor?: { username: string } | null;
    provenance?: { type?: string; worksheet?: string; sourceRow?: number } | null;
  })[];
  results: MatchResultView[];
  winnerSide: Side | null;
  forfeitSide: Side | null;
  firstPickSide: Side | null;
  firstBanSide: Side | null;
  firstProtectSide: Side | null;
  rollA: number | null;
  rollB: number | null;
  lobbyUrl: string;
  multiplayerId: number | null;
  notes: string;
  timerKind: string | null;
  timerRemainingSeconds: number;
  timerStartedAt: string | null;
  startedAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  events?: {
    id: string;
    version: number;
    kind: string;
    side: Side | null;
    notes: string;
    data: unknown;
    createdAt: string;
    actor: { username: string } | null;
  }[];
  revisions?: {
    id: string;
    version: number;
    kind: string;
    reason: string;
    createdAt: string;
    creator: { username: string } | null;
  }[];
};
export type MatchOptions = {
  defaults: MatchRules;
  defaultsHash: string;
  stages: {
    id: string;
    name: string;
    published: boolean;
    rules: MatchRules | null;
    rulesHash: string;
  }[];
  teams: { id: string; name: string; format: string }[];
  referees: RefereeProfile[];
};
export type MatchListData = {
  matches: MatchSummary[];
  counts: Partial<Record<MatchStatus, number>>;
  stages: { id: string; name: string }[];
  options: MatchOptions | null;
  serverNow: string;
};
