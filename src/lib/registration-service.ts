import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { db } from './db';
import { scopedDb } from './scoped-db';
import { AppError, type Actor } from './permissions';
import { publicTournamentWhere } from './public-visibility';
import { registrationPolicySchema, type RegistrationAction } from './registration-policy';
import { profileSchema, osuGet } from './osu';
import { teamFields } from './teams-validation';
import { writeTeam, teamInclude } from './teams-service';
import { inheritedRules } from './gameplay-scoring';
import {
  applyQualifierParticipantMove,
  removeQualifierParticipants,
  qualifierNeverStarted,
} from './qualifiers-bulk';
import { qualifierActionSchema } from './qualifiers-validation';
import { qualifierPolicySchema } from './qualifier-policy';
import type { RegistrationData } from './registration-types';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const profile = profileSchema.extend({
  statistics: z
    .object({ global_rank: z.number().int().positive().nullable() })
    .nullable()
    .optional(),
});
type Profile = z.infer<typeof profile>;
const profileCache = new Map<string, { expires: number; value: Profile }>();

async function configuration(tx: Prisma.TransactionClient, tournamentId: string) {
  const tournament = await tx.tournament.findFirst({
    where: { id: tournamentId, ...publicTournamentWhere },
    include: { settings: true },
  });
  if (!tournament?.settings) throw new AppError('Tournament not found.', 404);
  const policy = registrationPolicySchema.parse(tournament.settings.registrationPolicy || {});
  const policyToken = createHash('sha256')
    .update(
      JSON.stringify({
        policy,
        format: tournament.format,
        status: tournament.status,
        mode: tournament.gameMode,
        rules: tournament.settings.matchRules,
      }),
    )
    .digest('hex');
  return { tournament, policy, policyToken };
}
function registrationOpen(
  policy: z.infer<typeof registrationPolicySchema>,
  status: string,
  editing: boolean,
) {
  const now = Date.now();
  const deadline = editing ? policy.rosterClosesAt || policy.closesAt : policy.closesAt;
  return (
    policy.mode === 'WEBSITE' &&
    (editing || status === 'REGISTRATIONS_OPEN') &&
    !(editing && policy.rosterLocked) &&
    (!policy.opensAt || new Date(policy.opensAt).getTime() <= now) &&
    (!deadline || new Date(deadline).getTime() > now)
  );
}
export async function prepareRegistration(actor: Actor, action: RegistrationAction) {
  if (action.type !== 'registration.save') return [];
  const { tournament } = await configuration(db, actor.tournamentId!);
  const profiles: Profile[] = [];
  for (const member of action.members) {
    const key = `${tournament.gameMode}:${member.osuId}`;
    let cached = profileCache.get(key);
    if (!cached || cached.expires < Date.now()) {
      cached = {
        value: profile.parse(await osuGet(`users/${member.osuId}/${tournament.gameMode}`)),
        expires: Date.now() + 60000,
      };
      if (cached.value.id !== member.osuId)
        throw new AppError('Profile identity does not match the requested osu! ID.');
      if (profileCache.size > 1000) profileCache.clear();
      profileCache.set(key, cached);
    }
    profiles.push(cached.value);
  }
  return profiles;
}
export async function registrationData(
  actor: Actor | null,
  tournamentId: string,
): Promise<RegistrationData> {
  const { tournament, policy, policyToken } = await configuration(db, tournamentId);
  const team = actor
    ? await db.team.findFirst({
        where: { tournamentId, members: { some: { osuId: actor.osuId, captain: true } } },
        include: teamInclude,
      })
    : null;
  const membership = actor
    ? await db.teamMember.findUnique({
        where: { tournamentId_osuId: { tournamentId, osuId: actor.osuId } },
        select: { teamId: true },
      })
    : null;
  const competitionLocked =
    !!team &&
    (!!(await db.match.findFirst({
      where: { tournamentId, OR: [{ teamAId: team.id }, { teamBId: team.id }] },
      select: { id: true },
    })) ||
      !!(await db.qualifierLobby.findFirst({
        where: {
          tournamentId,
          entries: { some: { teamId: team.id } },
          OR: [
            { status: { notIn: ['SCHEDULED', 'CANCELLED'] } },
            { scores: { some: {} } },
            {
              events: {
                some: { kind: 'qualifier.status', data: { path: ['command'], equals: 'START' } },
              },
            },
          ],
        },
        select: { id: true },
      })));
  const sessions = await db.qualifierLobby.findMany({
    where: {
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
    policy,
    policyToken,
    format: tournament.format,
    gameMode: tournament.gameMode,
    minimumPlayers: Math.max(
      1,
      policy.minPlayers ||
        inheritedRules(tournament.settings!.matchRules, tournament.settings!.gameplayScoring)
          .teamSize,
    ),
    externalUrl: policy.mode === 'EXTERNAL' ? tournament.settings!.registrationUrl : null,
    open: registrationOpen(policy, tournament.status, !!team) && !competitionLocked,
    user: actor ? { osuId: actor.osuId, username: actor.username } : null,
    membership: membership?.teamId || null,
    team: team
      ? {
          id: team.id,
          name: team.name,
          format: team.format,
          version: team.version,
          status: team.status,
          rejectionReason: team.rejectionReason,
          answers: team.registrationAnswers,
          members: [...team.members]
            .sort((a, b) => Number(b.captain) - Number(a.captain))
            .map((member) => ({
              osuId: member.osuId,
              username: member.registeredUsername || member.participant.username,
              captain: member.captain,
              substitute: member.substitute,
              discordId: member.discordId,
            })),
        }
      : null,
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
export async function applyRegistration(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: RegistrationAction,
  profiles: Profile[],
) {
  const tournamentId = actor.tournamentId;
  if (!tournamentId || tournamentId === 'none')
    throw new AppError('Select a tournament before continuing.');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
  const { tournament, policy, policyToken } = await configuration(tx, tournamentId);
  if (input.policyToken !== policyToken)
    throw new AppError('Registration settings changed. Reload before saving.', 409);
  const owned = await tx.team.findFirst({
    where: { tournamentId, members: { some: { osuId: actor.osuId, captain: true } } },
    include: teamInclude,
  });
  if (input.type === 'registration.booking') {
    if (
      !owned ||
      (input.lobbyId && owned.status !== 'APPROVED') ||
      owned.version !== input.teamVersion
    )
      throw new AppError('Only the current captain of an approved registration can book.', 403);
    if (
      !policy.bookingEnabled ||
      (policy.bookingClosesAt && new Date(policy.bookingClosesAt) <= new Date())
    )
      throw new AppError('Qualifier booking is closed.', 409);
    if (input.lobbyId)
      for (const member of owned.members) {
        if (
          (policy.minRank || policy.maxRank) &&
          (!member.registrationRank ||
            (policy.minRank && member.registrationRank < policy.minRank) ||
            (policy.maxRank && member.registrationRank > policy.maxRank))
        )
          throw new AppError('A player does not meet the configured rank eligibility.');
        if (policy.countries.length && !policy.countries.includes(member.participant.country || ''))
          throw new AppError('A player does not meet the configured country eligibility.');
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
  if (!registrationOpen(policy, tournament.status, !!owned))
    throw new AppError('Registration or roster editing is closed.', 409);
  if (input.baseVersion !== (owned?.version || 0))
    throw new AppError('Your registration changed. Reload before saving.', 409);
  if (!input.members.some((member) => member.osuId === actor.osuId && !member.substitute))
    throw new AppError('The authenticated captain must be a starting player.');
  const format =
    policy.format === 'AUTO'
      ? tournament.format === 'SOLO'
        ? 'INDIVIDUAL'
        : tournament.format === 'TEAMS'
          ? 'TEAM'
          : input.format
      : policy.format;
  if (
    format !== input.format ||
    (format === 'INDIVIDUAL' &&
      (input.members.length !== 1 || input.members[0].osuId !== actor.osuId))
  )
    throw new AppError('Use the configured tournament registration format.');
  const starters = input.members.filter((member) => !member.substitute).length;
  const minimum =
    format === 'INDIVIDUAL'
      ? 1
      : Math.max(
          1,
          policy.minPlayers ||
            inheritedRules(tournament.settings!.matchRules, tournament.settings!.gameplayScoring)
              .teamSize,
        );
  if (
    starters < minimum ||
    input.members.length > policy.maxPlayers ||
    input.members.length - starters > policy.maxSubstitutes
  )
    throw new AppError('The roster does not meet the configured player and substitute limits.');
  const memberships = await tx.teamMember.findMany({
    where: {
      tournamentId,
      osuId: { in: input.members.map((member) => member.osuId) },
      ...(owned ? { teamId: { not: owned.id } } : {}),
    },
  });
  if (memberships.length)
    throw new AppError('A player already belongs to another registration in this tournament.', 409);
  if (
    owned &&
    (await tx.match.findFirst({
      where: { tournamentId, OR: [{ teamAId: owned.id }, { teamBId: owned.id }] },
    }))
  )
    throw new AppError('Competition has locked this roster. Contact an organizer.', 409);
  const reservations = owned
    ? await tx.qualifierLobby.findMany({
        where: {
          tournamentId,
          status: { not: 'CANCELLED' },
          entries: { some: { teamId: owned.id } },
        },
        include: { scores: true, events: true },
      })
    : [];
  if (reservations.some((session) => !qualifierNeverStarted(session)))
    throw new AppError('Qualifier gameplay has locked this roster. Contact an organizer.', 409);
  for (const member of input.members) {
    const observed = profiles.find((profile) => profile.id === member.osuId);
    if (!observed) throw new AppError('Every osu! player must be verified.');
    const rank = observed.statistics?.global_rank;
    if (
      (policy.minRank || policy.maxRank) &&
      (!rank ||
        (policy.minRank && rank < policy.minRank) ||
        (policy.maxRank && rank > policy.maxRank))
    )
      throw new AppError('A player does not meet the configured rank eligibility.');
    if (
      policy.countries.length &&
      (!observed.country_code || !policy.countries.includes(observed.country_code))
    )
      throw new AppError('A player does not meet the configured country eligibility.');
  }
  const answers: Record<string, string | number | boolean> = {};
  for (const field of policy.fields) {
    const value = input.answers[field.key];
    const missing =
      value === undefined ||
      (typeof value === 'string' && !value.trim()) ||
      (field.type === 'checkbox' && value !== true);
    if (field.required && missing)
      throw new AppError('Complete the required registration field: {0}', 400, [field.label]);
    if (missing) continue;
    if (
      (field.type === 'number' && typeof value !== 'number') ||
      (field.type === 'checkbox' && typeof value !== 'boolean') ||
      (['text', 'longtext', 'choice'].includes(field.type) && typeof value !== 'string') ||
      (field.type === 'choice' && !field.options.includes(String(value)))
    )
      throw new AppError('Invalid registration field: {0}', 400, [field.label]);
    answers[field.key] = value;
  }
  const fields = teamFields.parse({
    name: input.name,
    slug:
      owned?.slug ||
      `${
        input.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 60) || 'entrant'
      }-${actor.osuId}`,
    format: input.format,
    description: owned?.description || '',
    logoImageId: owned?.logoImageId || null,
    seed: owned?.seed || null,
    position: owned?.position || 0,
    members: input.members.map((member) => ({ ...member, captain: member.osuId === actor.osuId })),
  });
  const scoped = scopedDb(tx, tournamentId);
  const team = await writeTeam(scoped, fields, profiles, owned?.id);
  await tx.team.update({ where: { id: team.id }, data: { registrationAnswers: json(answers) } });
  for (const member of input.members)
    await tx.teamMember.update({
      where: { teamId_osuId: { teamId: team.id, osuId: member.osuId } },
      data: {
        registrationRank:
          profiles.find((profile) => profile.id === member.osuId)?.statistics?.global_rank || null,
        registeredUsername: profiles.find((profile) => profile.id === member.osuId)!.username,
      },
    });
  for (const session of reservations) {
    await removeQualifierParticipants(
      scoped,
      actor,
      tournamentId,
      {
        type: 'qualifier.participants.remove',
        id: session.id,
        baseVersion: session.version,
        teamIds: [team.id],
        override: false,
        reason: 'Captain updated an unstarted roster',
      },
      { captainTeamId: team.id },
    );
    await applyQualifierParticipantMove(
      scoped,
      actor,
      tournamentId,
      {
        type: 'qualifier.participants.move',
        fromLobbyId: null,
        toLobbyId: session.id,
        baseVersion: session.version + 1,
        teamIds: [team.id],
        reason: 'Refresh unstarted captain roster snapshot',
      },
      { captainTeamId: team.id },
    );
  }
  await tx.auditLog.create({
    data: {
      tournamentId,
      actorId: actor.id,
      action: input.type,
      entityType: 'Team',
      entityId: team.id,
      details: json({
        before: owned
          ? {
              name: owned.name,
              members: owned.members.map((member) => ({
                osuId: member.osuId,
                captain: member.captain,
                substitute: member.substitute,
              })),
            }
          : null,
        after: input,
      }),
    },
  });
  return { id: team.id };
}
