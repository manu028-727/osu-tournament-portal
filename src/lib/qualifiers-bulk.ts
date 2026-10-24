import type { Prisma } from '@/generated/prisma/client';
import { AppError, type Actor } from './permissions';
import { rosterSnapshot, type MatchParticipants } from './matches-service';
import { assertScheduleAvailability } from './schedule-availability';
import { qualifierPolicySchema, type QualifierPolicy } from './qualifier-policy';
import { teamInclude } from './teams-service';
import { matchRulesSchema } from './match-rules';
import type { QualifierAction } from './qualifiers-validation';
import { assertQualifierMutable } from './qualifier-standings-service';

export type QualifierRoster = MatchParticipants['A'][];
export type QualifierPlan = {
  id: string;
  code: string;
  stageId: string;
  scheduledAt: Date | null;
  refereeIds: string[];
  participants: QualifierRoster;
};
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

export function assertQualifierCapacity(participants: QualifierRoster, policy: QualifierPolicy) {
  const solo = participants.every((team) => team.format === 'INDIVIDUAL');
  if (
    (!solo && participants.some((team) => team.format === 'INDIVIDUAL')) ||
    participants.length > (solo ? 16 : 8) ||
    participants.length * policy.requiredPlayers > 16
  )
    throw new AppError(
      'A session supports sixteen active players: up to sixteen solo entrants or eight teams, without mixing formats.',
    );
  if (participants.length && solo && policy.requiredPlayers !== 1)
    throw new AppError('Individual qualifiers require one player per entrant.');
  const players = new Set<number>();
  for (const team of participants) {
    if (team.members.filter((player) => !player.substitute).length < policy.requiredPlayers)
      throw new AppError(`${team.name} needs ${policy.requiredPlayers} starting players.`);
    for (const player of team.members) {
      if (players.has(player.osuId))
        throw new AppError(
          `${player.username} is registered with multiple selected entrants.`,
          409,
        );
      players.add(player.osuId);
    }
  }
}

function playerIds(participants: QualifierRoster) {
  return participants.flatMap((team) => team.members.map((player) => player.osuId));
}

// Validate the final plan, excluding records being replaced so time swaps remain valid.
export async function assertQualifierAvailability(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  plans: QualifierPlan[],
  excludedLobbyIds: string[] = [],
) {
  // Stage uniqueness includes completed sessions; timed resources are checked below.
  const existing = await tx.qualifierLobby.findMany({
    where: {
      tournamentId,
      id: { notIn: excludedLobbyIds },
      status: { not: 'CANCELLED' },
      stageId: { in: [...new Set(plans.map((plan) => plan.stageId))] },
    },
    select: {
      id: true,
      code: true,
      stageId: true,
      status: true,
      scheduledAt: true,
      participants: true,
      assignments: { select: { userId: true } },
    },
  });
  for (const [index, plan] of plans.entries()) {
    const entrants = new Set(plan.participants.map((team) => team.id));
    const players = new Set(playerIds(plan.participants));
    const others = [
      ...plans.slice(0, index).map((other) => ({ ...other, status: 'SCHEDULED' })),
      ...existing.map((other) => ({
        ...other,
        participants: other.participants as unknown as QualifierRoster,
        refereeIds: other.assignments.map((ref) => ref.userId),
      })),
    ];
    for (const other of others) {
      if (
        plan.stageId === other.stageId &&
        other.participants.some((team) => entrants.has(team.id))
      )
        throw new AppError(
          `${plan.code}: an entrant already has a session in ${other.code} for this stage. Move the entrant instead.`,
          409,
        );
      const sharedPlayer = playerIds(other.participants).some((id) => players.has(id));
      if (plan.stageId === other.stageId && sharedPlayer)
        throw new AppError(
          `${plan.code}: a player already has a session in ${other.code} for this stage.`,
          409,
        );
    }
  }
  await assertScheduleAvailability(
    tx,
    tournamentId,
    plans.map((plan) => ({
      ...plan,
      label: plan.code,
    })),
    { lobbyIds: excludedLobbyIds },
  );
}

