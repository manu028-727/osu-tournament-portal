import { Prisma } from '@/generated/prisma/client';
import {
  advanceConfirmedCompetitionResult,
  assertCompetitionEligibility,
  assertCompetitionMatchStart,
  assertCompetitionResultCorrection,
  synchronizeCompetitionResults,
} from './competition-service';
import {
  assertScoreRepresentation,
  historicalScoring,
  inheritedRules,
  tournamentScoring,
} from './gameplay-scoring';
import {
  aggregateScores,
  nextDraftStep,
  replayDraft,
  startingSide,
  validateDraftAction,
} from './match-engine';
import { allocateMatchNumber, numericMatchIdentifier } from './match-numbering';
import {
  draftState,
  lobbyInfo,
  matchInclude,
  rosterSnapshot,
  rulesHash,
  type MatchRecord,
} from './match-record';
import { firstTo, matchRulesSchema, otherSide, type Side } from './match-rules';
import type { MatchParticipants } from './matches-types';
import { matchActionSchema, type MatchAction } from './matches-validation';
import type { MultiplayerProposal } from './multiplayer';
import { AppError, assertPermission, can, type Actor, type PermissionKey } from './permissions';
import { assertScheduleAvailability } from './schedule-availability';
import { scopedDb } from './scoped-db';
import { stagePoolProblems } from './stage-pool-validation';
import { teamInclude } from './teams-service';
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export function matchPermission(a: MatchAction): PermissionKey {
  switch (a.type) {
    case 'match.delete':
      return 'matches.delete';
    case 'match.create':
    case 'match.rules.save':
    case 'match.confirm':
    case 'match.reopen':
    case 'match.cancel':
    case 'match.summary':
    case 'match.visibility':
    case 'match.resolve':
      return 'matches.manage';
    case 'match.schedule':
      return 'matches.assign_referees';
    case 'match.roll':
    case 'match.draft':
    case 'match.undo':
    case 'match.correct':
    case 'match.detected_pick':
      return 'matches.manage_draft';
    case 'match.score':
    case 'match.winner':
    case 'match.import':
    case 'match.multiplayer.ignore':
    case 'match.multiplayer.associate':
      return 'matches.update_scores';
    case 'match.submit':
    case 'match.dispute':
    case 'match.forfeit':
      return 'matches.submit_results';
    default:
      return 'matches.manage_assigned';
  }
}
export function assertMatchActionPermission(
  actor: Actor | null,
  action: MatchAction,
): asserts actor is Actor {
  if (action.type === 'match.delete') {
    assertPermission(actor, 'matches.delete');
    return;
  }
  if (actor && can(actor, 'matches.manage')) return;
  const permission = matchPermission(action);
  if (
    actor &&
    permission !== 'matches.manage' &&
    action.type !== 'match.schedule' &&
    can(actor, 'matches.manage_all')
  )
    return;
  assertPermission(actor, permission);
}
function active(
  match: MatchRecord,
): asserts match is MatchRecord & { poolRevision: NonNullable<MatchRecord['poolRevision']> } {
  if (match.status !== 'IN_PROGRESS')
    throw new AppError(
      'This match is not in progress. An administrator must reopen submitted results before editing.',
      409,
    );
  if (match.resultMode === 'SUMMARY')
    throw new AppError(
      'This imported result contains an overall summary only. Use the historical result correction form.',
      409,
    );
  if (!match.poolRevision)
    throw new AppError('A published mappool must be linked before operating this match.', 409);
}
function pointTotals(results: { winnerSide: Side; voided: boolean }[]) {
  return {
    scoreA: results.filter((r) => !r.voided && r.winnerSide === 'A').length,
    scoreB: results.filter((r) => !r.voided && r.winnerSide === 'B').length,
  };
}

