import type { RegistrationPolicy } from './registration-policy';
export type RegistrationData = {
  policy: RegistrationPolicy;
  policyToken: string;
  format: string;
  gameMode: string;
  minimumPlayers: number;
  externalUrl: string | null;
  open: boolean;
  user: { osuId: number; username: string } | null;
  membership: string | null;
  team: {
    id: string;
    name: string;
    format: string;
    version: number;
    status: string;
    rejectionReason: string;
    answers: unknown;
    members: {
      osuId: number;
      username: string;
      captain: boolean;
      substitute: boolean;
      discordId: string;
    }[];
  } | null;
  sessions: {
    id: string;
    code: string;
    version: number;
    stageId: string;
    stage: { name: string };
    status: string;
    scheduledAt: Date | string | null;
    capacity: number;
    bookingOpen: boolean;
    bookingClosesAt: Date | string | null;
    requiredPlayers: number;
    runs: number;
    usedPlayers: number;
    booked: boolean;
  }[];
};
