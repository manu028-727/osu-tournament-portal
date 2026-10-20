import { Prisma } from '@/generated/prisma/client';
import { db as rootDb } from './db';
import { scopedDb } from './scoped-db';
import { can, assertPermission, AppError, type Actor, type PermissionKey } from './permissions';
import { matchAccess } from './match-access';
import {
  matchScope,
  rosterSnapshot,
  matchOptions,
  eligibleRefereeFor,
  type MatchParticipants,
} from './matches-service';
import { teamInclude } from './teams-service';
import { matchRulesSchema } from './match-rules';
import { convertedScore } from './match-engine';
import type { QualifierAction } from './qualifiers-validation';
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const include = {
  stage: { select: { id: true, name: true } },
  poolRevision: { include: { slots: { orderBy: { position: 'asc' as const } } } },
  assignments: { include: { user: { select: { id: true, osuId: true, username: true } } } },
  entries: {
    include: { team: { select: { members: { select: { discordId: true } } } } },
    orderBy: { position: 'asc' as const },
  },
  scores: true,
  events: {
    include: { actor: { select: { username: true } } },
    orderBy: { version: 'desc' as const },
  },
};
export function qualifierPermission(a: QualifierAction): PermissionKey {
  if (
    a.type === 'qualifier.create' ||
    (a.type === 'qualifier.status' && ['CONFIRM', 'REOPEN', 'CANCEL'].includes(a.command))
  )
    return 'matches.manage';
  if (a.type === 'qualifier.schedule') return 'matches.assign_referees';
  if (a.type === 'qualifier.score' || a.type === 'qualifier.score.remove')
    return 'matches.update_scores';
  if (a.type === 'qualifier.status' && a.command === 'SUBMIT') return 'matches.submit_results';
  return 'matches.manage_assigned';
}
export function assertQualifierPermission(
  actor: Actor | null,
  a: QualifierAction,
): asserts actor is Actor {
  const permission = qualifierPermission(a);
  if (
    actor &&
    (can(actor, 'matches.manage') ||
      (permission !== 'matches.manage' &&
        permission !== 'matches.assign_referees' &&
        can(actor, 'matches.manage_all')))
  )
    return;
  assertPermission(actor, permission);
}
export async function qualifierData(actor: Actor, url: URL) {
  const tournamentId = actor.tournamentId || 'main',
    db = scopedDb(rootDb, tournamentId);
  if (
    !['matches.view', 'matches.view_all', 'matches.manage', 'matches.manage_all'].some((key) =>
      actor.permissions.includes(key as PermissionKey),
    )
  )
    throw new AppError('Forbidden.', 403);
  const scope = matchScope(actor) as Prisma.QualifierLobbyWhereInput;
  const id = url.searchParams.get('id');
  const records = await db.qualifierLobby.findMany({
    where: { AND: [scope, ...(id ? [{ id }] : [])] },
    include,
    orderBy: [{ scheduledAt: { sort: 'asc', nulls: 'last' } }, { code: 'asc' }],
  });
  if (id && !records.length) throw new AppError('Qualifier lobby not found.', 404);
  return {
    lobbies: records.map((lobby) => ({
      ...lobby,
      rules: matchRulesSchema.parse(lobby.rules),
      access: matchAccess(actor, lobby),
      ...(!can(actor, 'matches.view_history') && !can(actor, 'matches.manage')
        ? { events: [] }
        : {}),
    })),
    options:
      can(actor, 'matches.manage') || can(actor, 'matches.assign_referees')
        ? await matchOptions(actor)
        : null,
  };
}
async function checkRefs(
  tx: Prisma.TransactionClient,
  ids: string[],
  date: Date | null,
  lobbyId?: string,
  tournamentId = 'main',
) {
  const eligible = await tx.user.count({
    where: {
      id: { in: ids },
      AND: [eligibleRefereeFor(tournamentId)],
    },
  });
  if (eligible !== ids.length)
    throw new AppError('Assign users with referee operational permissions.');
  if (
    date &&
    ((await tx.qualifierAssignment.findFirst({
      where: {
        userId: { in: ids },
        lobby: {
          ...(lobbyId ? { id: { not: lobbyId } } : {}),
          scheduledAt: date,
          status: { notIn: ['CANCELLED', 'COMPLETED'] },
        },
      },
    })) ||
      (await tx.matchAssignment.findFirst({
        where: {
          userId: { in: ids },
          match: { scheduledAt: date, status: { notIn: ['CANCELLED', 'COMPLETED'] } },
        },
      })))
  )
    throw new AppError('A referee is already scheduled at this time.', 409);
}
export async function applyQualifierAction(
  tx: Prisma.TransactionClient,
  actor: Actor,
  a: QualifierAction,
) {
  const tournamentId = actor.tournamentId || 'main';
  tx = scopedDb(tx, tournamentId);
  assertQualifierPermission(actor, a);
  if (a.type === 'qualifier.create') {
    const stage = await tx.tournamentStage.findUniqueOrThrow({
      where: { id: a.stageId },
      include: { mappool: { include: { publishedRevision: { include: { slots: true } } } } },
    });
    const revision = stage.mappool?.publishedRevision;
    if (
      stage.tournamentId !== tournamentId ||
      stage.mappool?.state !== 'PUBLISHED' ||
      !revision?.slots.length
    )
      throw new AppError('Select a stage with a published qualifier mappool.');
    const teams = await tx.team.findMany({
      where: { id: { in: a.teamIds }, tournamentId, status: 'APPROVED' },
      include: teamInclude,
    });
    if (teams.length !== a.teamIds.length) throw new AppError('Select approved entrants.');
    const solo = teams.every((team) => team.format === 'INDIVIDUAL');
    if (
      (!solo && teams.some((team) => team.format === 'INDIVIDUAL')) ||
      teams.length > (solo ? 16 : 8)
    )
      throw new AppError(
        'A lobby supports up to eight teams or sixteen solo entrants, without mixing formats.',
      );
    const settings = await tx.tournamentSettings.findUniqueOrThrow({
      where: { tournamentId },
    });
    const tournament = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    const rules = matchRulesSchema.parse({
      ...matchRulesSchema.parse(stage.matchRules || settings.matchRules),
      gameMode: tournament.gameMode,
      ...(solo ? { teamSize: 1 } : {}),
    });
    if (teams.some((team) => team.members.filter((p) => !p.substitute).length < rules.teamSize))
      throw new AppError('An entrant has too few starting players.');
    const date = a.scheduledAt ? new Date(a.scheduledAt) : null;
    await checkRefs(tx, a.refereeIds, date, undefined, tournamentId);
    const participants = a.teamIds.map((id) =>
      rosterSnapshot(teams.find((team) => team.id === id)!),
    );
    return tx.qualifierLobby.create({
      data: {
        code: a.code,
        stageId: stage.id,
        poolRevisionId: revision.id,
        rules: json(rules),
        participants: json(participants),
        scheduledAt: date,
        notes: a.notes,
        entries: { create: a.teamIds.map((teamId, position) => ({ teamId, position })) },
        assignments: { create: a.refereeIds.map((userId) => ({ userId })) },
        events: { create: { actorId: actor.id, version: 1, kind: a.type, data: json(a) } },
      },
    });
  }
  const lobby = await tx.qualifierLobby.findUniqueOrThrow({ where: { id: a.id }, include });
  if (
    !can(actor, 'matches.manage') &&
    !can(actor, 'matches.manage_all') &&
    !lobby.assignments.some((r) => r.userId === actor.id)
  )
    throw new AppError('This qualifier lobby is not assigned to you.', 403);
  if (lobby.version !== a.baseVersion)
    throw new AppError('Another referee updated this lobby. Reload before saving.', 409);
  const rules = matchRulesSchema.parse(lobby.rules);
  const participants = lobby.participants as unknown as MatchParticipants['A'][];
  let changes: Prisma.QualifierLobbyUncheckedUpdateManyInput = {};
  let eventData: unknown = a;
  if (a.type === 'qualifier.schedule') {
    if (lobby.status !== 'SCHEDULED')
      throw new AppError('Only scheduled qualifier lobbies can be rescheduled.', 409);
    const date = a.scheduledAt ? new Date(a.scheduledAt) : null;
    await checkRefs(tx, a.refereeIds, date, lobby.id, tournamentId);
    await tx.qualifierAssignment.deleteMany({ where: { lobbyId: lobby.id } });
    await tx.qualifierAssignment.createMany({
      data: a.refereeIds.map((userId) => ({ lobbyId: lobby.id, userId })),
    });
    changes = { scheduledAt: date, notes: a.notes };
  } else if (a.type === 'qualifier.lobby') {
    if (!['SCHEDULED', 'IN_PROGRESS'].includes(lobby.status))
      throw new AppError('Reopen this lobby before editing.', 409);
    if (
      a.lobbyUrl &&
      !/^https:\/\/osu\.ppy\.sh\/(?:community\/)?matches\/[1-9]\d{0,9}\/?$/.test(a.lobbyUrl)
    )
      throw new AppError('Use an osu! multiplayer match URL.');
    changes.lobbyUrl = a.lobbyUrl;
  } else if (a.type === 'qualifier.score.remove') {
    if (lobby.status !== 'IN_PROGRESS')
      throw new AppError('Reopen this lobby before correcting scores.', 409);
    const before = lobby.scores.find((score) => score.id === a.scoreId);
    if (!before) throw new AppError('Score not found.', 404);
    await tx.qualifierScore.delete({ where: { id: before.id } });
    eventData = { reason: a.reason, before, after: null };
  } else if (a.type === 'qualifier.score') {
    if (lobby.status !== 'IN_PROGRESS')
      throw new AppError('Start or reopen the lobby before recording scores.', 409);
    if (!participants.some((team) => team.members.some((p) => p.osuId === a.osuId)))
      throw new AppError('This player is not in the snapshotted qualifier roster.');
    const slot = lobby.poolRevision.slots.find((slot) => slot.name === a.slotName);
    if (!slot) throw new AppError('This map is not in the qualifier pool snapshot.');
    if (rules.scoreMode === 'ACCURACY' ? a.raw > 100 : !Number.isSafeInteger(a.raw))
      throw new AppError('Use a valid raw score for the configured scoring mode.');
    if (
      (a.mods.includes('EZ') && a.mods.includes('HR')) ||
      ((a.mods.includes('DT') || a.mods.includes('NC')) && a.mods.includes('HT')) ||
      (a.mods.includes('NF') && (a.mods.includes('SD') || a.mods.includes('PF')))
    )
      throw new AppError('Incompatible mods.');
    if (rules.enforceNoFail && !a.mods.includes('NF')) throw new AppError('NoFail is required.');
    if (
      rules.freeModCategories.includes(slot.category) &&
      a.mods.some((mod) => !rules.freeModAllowed.includes(mod))
    )
      throw new AppError('This mod is not allowed in FreeMod.');
    const where = {
      lobbyId_osuId_slotName: { lobbyId: lobby.id, osuId: a.osuId, slotName: a.slotName },
    };
    const before = await tx.qualifierScore.findUnique({ where });
    const data = {
      raw: a.raw,
      mods: json(a.mods),
      adjusted: convertedScore(rules, a.raw, a.mods, slot.name).adjusted,
    };
    const after = await tx.qualifierScore.upsert({
      where,
      create: { lobbyId: lobby.id, osuId: a.osuId, slotName: a.slotName, ...data },
      update: data,
    });
    eventData = { reason: a.reason, before, after };
  } else {
    const transition = {
      START: ['SCHEDULED'],
      SUBMIT: ['IN_PROGRESS'],
      CONFIRM: ['AWAITING_CONFIRMATION'],
      REOPEN: ['COMPLETED', 'AWAITING_CONFIRMATION', 'DISPUTED', 'CANCELLED'],
      CANCEL: ['SCHEDULED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'DISPUTED'],
    }[a.command];
    if (!transition.includes(lobby.status))
      throw new AppError('This status transition is not available.', 409);
    if (a.command === 'START' && (!lobby.scheduledAt || !lobby.assignments.length))
      throw new AppError('Set a schedule and referee before starting.');
    if (a.command === 'SUBMIT' || a.command === 'CONFIRM') {
      if (!lobby.lobbyUrl) throw new AppError('Record the multiplayer link before submitting.');
      for (const slot of lobby.poolRevision.slots)
        for (const team of participants) {
          const scores = lobby.scores.filter(
            (s) => s.slotName === slot.name && team.members.some((p) => p.osuId === s.osuId),
          );
          if (scores.length !== rules.teamSize)
            throw new AppError(
              `${team.name} needs exactly ${rules.teamSize} scores on ${slot.name}.`,
            );
          if (rules.freeModCategories.includes(slot.category)) {
            const mods = scores.map((s) => s.mods as string[]);
            if (
              mods.filter((m) => m.includes('HR')).length < rules.freeModRequiredHR ||
              mods.filter((m) => !m.includes('HR') && (m.includes('HD') || m.includes('EZ')))
                .length < rules.freeModRequiredHD
            )
              throw new AppError(
                `${team.name} does not meet the FreeMod requirements on ${slot.name}.`,
              );
          }
        }
    }
    changes.status = {
      START: 'IN_PROGRESS',
      SUBMIT: 'AWAITING_CONFIRMATION',
      CONFIRM: 'COMPLETED',
      REOPEN: 'IN_PROGRESS',
      CANCEL: 'CANCELLED',
    }[a.command] as 'IN_PROGRESS';
    eventData = {
      ...a,
      before: { status: lobby.status },
      scores: lobby.scores,
      participants: lobby.participants,
      poolRevisionId: lobby.poolRevisionId,
    };
  }
  const version = lobby.version + 1;
  const update = await tx.qualifierLobby.updateMany({
    where: { id: lobby.id, version: a.baseVersion },
    data: { ...changes, version },
  });
  if (update.count !== 1) throw new AppError('This lobby changed. Reload.', 409);
  await tx.qualifierEvent.create({
    data: {
      lobbyId: lobby.id,
      version,
      actorId: actor.id,
      kind: a.type,
      reason: 'reason' in a ? a.reason : '',
      data: json(eventData),
    },
  });
  return { id: lobby.id, version };
}
