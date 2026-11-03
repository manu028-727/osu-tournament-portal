import { Prisma } from '@/generated/prisma/client';
import { db as rootDb } from './db';
import { scopedDb } from './scoped-db';
import { can, assertPermission, AppError, type Actor, type PermissionKey } from './permissions';
import { matchAccess } from './match-access';
import { matchScope } from './match-access';
import { rosterSnapshot, lobbyInfo } from './match-record';
import { matchOptions } from './match-queries';
import { type MatchParticipants } from './matches-types';
import { teamInclude } from './teams-service';
import { matchRulesSchema } from './match-rules';
import { qualifierEffectiveScore, qualifierIndividualViolation } from './qualifier-score';
import { qualifierScoreDecision } from './qualifier-score-decisions';
import type { QualifierAction } from './qualifiers-validation';
import { inheritedRules, historicalScoring, assertScoreRepresentation } from './gameplay-scoring';
import { qualifierPolicySchema } from './qualifier-policy';
import { qualifierCompletion } from './qualifier-progress';
import type { QualifierView } from './qualifiers-types';
import { qualifierStandingSnapshot } from './qualifier-standings-contract';
import { assertQualifierMutable } from './qualifier-standings-service';
import {
  applyQualifierBulkSchedule,
  applyQualifierParticipantMove,
  assertQualifierAvailability,
  assertQualifierCapacity,
  qualifierNeverStarted,
  removeQualifierParticipants,
} from './qualifiers-bulk';
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const include = {
  games: true,
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
    a.type === 'qualifier.delete' ||
    a.type === 'qualifier.edit' ||
    a.type === 'qualifier.scores.resolve' ||
    a.type === 'qualifier.batch.create' ||
    a.type === 'qualifier.booking' ||
    (a.type === 'qualifier.status' && ['CONFIRM', 'REOPEN', 'CANCEL'].includes(a.command))
  )
    return 'matches.manage';
  if (a.type === 'qualifier.participants.move' || a.type === 'qualifier.participants.remove')
    return 'matches.manage_assigned';
  if (a.type === 'qualifier.schedule' || a.type === 'qualifier.bulk.schedule')
    return 'matches.assign_referees';
  if (
    a.type === 'qualifier.score' ||
    a.type === 'qualifier.scores' ||
    a.type === 'qualifier.score.remove'
  )
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
    where: {
      AND: [
        scope,
        ...(id
          ? [{ id }]
          : url.searchParams.get('deleted') === 'true'
            ? []
            : [{ deletedAt: null }]),
      ],
    },
    include,
    orderBy: [{ scheduledAt: { sort: 'asc', nulls: 'last' } }, { code: 'asc' }],
  });
  if (id && !records.length) throw new AppError('Qualifier lobby not found.', 404);
  const standings = await db.qualifierStanding.findMany({
    where: { stageId: { in: records.map((record) => record.stageId) } },
    orderBy: { version: 'desc' },
    select: { stageId: true, snapshot: true },
  });
  const locked = new Set(
    [...new Set(records.map((record) => record.stageId))].filter((stageId) => {
      const standing = standings.find((row) => row.stageId === stageId);
      return standing && qualifierStandingSnapshot(standing.snapshot).state === 'FINALIZED';
    }),
  );
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
    entrantOptions:
      can(actor, 'matches.manage') ||
      ((can(actor, 'matches.manage_assigned') || can(actor, 'matches.manage_all')) &&
        records.some((record) => matchAccess(actor, record).operate))
        ? await db.team.findMany({
            where: { status: 'APPROVED' },
            select: { id: true, name: true, format: true },
            orderBy: { name: 'asc' },
          })
        : undefined,
    lobbies: records.map((lobby) => ({
      ...lobby,
      scoringLocked: locked.has(lobby.stageId),
      ...(!matchAccess(actor, lobby).score &&
      !can(actor, 'matches.view_history') &&
      !can(actor, 'matches.manage')
        ? { games: [] }
        : {}),
      rules: matchRulesSchema.parse(lobby.rules),
      policy: qualifierPolicySchema.parse(
        lobby.policy || { requiredPlayers: matchRulesSchema.parse(lobby.rules).teamSize },
      ),
      access: {
        ...matchAccess(actor, lobby),
        score: !locked.has(lobby.stageId) && matchAccess(actor, lobby).score,
      },
      selection: lobby.events.find((event) => event.kind === 'qualifier.map')?.data || null,
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
  provenance?: {
    source: 'OSU_API' | 'IMPORT';
    gameId: string;
    verified: boolean;
    eligibilityReason?: string;
    mods?: string[];
    passed?: boolean | null;
    actualScoring?: string;
    eligibilityOverride?: 'INCLUDE' | 'EXCLUDE';
  },
  external?: { multiplayerId: number },
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
  if (a.type === 'qualifier.delete') {
    // Retain histories and FK ownership. Empty reservations become cancelled and reusable.
    for (const selected of a.lobbies) {
      const lobby = await tx.qualifierLobby.findUniqueOrThrow({
        where: { id: selected.id },
        include,
      });
      if (lobby.version !== selected.baseVersion || lobby.deletedAt)
        throw new AppError('A session changed. Reload before deleting.', 409);
      await assertQualifierMutable(tx, lobby.stageId, tournamentId);
      if (!['SCHEDULED', 'COMPLETED', 'CANCELLED'].includes(lobby.status))
        throw new AppError('Finish or cancel active sessions before deleting them.', 409);
      if (
        lobby.status === 'COMPLETED' &&
        (lobby.games.some((game) => game.status === 'PENDING') ||
          (lobby.multiplayerSync as { complete?: boolean } | null)?.complete === false)
      )
        throw new AppError(
          'Review pending multiplayer games and complete history before deleting.',
          409,
        );
      if (
        await tx.ircLobbyRequest.findFirst({
          where: { qualifierLobbyId: lobby.id, status: { in: ['PENDING', 'UNKNOWN'] } },
        })
      )
        throw new AppError(
          'Resolve the outstanding IRC lobby creation request before deleting.',
          409,
        );
      const version = lobby.version + 1;
      await tx.qualifierLobby.update({
        where: { id: lobby.id },
        data: {
          deletedAt: new Date(),
          bookingOpen: false,
          version,
          ...(qualifierNeverStarted(lobby) ? { status: 'CANCELLED' } : {}),
        },
      });
      await tx.qualifierEvent.create({
        data: {
          lobbyId: lobby.id,
          version,
          actorId: actor.id,
          kind: a.type,
          reason: a.reason,
          data: json({
            before: { status: lobby.status, code: lobby.code },
            preservedHistory: true,
          }),
        },
      });
    }
    return { id: 'bulk', updated: a.lobbies.length };
  }
  if (a.type === 'qualifier.bulk.schedule')
    return applyQualifierBulkSchedule(tx, actor, tournamentId, a);
  if (a.type === 'qualifier.participants.move')
    return applyQualifierParticipantMove(tx, actor, tournamentId, a);
  if (a.type === 'qualifier.participants.remove')
    return removeQualifierParticipants(tx, actor, tournamentId, a);
  if (a.type === 'qualifier.scores') {
    let version = a.baseVersion;
    for (const score of a.scores) {
      const result = await applyQualifierAction(tx, actor, {
        ...a,
        ...score,
        type: 'qualifier.score',
        baseVersion: version,
      });
      version = result.version!;
    }
    return { id: a.id, version, updated: a.scores.length };
  }
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
      throw new AppError('Lobby code {0} is already in use. Choose a different code.', 409, [
        a.code,
      ]);
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
    const tournament = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    const solo = teams.length
      ? teams.every((team) => team.format === 'INDIVIDUAL')
      : tournament.format === 'SOLO';
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
    assertQualifierCapacity(participants, policy, a.capacity);
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
        capacity: a.capacity ?? 16,
        bookingOpen: a.bookingOpen ?? true,
        bookingClosesAt: a.bookingClosesAt ? new Date(a.bookingClosesAt) : null,
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
  if (lobby.deletedAt)
    throw new AppError('This session has been deleted. Its history is read-only.', 409);
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
  if (a.type === 'qualifier.edit') {
    if (await tx.qualifierLobby.findFirst({ where: { code: a.code, id: { not: lobby.id } } }))
      throw new AppError('This session code is already in use.', 409);
    changes = { code: a.code, notes: a.notes };
  } else if (a.type === 'qualifier.scores.resolve') {
    if (
      !['IN_PROGRESS', 'COMPLETED'].includes(lobby.status) ||
      (lobby.status === 'COMPLETED' && !lobby.autoCompleted)
    )
      throw new AppError('Reopen this session before correcting scores.', 409);
    const selected = lobby.scores.filter((score) => a.scoreIds.includes(score.id));
    if (selected.length !== new Set(a.scoreIds).size) throw new AppError('Score not found.', 404);
    await tx.qualifierScore.updateMany({
      where: { lobbyId: lobby.id, id: { in: a.scoreIds } },
      data: {
        eligible: a.eligible,
        eligibilityReason: a.reason,
        eligibilityOverride: a.eligible ? 'INCLUDE' : 'EXCLUDE',
      },
    });
    eventData = {
      before: selected,
      after: selected.map((score) => ({
        ...score,
        eligible: a.eligible,
        eligibilityReason: a.reason,
        eligibilityOverride: a.eligible ? 'INCLUDE' : 'EXCLUDE',
      })),
      reason: a.reason,
    };
  } else if (a.type === 'qualifier.map') {
    if (!['SCHEDULED', 'IN_PROGRESS'].includes(lobby.status) && !lobby.autoCompleted)
      throw new AppError('Reopen this lobby before editing.', 409);
    if (a.run > policy.runs || !lobby.poolRevision.slots.some((slot) => slot.name === a.slotName))
      throw new AppError('Select a configured qualifier map and run.');
  } else if (a.type === 'qualifier.booking') {
    if (!qualifierNeverStarted(lobby))
      throw new AppError('Booking settings are locked after a session starts.', 409);
    assertQualifierCapacity(participants, policy, a.capacity);
    changes = {
      capacity: a.capacity,
      bookingOpen: a.bookingOpen,
      bookingClosesAt: a.bookingClosesAt ? new Date(a.bookingClosesAt) : null,
    };
  } else if (a.type === 'qualifier.schedule') {
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
    if (!['SCHEDULED', 'IN_PROGRESS'].includes(lobby.status) && !lobby.autoCompleted)
      throw new AppError('Reopen this lobby before editing.', 409);
    changes.lobbyUrl = a.lobbyUrl ? lobbyInfo(a.lobbyUrl, null).lobbyUrl : '';
    if (changes.lobbyUrl !== lobby.lobbyUrl)
      Object.assign(changes, {
        multiplayerSync: Prisma.DbNull,
        multiplayerSyncedAt: null,
        multiplayerError: null,
      });
  } else if (a.type === 'qualifier.score.remove') {
    if (lobby.status !== 'IN_PROGRESS' && !(lobby.status === 'COMPLETED' && lobby.autoCompleted))
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
    if (lobby.status !== 'IN_PROGRESS' && !(lobby.status === 'COMPLETED' && lobby.autoCompleted))
      throw new AppError('Start or reopen the lobby before recording scores.', 409);
    if (!participants.some((team) => team.members.some((p) => p.osuId === a.osuId)))
      throw new AppError('This player is not in the snapshotted qualifier roster.');
    const slot = lobby.poolRevision.slots.find((slot) => slot.name === a.slotName);
    if (!slot) throw new AppError('This map is not in the qualifier pool snapshot.');
    const evidence = {
      accuracy: a.accuracy ?? null,
      maxCombo: a.maxCombo ?? null,
      misses: a.misses ?? null,
    };
    const violation =
      provenance?.eligibilityReason ||
      qualifierIndividualViolation(rules, policy, slot.category, {
        mods: provenance?.mods || a.mods,
        passed: provenance?.passed ?? a.passed,
        actualScoring: provenance?.actualScoring || scoring,
        ...evidence,
      });
    const where = {
      lobbyId_osuId_slotName_run: {
        lobbyId: lobby.id,
        osuId: a.osuId,
        slotName: a.slotName,
        run: a.run,
      },
    };
    const before = await tx.qualifierScore.findUnique({ where });
    const override =
      provenance?.eligibilityOverride ||
      (before && (!provenance || before.gameId === provenance.gameId)
        ? qualifierScoreDecision(before, lobby.events)
        : null);
    const data = {
      eligible: override === 'INCLUDE' || (override !== 'EXCLUDE' && !violation),
      eligibilityReason: override
        ? provenance?.eligibilityReason || before?.eligibilityReason || a.reason
        : violation || '',
      eligibilityOverride: override,
      passed: provenance?.passed ?? a.passed ?? null,
      raw: a.raw,
      ...evidence,
      mods: json(provenance?.mods || a.mods),
      adjusted: qualifierEffectiveScore(
        rules,
        policy,
        a.raw,
        provenance?.mods || a.mods,
        slot.name,
        evidence,
      ),
      actualScoring: provenance?.actualScoring
        ? ['SCORE_V1', 'SCORE_V2', 'LAZER'].includes(provenance.actualScoring)
          ? provenance.actualScoring
          : null
        : historicalScoring(rules),
      representation: a.representation,
      source: provenance?.source || 'MANUAL',
      gameId: provenance?.gameId || null,
      verified: provenance?.verified ?? true,
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
    if (external && !can(actor, 'matches.manage'))
      throw new AppError('Only organizers may record externally refereed sessions.', 403);
    if (a.command === 'START' && (!lobby.scheduledAt || (!lobby.assignments.length && !external)))
      throw new AppError('Set a schedule and referee before starting.');
    if (a.command === 'START') {
      if (!participants.length)
        throw new AppError('Assign entrants before starting this qualifier session.');
      assertQualifierCapacity(participants, policy, lobby.capacity);
      const settings = await tx.tournamentSettings.findUniqueOrThrow({ where: { tournamentId } });
      if (!historicalScoring(rules) || historicalScoring(rules) !== settings.gameplayScoring)
        throw new AppError(
          'Session scoring differs from the tournament configuration. Review the session snapshot before starting.',
          409,
        );
    }
    if (a.command === 'SUBMIT' || a.command === 'CONFIRM') {
      if (
        lobby.games.some((game) => game.status === 'PENDING') ||
        (lobby.multiplayerSync as { complete?: boolean } | null)?.complete === false
      )
        throw new AppError(
          'Review pending multiplayer games and finish loading history before submitting.',
          409,
        );
      if (!lobby.lobbyUrl) throw new AppError('Record the multiplayer link before submitting.');
      if (
        !qualifierCompletion({ ...lobby, policy, rules, participants } as unknown as QualifierView)
          .complete
      )
        throw new AppError(
          'A complete eligible qualifier run is required for every entrant. Review missing scores and FreeMod requirements.',
          409,
        );
    }
    if (
      a.command === 'CANCEL' &&
      (await tx.ircLobbyRequest.findFirst({
        where: { qualifierLobbyId: lobby.id, status: { in: ['PENDING', 'UNKNOWN'] } },
      }))
    )
      throw new AppError(
        'Resolve the outstanding IRC lobby creation request before cancelling.',
        409,
      );
    changes.status = {
      START: 'IN_PROGRESS',
      SUBMIT: 'AWAITING_CONFIRMATION',
      CONFIRM: 'COMPLETED',
      REOPEN: 'IN_PROGRESS',
      CANCEL: 'CANCELLED',
    }[a.command] as 'IN_PROGRESS';
    changes.autoCompleted = false;
    eventData = {
      ...a,
      ...(external ? { external } : {}),
      before: { status: lobby.status },
      scores: lobby.scores,
      participants: lobby.participants,
      poolRevisionId: lobby.poolRevisionId,
    };
  }
  let version = lobby.version + 1;
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
  if (
    !provenance &&
    ['qualifier.score', 'qualifier.scores.resolve', 'qualifier.score.remove'].includes(a.type)
  )
    version = (await reconcileQualifierCompletion(tx, actor, lobby.id)) ?? version;
  return { id: lobby.id, version };
}

// Caller holds the root mutation lock. This never sends an IRC command or finalizes standings.
export async function reconcileQualifierCompletion(
  tx: Prisma.TransactionClient,
  actor: Actor,
  id: string,
) {
  const lobby = await tx.qualifierLobby.findUniqueOrThrow({ where: { id }, include });
  if (
    lobby.deletedAt ||
    !matchAccess(actor, lobby).score ||
    (lobby.status !== 'IN_PROGRESS' && !(lobby.status === 'COMPLETED' && lobby.autoCompleted))
  )
    return null;
  const rules = matchRulesSchema.parse(lobby.rules);
  const completion = qualifierCompletion({
    ...lobby,
    rules,
    policy: qualifierPolicySchema.parse(lobby.policy || { requiredPlayers: rules.teamSize }),
  } as unknown as QualifierView);
  const complete =
    completion.complete &&
    (lobby.multiplayerSync as { complete?: boolean } | null)?.complete !== false;
  if (
    complete === lobby.autoCompleted ||
    (!lobby.autoCompleted &&
      !lobby.scores.some((s) => s.source === 'IMPORT' || s.source === 'OSU_API'))
  )
    return null;
  await assertQualifierMutable(tx, lobby.stageId, actor.tournamentId!);
  const version = lobby.version + 1;
  await tx.qualifierLobby.update({
    where: { id, version: lobby.version },
    data: {
      status: complete ? 'COMPLETED' : 'IN_PROGRESS',
      autoCompleted: complete,
      version,
    },
  });
  await tx.qualifierEvent.create({
    data: {
      lobbyId: id,
      version,
      actorId: actor.id,
      kind: complete ? 'qualifier.auto.complete' : 'qualifier.auto.resume',
      reason: complete
        ? 'Complete played multiplayer run verified'
        : 'Played run is no longer complete',
      data: json(completion),
    },
  });
  return version;
}
