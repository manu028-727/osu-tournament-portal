import { z } from 'zod';
export const qualifierBookingSchema = z.object({
  type: z.literal('qualifier.booking.reserve'),
  teamVersion: z.number().int().positive(),
  policyToken: z.string().regex(/^[a-f0-9]{64}$/),
  stageId: z.string().min(1).max(100),
  lobbyId: z.string().min(1).max(100).nullable(),
  baseVersion: z.number().int().positive().optional(),
  sourceVersion: z.number().int().positive().optional(),
});
// The former registration endpoint delegates old booking payloads to the same owner.
export type QualifierBookingAction = Omit<z.infer<typeof qualifierBookingSchema>, 'type'> & {
  type: 'qualifier.booking.reserve' | 'registration.booking';
};
export type QualifierBookingData = {
  policyToken: string;
  policy: import('./qualifier-booking-policy').QualifierBookingPolicy;
  user: { osuId: number; username: string } | null;
  team: {
    id: string;
    name: string;
    version: number;
    status: string;
    rejectionReason: string;
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
