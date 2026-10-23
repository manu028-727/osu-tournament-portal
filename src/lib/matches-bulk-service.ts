import { Prisma } from '@/generated/prisma/client';
import { AppError, assertPermission, type Actor } from './permissions';
import { eligibleRefereeFor, type MatchParticipants } from './matches-service';
import {
  matchesSchedulingActionSchema,
  type MatchesBulkScheduleAction,
  type MatchesSchedulingAction,
} from './matches-bulk-validation';
import { scopedDb } from './scoped-db';
import { inheritedRules } from './gameplay-scoring';
import { stagePoolProblems } from './stage-pool-validation';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
function sourceObject(value: Prisma.JsonValue) {
  if (value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value))
    throw new AppError(
      'This match has incompatible source metadata. Review it before changing staff.',
      409,
    );
  return value as Prisma.JsonObject;
}
type Entrants = { teamIds: Set<string>; playerIds: Set<number> };
function entrants(value: Prisma.JsonValue, teamIds: (string | null)[] = []): Entrants {
  const sides = (Array.isArray(value)
    ? value
    : Object.values(value as unknown as MatchParticipants)) as unknown as MatchParticipants['A'][];
  return {
    teamIds: new Set([
      ...teamIds.filter((id): id is string => !!id),
      ...sides.flatMap((side) => (side.id ? [side.id] : [])),
    ]),
    playerIds: new Set(sides.flatMap((side) => side.members.map((player) => player.osuId))),
  };
}
const intersects = <T>(a: Set<T>, b: Set<T>) => [...a].some((value) => b.has(value));
const sharesEntrants = (a: Entrants, b: Entrants) =>
  intersects(a.teamIds, b.teamIds) || intersects(a.playerIds, b.playerIds);

