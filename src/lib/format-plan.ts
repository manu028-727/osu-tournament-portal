import { z } from 'zod';

// The reviewed shape of a tournament's progression. Rules live on stages and saved
// entrants live on teams; this owns only who plays where and in what order.
export const FORMAT_PLAN_VERSION = 1;
export const PHASE_KINDS = [
  'QUALIFIER',
  'TEAM_FORMATION',
  'GROUPS',
  'SINGLE_ELIMINATION',
  'DOUBLE_ELIMINATION',
] as const;
export const GROUP_TIEBREAKERS = [
  'MATCH_WINS',
  'MAP_DIFFERENCE',
  'MAPS_WON',
  'HEAD_TO_HEAD',
  'QUALIFIER_SEED',
] as const;

const key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
const id = z.string().min(1).max(100);
const name = z.string().trim().min(1).max(100);
const seed = z.number().int().min(1).max(256);

const source = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ALL'), phase: key }),
  z.strictObject({ kind: z.literal('RANK_RANGE'), phase: key, from: seed, to: seed }),
  z.strictObject({
    kind: z.literal('PLACEMENT'),
    phase: key,
    tier: key.optional(),
    placement: z.number().int().min(1).max(32),
    orderWithin: z.enum(['GROUP_LABEL', 'CROSS_GROUP_RANK']),
  }),
  z.strictObject({
    kind: z.literal('EXPLICIT'),
    phase: key,
    count: z.number().int().min(1).max(256),
  }),
]);
export type FormatSource = z.infer<typeof source>;

const entry = z.strictObject({ source, seedFrom: seed });
const laneEntry = entry.extend({ lane: z.enum(['WINNERS', 'LOSERS']) });
const pairing = z.union([
  z.literal('STANDARD'),
  z
    .array(z.tuple([seed, seed]))
    .min(1)
    .max(64),
]);
const lane = z.strictObject({ size: z.number().int().min(2).max(128), pairing });
const rematch = z.enum(['ALLOW', 'AVOID_SAME_GROUP']);
const eliminationBase = {
  key,
  name,
  stageId: id,
  roundStages: z.record(z.string().regex(/^g\d+-r\d+$/), id).default({}),
  rematch: rematch.default('ALLOW'),
};

export const formatPhaseSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('QUALIFIER'),
    key,
    name,
    stageId: id,
    entrantUnit: z.enum(['REGISTERED_ENTRANT', 'INDIVIDUAL_PLAYER']).default('REGISTERED_ENTRANT'),
    advance: z.number().int().min(1).max(256).nullable().default(null),
  }),
  z.strictObject({
    kind: z.literal('TEAM_FORMATION'),
    key,
    name,
    entries: z.array(entry).min(1).max(32),
    method: z.enum(['AUCTION', 'SNAKE_DRAFT', 'MANUAL']),
    teamCount: z.number().int().min(2).max(128),
    rosterSize: z.number().int().min(1).max(16),
    captains: z.enum(['MANUAL', 'TOP_SEEDS']),
    auction: z
      .strictObject({
        budget: z.number().int().min(1).max(100_000_000),
        minimumRaise: z.number().int().min(1).max(100_000_000),
        lotOrder: z.enum(['SEED', 'RANDOM']),
        reserveFillPrice: z.number().int().min(0).max(100_000_000),
      })
      .optional(),
  }),
  z.strictObject({
    kind: z.literal('GROUPS'),
    key,
    name,
    stageId: id,
    entries: z.array(entry).min(1).max(32),
    tiers: z
      .array(
        z.strictObject({
          key,
          name,
          seedFrom: seed,
          seedTo: seed,
          groupCount: z.number().int().min(1).max(32),
          groupSize: z.number().int().min(2).max(32),
        }),
      )
      .min(1)
      .max(8),
    draw: z.enum(['SEEDED', 'RANDOM_BY_POT', 'MANUAL']),
    labels: z.enum(['NUMBERS', 'LETTERS']).default('NUMBERS'),
    labelOrder: z.enum(['DRAW', 'SOURCE_AGGREGATE']).default('DRAW'),
    tiebreakers: z
      .array(z.enum(GROUP_TIEBREAKERS))
      .min(1)
      .max(GROUP_TIEBREAKERS.length)
      .default(['MATCH_WINS', 'MAP_DIFFERENCE', 'QUALIFIER_SEED']),
    forfeitMapDifference: z.enum(['COUNT', 'IGNORE']).default('COUNT'),
  }),
  z.strictObject({
    kind: z.literal('SINGLE_ELIMINATION'),
    ...eliminationBase,
    entries: z.array(entry).min(1).max(32),
    size: z.number().int().min(2).max(128),
    pairing: pairing.default('STANDARD'),
    thirdPlace: z.boolean().default(false),
    reseed: z.enum(['NONE', 'EACH_ROUND']).default('NONE'),
  }),
  z.strictObject({
    kind: z.literal('DOUBLE_ELIMINATION'),
    ...eliminationBase,
    entries: z.array(laneEntry).min(1).max(32),
    winners: lane,
    losers: lane.nullable().default(null),
    grandFinalReset: z.boolean().default(true),
  }),
]);
export type FormatPhase = z.infer<typeof formatPhaseSchema>;
type EntryPhase = Extract<FormatPhase, { entries: unknown }>;
type GroupsPhase = Extract<FormatPhase, { kind: 'GROUPS' }>;

