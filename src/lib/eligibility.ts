import type { RegistrationPolicy } from './registration-policy';

// Who may enter, decided in one place. Registration, qualifier booking, organizer approval
// and the review list all read these same answers, each deciding what a problem means there.
export const ELIGIBILITY_EXCEPTIONS = ['RANK', 'COUNTRY', 'RANK_SUM'] as const;
export type EligibilityExceptionKind = (typeof ELIGIBILITY_EXCEPTIONS)[number];
export type EligibilityPlayer = {
  osuId: number;
  username: string;
  rank: number | null;
  country: string | null;
  captain: boolean;
  substitute: boolean;
};
export type EligibilityIssue = {
  code:
    'RANK_UNKNOWN' | 'RANK_OUTSIDE' | 'COUNTRY' | 'COUNTRY_MIXED' | 'COUNTRY_TAKEN' | 'RANK_SUM';
  // The decision that would clear this, attached to one player.
  kind: EligibilityExceptionKind;
  osuId: number;
  message: string;
  values: (string | number)[];
};
type Limits = Pick<
  RegistrationPolicy,
  | 'minRank'
  | 'maxRank'
  | 'rankSumMin'
  | 'rankSumMax'
  | 'rankSumScope'
  | 'countries'
  | 'countryTeams'
>;

export const rankLocked = (policy: Pick<RegistrationPolicy, 'rankLockAt'>, now = new Date()) =>
  !!policy.rankLockAt && new Date(policy.rankLockAt).getTime() <= now.getTime();

// A reading taken after the lock is the closest record of the locked rank, so it stands.
export const rankReadingIsLocked = (
  policy: Pick<RegistrationPolicy, 'rankLockAt'>,
  capturedAt: Date | string | null | undefined,
) =>
  !!policy.rankLockAt &&
  !!capturedAt &&
  new Date(capturedAt).getTime() >= new Date(policy.rankLockAt).getTime();

export function rosterEligibility(
  policy: Limits,
  players: readonly EligibilityPlayer[],
  exceptions: readonly { osuId: number; kind: string }[],
  takenCountries: readonly string[] = [],
): EligibilityIssue[] {
  const allowed = (osuId: number, kind: EligibilityExceptionKind) =>
    exceptions.some((item) => item.osuId === osuId && item.kind === kind);
  const issues: EligibilityIssue[] = [];
  const captain = players.find((player) => player.captain) ?? players[0];
  const rankLimited = !!(policy.minRank || policy.maxRank);
  const sumLimited = !!(policy.rankSumMin || policy.rankSumMax);
  for (const player of players) {
    if ((rankLimited || sumLimited) && player.rank === null && !allowed(player.osuId, 'RANK'))
      issues.push({
        code: 'RANK_UNKNOWN',
        kind: 'RANK',
        osuId: player.osuId,
        message: "{0}'s rank has not been recorded.",
        values: [player.username],
      });
    if (
      rankLimited &&
      player.rank !== null &&
      !allowed(player.osuId, 'RANK') &&
      ((policy.minRank && player.rank < policy.minRank) ||
        (policy.maxRank && player.rank > policy.maxRank))
    )
      issues.push({
        code: 'RANK_OUTSIDE',
        kind: 'RANK',
        osuId: player.osuId,
        message: '{0} is rank {1}, outside the allowed range.',
        values: [player.username, player.rank],
      });
    if (
      policy.countries.length &&
      !policy.countries.includes(player.country ?? '') &&
      !allowed(player.osuId, 'COUNTRY')
    )
      issues.push({
        code: 'COUNTRY',
        kind: 'COUNTRY',
        osuId: player.osuId,
        message: '{0} is not from an eligible country.',
        values: [player.username],
      });
    if (
      policy.countryTeams &&
      captain &&
      player.country !== captain.country &&
      !allowed(player.osuId, 'COUNTRY')
    )
      issues.push({
        code: 'COUNTRY_MIXED',
        kind: 'COUNTRY',
        osuId: player.osuId,
        message: "{0} does not share the captain's country.",
        values: [player.username],
      });
  }
  if (
    policy.countryTeams &&
    captain?.country &&
    takenCountries.includes(captain.country) &&
    !allowed(captain.osuId, 'COUNTRY')
  )
    issues.push({
      code: 'COUNTRY_TAKEN',
      kind: 'COUNTRY',
      osuId: captain.osuId,
      message: 'Another team already represents {0}.',
      values: [captain.country],
    });
  if (sumLimited && captain) {
    const counted = players.filter(
      (player) => policy.rankSumScope === 'ROSTER' || !player.substitute,
    );
    const sum = counted.reduce((total, player) => total + (player.rank ?? 0), 0);
    if (
      counted.every((player) => player.rank !== null) &&
      !counted.some((player) => allowed(player.osuId, 'RANK_SUM')) &&
      ((policy.rankSumMin && sum < policy.rankSumMin) ||
        (policy.rankSumMax && sum > policy.rankSumMax))
    )
      issues.push({
        code: 'RANK_SUM',
        kind: 'RANK_SUM',
        osuId: captain.osuId,
        message: 'The team rank sum of {0} is outside the allowed range.',
        values: [sum],
      });
  }
  return issues;
}
