import { describe, expect, it } from 'vitest';
import {
  rankLocked,
  rankReadingIsLocked,
  rosterEligibility,
  type EligibilityPlayer,
} from '../src/lib/eligibility';
import { registrationActionSchema, registrationPolicySchema } from '../src/lib/registration-policy';
import { rosterSchema } from '../src/lib/teams-validation';
import { validationFeedback } from '../src/lib/validation-feedback';

const policy = (fields: object = {}) => registrationPolicySchema.parse(fields);
const player = (osuId: number, rank: number | null, fields: Partial<EligibilityPlayer> = {}) => ({
  osuId,
  username: `P${osuId}`,
  rank,
  country: 'IT',
  captain: osuId === 1,
  substitute: false,
  ...fields,
});
const codes = (...args: Parameters<typeof rosterEligibility>) =>
  rosterEligibility(...args).map((issue) => issue.code);
// The written limits of a real 2v2 event, used here because their boundaries are exact.
const oidcLimits = policy({
  minRank: 1,
  maxRank: 99_999,
  rankSumMin: 5_000,
  rankSumMax: 150_000,
  countries: ['IT', 'SM', 'VA'],
});

describe('rosterEligibility', () => {
  it('holds individual rank limits exactly at their boundaries', () => {
    expect(codes(oidcLimits, [player(1, 99_999), player(2, 50_000)], [])).toEqual([]);
    expect(codes(oidcLimits, [player(1, 100_000), player(2, 40_000)], [])).toEqual([
      'RANK_OUTSIDE',
    ]);
  });

  it('holds team rank sums exactly at their boundaries', () => {
    expect(codes(oidcLimits, [player(1, 2_500), player(2, 2_500)], [])).toEqual([]);
    expect(codes(oidcLimits, [player(1, 2_499), player(2, 2_500)], [])).toEqual(['RANK_SUM']);
    expect(codes(oidcLimits, [player(1, 75_000), player(2, 75_000)], [])).toEqual([]);
    expect(codes(oidcLimits, [player(1, 75_001), player(2, 75_000)], [])).toEqual(['RANK_SUM']);
  });

  it('counts substitutes in a rank sum only when asked to', () => {
    const roster = [player(1, 2_500), player(2, 2_500), player(3, 99_000, { substitute: true })];
    const limits = { rankSumMax: 10_000 };
    expect(codes(policy(limits), roster, [])).toEqual([]);
    expect(codes(policy({ ...limits, rankSumScope: 'ROSTER' }), roster, [])).toEqual(['RANK_SUM']);
  });

  it('accepts several allowed countries and lifts a country limit for one player only', () => {
    const roster = [player(1, 2_500, { country: 'SM' }), player(2, 2_500, { country: 'FR' })];
    expect(rosterEligibility(oidcLimits, roster, [])).toMatchObject([
      { code: 'COUNTRY', osuId: 2, kind: 'COUNTRY' },
    ]);
    expect(codes(oidcLimits, roster, [{ osuId: 2, kind: 'COUNTRY' }])).toEqual([]);
    expect(codes(oidcLimits, roster, [{ osuId: 1, kind: 'COUNTRY' }])).toEqual(['COUNTRY']);
  });

  it('never treats a missing rank as passing, even when no other limit fails', () => {
    expect(codes(oidcLimits, [player(1, null), player(2, 5_000)], [])).toEqual(['RANK_UNKNOWN']);
    expect(codes(policy({ rankSumMax: 10 }), [player(1, null)], [])).toEqual(['RANK_UNKNOWN']);
    expect(codes(policy(), [player(1, null)], [])).toEqual([]);
  });

  it('holds a sum decision separately from a personal rank decision', () => {
    const roster = [player(1, 80_000), player(2, 80_000)];
    expect(codes(oidcLimits, roster, [{ osuId: 1, kind: 'RANK' }])).toEqual(['RANK_SUM']);
    expect(codes(oidcLimits, roster, [{ osuId: 2, kind: 'RANK_SUM' }])).toEqual([]);
  });

  it('keeps national teams to one country, with room for a territory decision', () => {
    const national = policy({ countryTeams: true });
    const roster = [player(1, 1), player(2, 2, { country: 'SM' })];
    expect(codes(national, roster, [])).toEqual(['COUNTRY_MIXED']);
    expect(codes(national, roster, [{ osuId: 2, kind: 'COUNTRY' }])).toEqual([]);
    expect(codes(national, [player(1, 1)], [], ['IT'])).toEqual(['COUNTRY_TAKEN']);
    expect(codes(national, [player(1, 1)], [{ osuId: 1, kind: 'COUNTRY' }], ['IT'])).toEqual([]);
    expect(codes(national, [player(1, 1)], [], ['FR'])).toEqual([]);
  });

  it('has nothing to say when no limits are set', () => {
    expect(codes(policy(), [player(1, null, { country: null })], [])).toEqual([]);
  });
});

describe('rank locks', () => {
  const lock = { rankLockAt: '2026-08-30T21:59:00.000Z' };
  it('starts exactly at the configured moment', () => {
    expect(rankLocked(lock, new Date('2026-08-30T21:58:59.999Z'))).toBe(false);
    expect(rankLocked(lock, new Date('2026-08-30T21:59:00.000Z'))).toBe(true);
    expect(rankLocked({ rankLockAt: null })).toBe(false);
  });

  it('treats only a reading taken at or after the lock as final', () => {
    expect(rankReadingIsLocked(lock, new Date('2026-08-30T21:58:59.999Z'))).toBe(false);
    expect(rankReadingIsLocked(lock, '2026-08-30T21:59:00.000Z')).toBe(true);
    expect(rankReadingIsLocked(lock, null)).toBe(false);
    expect(rankReadingIsLocked({ rankLockAt: null }, new Date())).toBe(false);
  });
});

describe('registration policy', () => {
  it('reads every saved policy as it did before these limits existed', () => {
    const parsed = policy({ minRank: 5 });
    expect(parsed).toMatchObject({
      rankSumMin: null,
      rankSumMax: null,
      rankLockAt: null,
      countryTeams: false,
      ineligible: 'REJECT',
    });
  });

  it('refuses an impossible rank sum range', () => {
    expect(registrationPolicySchema.safeParse({ rankSumMin: 10, rankSumMax: 5 }).success).toBe(
      false,
    );
  });
});

describe('Discord contact on a roster', () => {
  const registering = (discordId: string) =>
    registrationActionSchema.safeParse({
      type: 'registration.save',
      baseVersion: 0,
      policyToken: 'a'.repeat(64),
      name: 'Entry',
      format: 'TEAM',
      members: [{ osuId: 1, substitute: false, discordId }],
    });
  const editing = (discordId: string) =>
    rosterSchema.safeParse([{ osuId: 1, captain: true, substitute: false, discordId }]);

  it('takes a user ID or nothing, from a captain and from an organizer alike', () => {
    for (const check of [registering, editing])
      for (const value of ['', '12345678901234567', '12345678901234567890'])
        expect(check(value).success, value).toBe(true);
  });

  it('explains a refusal in words, in either language', () => {
    for (const check of [registering, editing])
      for (const value of ['manu028', '1234567890123456', '123456789012345678901']) {
        const issues = check(value).error!.issues;
        expect(issues[0].message).toBe('Use a Discord user ID, not a username.');
        expect(validationFeedback(issues, 'it')).toContain(
          'Usa un ID utente Discord, non un nome utente.',
        );
      }
  });
});
