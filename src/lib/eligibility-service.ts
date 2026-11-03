import type { Prisma } from '@/generated/prisma/client';
import {
  rankLocked,
  rankReadingIsLocked,
  rosterEligibility,
  type EligibilityIssue,
  type EligibilityPlayer,
} from './eligibility';
import { AppError, type Actor } from './permissions';
import { registrationPolicySchema, type RegistrationPolicy } from './registration-policy';
import { scopedDb } from './scoped-db';

type RosterRow = {
  osuId: number;
  captain: boolean;
  substitute: boolean;
  registrationRank: number | null;
  registeredUsername: string | null;
  participant: { username: string; country: string | null };
};
const reviewedTeam = {
  id: true,
  name: true,
  status: true,
  version: true,
  members: {
    orderBy: { position: 'asc' as const },
    select: {
      osuId: true,
      captain: true,
      substitute: true,
      registrationRank: true,
      registeredUsername: true,
      rankCapturedAt: true,
      participant: { select: { username: true, country: true } },
    },
  },
};

export const eligibilityPlayers = (members: readonly RosterRow[]): EligibilityPlayer[] =>
  members.map((member) => ({
    osuId: member.osuId,
    username: member.registeredUsername || member.participant.username,
    rank: member.registrationRank,
    country: member.participant.country,
    captain: member.captain,
    substitute: member.substitute,
  }));

export async function activeExceptions(tx: Prisma.TransactionClient, tournamentId: string) {
  return scopedDb(tx, tournamentId).eligibilityException.findMany({
    where: { tournamentId, revokedAt: null },
    select: { osuId: true, kind: true },
  });
}

// Countries already represented by a team other than this one.
export async function takenCountries(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  excludeTeamId?: string,
) {
  const captains = await scopedDb(tx, tournamentId).teamMember.findMany({
    where: {
      tournamentId,
      captain: true,
      team: {
        supersededAt: null,
        status: { not: 'REJECTED' },
        ...(excludeTeamId ? { id: { not: excludeTeamId } } : {}),
      },
    },
    select: { participant: { select: { country: true } } },
  });
  return captains.flatMap((row) => (row.participant.country ? [row.participant.country] : []));
}

const knownProblem = (issue: EligibilityIssue) => issue.code !== 'RANK_UNKNOWN';

// Approval is the moment a problem must have been decided, so it leaves a recorded reason.
// Teams organizers enter themselves skip this step and appear in the review list instead.
export async function assertApprovable(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  teamId: string,
) {
  const db = scopedDb(tx, tournamentId);
  const settings = await db.tournamentSettings.findUnique({ where: { tournamentId } });
  const policy = registrationPolicySchema.parse(settings?.registrationPolicy || {});
  const team = await db.team.findFirstOrThrow({ where: { id: teamId }, select: reviewedTeam });
  const blocking = rosterEligibility(
    policy,
    eligibilityPlayers(team.members),
    await activeExceptions(tx, tournamentId),
    policy.countryTeams ? await takenCountries(tx, tournamentId, teamId) : [],
  ).find(knownProblem);
  if (blocking) throw new AppError(blocking.message, 409, blocking.values);
}

export async function eligibilityReview(tx: Prisma.TransactionClient, tournamentId: string) {
  const db = scopedDb(tx, tournamentId);
  const settings = await db.tournamentSettings.findUnique({ where: { tournamentId } });
  const policy = registrationPolicySchema.parse(settings?.registrationPolicy || {});
  const [teams, exceptions] = await Promise.all([
    db.team.findMany({
      where: { supersededAt: null, status: { not: 'REJECTED' } },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      select: reviewedTeam,
    }),
    db.eligibilityException.findMany({
      where: { tournamentId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  const owners = policy.countryTeams
    ? teams.flatMap((team) => {
        const captain = team.members.find((member) => member.captain);
        return captain?.participant.country
          ? [{ teamId: team.id, country: captain.participant.country }]
          : [];
      })
    : [];
  const rows = teams.flatMap((team) => {
    const issues = rosterEligibility(
      policy,
      eligibilityPlayers(team.members),
      exceptions,
      owners.filter((owner) => owner.teamId !== team.id).map((owner) => owner.country),
    );
    return issues.length || team.status === 'PENDING'
      ? [{ id: team.id, name: team.name, status: team.status, version: team.version, issues }]
      : [];
  });
  const members = teams.flatMap((team) => team.members);
  return {
    rows,
    exceptions: exceptions.map((item) => ({
      id: item.id,
      osuId: item.osuId,
      username: item.username,
      kind: item.kind,
      reason: item.reason,
    })),
    teams: teams.length,
    players: members.length,
    // Every roster player, so capturing can run in small batches from the browser.
    rankTargets: members
      .filter((member) => !rankReadingIsLocked(policy, member.rankCapturedAt))
      .map((member) => member.osuId),
    rankLockAt: policy.rankLockAt,
    rankLockPassed: rankLocked(policy),
    limited: !!(
      policy.minRank ||
      policy.maxRank ||
      policy.rankSumMin ||
      policy.rankSumMax ||
      policy.countries.length ||
      policy.countryTeams
    ),
  };
}
export type EligibilityReview = Awaited<ReturnType<typeof eligibilityReview>>;

type EligibilityAction =
  | {
      type: 'eligibility.exception.grant';
      osuId: number;
      kind: 'RANK' | 'COUNTRY' | 'RANK_SUM';
      reason: string;
    }
  | { type: 'eligibility.exception.revoke'; id: string; reason: string }
  | { type: 'eligibility.ranks.capture'; osuIds: number[] };

export type EligibilityPrepared = {
  username?: string;
  ranks?: { osuId: number; rank: number | null }[];
};

export async function applyEligibilityAction(
  transaction: Prisma.TransactionClient,
  actor: Actor,
  tournamentId: string,
  a: EligibilityAction,
  prepared: EligibilityPrepared,
) {
  const tx = scopedDb(transaction, tournamentId);
  if (a.type === 'eligibility.exception.grant') {
    const data = {
      username: prepared.username!,
      reason: a.reason,
      actorId: actor.id,
      createdAt: new Date(),
      revokedAt: null,
      revokedById: null,
      revokedReason: '',
    };
    const row = await tx.eligibilityException.upsert({
      where: { tournamentId_osuId_kind: { tournamentId, osuId: a.osuId, kind: a.kind } },
      create: { ...data, tournamentId, osuId: a.osuId, kind: a.kind },
      update: data,
    });
    return { id: row.id };
  }
  if (a.type === 'eligibility.exception.revoke') {
    const row = await tx.eligibilityException.findFirst({ where: { id: a.id, revokedAt: null } });
    if (!row) throw new AppError('This exception was already removed.', 409);
    await tx.eligibilityException.update({
      where: { id: a.id },
      data: { revokedAt: new Date(), revokedById: actor.id, revokedReason: a.reason },
    });
    return { id: a.id };
  }
  const settings = await tx.tournamentSettings.findUnique({ where: { tournamentId } });
  const policy: RegistrationPolicy = registrationPolicySchema.parse(
    settings?.registrationPolicy || {},
  );
  const now = new Date();
  let captured = 0;
  for (const { osuId, rank } of prepared.ranks ?? []) {
    const member = await tx.teamMember.findFirst({ where: { tournamentId, osuId } });
    if (!member || rankReadingIsLocked(policy, member.rankCapturedAt)) continue;
    await tx.teamMember.update({
      where: { teamId_osuId: { teamId: member.teamId, osuId } },
      data: { registrationRank: rank, rankCapturedAt: now },
    });
    captured++;
  }
  return { captured };
}
