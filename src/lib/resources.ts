import { z } from 'zod';

const amount = z.number().int().min(0).max(100_000_000);
// A budget's rules. Lanes and rounds match bracket rounds, so "Losers from round 3" means
// what the bracket says it means rather than a separately maintained list of matches.
export const resourcePolicySchema = z.strictObject({
  enabled: z.boolean().default(false),
  currency: z.string().trim().min(1).max(8).default('$'),
  startingBalance: amount.default(0),
  maxPerStage: z.number().int().min(1).max(100).nullable().default(null),
  earnings: z
    .strictObject({
      mapWin: amount.default(0),
      matchWin: amount.default(0),
      overrides: z
        .array(
          z.strictObject({
            lane: z.enum(['WINNERS', 'LOSERS', 'FINALS']),
            fromRound: z.number().int().min(1).max(64),
            mapWin: amount,
            matchWin: amount,
          }),
        )
        .max(8)
        .default([]),
    })
    .prefault({}),
  public: z.boolean().default(true),
});
export type ResourcePolicy = z.infer<typeof resourcePolicySchema>;
export const resourcePolicy = (value: unknown) => resourcePolicySchema.parse(value ?? {});

export type ConfirmedMatch = {
  code: string;
  lane: string | null;
  round: number | null;
  teamAId: string | null;
  teamBId: string | null;
  winnerSide: 'A' | 'B' | null;
  mapWinners: ('A' | 'B')[];
};
export const earningRates = (
  policy: ResourcePolicy,
  match: Pick<ConfirmedMatch, 'lane' | 'round'>,
) => {
  // The last matching override wins, so a later round's rate can replace an earlier one.
  const override = policy.earnings.overrides
    .filter(
      (item) => item.lane === match.lane && match.round !== null && match.round >= item.fromRound,
    )
    .at(-1);
  return override ?? policy.earnings;
};

// What a team earned in one confirmed match. A forfeit plays no maps, so it earns only the
// match rate: whether a forfeit should pay anything more is the organizers' call to adjust.
export function matchEarnings(policy: ResourcePolicy, match: ConfirmedMatch, teamId: string) {
  const side = match.teamAId === teamId ? 'A' : match.teamBId === teamId ? 'B' : null;
  if (!side) return { maps: 0, amount: 0 };
  const rates = earningRates(policy, match);
  const maps = match.mapWinners.filter((winner) => winner === side).length;
  return {
    maps,
    amount: maps * rates.mapWin + (match.winnerSide === side ? rates.matchWin : 0),
  };
}

export type LedgerInput = {
  policy: ResourcePolicy;
  auction: { budget: number; spent: number } | null;
  matches: readonly ConfirmedMatch[];
  purchases: readonly { price: number; reversed: boolean }[];
  adjustments: readonly { amount: number }[];
};
// Derived every time, so correcting a result or reversing a purchase corrects the balance.
export function teamBalance(teamId: string, input: LedgerInput) {
  const starting = input.auction ? input.auction.budget : input.policy.startingBalance;
  const spentAtAuction = input.auction?.spent ?? 0;
  const earned = input.matches.reduce(
    (total, match) => total + matchEarnings(input.policy, match, teamId).amount,
    0,
  );
  const purchased = input.purchases
    .filter((purchase) => !purchase.reversed)
    .reduce((total, purchase) => total + purchase.price, 0);
  const adjusted = input.adjustments.reduce((total, item) => total + item.amount, 0);
  return {
    starting,
    spentAtAuction,
    earned,
    purchased,
    adjusted,
    balance: starting - spentAtAuction + earned - purchased + adjusted,
  };
}