export function qualifierNeverStarted(lobby: {
  status: string;
  scores: unknown[];
  events: { kind: string; data: unknown }[];
}) {
  return (
    lobby.status === 'SCHEDULED' &&
    !lobby.scores.length &&
    !lobby.events.some((event) => {
      const data = event.data as { command?: string } | null;
      return (
        data?.command === 'START' ||
        ['qualifier.score', 'qualifier.capture', 'qualifier.score.remove'].includes(event.kind)
      );
    })
  );
}

export async function applyQualifierBulkSchedule(
  tx: Prisma.TransactionClient,
  actor: Actor,
  tournamentId: string,
  action: Extract<QualifierAction, { type: 'qualifier.bulk.schedule' }>,
) {
  const ids = action.lobbies.map((lobby) => lobby.id);
  const records = await tx.qualifierLobby.findMany({
    where: { tournamentId, id: { in: ids } },
    include: { assignments: true },
  });
  if (records.length !== ids.length)
    throw new AppError('A selected lobby does not exist in this tournament.', 404);
  const versions = new Map(action.lobbies.map((lobby) => [lobby.id, lobby.baseVersion]));
  for (const record of records) {
    if (record.version !== versions.get(record.id))
      throw new AppError(`${record.code} changed. Reload and review the selection.`, 409);
    if (record.status !== 'SCHEDULED')
      throw new AppError(
        `${record.code} has already started or is closed. Only scheduled lobbies can be changed in bulk.`,
        409,
      );
  }
  for (const stageId of [...new Set(records.map((record) => record.stageId))].sort())
    await assertQualifierMutable(tx, stageId, tournamentId);
  const plans = records.map((record) => {
    if (action.shiftMinutes !== undefined && !record.scheduledAt)
      throw new AppError(`${record.code} has no time to shift. Set a start time first.`, 409);
    return {
      ...record,
      participants: record.participants as unknown as QualifierRoster,
      scheduledAt:
        action.scheduledAt !== undefined
          ? action.scheduledAt
            ? new Date(action.scheduledAt)
            : null
          : action.shiftMinutes !== undefined
            ? new Date(record.scheduledAt!.getTime() + action.shiftMinutes * 60_000)
            : record.scheduledAt,
      refereeIds: action.refereeIds ?? record.assignments.map((assignment) => assignment.userId),
    };
  });
  await assertQualifierAvailability(tx, tournamentId, plans, ids);
  for (const plan of plans) {
    const record = records.find((record) => record.id === plan.id)!;
    const updated = await tx.qualifierLobby.updateMany({
      where: { id: plan.id, tournamentId, version: record.version, status: 'SCHEDULED' },
      data: {
        ...(action.scheduledAt !== undefined || action.shiftMinutes !== undefined
          ? { scheduledAt: plan.scheduledAt }
          : {}),
        ...(action.notes !== undefined ? { notes: action.notes } : {}),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1)
      throw new AppError(`${plan.code} changed during this update. Reload.`, 409);
    if (action.refereeIds !== undefined) {
      await tx.qualifierAssignment.deleteMany({ where: { lobbyId: plan.id } });
      if (plan.refereeIds.length)
        await tx.qualifierAssignment.createMany({
          data: plan.refereeIds.map((userId) => ({ lobbyId: plan.id, userId })),
        });
    }
    await tx.qualifierEvent.create({
      data: {
        lobbyId: plan.id,
        actorId: actor.id,
        version: record.version + 1,
        kind: action.type,
        data: json({
          before: {
            scheduledAt: record.scheduledAt,
            refereeIds: record.assignments.map((ref) => ref.userId),
            notes: record.notes,
          },
          after: {
            scheduledAt: plan.scheduledAt,
            refereeIds: plan.refereeIds,
            notes: action.notes ?? record.notes,
          },
        }),
      },
    });
  }
  return { id: 'bulk', updated: plans.length };
}

export async function applyQualifierParticipantMove(
  tx: Prisma.TransactionClient,
  actor: Actor,
  tournamentId: string,
  action: Extract<QualifierAction, { type: 'qualifier.participants.move' }>,
) {
  const ids = [action.toLobbyId, ...(action.fromLobbyId ? [action.fromLobbyId] : [])];
  const records = await tx.qualifierLobby.findMany({
    where: { tournamentId, id: { in: ids } },
    include: { assignments: true, entries: true, scores: true, events: true },
  });
  if (records.length !== ids.length)
    throw new AppError('A selected lobby does not exist in this tournament.', 404);
  const target = records.find((record) => record.id === action.toLobbyId)!;
  const source = records.find((record) => record.id === action.fromLobbyId);
  for (const record of records) {
    if (record.version !== (record.id === target.id ? action.baseVersion : action.sourceVersion))
      throw new AppError(`${record.code} changed. Reload before moving entrants.`, 409);
    if (!qualifierNeverStarted(record))
      throw new AppError(
        `${record.code} has started or has recorded history. Entrants can only move between unstarted sessions.`,
        409,
      );
  }
  if (
    source &&
    (source.stageId !== target.stageId ||
      source.poolRevisionId !== target.poolRevisionId ||
      source.gameplayScoring !== target.gameplayScoring ||
      JSON.stringify(source.policy) !== JSON.stringify(target.policy) ||
      JSON.stringify(source.rules) !== JSON.stringify(target.rules))
  )
    throw new AppError(
      'Move entrants between sessions with the same stage, pool snapshot, rules, scoring, and run policy.',
      409,
    );
  await assertQualifierMutable(tx, target.stageId, tournamentId);
  let moving: QualifierRoster;
  if (source) {
    const roster = source.participants as unknown as QualifierRoster;
    moving = action.teamIds.map((id) => {
      const entrant = roster.find((team) => team.id === id);
      if (!entrant || !source.entries.some((entry) => entry.teamId === id))
        throw new AppError('An entrant is no longer assigned to the source session. Reload.', 409);
      return entrant;
    });
  } else {
    const teams = await tx.team.findMany({
      where: { tournamentId, id: { in: action.teamIds }, status: 'APPROVED' },
      include: teamInclude,
    });
    if (teams.length !== action.teamIds.length)
      throw new AppError('Select approved entrants from this tournament.');
    moving = action.teamIds.map((id) => rosterSnapshot(teams.find((team) => team.id === id)!));
  }
  const plans = records.map((record) => {
    const before = record.participants as unknown as QualifierRoster;
    const participants =
      record.id === target.id
        ? [...before, ...moving]
        : before.filter((team) => !action.teamIds.includes(team.id!));
    if (new Set(participants.map((team) => team.id)).size !== participants.length)
      throw new AppError(`${record.code} already contains a selected entrant.`, 409);
    assertQualifierCapacity(
      participants,
      qualifierPolicySchema.parse(
        record.policy || {
          requiredPlayers: matchRulesSchema.parse(record.rules).teamSize,
        },
      ),
    );
    return { ...record, participants, refereeIds: record.assignments.map((ref) => ref.userId) };
  });
  await assertQualifierAvailability(tx, tournamentId, plans, ids);
  for (const plan of plans) {
    const updated = await tx.qualifierLobby.updateMany({
      where: { id: plan.id, tournamentId, version: plan.version, status: 'SCHEDULED' },
      data: { participants: json(plan.participants), version: { increment: 1 } },
    });
    if (updated.count !== 1)
      throw new AppError(`${plan.code} changed during the move. Reload.`, 409);
    await tx.qualifierEntry.deleteMany({ where: { lobbyId: plan.id, tournamentId } });
    if (plan.participants.length)
      await tx.qualifierEntry.createMany({
        data: plan.participants.map((team, position) => ({
          lobbyId: plan.id,
          tournamentId,
          teamId: team.id!,
          position,
        })),
      });
    await tx.qualifierEvent.create({
      data: {
        lobbyId: plan.id,
        version: plan.version + 1,
        actorId: actor.id,
        kind: action.type,
        data: json({
          ...action,
          before: records.find((record) => record.id === plan.id)!.participants,
          after: plan.participants,
        }),
      },
    });
  }
  return { id: target.id, moved: moving.length };
}
