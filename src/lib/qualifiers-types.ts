import type { MatchRules } from './match-rules';
import type { MatchParticipants } from './matches-types';
import type { MatchOptions, MatchStatus, MatchView } from './matches-types';
import type { MatchAccess } from './match-access';
export type QualifierView = {
  deletedAt?: string | null;
  autoCompleted?: boolean;
  scoringLocked?: boolean;
  capacity: number;
  bookingOpen: boolean;
  bookingClosesAt: string | null;
  multiplayerSyncedAt: string | null;
  multiplayerError: string | null;
  multiplayerSync: unknown;
  games: {
    id: string;
    multiplayerId: number;
    gameId: string;
    run: number | null;
    slotName: string | null;
    evidence: unknown;
    status: string;
    reason: string;
    version: number;
  }[];
  selection?: unknown;
  id: string;
  code: string;
  stage: { id: string; name: string };
  status: MatchStatus;
  version: number;
  rules: MatchRules;
  policy: import('./qualifier-policy').QualifierPolicy;
  gameplayScoring: string | null;
  participants: MatchParticipants['A'][];
  poolRevision: NonNullable<MatchView['poolRevision']>;
  scheduledAt: string | null;
  notes: string;
  lobbyUrl: string;
  updatedAt: string;
  access: MatchAccess;
  canTransfer?: boolean;
  assignments: { userId: string; user: { id: string; username: string; osuId: number } }[];
  entries: { team: { members: { discordUsername: string; discordId: string }[] } }[];
  scores: {
    passed?: boolean | null;
    eligibilityOverride?: string | null;
    eligible?: boolean;
    eligibilityReason?: string;
    id: string;
    osuId: number;
    slotName: string;
    run: number;
    actualScoring: string | null;
    representation: string;
    source: string;
    gameId: string | null;
    verified: boolean;
    raw: number;
    accuracy?: number | null;
    maxCombo?: number | null;
    misses?: number | null;
    mods: string[];
    adjusted: number;
  }[];
  events: {
    id: string;
    version: number;
    kind: string;
    reason: string;
    data: unknown;
    createdAt: string;
    actor: { username: string } | null;
  }[];
};
export type QualifierData = {
  entrantOptions?: { id: string; name: string; format: string; startingPlayers?: number }[];
  lobbies: QualifierView[];
  options:
    | (Omit<MatchOptions, 'teams'> & {
        teams: (MatchOptions['teams'][number] & { startingPlayers?: number })[];
        qualifierStages?: { id: string; policy: import('./qualifier-policy').QualifierPolicy }[];
      })
    | null;
};
