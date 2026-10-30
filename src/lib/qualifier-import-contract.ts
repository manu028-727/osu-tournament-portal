import { z } from 'zod';
import { MODS } from './match-rules';
import type { QualifierCapture } from './qualifier-multiplayer';
import type { QualifierPolicy } from './qualifier-policy';

export const qualifierImportSchema = z.object({
  stageId: z.string().min(1).max(100),
  jobId: z.string().min(1).max(100).optional(),
  fingerprint: z.string().max(100).optional(),
  apply: z.boolean().default(false),
  links: z
    .array(
      z
        .string()
        .trim()
        .regex(/^https:\/\/osu\.ppy\.sh\/(?:community\/matches|mp)\/[1-9]\d{0,9}\/?$/)
        .refine(
          (value) => Number(value.match(/\/(\d+)\/?$/)?.[1]) <= 2147483647,
          'Use a valid multiplayer match ID.',
        ),
    )
    .max(12)
    .default([]),
  decisions: z
    .array(
      z.object({
        multiplayerId: z.number().int().positive().max(2147483647),
        lobbyId: z.string().min(1).max(100).nullable().default(null),
        warmups: z.number().int().min(0).max(100).default(0),
        excludePlayers: z.array(z.number().int().positive()).max(32).default([]),
        games: z
          .array(
            z.object({
              gameId: z.string().regex(/^\d+$/),
              ignore: z.boolean().default(false),
              run: z.number().int().min(1).max(2).optional(),
              replace: z.boolean().default(false),
              corrections: z
                .array(
                  z.object({
                    osuId: z.number().int().positive(),
                    raw: z.number().nonnegative().max(1e12),
                    mods: z.array(z.enum(MODS)).max(10),
                  }),
                )
                .max(16)
                .default([]),
            }),
          )
          .max(300)
          .default([]),
      }),
    )
    .max(12)
    .default([]),
  reason: z.string().trim().min(3).max(2000).default('External qualifier multiplayer import'),
});
export type QualifierImportInput = z.infer<typeof qualifierImportSchema>;
export type QualifierImportPreview = {
  jobId: string;
  fingerprint: string;
  stageName: string;
  policy: QualifierPolicy;
  complete: boolean;
  sources: {
    multiplayerId: number;
    name: string;
    complete: boolean;
    lobbyId: string | null;
    lobbyCode: string | null;
    teams: { id: string; name: string }[];
    unknownPlayers: number[];
    issues: string[];
    players: { osuId: number; username: string | null; teamName: string | null }[];
    games: {
      gameId: string;
      recordId?: string;
      proposal: QualifierCapture | null;
      run: number | null;
      issue: string | null;
      ignored: boolean;
      accepted: boolean;
      teams: { name: string; players: number; value: number | null }[];
    }[];
  }[];
};
