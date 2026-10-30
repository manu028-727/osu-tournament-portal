import type { TeamFields } from './teams-validation';
export type TeamView = Omit<TeamFields, 'members'> & {
  adminNotes?: string;
  rejectionReason?: string;
  registrationAnswers?: unknown;
  id: string;
  version: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  published: boolean;
  members: (TeamFields['members'][number] & {
    participant: { osuId: number; username: string; avatarUrl: string; country: string | null };
  })[];
};