const isPowerOfTwo = (value: number) => Number.isInteger(Math.log2(value));
export const tierEntrants = (tier: GroupsPhase['tiers'][number]) => tier.seedTo - tier.seedFrom + 1;

// A source's size, or null when it depends on how many entrants actually register.
export function formatSourceCount(phases: readonly FormatPhase[], from: FormatSource) {
  if (from.kind === 'RANK_RANGE') return from.to - from.from + 1;
  if (from.kind === 'EXPLICIT') return from.count;
  const origin = phases.find((phase) => phase.key === from.phase);
  if (from.kind === 'ALL') {
    if (origin?.kind === 'QUALIFIER') return origin.advance;
    if (origin?.kind === 'TEAM_FORMATION') return origin.teamCount;
    return null;
  }
  if (origin?.kind !== 'GROUPS') return null;
  return origin.tiers
    .filter((tier) => !from.tier || tier.key === from.tier)
    .reduce((total, tier) => total + tier.groupCount, 0);
}

export const formatPlanSchema = z
  .strictObject({
    version: z.literal(FORMAT_PLAN_VERSION),
    phases: z.array(formatPhaseSchema).min(1).max(16),
  })
  .superRefine((plan, ctx) => {
    const fail = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    const seen = new Set<string>();
    plan.phases.forEach((phase, index) => {
      if (seen.has(phase.key)) fail(['phases', index, 'key'], 'Phase keys must be unique.');
      seen.add(phase.key);
    });
    const consumed = new Map<string, Set<number>>();
    const placements = new Set<string>();
    plan.phases.forEach((phase, index) => {
      const path = ['phases', index];
      const earlier = plan.phases.slice(0, index);
      if (phase.kind === 'QUALIFIER') {
        if (index && earlier.some((other) => other.kind !== 'QUALIFIER'))
          fail(path, 'Qualifiers must come before other phases.');
        return;
      }
      for (const [entryIndex, item] of (phase as EntryPhase).entries.entries()) {
        const at = [...path, 'entries', entryIndex, 'source'];
        const from = item.source;
        const origin = earlier.find((other) => other.key === from.phase);
        if (!origin) {
          fail(at, `Entrants must come from an earlier phase, not "${from.phase}".`);
          continue;
        }
        if (
          origin.kind === 'QUALIFIER' &&
          origin.entrantUnit === 'INDIVIDUAL_PLAYER' &&
          phase.kind !== 'TEAM_FORMATION'
        )
          fail(at, 'Individual qualifier players must form teams before they can compete.');
        if (phase.kind === 'TEAM_FORMATION' && origin.kind !== 'QUALIFIER')
          fail(at, 'Team formation draws its players from an individual qualifier.');
        if (from.kind === 'RANK_RANGE') {
          if (from.from > from.to) fail(at, 'A rank range must run from best to worst.');
          if (origin.kind === 'QUALIFIER' && origin.advance && from.to > origin.advance)
            fail(at, `Only ${origin.advance} entrants advance from "${origin.name}".`);
          if (origin.kind !== 'QUALIFIER')
            fail(at, 'Rank ranges read final qualifier standings; use a placement for this phase.');
          const taken = consumed.get(origin.key) ?? new Set<number>();
          for (let rank = from.from; rank <= from.to; rank++) {
            if (taken.has(rank)) fail(at, `Rank ${rank} already enters another phase.`);
            taken.add(rank);
          }
          consumed.set(origin.key, taken);
        }
        if (from.kind === 'PLACEMENT') {
          if (origin.kind !== 'GROUPS') {
            fail(at, 'Placements can only come from a group phase.');
            continue;
          }
          if (origin.tiers.length > 1 && !from.tier)
            fail(at, 'Choose which tier this placement comes from.');
          const tiers = origin.tiers.filter((tier) => !from.tier || tier.key === from.tier);
          if (!tiers.length) fail(at, `Unknown tier "${from.tier}".`);
          if (tiers.some((tier) => from.placement > tier.groupSize))
            fail(at, `Placement ${from.placement} does not exist in a group this size.`);
          for (const tier of tiers) {
            const marker = `${origin.key}:${tier.key}:${from.placement}`;
            if (placements.has(marker))
              fail(at, `Placement ${from.placement} already advances elsewhere.`);
            placements.add(marker);
          }
        }
      }
      if (phase.kind === 'TEAM_FORMATION') {
        if (phase.method === 'AUCTION' && !phase.auction)
          fail(path, 'An auction needs a budget, minimum raise and lot order.');
        if (phase.method !== 'AUCTION' && phase.auction)
          fail(path, 'Auction settings only apply to an auction.');
        return;
      }
      const seats = new Map<number, string>();
      let open = false;
      for (const [entryIndex, item] of (phase as EntryPhase).entries.entries()) {
        const count = formatSourceCount(plan.phases, item.source);
        if (count === null) {
          open = true;
          continue;
        }
        for (let offset = 0; offset < count; offset++) {
          const value = item.seedFrom + offset;
          if (seats.has(value))
            fail([...path, 'entries', entryIndex, 'seedFrom'], `Seed ${value} is assigned twice.`);
          seats.set(value, 'lane' in item ? String(item.lane) : '');
        }
      }
      if (phase.kind === 'GROUPS') {
        const covered = new Set<number>();
        let labelled = 0;
        phase.tiers.forEach((tier, tierIndex) => {
          const at = [...path, 'tiers', tierIndex];
          if (tier.seedFrom > tier.seedTo) fail(at, 'A tier must run from best to worst seed.');
          if (tier.groupCount * tier.groupSize !== tierEntrants(tier))
            fail(at, 'Groups in a tier must exactly seat its seed range.');
          for (let value = tier.seedFrom; value <= tier.seedTo; value++) {
            if (covered.has(value)) fail(at, `Seed ${value} is in more than one tier.`);
            covered.add(value);
            if (!open && !seats.has(value)) fail(at, `No entrant is assigned to seed ${value}.`);
          }
          labelled += tier.groupCount;
        });
        if (new Set(phase.tiers.map((tier) => tier.key)).size !== phase.tiers.length)
          fail([...path, 'tiers'], 'Tier keys must be unique.');
        for (const value of seats.keys())
          if (!covered.has(value))
            fail([...path, 'entries'], `Seed ${value} is outside every tier.`);
        if (phase.labels === 'LETTERS' && labelled > 26)
          fail([...path, 'labels'], 'Letter labels support up to 26 groups.');
        if (new Set(phase.tiebreakers).size !== phase.tiebreakers.length)
          fail([...path, 'tiebreakers'], 'Each tiebreaker can be used once.');
        return;
      }
      const checkLane = (
        size: number,
        layout: z.infer<typeof pairing>,
        laneSeats: number[],
        at: (string | number)[],
      ) => {
        if (!isPowerOfTwo(size)) fail(at, 'Bracket sizes must be powers of two.');
        if (laneSeats.length > size)
          fail(at, 'More entrants are assigned than this bracket seats.');
        if (layout === 'STANDARD') return;
        const used = layout.flat();
        if (layout.length !== size / 2)
          fail(at, `A bracket of ${size} needs exactly ${size / 2} opening matches.`);
        if (new Set(used).size !== used.length) fail(at, 'A seed appears in two opening matches.');
        if (!open)
          for (const value of used)
            if (!laneSeats.includes(value))
              fail(at, `Opening match seed ${value} has no assigned entrant.`);
      };
      if (
        phase.rematch === 'AVOID_SAME_GROUP' &&
        !phase.entries.some((item) => item.source.kind === 'PLACEMENT')
      )
        fail([...path, 'rematch'], 'Rematch limits need entrants placed from a group phase.');
      if (phase.kind === 'SINGLE_ELIMINATION') {
        checkLane(phase.size, phase.pairing, [...seats.keys()], [...path, 'size']);
        if (phase.reseed === 'EACH_ROUND' && phase.pairing !== 'STANDARD')
          fail(
            [...path, 'reseed'],
            'Reseeding replaces fixed opening pairs after the first round.',
          );
        if (phase.thirdPlace && phase.size < 4)
          fail([...path, 'thirdPlace'], 'A third-place match needs at least four entrants.');
        return;
      }
      const inLane = (wanted: string) =>
        [...seats.entries()].filter(([, value]) => value === wanted).map(([value]) => value);
      checkLane(phase.winners.size, phase.winners.pairing, inLane('WINNERS'), [...path, 'winners']);
      if (phase.losers) {
        checkLane(phase.losers.size, phase.losers.pairing, inLane('LOSERS'), [...path, 'losers']);
        if (phase.losers.size !== phase.winners.size)
          fail(
            [...path, 'losers'],
            'Losers entry must match the Winners size so each drop has an opponent.',
          );
      } else if (inLane('LOSERS').length)
        fail([...path, 'losers'], 'Enable Losers entry before routing entrants into it.');
    });
  });
export type FormatPlan = z.infer<typeof formatPlanSchema>;
