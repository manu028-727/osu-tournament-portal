import type { MatchRules } from './match-rules';
import type { MatchParticipants } from './matches-service';
import type { MatchOptions, MatchStatus, MatchView } from './matches-types';
import type { MatchAccess } from './match-access';
export type QualifierView = {
  id: string;
  code: string;
  stage: { id: string; name: string };
  status: MatchStatus;
  version: number;
  rules: MatchRules;
  participants: MatchParticipants['A'][];
  poolRevision: NonNullable<MatchView['poolRevision']>;
  scheduledAt: string | null;
  notes: string;
  lobbyUrl: string;
  updatedAt: string;
  access: MatchAccess;
  assignments: { userId: string; user: { id: string; username: string; osuId: number } }[];
  entries: { team: { members: { discordId: string }[] } }[];
  scores: {
    id: string;
    osuId: number;
    slotName: string;
    raw: number;
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
export type QualifierData = { lobbies: QualifierView[]; options: MatchOptions | null };