export async function applyBulkScheduleAction(
  tx: Prisma.TransactionClient,
  actor: Actor,
  tournamentId: string,
  input: MatchesSchedulingAction,
) {
  assertPermission(actor, 'matches.manage');
  if (actor.tournamentId && actor.tournamentId !== tournamentId)
    throw new AppError('Choose matches from the current tournament.', 403);
  const parsed = matchesSchedulingActionSchema.parse(input);
  const action: MatchesBulkScheduleAction =
    parsed.type === 'matches.bulk.schedule'
      ? parsed
      : { type: 'matches.bulk.schedule', matches: parsed.matches };
  const rowPatches = new Map<string, Pick<MatchesBulkScheduleAction, 'scheduledAt' | 'refereeIds'>>(
    parsed.type === 'matches.batch.schedule'
      ? parsed.matches.map((row) => [
          row.id,
          { scheduledAt: row.scheduledAt, refereeIds: row.refereeIds },
        ])
      : parsed.matches.map((row) => [
          row.id,
          { scheduledAt: parsed.scheduledAt, refereeIds: parsed.refereeIds },
        ]),
  );
  tx = scopedDb(tx, tournamentId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
  const ids = action.matches.map((match) => match.id);
  const records = await tx.match.findMany({
    where: { tournamentId, id: { in: ids } },
    include: {
      assignments: { select: { userId: true } },
      bracketNode: { select: { round: { select: { stageId: true } } } },
      _count: { select: { actions: true, results: true } },
    },
  });
  if (records.length !== ids.length)
    throw new AppError('A selected match does not exist in this tournament.', 404);
  const versions = new Map(action.matches.map((match) => [match.id, match.baseVersion]));
  for (const record of records) {
    if (record.version !== versions.get(record.id))
      throw new AppError(
        `Match ${record.matchNumber} changed. Reload and review the selection.`,
        409,
      );
    if (
      record.status !== 'SCHEDULED' ||
      record.startedAt ||
      record.submittedAt ||
      record.completedAt
    )
      throw new AppError(
        `Match ${record.matchNumber} has started or is closed. Bulk editing requires unstarted scheduled matches.`,
        409,
      );
  }

  const target = action.stageId
    ? await tx.tournamentStage.findFirst({
        where: { id: action.stageId, tournamentId },
        include: { mappool: { include: { publishedRevision: { include: { slots: true } } } } },
      })
    : null;
  let targetRules: ReturnType<typeof inheritedRules> | null = null;
  if (action.stageId) {
    if (!target) throw new AppError('The target stage does not exist in this tournament.', 404);
    if (target.archivedAt || target.kind === 'QUALIFIERS')
      throw new AppError('Choose an active elimination or custom stage. Qualifiers use sessions.');
    if (target.mappool?.state !== 'PUBLISHED' || !target.mappool.publishedRevision?.slots.length)
      throw new AppError(`${target.name} needs a published mappool before assigning matches.`);
    const settings = await tx.tournamentSettings.findUniqueOrThrow({ where: { tournamentId } });
    const tournament = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    targetRules = inheritedRules(
      target.matchRules || settings.matchRules,
      settings.gameplayScoring,
      tournament.gameMode,
    );
    const problems = stagePoolProblems(
      target.kind,
      targetRules,
      target.mappool.publishedRevision.slots,
    );
    if (problems.length) throw new AppError(`${target.name}: ${problems.join(' ')}`);
    for (const record of records) {
      if (record.bracketNode && record.bracketNode.round.stageId !== target.id)
        throw new AppError(
          `Match ${record.matchNumber} is linked to a bracket round in another stage. Change the bracket round instead.`,
          409,
        );
      if (record.stageId === target.id) continue;
      if (
        record._count.actions ||
        record._count.results ||
        record.scoreA ||
        record.scoreB ||
        record.rollA !== null ||
        record.rollB !== null
      )
        throw new AppError(
          `Match ${record.matchNumber} already has referee actions or results. Its stage and snapshots must be preserved.`,
          409,
        );
      const roster = Object.values(record.participants as unknown as MatchParticipants);
      if (
        roster.length !== 2 ||
        roster.some(
          (team) =>
            !team.id ||
            team.members.filter((member) => !member.substitute).length < targetRules!.teamSize ||
            (team.format === 'INDIVIDUAL' && targetRules!.teamSize !== 1),
        )
      )
        throw new AppError(
          `Match ${record.matchNumber} needs two resolved rosters with ${targetRules.teamSize} starting player(s) per side.`,
        );
      const approved = await tx.team.count({
        where: { tournamentId, id: { in: roster.map((team) => team.id!) }, status: 'APPROVED' },
      });
      if (approved !== 2)
        throw new AppError(`Match ${record.matchNumber} needs two approved entrants.`);
      const pathId = sourceObject(record.source).competitionPathId;
      if (
        typeof pathId === 'string' &&
        pathId &&
        !(await tx.bracket.findFirst({
          where: { id: pathId, tournamentId, rounds: { some: { stageId: target.id } } },
          select: { id: true },
        }))
      )
        throw new AppError(
          `Match ${record.matchNumber}'s competition path does not use the selected stage.`,
          409,
        );
    }
  }

  const plans = records.map((record) => {
    const patch = rowPatches.get(record.id)!;
    if (action.shiftMinutes !== undefined && !record.scheduledAt)
      throw new AppError(`Match ${record.matchNumber} has no start time to shift.`, 409);
    const scheduledAt =
      patch.scheduledAt !== undefined
        ? patch.scheduledAt
          ? new Date(patch.scheduledAt)
          : null
        : action.shiftMinutes !== undefined
          ? new Date(record.scheduledAt!.getTime() + action.shiftMinutes * 60_000)
          : record.scheduledAt;
    return {
      record,
      patch,
      scheduledAt,
      refereeIds: patch.refereeIds ?? record.assignments.map((assignment) => assignment.userId),
      entrants: entrants(record.participants, [record.teamAId, record.teamBId]),
      source:
        action.streamer !== undefined || action.commentators !== undefined
          ? {
              ...sourceObject(record.source),
              ...(action.streamer !== undefined ? { streamer: action.streamer } : {}),
              ...(action.commentators !== undefined ? { commentators: action.commentators } : {}),
            }
          : undefined,
    };
  });
  const refereeIds = [...new Set(plans.flatMap((plan) => plan.refereeIds))];
  if (
    refereeIds.length &&
    (await tx.user.count({
      where: { id: { in: refereeIds }, AND: [eligibleRefereeFor(tournamentId)] },
    })) !== refereeIds.length
  )
    throw new AppError(
      'Every assigned referee needs match access and operational permissions in this tournament.',
    );

  const dates = [
    ...new Set(plans.flatMap((plan) => (plan.scheduledAt ? [plan.scheduledAt.toISOString()] : []))),
  ].map((date) => new Date(date));
  // Fetch candidates once, then correlate every resource against its own planned instant.
  const outsideMatches = dates.length
    ? await tx.match.findMany({
        where: {
          tournamentId,
          id: { notIn: ids },
          scheduledAt: { in: dates },
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
        select: {
          matchNumber: true,
          scheduledAt: true,
          participants: true,
          teamAId: true,
          teamBId: true,
          assignments: { select: { userId: true } },
        },
      })
    : [];
  const outsideLobbies = dates.length
    ? await tx.qualifierLobby.findMany({
        where: {
          tournamentId,
          scheduledAt: { in: dates },
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
        select: {
          code: true,
          scheduledAt: true,
          participants: true,
          assignments: { select: { userId: true } },
        },
      })
    : [];
  for (const [index, plan] of plans.entries()) {
    if (!plan.scheduledAt) continue;
    const instant = plan.scheduledAt.getTime();
    const refs = new Set(plan.refereeIds);
    for (const other of plans
      .slice(0, index)
      .filter((other) => other.scheduledAt?.getTime() === instant)) {
      if (other.refereeIds.some((ref) => refs.has(ref)))
        throw new AppError(
          `Matches ${plan.record.matchNumber} and ${other.record.matchNumber} assign a referee at the same time.`,
          409,
        );
      if (sharesEntrants(plan.entrants, other.entrants))
        throw new AppError(
          `Matches ${plan.record.matchNumber} and ${other.record.matchNumber} assign a participant at the same time.`,
          409,
        );
    }
    for (const other of outsideMatches.filter(
      (other) => other.scheduledAt?.getTime() === instant,
    )) {
      if (other.assignments.some((ref) => refs.has(ref.userId)))
        throw new AppError(
          `Match ${plan.record.matchNumber}: a referee already has Match ${other.matchNumber} at this time.`,
          409,
        );
      if (
        sharesEntrants(plan.entrants, entrants(other.participants, [other.teamAId, other.teamBId]))
      )
        throw new AppError(
          `Match ${plan.record.matchNumber}: a participant already has Match ${other.matchNumber} at this time.`,
          409,
        );
    }
    for (const other of outsideLobbies.filter(
      (other) => other.scheduledAt?.getTime() === instant,
    )) {
      if (other.assignments.some((ref) => refs.has(ref.userId)))
        throw new AppError(
          `Match ${plan.record.matchNumber}: a referee already has qualifier lobby ${other.code} at this time.`,
          409,
        );
      if (sharesEntrants(plan.entrants, entrants(other.participants)))
        throw new AppError(
          `Match ${plan.record.matchNumber}: a participant already has qualifier lobby ${other.code} at this time.`,
          409,
        );
    }
  }

  for (const plan of plans) {
    const { record } = plan;
    const changeStage = !!target && target.id !== record.stageId;
    const updated = await tx.match.updateMany({
      where: {
        id: record.id,
        tournamentId,
        version: record.version,
        status: 'SCHEDULED',
        startedAt: null,
      },
      data: {
        ...(plan.patch.scheduledAt !== undefined || action.shiftMinutes !== undefined
          ? { scheduledAt: plan.scheduledAt }
          : {}),
        ...(action.notes !== undefined ? { notes: action.notes } : {}),
        ...(action.published !== undefined ? { published: action.published } : {}),
        ...(plan.source !== undefined ? { source: json(plan.source) } : {}),
        ...(changeStage
          ? {
              stageId: target!.id,
              poolRevisionId: target!.mappool!.publishedRevision!.id,
              rules: json(targetRules),
            }
          : {}),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1)
      throw new AppError(`Match ${record.matchNumber} changed during this update. Reload.`, 409);
    if (plan.patch.refereeIds !== undefined) {
      await tx.matchAssignment.deleteMany({ where: { matchId: record.id } });
      if (plan.refereeIds.length)
        await tx.matchAssignment.createMany({
          data: plan.refereeIds.map((userId, index) => ({
            matchId: record.id,
            userId,
            primary: index === 0,
          })),
        });
    }
    await tx.matchEvent.create({
      data: {
        matchId: record.id,
        version: record.version + 1,
        actorId: actor.id,
        kind: parsed.type === 'matches.batch.schedule' ? 'batch.schedule' : 'bulk.schedule',
        data: json({
          before: {
            scheduledAt: record.scheduledAt,
            refereeIds: record.assignments.map((ref) => ref.userId),
            stageId: record.stageId,
            poolRevisionId: record.poolRevisionId,
            rules: record.rules,
            source: record.source,
            notes: record.notes,
            published: record.published,
          },
          after: {
            scheduledAt: plan.scheduledAt,
            refereeIds: plan.refereeIds,
            stageId: changeStage ? target!.id : record.stageId,
            poolRevisionId: changeStage
              ? target!.mappool!.publishedRevision!.id
              : record.poolRevisionId,
            rules: changeStage ? targetRules : record.rules,
            source: plan.source ?? record.source,
            notes: action.notes ?? record.notes,
            published: action.published ?? record.published,
          },
        }),
      },
    });
  }
  return { updated: plans.length };
}
