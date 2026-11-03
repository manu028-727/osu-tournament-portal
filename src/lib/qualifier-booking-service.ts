import type { Prisma } from '@/generated/prisma/client';
import { db } from './db';
import { scopedDb } from './scoped-db';
import { rosterEligibility } from './eligibility';
import { activeExceptions, eligibilityPlayers, takenCountries } from './eligibility-service';
import { AppError, type Actor } from './permissions';
import { registrationConfiguration } from './registration-configuration';
import { qualifierBookingPolicy } from './qualifier-booking-policy';
import { qualifierSourceHash } from './qualifier-seeding';
async function configuration(tx: Prisma.TransactionClient, tournamentId: string) {
  const { tournament, policy: registration } = await registrationConfiguration(tx, tournamentId);
  const policy = qualifierBookingPolicy(tournament.settings!);
  const policyToken = qualifierSourceHash({
    policy,
    eligibility: {
      minRank: registration.minRank,
      maxRank: registration.maxRank,
      rankSumMin: registration.rankSumMin,
      rankSumMax: registration.rankSumMax,
      countries: registration.countries,
      countryTeams: registration.countryTeams,
    },
    format: tournament.format,
    mode: tournament.gameMode,
    rules: tournament.settings!.matchRules,
  });
  return { tournament, policy, registration, policyToken };
}
import { teamInclude } from './teams-service';
import { inheritedRules } from './gameplay-scoring';
import { qualifierPolicySchema } from './qualifier-policy';
import { qualifierActionSchema } from './qualifiers-validation';
import {
  applyQualifierParticipantMove,
  removeQualifierParticipants,
  qualifierNeverStarted,
} from './qualifiers-bulk';
import type { QualifierBookingAction, QualifierBookingData } from './qualifier-booking-contract';
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export async function qualifierBookingData(
  actor: Actor | null,
  tournamentId: string,
): Promise<QualifierBookingData> {
  const { tournament, policy, policyToken } = await configuration(db, tournamentId);
  const team = actor
    ? await db.team.findFirst({
        where: { tournamentId, members: { some: { osuId: actor.osuId, captain: true } } },
        select: { id: true, name: true, version: true, status: true, rejectionReason: true },
      })
    : null;
  const sessions = await db.qualifierLobby.findMany({
    where: {
      deletedAt: null,
      tournamentId,
      status: { not: 'CANCELLED' },
      stage: { kind: 'QUALIFIERS', archivedAt: null },
    },
    select: {
      id: true,
      code: true,
      version: true,
      stageId: true,
      status: true,
      scheduledAt: true,
      capacity: true,
      bookingOpen: true,
      bookingClosesAt: true,
      policy: true,
      rules: true,
      participants: true,
      stage: { select: { name: true } },
      entries: { select: { teamId: true } },
    },
    orderBy: [{ scheduledAt: 'asc' }, { code: 'asc' }],
  });
  return {
    policyToken,
    policy,
    user: actor ? { osuId: actor.osuId, username: actor.username } : null,
    team,
    sessions: sessions.map((session) => {
      const { policy: snapshot, rules, participants: _participants, entries, ...view } = session;
      const runPolicy = qualifierPolicySchema.parse(
        snapshot || {
          requiredPlayers: inheritedRules(rules, tournament.settings!.gameplayScoring).teamSize,
        },
      );
      return {
        ...view,
        requiredPlayers: runPolicy.requiredPlayers,
        runs: runPolicy.runs,
        usedPlayers: entries.length * runPolicy.requiredPlayers,
        booked: !!team && entries.some((entry) => entry.teamId === team.id),
      };
    }),
  };
}
export async function applyQualifierBooking(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: QualifierBookingAction,
) {
  const tournamentId = actor.tournamentId;
  if (!tournamentId || tournamentId === 'none')
    throw new AppError('Select a tournament before continuing.');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
  const { policy, registration, policyToken } = await configuration(tx, tournamentId);
  const legacyToken =
    input.type === 'registration.booking'
      ? (await registrationConfiguration(tx, tournamentId)).policyToken
      : null;
  if (input.policyToken !== policyToken && input.policyToken !== legacyToken)
    throw new AppError('Qualifier booking settings changed. Reload before saving.', 409);
  const owned = await tx.team.findFirst({
    where: { tournamentId, members: { some: { osuId: actor.osuId, captain: true } } },
    include: teamInclude,
  });
  if (
    !owned ||
    (input.lobbyId && owned.status !== 'APPROVED') ||
    owned.version !== input.teamVersion
  )
    throw new AppError('Only the current captain of an approved registration can book.', 403);
  if (
    !policy.enabled ||
    (policy.opensAt && new Date(policy.opensAt) > new Date()) ||
    (policy.closesAt && new Date(policy.closesAt) <= new Date())
  )
    throw new AppError('Qualifier booking is closed.', 409);
  if (input.lobbyId) {
    const blocking = rosterEligibility(
      registration,
      eligibilityPlayers(owned.members),
      await activeExceptions(tx, tournamentId),
      registration.countryTeams ? await takenCountries(tx, tournamentId, owned.id) : [],
    )[0];
    if (blocking) throw new AppError(blocking.message, 400, blocking.values);
  }
  const source = await tx.qualifierLobby.findFirst({
    where: {
      tournamentId,
      stageId: input.stageId,
      status: { not: 'CANCELLED' },
      entries: { some: { teamId: owned.id } },
    },
    include: { scores: true, events: true },
  });
  if (source && (!qualifierNeverStarted(source) || source.version !== input.sourceVersion))
    throw new AppError(
      'The current reservation changed or has started. Contact an organizer.',
      409,
    );
  const scoped = scopedDb(tx, tournamentId);
  if (!input.lobbyId) {
    if (!source) return { id: owned.id };
    await removeQualifierParticipants(
      scoped,
      actor,
      tournamentId,
      qualifierActionSchema.parse({
        type: 'qualifier.participants.remove',
        id: source.id,
        baseVersion: source.version,
        teamIds: [owned.id],
        reason: 'Captain cancelled qualifier reservation',
      }) as Extract<
        import('./qualifiers-validation').QualifierAction,
        { type: 'qualifier.participants.remove' }
      >,
      { captainTeamId: owned.id },
    );
  } else {
    const target = await tx.qualifierLobby.findFirst({
      where: {
        deletedAt: null,
        id: input.lobbyId,
        tournamentId,
        stageId: input.stageId,
        stage: { kind: 'QUALIFIERS', archivedAt: null },
      },
      include: { scores: true, events: true },
    });
    if (!target || target.version !== input.baseVersion || !qualifierNeverStarted(target))
      throw new AppError(
        'This session changed or has started. Reload the available sessions.',
        409,
      );
    if (
      !target.bookingOpen ||
      !target.scheduledAt ||
      target.scheduledAt <= new Date() ||
      (target.bookingClosesAt && target.bookingClosesAt <= new Date())
    )
      throw new AppError('This session is closed for booking.', 409);
    if (source?.id === target.id) return { id: owned.id };
    await applyQualifierParticipantMove(
      scoped,
      actor,
      tournamentId,
      {
        type: 'qualifier.participants.move',
        fromLobbyId: source?.id || null,
        sourceVersion: source?.version,
        toLobbyId: target.id,
        baseVersion: target.version,
        teamIds: [owned.id],
        reason: 'Captain qualifier reservation',
      },
      { captainTeamId: owned.id },
    );
  }
  await tx.auditLog.create({
    data: {
      tournamentId,
      actorId: actor.id,
      action: input.type,
      entityType: 'Team',
      entityId: owned.id,
      details: json(input),
    },
  });
  return { id: owned.id };
}
