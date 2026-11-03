import { describe, expect, it } from 'vitest';
import {
  earningRates,
  matchEarnings,
  resourcePolicy,
  resourcePolicySchema,
  teamBalance,
  type ConfirmedMatch,
} from '../src/lib/resources';

const match = (fields: Partial<ConfirmedMatch> = {}): ConfirmedMatch => ({
  code: '1',
  lane: 'WINNERS',
  round: 1,
  teamAId: 'a',
  teamBId: 'b',
  winnerSide: 'A',
  scoreA: 3,
  scoreB: 1,
  forfeit: false,
  ...fields,
});
// The written earnings of one real event: 200 per map, 100 in losers rounds after the second.
const policy = resourcePolicy({
  enabled: true,
  earnings: {
    mapWin: 200,
    overrides: [{ lane: 'LOSERS', fromRound: 3, mapWin: 100, matchWin: 0 }],
  },
});

describe('earning rates', () => {
  it('applies a different rate only from the round it starts', () => {
    expect(earningRates(policy, { lane: 'LOSERS', round: 2 }).mapWin).toBe(200);
    expect(earningRates(policy, { lane: 'LOSERS', round: 3 }).mapWin).toBe(100);
    expect(earningRates(policy, { lane: 'LOSERS', round: 7 }).mapWin).toBe(100);
    expect(earningRates(policy, { lane: 'WINNERS', round: 3 }).mapWin).toBe(200);
    expect(earningRates(policy, { lane: 'FINALS', round: 1 }).mapWin).toBe(200);
  });

  it('uses the base rate for a match outside any bracket', () => {
    expect(earningRates(policy, { lane: null, round: null }).mapWin).toBe(200);
  });

  it('lets a later override replace an earlier one', () => {
    const tiered = resourcePolicy({
      earnings: {
        overrides: [
          { lane: 'LOSERS', fromRound: 2, mapWin: 50, matchWin: 0 },
          { lane: 'LOSERS', fromRound: 4, mapWin: 10, matchWin: 0 },
        ],
      },
    });
    expect(earningRates(tiered, { lane: 'LOSERS', round: 3 }).mapWin).toBe(50);
    expect(earningRates(tiered, { lane: 'LOSERS', round: 5 }).mapWin).toBe(10);
  });
});

describe('match earnings', () => {
  it('pays each team for the maps it won, win or lose', () => {
    expect(matchEarnings(policy, match(), 'a')).toEqual({ maps: 3, amount: 600 });
    expect(matchEarnings(policy, match(), 'b')).toEqual({ maps: 1, amount: 200 });
  });

  it('adds a match win only for the winner', () => {
    const paid = resourcePolicy({ earnings: { mapWin: 10, matchWin: 100 } });
    expect(matchEarnings(paid, match(), 'a').amount).toBe(130);
    expect(matchEarnings(paid, match(), 'b').amount).toBe(10);
  });

  it('earns no map money from a forfeit, whose score records no maps played', () => {
    const forfeit = match({ scoreA: 6, scoreB: 0, forfeit: true });
    expect(matchEarnings(policy, forfeit, 'a')).toEqual({ maps: 0, amount: 0 });
    const paid = resourcePolicy({ earnings: { mapWin: 10, matchWin: 100 } });
    expect(matchEarnings(paid, forfeit, 'a').amount).toBe(100);
  });

  it('ignores teams that did not play', () => {
    expect(matchEarnings(policy, match(), 'c')).toEqual({ maps: 0, amount: 0 });
  });
});

describe('team balance', () => {
  const base = {
    policy,
    auction: { budget: 4000, spent: 3400 },
    matches: [match()],
    purchases: [
      { price: 500, reversed: false },
      { price: 800, reversed: true },
    ],
    adjustments: [{ amount: 50 }, { amount: -25 }],
  };

  it('is derived from each thing that moves money', () => {
    expect(teamBalance('a', base)).toEqual({
      starting: 4000,
      spentAtAuction: 3400,
      earned: 600,
      purchased: 500,
      adjusted: 25,
      balance: 725,
    });
  });

  it('falls with a corrected result without anything being recorded', () => {
    const corrected = { ...base, matches: [match({ scoreA: 1, scoreB: 3, winnerSide: 'B' })] };
    expect(teamBalance('a', base).balance - teamBalance('a', corrected).balance).toBe(400);
  });

  it('uses the configured starting balance for a team no auction formed', () => {
    const plain = resourcePolicy({ startingBalance: 1000 });
    expect(
      teamBalance('a', {
        policy: plain,
        auction: null,
        matches: [],
        purchases: [],
        adjustments: [],
      }).balance,
    ).toBe(1000);
  });

  it('can go negative, which is for organizers to settle rather than hide', () => {
    const over = { ...base, auction: { budget: 100, spent: 300 }, matches: [], adjustments: [] };
    expect(teamBalance('a', over).balance).toBe(-700);
  });
});

describe('resource policy', () => {
  it('defaults to off and reads a missing policy', () => {
    expect(resourcePolicy(null)).toMatchObject({
      enabled: false,
      startingBalance: 0,
      earnings: { mapWin: 0, matchWin: 0, overrides: [] },
    });
  });

  it('rejects unknown fields and negative money', () => {
    expect(resourcePolicySchema.safeParse({ surprise: true }).success).toBe(false);
    expect(resourcePolicySchema.safeParse({ startingBalance: -1 }).success).toBe(false);
  });
});
