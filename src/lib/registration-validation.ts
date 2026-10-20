import { z } from 'zod';
const member = z.object({
  username: z.string().min(1),
  osuId: z.number().int().positive(),
  rank: z.number().int().positive(),
});
const score = z.number().int().min(-1).max(16).nullable();
export const registrationImportSchema = z
  .object({
    source: z.string(),
    sheetUrl: z.url(),
    timeZone: z.string().refine((v) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, 'Use an IANA timezone.'),
    stageBestOf: z
      .record(
        z.string(),
        z
          .number()
          .int()
          .min(1)
          .max(31)
          .refine((n) => n % 2 === 1),
      )
      .default({}),
    teams: z
      .array(
        z.object({
          registrationOrder: z.number().int().positive(),
          seed: z.number().int().positive().nullable(),
          name: z.string().trim().min(1).max(120),
          rankSum: z.number().int().positive(),
          members: z.array(member).min(1).max(16),
        }),
      )
      .min(1),
    matches: z.array(
      z.object({
        number: z.number().int().positive(),
        stage: z.string().min(1),
        bracket: z.string(),
        scheduledAt: z.iso.datetime().nullable(),
        red: z.string().min(1),
        blue: z.string().min(1),
        scoreRed: score,
        scoreBlue: score,
        referee: z.string(),
        streamer: z.string(),
        commentators: z.array(z.string()),
        lobbyUrl: z.string(),
      }),
    ),
  })
  .superRefine((data, ctx) => {
    const unique = (values: (string | number)[], label: string) => {
      if (new Set(values).size !== values.length)
        ctx.addIssue({ code: 'custom', message: `Duplicate ${label}.` });
    };
    unique(
      data.teams.flatMap((t) => (t.seed === null ? [] : [t.seed])),
      'seed',
    );
    unique(
      data.teams.map((t) => t.registrationOrder),
      'registration order',
    );
    unique(
      data.teams.map((t) => t.name),
      'team',
    );
    unique(
      data.teams.flatMap((t) => t.members.map((m) => m.osuId)),
      'player',
    );
    unique(
      data.matches.map((m) => m.number),
      'match',
    );
    for (const team of data.teams)
      if (team.members.reduce((sum, m) => sum + m.rank, 0) !== team.rankSum)
        ctx.addIssue({ code: 'custom', message: `Rank sum mismatch: ${team.name}` });
    for (const match of data.matches) {
      if (
        (match.scoreRed === null) !== (match.scoreBlue === null) ||
        (match.scoreRed !== null &&
          (match.scoreRed === match.scoreBlue || Math.max(match.scoreRed, match.scoreBlue!) < 1))
      )
        ctx.addIssue({ code: 'custom', message: `Invalid result: ${match.number}` });
      for (const name of [match.red, match.blue]) {
        const ref = /^[WL](\d+)$/.exec(name);
        if (
          !data.teams.some((t) => t.name === name) &&
          (!ref ||
            !data.matches.some((m) => m.number === Number(ref[1]) && m.number < match.number))
        )
          ctx.addIssue({
            code: 'custom',
            message: `Unknown or forward-referencing match entrant: ${name}`,
          });
      }
    }
  });
export type RegistrationImport = z.infer<typeof registrationImportSchema>;
