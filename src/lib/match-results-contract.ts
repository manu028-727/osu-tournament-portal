import { z } from 'zod';
import type { MultiplayerEvidence, MultiplayerProposal } from './multiplayer';

const side = z.enum(['A', 'B']);
const review = z.object({
  id: z.string().min(1).max(100),
  baseVersion: z.number().int().positive(),
  reason: z.string().trim().min(3).max(2000),
  confirm: z.boolean().default(true),
  approveProgression: z.boolean().default(false),
  correctionHash: z.string().length(64).optional(),
});
export const importGameDecisionSchema = z.object({
  gameId: z.string().regex(/^\d+$/).max(30),
  included: z.boolean(),
  winnerSide: side.nullable(),
  reason: z.string().trim().max(1000).default(''),
});
export const organizerResultOptions = [
  review.extend({
    type: z.literal('match.result.set'),
    scoreA: z.number().int().min(0).max(16),
    scoreB: z.number().int().min(0).max(16),
    winnerSide: side,
    forfeitSide: side.nullable(),
    externalReferee: z.string().trim().max(120).default(''),
  }),
  review.extend({
    type: z.literal('match.result.import'),
    token: z.string().min(1).max(440000),
    decisions: z.array(importGameDecisionSchema).min(1).max(120),
  }),
] as const;
export type OrganizerResultAction = z.infer<(typeof organizerResultOptions)[number]>;
export type ImportGameDecision = z.infer<typeof importGameDecisionSchema>;
export type MultiplayerImportGame = {
  evidence: MultiplayerEvidence;
  proposal: MultiplayerProposal | null;
};
export type MultiplayerResultPreview = {
  token: string;
  complete: boolean;
  metadata: { id: number; name?: string; start_time?: string | null; end_time?: string | null };
  games: MultiplayerImportGame[];
  decisions: ImportGameDecision[];
};
export type MatchResultImpact = {
  hash: string;
  blocked: boolean;
  requiresApproval: boolean;
  affected: { matchNumber: number; protected: boolean }[];
};
