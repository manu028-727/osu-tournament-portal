import { Prisma } from '@/generated/prisma/client';
import { db as rootDb } from './db';
import { scopedDb } from './scoped-db';
import { can, assertPermission, AppError, type Actor, type PermissionKey } from './permissions';
import { matchAccess } from './match-access';
import {
  matchScope,
  rosterSnapshot,
  matchOptions,
  lobbyInfo,
  type MatchParticipants,
} from './matches-service';
import { teamInclude } from './teams-service';
import { matchRulesSchema } from './match-rules';
import { convertedScore } from './match-engine';
import type { QualifierAction } from './qualifiers-validation';
import { inheritedRules, historicalScoring, assertScoreRepresentation } from './gameplay-scoring';
import { qualifierPolicySchema } from './qualifier-policy';
import { assertQualifierMutable } from './qualifier-standings-service';
import {
  applyQualifierBulkSchedule,
  applyQualifierParticipantMove,
  assertQualifierAvailability,
  assertQualifierCapacity,
  qualifierNeverStarted,
} from './qualifiers-bulk';
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
    a.type === 'qualifier.batch.create' ||
    a.type === 'qualifier.participants.move' ||
    (a.type === 'qualifier.status' && ['CONFIRM', 'REOPEN', 'CANCEL'].includes(a.command))
  )
    return 'matches.manage';
  if (a.type === 'qualifier.schedule' || a.type === 'qualifier.bulk.schedule')
    return 'matches.assign_referees';
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
  let options = null;
  if (can(actor, 'matches.manage') || can(actor, 'matches.assign_referees')) {
    const defaults = await matchOptions(actor);
    const [stages, teams] = await Promise.all([
      db.tournamentStage.findMany({
        where: { kind: 'QUALIFIERS', archivedAt: null },
        select: { id: true, qualifierPolicy: true, matchRules: true },
      }),
      db.team.findMany({
        where: { status: 'APPROVED' },
        select: { id: true, members: { select: { substitute: true } } },
      }),
    ]);
    options = {
      ...defaults,
      teams: defaults.teams.map((team) => ({
        ...team,
        startingPlayers:
          teams.find((row) => row.id === team.id)?.members.filter((member) => !member.substitute)
            .length ?? 0,
      })),
      qualifierStages: stages.map((stage) => ({
        id: stage.id,
        policy: qualifierPolicySchema.parse(
          stage.qualifierPolicy || {
            requiredPlayers: stage.matchRules
              ? matchRulesSchema.parse(stage.matchRules).teamSize
              : defaults.defaults.teamSize,
          },
        ),
      })),
    };
  }
  return {
    lobbies: records.map((lobby) => ({
      ...lobby,
      rules: matchRulesSchema.parse(lobby.rules),
      policy: qualifierPolicySchema.parse(
        lobby.policy || { requiredPlayers: matchRulesSchema.parse(lobby.rules).teamSize },
      ),
      access: matchAccess(actor, lobby),
      canTransfer: qualifierNeverStarted(lobby),
      ...(!can(actor, 'matches.view_history') && !can(actor, 'matches.manage')
        ? { events: [] }
        : {}),
    })),
    options,
  };
}
export async function applyQualifierAction(
  tx: Prisma.TransactionClient,
  actor: Actor,
  a: QualifierAction,
): Promise<{
  id: string;
  version?: number;
  created?: number;
  updated?: number;
  moved?: number;
  lobbies?: { id: string; code: string }[];
}> {
  const tournamentId = actor.tournamentId || 'main';
  tx = scopedDb(tx, tournamentId);
  assertQualifierPermission(actor, a);
  // Use the admin mutation lock even when called directly by a transactional importer.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
  if (a.type === 'qualifier.bulk.schedule')
    return applyQualifierBulkSchedule(tx, actor, tournamentId, a);
  if (a.type === 'qualifier.participants.move')
    return applyQualifierParticipantMove(tx, actor, tournamentId, a);
  if (a.type === 'qualifier.batch.create') {
    const lobbies = [];
    for (const session of a.sessions) {
      const result = await applyQualifierAction(tx, actor, {
        type: 'qualifier.create',
        ...session,
      });
      lobbies.push({ id: result.id, code: session.code });
    }
    return { id: 'bulk', created: lobbies.length, lobbies };
  }
  if (a.type === 'qualifier.create') {
    if (
      await tx.qualifierLobby.findUnique({
        where: { tournamentId_code: { tournamentId, code: a.code } },
      })
    )
      throw new AppError(`Lobby code ${a.code} is already in use. Choose a different code.`, 409);
    const stage = await tx.tournamentStage.findUniqueOrThrow({
      where: { id: a.stageId },
      include: { mappool: { include: { publishedRevision: { include: { slots: true } } } } },
    });
    const revision = stage.mappool?.publishedRevision;
    if (stage.kind !== 'QUALIFIERS' || stage.archivedAt)
      throw new AppError(
        'Choose an active qualifier stage. Elimination stages use the match workspace.',
      );
    await assertQualifierMutable(tx, stage.id, tournamentId);
    if (
      await tx.qualifierEntry.findFirst({
        where: {
          teamId: { in: a.teamIds },
          lobby: { stageId: stage.id, status: { not: 'CANCELLED' } },
        },
      })
    )
      throw new AppError(
        'An entrant already has a qualifier session for this stage. Reschedule that session instead of creating duplicate performances.',
        409,
      );
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
    const solo = teams.length > 0 && teams.every((team) => team.format === 'INDIVIDUAL');
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
      ...inheritedRules(stage.matchRules || settings.matchRules, settings.gameplayScoring),
      gameMode: tournament.gameMode,
      teamMode: 'HEAD_TO_HEAD',
      ...(solo ? { teamSize: 1 } : {}),
    });
    const policy = qualifierPolicySchema.parse(
      stage.qualifierPolicy || { requiredPlayers: rules.teamSize },
    );
    if (
      teams.some(
        (team) => team.members.filter((p) => !p.substitute).length < policy.requiredPlayers,
      )
    )
      throw new AppError('An entrant has too few starting players.');
    if (solo && policy.requiredPlayers !== 1)
      throw new AppError('Individual qualifiers require one player per entrant.');
    if (teams.length * policy.requiredPlayers > 16)
      throw new AppError('Split these entrants into sessions of at most sixteen active players.');
    const date = a.scheduledAt ? new Date(a.scheduledAt) : null;
    const participants = a.teamIds.map((id) =>
      rosterSnapshot(teams.find((team) => team.id === id)!),
    );
    assertQualifierCapacity(participants, policy);
    await assertQualifierAvailability(tx, tournamentId, [
      {
        id: '',
        code: a.code,
        stageId: stage.id,
        scheduledAt: date,
        refereeIds: a.refereeIds,
        participants,
      },
    ]);
    return tx.qualifierLobby.create({
      data: {
        code: a.code,
        stageId: stage.id,
        poolRevisionId: revision.id,
        rules: json(rules),
        policy: json(policy),
        gameplayScoring: settings.gameplayScoring,
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
    !(a.type === 'qualifier.schedule' && can(actor, 'matches.assign_referees')) &&
    !lobby.assignments.some((r) => r.userId === actor.id)
  )
    throw new AppError('This qualifier lobby is not assigned to you.', 403);
  if (lobby.version !== a.baseVersion)
    throw new AppError('Another referee updated this lobby. Reload before saving.', 409);
  const rules = matchRulesSchema.parse(lobby.rules);
  const policy = qualifierPolicySchema.parse(lobby.policy || { requiredPlayers: rules.teamSize });
  await assertQualifierMutable(tx, lobby.stageId, tournamentId);
  const participants = lobby.participants as unknown as MatchParticipants['A'][];
  let changes: Prisma.QualifierLobbyUncheckedUpdateManyInput = {};
  let eventData: unknown = a;
  if (a.type === 'qualifier.schedule') {
    if (lobby.status !== 'SCHEDULED')
      throw new AppError('Only scheduled qualifier lobbies can be rescheduled.', 409);
    const date = a.scheduledAt ? new Date(a.scheduledAt) : null;
    await assertQualifierAvailability(
      tx,
      tournamentId,
      [
        {
          id: lobby.id,
          code: lobby.code,
          stageId: lobby.stageId,
          scheduledAt: date,
          refereeIds: a.refereeIds,
          participants,
        },
      ],
      [lobby.id],
    );
    await tx.qualifierAssignment.deleteMany({ where: { lobbyId: lobby.id } });
    await tx.qualifierAssignment.createMany({
      data: a.refereeIds.map((userId) => ({ lobbyId: lobby.id, userId })),
    });
    changes = { scheduledAt: date, notes: a.notes };
  } else if (a.type === 'qualifier.lobby') {
    if (!['SCHEDULED', 'IN_PROGRESS'].includes(lobby.status))
      throw new AppError('Reopen this lobby before editing.', 409);
    changes.lobbyUrl = a.lobbyUrl ? lobbyInfo(a.lobbyUrl, null).lobbyUrl : '';
  } else if (a.type === 'qualifier.score.remove') {
    if (lobby.status !== 'IN_PROGRESS')
      throw new AppError('Reopen this lobby before correcting scores.', 409);
    const before = lobby.scores.find((score) => score.id === a.scoreId);
    if (!before) throw new AppError('Score not found.', 404);
    await tx.qualifierScore.delete({ where: { id: before.id } });
    eventData = { reason: a.reason, before, after: null };
  } else if (a.type === 'qualifier.score') {
    if (a.run > policy.runs) throw new AppError('This run is not enabled in the qualifier policy.');
    const scoring = historicalScoring(rules);
    if (!scoring)
      throw new AppError(
        'This historical session has unresolved gameplay scoring. Review its provenance before recording competitive scores.',
        409,
      );
    assertScoreRepresentation(scoring, scoring, a.representation, a.raw);
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
      lobbyId_osuId_slotName_run: {
        lobbyId: lobby.id,
        osuId: a.osuId,
        slotName: a.slotName,
        run: a.run,
      },
    };
    const before = await tx.qualifierScore.findUnique({ where });
    const data = {
      raw: a.raw,
      mods: json(a.mods),
      adjusted: convertedScore(rules, a.raw, a.mods, slot.name).adjusted,
      actualScoring: historicalScoring(rules),
      representation: a.representation,
      source: 'MANUAL',
      gameId: null,
      verified: true,
    };
    const after = await tx.qualifierScore.upsert({
      where,
      create: { lobbyId: lobby.id, osuId: a.osuId, slotName: a.slotName, run: a.run, ...data },
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
    if (a.command === 'START') {
      if (!participants.length)
        throw new AppError('Assign entrants before starting this qualifier session.');
      assertQualifierCapacity(participants, policy);
      const settings = await tx.tournamentSettings.findUniqueOrThrow({ where: { tournamentId } });
      if (!historicalScoring(rules) || historicalScoring(rules) !== settings.gameplayScoring)
        throw new AppError(
          'Session scoring differs from the tournament configuration. Review the session snapshot before starting.',
          409,
        );
    }
    if (a.command === 'SUBMIT' || a.command === 'CONFIRM') {
      if (!lobby.lobbyUrl) throw new AppError('Record the multiplayer link before submitting.');
      for (const run of Array.from({ length: policy.runs }, (_, i) => i + 1))
        for (const slot of lobby.poolRevision.slots)
          for (const team of participants) {
            const scores = lobby.scores.filter(
              (s) =>
                s.slotName === slot.name &&
                s.run === run &&
                team.members.some((p) => p.osuId === s.osuId),
            );
            if (
              policy.teamAggregation === 'TOP_N'
                ? scores.length < policy.requiredPlayers
                : scores.length !== policy.requiredPlayers
            )
              throw new AppError(
                `${team.name} needs ${policy.requiredPlayers} scores on ${slot.name}, Run ${run}.`,
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
