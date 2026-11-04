import type { RegistrationPolicy } from './registration-policy';
export type RegistrationData = {
  policy: Omit<RegistrationPolicy, 'bookingEnabled' | 'bookingClosesAt'>;
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
      discordUsername: string;
    }[];
  } | null;
};