export async function applyMatchAction(
  tx: Prisma.TransactionClient,
  actor: Actor,
  a: MatchAction,
): Promise<{ id: string; version?: number; matchNumber?: number }> {
  const tournamentId = actor.tournamentId || 'main';
  tx = scopedDb(tx, tournamentId);
  assertMatchActionPermission(actor, a);
  if (a.type === 'match.rules.save') {
    const scoring = (await tx.tournamentSettings.findUniqueOrThrow({ where: { tournamentId } }))
      .gameplayScoring;
    const target = a.stageId
      ? await tx.tournamentStage.findUniqueOrThrow({ where: { id: a.stageId } })
      : await tx.tournamentSettings.findUniqueOrThrow({ where: { tournamentId } });
    if ('kind' in target && target.kind === 'QUALIFIERS')
      throw new AppError('Qualifier stages use full-pool policies, not Best-of or pick/ban rules.');
    if (rulesHash(target.matchRules) !== a.baseHash)
      throw new AppError('These rule settings changed. Reload before saving.', 409);
    if (a.stageId)
      await tx.tournamentStage.update({
        where: { id: a.stageId },
        data: { matchRules: a.rules ? json(inheritedRules(a.rules, scoring)) : Prisma.DbNull },
      });
    else
      await tx.tournamentSettings.update({
        where: { tournamentId },
        data: { matchRules: json(inheritedRules(a.rules || {}, scoring)) },
      });
    return { id: a.stageId || tournamentId };
  }
  if (a.type === 'match.create') {
    if (a.teamAId === a.teamBId) throw new AppError('Choose two different teams or solo entrants.');
    const stage = await tx.tournamentStage.findUniqueOrThrow({
      where: { id: a.stageId },
      include: { mappool: { include: { publishedRevision: { include: { slots: true } } } } },
    });
    const paths = await tx.bracket.findMany({
      where: { rounds: { some: { stageId: stage.id } } },
      select: { id: true },
    });
    const bracketId = a.bracketId || (paths.length === 1 ? paths[0].id : undefined);
    if (paths.length > 1 && !bracketId && !a.allowIneligible)
      throw new AppError('Select the relevant competition path for this match.');
    if (a.allowIneligible && (!a.overrideReason || a.overrideReason.trim().length < 3))
      throw new AppError('Record an explicit reason for this exhibition or eligibility override.');
    if (bracketId) {
      if (!paths.some((p) => p.id === bracketId))
        throw new AppError('The selected competition path does not use this stage.');
      for (const teamId of [a.teamAId, a.teamBId])
        await assertCompetitionEligibility(tx, actor, {
          bracketId,
          teamId,
          allowIneligible: !!a.allowIneligible,
          reason: a.overrideReason,
        });
    }
    const teams = await tx.team.findMany({
      where: { id: { in: [a.teamAId, a.teamBId] }, tournamentId, status: 'APPROVED' },
      include: teamInclude,
    });
    const settings = await tx.tournamentSettings.findUniqueOrThrow({
      where: { tournamentId },
    });
    const tournament = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    const revision = stage.mappool?.publishedRevision;
    if (stage.archivedAt || stage.kind === 'QUALIFIERS')
      throw new AppError(
        'Choose an active elimination or custom stage; qualifiers use the qualifier workspace.',
      );
    if (stage.tournamentId !== tournamentId)
      throw new AppError('This stage belongs to another tournament.');
    if (stage.mappool?.state !== 'PUBLISHED' || !revision?.slots.length)
      throw new AppError('The selected stage needs a published mappool.');
    const rules = matchRulesSchema.parse({
      ...inheritedRules(stage.matchRules || settings.matchRules, settings.gameplayScoring),
      gameMode: tournament.gameMode,
      ...(a.bestOf === undefined ? {} : { bestOf: a.bestOf }),
    });
    if (
      teams.length !== 2 ||
      teams.some(
        (t) =>
          t.members.filter((m) => !m.substitute).length < rules.teamSize ||
          (t.format === 'INDIVIDUAL' && rules.teamSize !== 1),
      )
    )
      throw new AppError(
        'Approved participants and sufficient starting players are required for this team size.',
      );
    const poolProblems = stagePoolProblems(stage.kind, rules, revision.slots);
    if (poolProblems.length) throw new AppError(poolProblems.join(' '));
    const date = a.scheduledAt ? new Date(a.scheduledAt) : null;
    if (
      await tx.match.findFirst({
        where: {
          stageId: a.stageId,
          scheduledAt: date,
          status: a.allowIneligible ? { notIn: ['CANCELLED', 'COMPLETED'] } : { not: 'CANCELLED' },
          OR: [
            { teamAId: a.teamAId, teamBId: a.teamBId },
            { teamAId: a.teamBId, teamBId: a.teamAId },
          ],
        },
      })
    )
      throw new AppError('This match is already scheduled.', 409);
    await assertScheduleAvailability(tx, tournamentId, [
      {
        label: 'New match',
        scheduledAt: date,
        refereeIds: a.refereeIds,
        participants: teams.map(rosterSnapshot),
        teamIds: [a.teamAId, a.teamBId],
      },
    ]);
    const match = await tx.match.create({
      data: {
        matchNumber: await allocateMatchNumber(tx, tournamentId, numericMatchIdentifier(a.code)),
        code: a.code,
        ...(bracketId || a.allowIneligible
          ? {
              source: json({
                competitionPathId: bracketId || null,
                eligibilityOverride: !!a.allowIneligible,
                overrideReason: a.overrideReason || '',
              }),
            }
          : {}),
        stageId: a.stageId,
        teamAId: a.teamAId,
        teamBId: a.teamBId,
        poolRevisionId: revision.id,
        participants: json({
          A: rosterSnapshot(teams.find((t) => t.id === a.teamAId)!),
          B: rosterSnapshot(teams.find((t) => t.id === a.teamBId)!),
        }),
        rules: json(rules),
        notes: a.notes,
        published: a.published,
        scheduledAt: date,
        assignments: { create: a.refereeIds.map((userId, i) => ({ userId, primary: i === 0 })) },
        events: { create: { version: 1, actorId: actor.id, kind: a.type, data: json(a) } },
      },
    });
    return { id: match.id, matchNumber: match.matchNumber, version: match.version };
  }
  const match = await tx.match.findUniqueOrThrow({ where: { id: a.id }, include: matchInclude });
  if (a.type === 'match.delete') {
    if (await tx.bracketNode.findFirst({ where: { matchId: match.id } }))
      throw new AppError(
        'This match belongs to a bracket. Correct its position or cancel it through the competition workflow instead of deleting its history.',
        409,
      );
    if (match.version !== a.baseVersion)
      throw new AppError('The match changed. Reload and review it before deleting.', 409);
    if (a.confirmCode !== match.code)
      throw new AppError('Type the exact match code to confirm permanent deletion.');
    const dependency = await tx.match.findFirst({
      where: {
        id: { not: match.id },
        OR: [
          ...(['A', 'B'] as const).flatMap((side) =>
            ['W', 'L'].map((prefix) => ({
              participants: { path: [side, 'name'], equals: `${prefix}${match.code}` },
            })),
          ),
          {
            events: {
              some: { kind: 'match.resolve', data: { path: ['sourceMatchId'], equals: match.id } },
            },
          },
        ],
      },
      select: { code: true },
    });
    if (dependency)
      throw new AppError(
        `Match ${dependency.code} depends on this result. Remove that dependent match first, or cancel this match instead.`,
        409,
      );
    const deleted = await tx.match.deleteMany({ where: { id: match.id, version: a.baseVersion } });
    if (deleted.count !== 1) throw new AppError('The match changed. Reload before deleting.', 409);
    return { id: match.id };
  }
  if (
    !can(actor, 'matches.manage') &&
    !can(actor, 'matches.manage_all') &&
    !match.assignments.some((ref) => ref.userId === actor.id)
  )
    throw new AppError('This match is not assigned to you.', 403);
  if (match.version !== a.baseVersion)
    throw new AppError(
      'Another referee updated this match. Reload and review the latest state.',
      409,
    );
  const rules = matchRulesSchema.parse(match.rules),
    participants = match.participants as unknown as MatchParticipants;
  if (a.type === 'match.reopen' || a.type === 'match.cancel' || a.type === 'match.dispute') {
    const impact = await assertCompetitionResultCorrection(
      tx,
      tournamentId,
      match.id,
      null,
      !!a.approveProgression,
    );
    if (impact.affected.length) {
      assertPermission(actor, 'matches.manage');
      if (a.correctionHash !== impact.hash)
        throw new AppError(
          'Downstream progression changed since the preview. Review it again.',
          409,
        );
    }
  }
  if (a.type === 'match.detected_pick') {
    active(match);
    const game = await tx.multiplayerGame.findFirst({
      where: { id: a.proposalId, matchId: match.id, multiplayerId: match.multiplayerId || 0 },
    });
    const expected = nextDraftStep(rules, draftState(match));
    const evidence = game?.evidence as unknown as { startTime?: string } | null;
    if (
      !game ||
      game.ignoredAt ||
      game.confirmedAt ||
      game.actionId ||
      expected?.kind !== 'PICK' ||
      !expected.side ||
      !evidence?.startTime ||
      !match.startedAt ||
      new Date(evidence.startTime) < match.startedAt
    )
      throw new AppError('This game cannot be proposed as the current pick.');
    const saved = await applyMatchAction(
      tx,
      actor,
      matchActionSchema.parse({
        type: 'match.draft',
        id: match.id,
        baseVersion: match.version,
        kind: 'PICK',
        side: expected.side,
        slotName: game.slotName,
      }),
    );
    const pick = await tx.matchMapAction.findFirstOrThrow({
      where: { matchId: match.id, kind: 'PICK', voided: false },
      orderBy: { sequence: 'desc' },
    });
    return applyMatchAction(
      tx,
      actor,
      matchActionSchema.parse({
        type: 'match.multiplayer.associate',
        id: match.id,
        baseVersion: saved.version,
        proposalId: game.id,
        actionId: pick.id,
        reason: a.reason,
      }),
    );
  }
  if (a.type === 'match.import') {
    active(match);
    const game = await tx.multiplayerGame.findUniqueOrThrow({
      where: { id: a.proposalId, matchId: match.id },
    });
    if (
      game.confirmedAt ||
      game.ignoredAt ||
      !game.proposal ||
      game.multiplayerId !== match.multiplayerId
    )
      throw new AppError('This game was already confirmed or belongs to a different lobby.', 409);
    const proposal = game.proposal as unknown as MultiplayerProposal;
    const picked = match.actions.find(
      (entry) =>
        !entry.voided &&
        entry.kind === 'PICK' &&
        !match.results.some((r) => !r.voided && r.actionId === entry.id),
    );
    const slot = match.poolRevision.slots.find((s) => s.name === picked?.slotName);
    if (
      !picked ||
      !slot ||
      slot.beatmapId !== game.beatmapId ||
      picked.slotName !== game.slotName ||
      (game.actionId !== picked.id && new Date(proposal.startTime) < picked.createdAt)
    )
      throw new AppError('The game does not match the current pending pick. Use manual review.');
    const result = await applyMatchAction(
      tx,
      actor,
      matchActionSchema.parse({
        type: 'match.score',
        id: match.id,
        baseVersion: match.version,
        actionId: picked.id,
        scoreA: proposal.scoreA,
        scoreB: proposal.scoreB,
        players: proposal.players,
        notes: `osu! game ${game.gameId}`,
        reason: `${a.reason} · osu! game ${game.gameId}`,
      }),
    );
    await tx.multiplayerGame.update({
      where: { id: game.id, confirmedAt: null },
      data: { confirmedAt: new Date(), actionId: picked.id },
    });
    return result;
  }
  let changes: Prisma.MatchUncheckedUpdateManyInput = {},
    revise = false;
  let eventData: unknown = a;
  switch (a.type) {
    case 'match.multiplayer.ignore':
    case 'match.multiplayer.associate': {
      const game = await tx.multiplayerGame.findFirst({
        where: { id: a.proposalId, matchId: match.id, multiplayerId: match.multiplayerId || 0 },
      });
      if (!game || game.confirmedAt)
        throw new AppError('Select an unconfirmed game from this lobby.');
      if (a.type === 'match.multiplayer.ignore')
        await tx.multiplayerGame.update({
          where: { id: game.id },
          data: { ignoredAt: new Date() },
        });
      else {
        const pick = match.actions.find(
          (entry) => entry.id === a.actionId && entry.kind === 'PICK' && !entry.voided,
        );
        const slot = match.poolRevision?.slots.find((entry) => entry.name === pick?.slotName);
        if (!pick || slot?.beatmapId !== game.beatmapId || game.ignoredAt)
          throw new AppError('This game does not match the selected official pick.');
        if (
          await tx.multiplayerGame.findFirst({
            where: { matchId: match.id, actionId: pick.id, id: { not: game.id } },
          })
        )
          throw new AppError('A different game is already associated with that pick.');
        if (game.actionId && game.actionId !== pick.id)
          throw new AppError('This game already belongs to another pick.');
        await tx.multiplayerGame.update({ where: { id: game.id }, data: { actionId: pick.id } });
      }
      break;
    }
    case 'match.resolve': {
      if (match.status !== 'SCHEDULED' || (a.side === 'A' ? match.teamAId : match.teamBId))
        throw new AppError('Only unresolved scheduled opponents can be resolved.', 409);
      const reference = /^([WL])(.{1,80})$/.exec(participants[a.side].name);
      if (!reference) throw new AppError('This opponent has no winner/loser dependency.');
      const source = await tx.match.findFirst({ where: { code: reference[2] } });
      if (
        !source ||
        source.status !== 'COMPLETED' ||
        !source.winnerSide ||
        source.version !== a.dependencyVersion
      )
        throw new AppError(
          'The source result is unconfirmed or changed. Reload before resolving.',
          409,
        );
      const selected = reference[1] === 'W' ? source.winnerSide : otherSide(source.winnerSide);
      const teamId = selected === 'A' ? source.teamAId : source.teamBId;
      if (!teamId || teamId === (a.side === 'A' ? match.teamBId : match.teamAId))
        throw new AppError('The dependency does not resolve to a distinct registered opponent.');
      const team = await tx.team.findFirst({
        where: { id: teamId, tournamentId, status: 'APPROVED' },
        include: teamInclude,
      });
      if (!team || team.members.filter((p) => !p.substitute).length < rules.teamSize)
        throw new AppError('This entrant is no longer eligible for the configured team size.');
      changes = {
        [a.side === 'A' ? 'teamAId' : 'teamBId']: team.id,
        participants: json({ ...participants, [a.side]: rosterSnapshot(team) }),
      };
      eventData = {
        ...a,
        sourceMatchId: source.id,
        sourceVersion: source.version,
        before: participants[a.side],
        after: rosterSnapshot(team),
      };
      break;
    }
    case 'match.visibility':
      changes = { published: a.published };
      break;
    case 'match.start':
      await assertCompetitionMatchStart(tx, tournamentId, match.id);
      {
        const source = match.source as {
          competitionPathId?: string;
          eligibilityOverride?: boolean;
        } | null;
        if (source?.competitionPathId && !source.eligibilityOverride)
          for (const teamId of [match.teamAId, match.teamBId])
            if (teamId)
              await assertCompetitionEligibility(tx, actor, {
                bracketId: source.competitionPathId,
                teamId,
              });
      }
      if (match.status !== 'SCHEDULED')
        throw new AppError('Only scheduled matches can be started.', 409);
      if (
        historicalScoring(rules) !==
        tournamentScoring(
          (await tx.tournamentSettings.findUniqueOrThrow({ where: { tournamentId } }))
            .gameplayScoring,
        )
      )
        throw new AppError(
          'The frozen scoring configuration differs from the tournament. Review it before starting.',
          409,
        );
      if (!match.teamAId || !match.teamBId)
        throw new AppError('Resolve both opponents before starting this fixture.', 409);
      if (!match.poolRevisionId) {
        const pool = await tx.mappool.findUnique({
          where: { stageId: match.stageId },
          include: { publishedRevision: { include: { slots: true } } },
        });
        if (pool?.state !== 'PUBLISHED' || !pool.publishedRevision?.slots.length)
          throw new AppError('Publish the stage mappool before starting this fixture.', 409);
        changes.poolRevisionId = pool.publishedRevisionId;
      }
      changes = {
        ...changes,
        status: 'IN_PROGRESS',
        startedAt: new Date(),
        ...(!rules.rollRequired
          ? {
              firstBanSide: startingSide(rules.firstBanRule, 0, 0, 'A'),
              firstPickSide: startingSide(rules.firstPickRule, 0, 0, 'A'),
              firstProtectSide: startingSide(rules.firstProtectRule, 0, 0, 'A'),
            }
          : {}),
      };
      break;
    case 'match.schedule':
      if (
        ((a.teamAId && a.teamAId !== match.teamAId) ||
          (a.teamBId && a.teamBId !== match.teamBId)) &&
        (await tx.bracketNode.findFirst({ where: { matchId: match.id } }))
      )
        throw new AppError(
          'Change bracket opponents through the Bracket view so progression stays consistent.',
          409,
        );
      if (
        !can(actor, 'matches.manage') &&
        (a.teamAId || a.teamBId || a.bestOf || a.published !== undefined)
      )
        throw new AppError('Only match managers can change opponents, format or publication.', 403);
      if (['COMPLETED', 'CANCELLED'].includes(match.status))
        throw new AppError('Reopen a finalized match before changing its assignment.', 409);
      if (
        match.status !== 'SCHEDULED' &&
        (a.scheduledAt ? new Date(a.scheduledAt).getTime() : null) !==
          (match.scheduledAt?.getTime() ?? null)
      )
        throw new AppError('An active match cannot be rescheduled.');
      await tx.matchAssignment.deleteMany({ where: { matchId: match.id } });
      await tx.matchAssignment.createMany({
        data: a.refereeIds.map((userId, i) => ({ userId, matchId: match.id, primary: i === 0 })),
      });
      changes = {
        scheduledAt: a.scheduledAt ? new Date(a.scheduledAt) : null,
        notes: a.notes,
        published: a.published,
      };
      if (a.teamAId || a.teamBId || a.bestOf) {
        if (match.status !== 'SCHEDULED')
          throw new AppError('Only scheduled fixtures can change participants or format.');
        const teamAId = a.teamAId || match.teamAId,
          teamBId = a.teamBId || match.teamBId;
        if (teamAId === teamBId) throw new AppError('Choose two different opponents.');
        const selected = await tx.team.findMany({
          where: {
            id: { in: [teamAId, teamBId].filter((id): id is string => !!id) },
            status: 'APPROVED',
            tournamentId,
          },
          include: teamInclude,
        });
        if (selected.length !== [teamAId, teamBId].filter(Boolean).length)
          throw new AppError('Select approved teams.');
        if (selected.some((t) => t.members.filter((m) => !m.substitute).length < rules.teamSize))
          throw new AppError('A selected team has too few starting players.');
        changes = {
          ...changes,
          teamAId,
          teamBId,
          participants: json({
            A: teamAId ? rosterSnapshot(selected.find((t) => t.id === teamAId)!) : participants.A,
            B: teamBId ? rosterSnapshot(selected.find((t) => t.id === teamBId)!) : participants.B,
          }),
          rules: json({ ...rules, ...(a.bestOf ? { bestOf: a.bestOf } : {}) }),
        };
      }
      await assertScheduleAvailability(
        tx,
        tournamentId,
        [
          {
            label: `Match ${match.matchNumber}`,
            scheduledAt: a.scheduledAt ? new Date(a.scheduledAt) : null,
            refereeIds: a.refereeIds,
            participants: changes.participants ?? match.participants,
            teamIds: [a.teamAId || match.teamAId, a.teamBId || match.teamBId],
          },
        ],
        { matchIds: [match.id] },
      );
      break;
    case 'match.roll':
      active(match);
      if (!rules.rollRequired)
        throw new AppError('This match uses fixed starting sides, not rolls.');
      if (a.rollA === a.rollB) throw new AppError('Tied rolls must be repeated.');
      if (match.actions.some((action) => !action.voided))
        throw new AppError('Undo the draft before correcting its roll order.');
      changes = {
        rollA: a.rollA,
        rollB: a.rollB,
        firstPickSide: startingSide(rules.firstPickRule, a.rollA, a.rollB, a.firstPickSide),
        firstBanSide: startingSide(rules.firstBanRule, a.rollA, a.rollB, a.firstBanSide),
        firstProtectSide: startingSide(
          rules.firstProtectRule,
          a.rollA,
          a.rollB,
          a.firstProtectSide || a.firstBanSide,
        ),
      };
      break;
    case 'match.draft': {
      active(match);
      const slot = validateDraftAction(rules, draftState(match), match.poolRevision.slots, a);
      await tx.matchMapAction.create({
        data: {
          matchId: match.id,
          sequence: (match.actions.at(-1)?.sequence || 0) + 1,
          kind: a.kind,
          side: a.side,
          slotName: slot.name,
          category: slot.category,
          actorId: actor.id,
          provenance: { type: 'MANUAL', version: match.version + 1 },
        },
      });
      changes = {
        timerStartedAt: null,
        timerRemainingSeconds: 0,
        timerKind: a.kind === 'PICK' ? 'READY' : a.kind === 'BAN' ? 'BAN' : 'PICK',
      };
      break;
    }
    case 'match.correct': {
      active(match);
      const current = match.actions.filter((entry) => !entry.voided),
        index = current.findIndex((entry) => entry.id === a.actionId);
      if (index < 0) throw new AppError('Select an active action.');
      const tail = current.slice(index);
      if (tail.length > 1 && !a.discardFollowing)
        throw new AppError(
          'This correction invalidates later actions. Confirm discarding them first.',
          409,
        );
      const prefix = current.slice(0, index),
        replay = replayDraft(
          rules,
          draftState(match),
          match.poolRevision.slots,
          prefix,
          match.results,
        );
      const original = current[index];
      const slot = validateDraftAction(rules, replay, match.poolRevision.slots, {
        kind: original.kind,
        side: original.side,
        slotName: a.slotName,
      });
      await tx.matchMapAction.updateMany({
        where: { id: { in: tail.map((entry) => entry.id) } },
        data: { voided: true },
      });
      await tx.matchMapResult.updateMany({
        where: { actionId: { in: tail.map((entry) => entry.id) } },
        data: { voided: true },
      });
      await tx.matchMapAction.create({
        data: {
          matchId: match.id,
          sequence: (match.actions.at(-1)?.sequence || 0) + 1,
          kind: original.kind,
          side: original.side,
          slotName: slot.name,
          category: slot.category,
          actorId: actor.id,
          provenance: { type: 'CORRECTION', previousActionId: original.id, reason: a.reason },
        },
      });
      changes = {
        scoreA: replay.scoreA,
        scoreB: replay.scoreB,
        winnerSide: null,
        forfeitSide: null,
        timerStartedAt: null,
        timerRemainingSeconds: 0,
      };
      eventData = {
        ...a,
        before: tail,
        previousResults: match.results.filter((r) => tail.some((entry) => entry.id === r.actionId)),
      };
      revise = true;
      break;
    }
    case 'match.undo': {
      active(match);
      const last = match.actions.filter((action) => !action.voided).at(-1);
      if (!last) throw new AppError('There is no draft action to undo.');
      await tx.matchMapAction.update({ where: { id: last.id }, data: { voided: true } });
      await tx.matchMapResult.updateMany({ where: { actionId: last.id }, data: { voided: true } });
      const points = pointTotals(match.results.filter((r) => r.actionId !== last.id));
      changes = { ...points, winnerSide: null, forfeitSide: null };
      revise = true;
      eventData = {
        ...a,
        undone: last,
        previousResult: match.results.find((r) => r.actionId === last.id) || null,
      };
      break;
    }
    case 'match.winner':
    case 'match.score': {
      active(match);
      if (a.type === 'match.score') {
        const scoring = historicalScoring(rules);
        if (scoring)
          for (const value of a.players.length
            ? a.players.map((p) => p.score)
            : [a.scoreA, a.scoreB])
            assertScoreRepresentation(scoring, scoring, a.representation, value);
      }
      const picked = match.actions.find(
        (action) => action.id === a.actionId && action.kind === 'PICK' && !action.voided,
      );
      if (!picked) throw new AppError('Select an active picked map.');
      const totals =
        a.type === 'match.winner'
          ? { scoreA: null, scoreB: null, winnerSide: a.winnerSide }
          : aggregateScores(
              rules,
              picked.category,
              a.players,
              {
                A: participants.A.members.map((p) => p.osuId),
                B: participants.B.members.map((p) => p.osuId),
              },
              a.scoreA,
              a.scoreB,
              picked.slotName,
            );
      const previous = match.results.find((result) => result.actionId === picked.id);
      if (previous) await tx.matchPlayerScore.deleteMany({ where: { resultId: previous.id } });
      const data = {
        matchId: match.id,
        ...totals,
        entryMode: a.type === 'match.winner' ? 'WINNER_ONLY' : 'SCORES',
        notes: a.notes,
        voided: false,
        playerScores: {
          create: (a.type === 'match.winner' ? [] : a.players).map((p) => ({
            ...p,
            mods: json(p.mods),
          })),
        },
      };
      const result = await tx.matchMapResult.upsert({
        where: { actionId: picked.id },
        create: { ...data, actionId: picked.id },
        update: data,
      });
      const results = [
        ...match.results.filter((r) => r.actionId !== picked.id),
        { ...result, playerScores: [] },
      ];
      try {
        replayDraft(rules, draftState(match), match.poolRevision.slots, match.actions, results);
      } catch (error) {
        throw new AppError(
          `This result would invalidate the match history. Undo later actions first. ${(error as Error).message}`,
          409,
        );
      }
      let scoreA = 0,
        scoreB = 0;
      for (const [index, action] of match.actions
        .filter((action) => !action.voided && action.kind === 'PICK')
        .entries()) {
        const map = results.find((r) => !r.voided && r.actionId === action.id);
        if (map) map.winnerSide === 'A' ? scoreA++ : scoreB++;
        if (
          Math.max(scoreA, scoreB) >= firstTo(rules) &&
          index < match.actions.filter((a) => !a.voided && a.kind === 'PICK').length - 1
        )
          throw new AppError(
            'Undo later picks before applying a correction that would have ended the match earlier.',
          );
      }
      changes = {
        scoreA,
        scoreB,
        winnerSide: scoreA >= firstTo(rules) ? 'A' : scoreB >= firstTo(rules) ? 'B' : null,
        forfeitSide: null,
        timerStartedAt: null,
        timerRemainingSeconds: 0,
      };
      revise = true;
      eventData = {
        reason: a.reason,
        before: previous || null,
        after: { ...totals, players: a.type === 'match.winner' ? [] : a.players, notes: a.notes },
        actionId: picked.id,
      };
      break;
    }
    case 'match.timer': {
      active(match);
      if (a.command === 'START' && a.kind === 'TIMEOUT')
        throw new AppError('Record a tactical timeout to start its timer.');
      const seconds = {
        PICK: rules.pickSeconds,
        BAN: rules.banSeconds,
        READY: rules.readySeconds,
        TIMEOUT: rules.timeoutSeconds,
      }[a.kind];
      const remaining = match.timerStartedAt
        ? Math.max(
            0,
            match.timerRemainingSeconds -
              Math.max(0, Math.floor((Date.now() - match.timerStartedAt.getTime()) / 1000)),
          )
        : match.timerRemainingSeconds;
      changes = {
        timerKind: a.kind,
        timerRemainingSeconds:
          a.command === 'RESET'
            ? seconds
            : a.command === 'PAUSE'
              ? remaining
              : match.timerKind === a.kind && remaining > 0
                ? remaining
                : seconds,
        timerStartedAt: a.command === 'START' ? new Date() : null,
      };
      break;
    }
    case 'match.incident': {
      active(match);
      if (a.kind === 'TIMEOUT' || a.kind === 'WARMUP') {
        if (!a.side) throw new AppError('Select a team.');
        const count = await tx.matchEvent.count({
          where: { matchId: match.id, kind: `incident.${a.kind}`, side: a.side },
        });
        if (count >= (a.kind === 'TIMEOUT' ? rules.timeoutsPerTeam : rules.warmupsPerTeam))
          throw new AppError('This team has used its allowance.');
        if (
          a.kind === 'WARMUP' &&
          match.actions.some((action) => !action.voided && action.kind === 'PICK')
        )
          throw new AppError('Warmups end once picks begin.');
        const pending = match.actions.find(
          (action) =>
            !action.voided &&
            action.kind === 'PICK' &&
            !match.results.some((r) => !r.voided && r.actionId === action.id),
        );
        if (
          a.kind === 'TIMEOUT' &&
          rules.timeoutOnlyOwnPick &&
          (pending?.side ||
            (nextDraftStep(rules, draftState(match))?.kind === 'PICK'
              ? nextDraftStep(rules, draftState(match))?.side
              : null)) !== a.side
        )
          throw new AppError('A timeout is allowed only on the team’s own pick.');
        if (a.kind === 'TIMEOUT')
          changes = {
            timerKind: 'TIMEOUT',
            timerRemainingSeconds: rules.timeoutSeconds,
            timerStartedAt: new Date(),
          };
      }
      break;
    }
    case 'match.lobby':
      if (['COMPLETED', 'CANCELLED'].includes(match.status))
        throw new AppError('Reopen the match before editing its lobby.');
      changes = lobbyInfo(a.lobbyUrl, a.multiplayerId);
      if (changes.multiplayerId !== match.multiplayerId)
        changes = {
          ...changes,
          multiplayerSync: Prisma.DbNull,
          multiplayerSyncedAt: null,
          multiplayerError: null,
        };
      break;
    case 'match.submit':
      active(match);
      if (!match.winnerSide || draftState(match).pendingPick)
        throw new AppError('Complete the required map results before submitting.');
      changes = {
        status: 'AWAITING_CONFIRMATION',
        notes: a.notes,
        submittedAt: new Date(),
        timerStartedAt: null,
      };
      revise = true;
      break;
    case 'match.confirm':
      if (match.status !== 'AWAITING_CONFIRMATION' || !match.winnerSide)
        throw new AppError('Only submitted results can be confirmed.');
      changes = { status: 'COMPLETED', completedAt: new Date() };
      revise = true;
      break;
    case 'match.summary': {
      if (match.resultMode !== 'SUMMARY' || match.status !== 'IN_PROGRESS')
        throw new AppError('Reopen an imported summary before correcting its overall result.', 409);
      if (
        Math.max(a.scoreA, a.scoreB) !== firstTo(rules) ||
        Math.min(a.scoreA, a.scoreB) >= firstTo(rules)
      )
        throw new AppError(
          'The result must contain exactly one match winner at the configured win target.',
        );
      const winner = a.scoreA > a.scoreB ? 'A' : 'B';
      if (a.forfeitSide === winner) throw new AppError('The winner cannot be the forfeiting team.');
      changes = {
        scoreA: a.scoreA,
        scoreB: a.scoreB,
        winnerSide: winner,
        forfeitSide: a.forfeitSide,
        status: 'AWAITING_CONFIRMATION',
        submittedAt: new Date(),
      };
      revise = true;
      break;
    }
    case 'match.forfeit':
      if (!match.teamAId || !match.teamBId)
        throw new AppError('Resolve both opponents before recording a forfeit.');
      if (!['SCHEDULED', 'IN_PROGRESS'].includes(match.status) || match.winnerSide)
        throw new AppError('Dispute an already-decided result instead of recording a forfeit.');
      changes = {
        status: 'AWAITING_CONFIRMATION',
        winnerSide: a.winnerSide,
        forfeitSide: otherSide(a.winnerSide),
        scoreA: a.winnerSide === 'A' ? firstTo(rules) : match.scoreA,
        scoreB: a.winnerSide === 'B' ? firstTo(rules) : match.scoreB,
        notes: [match.notes, a.reason].filter(Boolean).join('\n'),
        submittedAt: new Date(),
        timerStartedAt: null,
      };
      revise = true;
      break;
    case 'match.reopen':
      if (!['COMPLETED', 'AWAITING_CONFIRMATION', 'DISPUTED', 'CANCELLED'].includes(match.status))
        throw new AppError('This match is already open.');
      changes = {
        status: match.resultMode === 'MAPS' && !match.poolRevisionId ? 'SCHEDULED' : 'IN_PROGRESS',
        completedAt: null,
        submittedAt: null,
        ...(match.forfeitSide && match.resultMode !== 'SUMMARY'
          ? { ...pointTotals(match.results), winnerSide: null, forfeitSide: null }
          : {}),
      };
      revise = true;
      break;
    case 'match.dispute':
      if (!['IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED'].includes(match.status))
        throw new AppError('This result cannot be disputed in its current state.');
      changes = { status: 'DISPUTED', timerStartedAt: null };
      revise = true;
      break;
    case 'match.cancel':
      if (match.status === 'COMPLETED')
        throw new AppError('Reopen a confirmed result before cancelling it.');
      changes = { status: 'CANCELLED', timerStartedAt: null };
      revise = true;
      break;
  }
  const updated = await tx.match.updateMany({
    where: { id: match.id, version: a.baseVersion },
    data: { ...changes, version: { increment: 1 } },
  });
  if (updated.count !== 1) throw new AppError('The match changed. Reload before saving.', 409);
  await tx.matchEvent.create({
    data: {
      matchId: match.id,
      version: match.version + 1,
      actorId: actor.id,
      kind: a.type === 'match.incident' ? `incident.${a.kind}` : a.type,
      side: 'side' in a ? a.side : null,
      notes: 'reason' in a ? a.reason : 'notes' in a ? a.notes : '',
      data: json(eventData),
    },
  });
  if (revise) {
    const snapshot = await tx.match.findUniqueOrThrow({
      where: { id: match.id },
      include: matchInclude,
    });
    await tx.matchResultRevision.create({
      data: {
        matchId: match.id,
        version: snapshot.version,
        createdBy: actor.id,
        kind: a.type,
        reason: 'reason' in a ? a.reason : 'notes' in a ? a.notes : a.type,
        snapshot: json(snapshot),
      },
    });
  }
  if (a.type === 'match.confirm')
    await advanceConfirmedCompetitionResult(tx, tournamentId, match.id, actor.id);
  if (['match.reopen', 'match.cancel', 'match.dispute'].includes(a.type))
    await synchronizeCompetitionResults(tx, tournamentId, actor.id);
  return { id: match.id, version: match.version + 1 };
}
