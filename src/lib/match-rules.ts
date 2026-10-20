import { z } from 'zod';
export const SIDES = ['A', 'B'] as const;
export type Side = (typeof SIDES)[number];
export const MODS = ['EZ', 'HD', 'HR', 'DT', 'NC', 'HT', 'FL', 'SD', 'PF', 'NF'] as const;
export const START_RULES = ['CHOICE', 'ROLL_WINNER', 'ROLL_LOSER', 'RED', 'BLUE'] as const;
export const matchRulesSchema = z
  .object({
    gameMode: z.enum(['osu', 'taiko', 'fruits', 'mania']).default('osu'),
    teamMode: z.enum(['TEAM_VS', 'HEAD_TO_HEAD', 'TAG_COOP', 'TAG_TEAM_VS']).default('TEAM_VS'),
    scoreMode: z.enum(['SCORE_V2', 'SCORE', 'COMBO', 'ACCURACY']).default('SCORE_V2'),
    draftSequence: z
      .array(z.enum(['PROTECT', 'BAN', 'PICK', 'TB_BAN']))
      .max(30)
      .default([]),
    teamSize: z.number().int().min(1).max(8).default(2),
    bestOf: z
      .number()
      .int()
      .min(1)
      .max(31)
      .refine((n) => n % 2 === 1, 'Best-of must be odd.')
      .default(11),
    bansPerTeam: z.number().int().min(0).max(8).default(2),
    protectsPerTeam: z.number().int().min(0).max(4).default(0),
    banOrder: z.enum(['AB', 'ABAB', 'ABBA']).default('ABBA'),
    rollRequired: z.boolean().default(true),
    firstBanRule: z.enum(START_RULES).default('CHOICE'),
    firstPickRule: z.enum(START_RULES).default('CHOICE'),
    firstProtectRule: z.enum(START_RULES).default('CHOICE'),
    pickOrder: z.enum(['ABAB', 'ABBA']).default('ABBA'),
    protectOrder: z.enum(['ABAB', 'ABBA']).default('ABBA'),
    tiebreakerBanOrder: z.enum(['ABAB', 'ABBA']).default('ABBA'),
    tiebreakerBanFirstSide: z.enum(SIDES).default('A'),
    allowDoublePicks: z.boolean().default(false),
    allowDoubleBans: z.boolean().default(false),
    categoryExceptions: z
      .array(z.string().regex(/^[A-Z0-9_-]{1,20}$/))
      .max(20)
      .default(['NM']),
    enforceNoFail: z.boolean().default(true),
    enableTiebreaker: z.boolean().default(true),
    tiebreakerCategory: z
      .string()
      .regex(/^[A-Z0-9_-]{1,20}$/)
      .default('TB'),
    allowTiebreakerBans: z.boolean().default(false),
    warmupsPerTeam: z.number().int().min(0).max(4).default(0),
    timeoutsPerTeam: z.number().int().min(0).max(5).default(1),
    timeoutOnlyOwnPick: z.boolean().default(true),
    pickSeconds: z.number().int().min(10).max(900).default(120),
    banSeconds: z.number().int().min(10).max(900).default(120),
    readySeconds: z.number().int().min(10).max(900).default(90),
    timeoutSeconds: z.number().int().min(10).max(900).default(120),
    freeModCategories: z
      .array(z.string().regex(/^[A-Z0-9_-]{1,20}$/))
      .max(20)
      .default(['FM']),
    freeModRequiredHD: z.number().int().min(0).max(8).default(1),
    freeModRequiredHR: z.number().int().min(0).max(8).default(1),
    freeModAllowed: z.array(z.enum(MODS)).default(['HD', 'HR', 'EZ', 'FL', 'NF']),
    multiplierMode: z
      .enum(['LEGACY_PRODUCT', 'UNIVERSAL', 'CUSTOM', 'NONE'])
      .default('LEGACY_PRODUCT'),
    slotModMultipliers: z
      .array(
        z.object({
          slot: z.string().regex(/^[A-Z0-9_-]{1,20}$/),
          mods: z.string().regex(/^(?:NM|(?:EZ|HD|HR|DT|NC|HT|FL|SD|PF){1,8})$/),
          multiplier: z.number().min(0.01).max(10),
        }),
      )
      .max(200)
      .default([]),
    redEmoji: z.string().max(100).default(':red_circle:'),
    blueEmoji: z.string().max(100).default(':blue_circle:'),
    worldCup: z.boolean().default(false),
    warmupPolicy: z.string().max(2000).default(''),
    timeoutPolicy: z.string().max(2000).default(''),
    doublePickPolicy: z.string().max(2000).default(''),
    doubleBanPolicy: z.string().max(2000).default(''),
    modMultipliers: z
      .record(
        z.string().regex(/^(?:NM|(?:EZ|HD|HR|DT|NC|HT|FL|SD|PF){1,8})$/),
        z.number().min(0.01).max(10),
      )
      .default({ EZ: 2, EZHD: 2, FL: 1.2 }),
    categoryMods: z
      .record(
        z.string().regex(/^[A-Z0-9_-]{1,20}$/),
        z
          .string()
          .max(80)
          .regex(/^(?:[A-Za-z]+(?: [A-Za-z]+)*)?$/),
      )
      .default({ NM: '', HD: 'HD', HR: 'HR', DT: 'DT', FM: 'Freemod', TB: 'Freemod' }),
    latePolicy: z
      .string()
      .max(2000)
      .default(
        'Dieci minuti senza preavviso: sconfitta a tavolino. Ritardo concordato: massimo venti minuti.',
      ),
    rollPolicy: z
      .string()
      .max(2000)
      .default(
        'Il vincitore sceglie il primo o secondo pick; il perdente sceglie l’ordine dei ban.',
      ),
    freeModPolicy: z
      .string()
      .max(2000)
      .default('Almeno un HD e un HR per team. HDHR conta come HR; EZ/EZHD contano come HD.'),
    tiebreakerPolicy: z
      .string()
      .max(2000)
      .default('FreeMod, mod opzionali. Hidden, HardRock, Easy e Flashlight consentiti.'),
    disconnectPolicy: z
      .string()
      .max(2000)
      .default(
        'Problemi nel primo quarto o nei primi 30 secondi: una ripetizione per giocatore per incontro, a discrezione del referee.',
      ),
  })
  .superRefine((rules, ctx) => {
    if (rules.banOrder === 'AB' && rules.bansPerTeam !== 1)
      ctx.addIssue({
        code: 'custom',
        path: ['banOrder'],
        message: 'AB requires one ban per team.',
      });
    if (
      !rules.rollRequired &&
      [rules.firstBanRule, rules.firstPickRule, rules.firstProtectRule].some(
        (r) => !['RED', 'BLUE'].includes(r),
      )
    )
      ctx.addIssue({
        code: 'custom',
        path: ['rollRequired'],
        message: 'Without a roll, choose fixed Red or Blue starting teams.',
      });
    if (rules.draftSequence.length) {
      const count = (kind: string) => rules.draftSequence.filter((entry) => entry === kind).length;
      if (count('PICK') * 2 + 1 !== rules.bestOf)
        ctx.addIssue({
          code: 'custom',
          path: ['draftSequence'],
          message: 'Best-of must equal twice the Pick pairs plus one.',
        });
      if (count('PROTECT') !== rules.protectsPerTeam || count('BAN') !== rules.bansPerTeam)
        ctx.addIssue({
          code: 'custom',
          path: ['draftSequence'],
          message: 'Protect and Ban pair counts must match the per-team settings.',
        });
      if (
        count('TB_BAN') > 1 ||
        (count('TB_BAN') && (!rules.enableTiebreaker || rules.draftSequence.at(-1) !== 'TB_BAN'))
      )
        ctx.addIssue({
          code: 'custom',
          path: ['draftSequence'],
          message:
            'One optional tiebreaker-ban pair may appear only at the end, with tiebreakers enabled.',
        });
    }
    const keys = rules.slotModMultipliers.map((m) => `${m.slot}:${m.mods}`);
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({
        code: 'custom',
        path: ['slotModMultipliers'],
        message: 'A slot/mod combination can have only one multiplier.',
      });
  });
export type MatchRules = z.infer<typeof matchRulesSchema>;
export const DEFAULT_MATCH_RULES = matchRulesSchema.parse({});
export const firstTo = (rules: MatchRules) => (rules.bestOf + 1) / 2;
export const otherSide = (side: Side): Side => (side === 'A' ? 'B' : 'A');
export function canonicalMods(mods: readonly string[]) {
  return MODS.filter((m) => m !== 'NF' && mods.includes(m)).join('') || 'NM';
}
