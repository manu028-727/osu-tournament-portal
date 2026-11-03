import { randomBytes } from 'node:crypto';
import { Prisma } from '@/generated/prisma/client';
import { recalculateCompetition } from './competition-engine';
import { persistRecalculation } from './competition-service';
import { orderedCompetitionStages } from './competition-stages';
import { allNodes } from './competition-queries';
import type { CompetitionNode } from './competition-types';
import {
  avoidRematches,
  drawGroups,
  reseededPairs,
  resolveEntries,
  sharedGroup,
  type AdvancementIssue,
  type AdvancementSeat,
  type DrawnGroup,
  type SourceEntrant,
} from './format-advancement';
import { lanePairs, phaseGraph } from './format-graph';
import {
  competitionNodeStarted,
  phaseSources,
  type AdvancementInput,
  type EntriesAssignment,
} from './format-guards';
import type { FormatPhase, FormatPlan } from './format-plan';
import { formatPlanToken, loadFormatPlan } from './format-plan-service';
import { sourceLabels } from './format-preview';
import { reserveBracketMatchNumbers } from './match-numbering';
import { AppError, assertPermission, type Actor } from './permissions';
import { qualifierSourceHash } from './qualifier-seeding';
import { scopedDb } from './scoped-db';

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
type GraphPhase = Extract<
  FormatPhase,
  { kind: 'GROUPS' | 'SINGLE_ELIMINATION' | 'DOUBLE_ELIMINATION' }
>;
const isGraphPhase = (phase: FormatPhase): phase is GraphPhase =>
  phase.kind === 'GROUPS' ||
  phase.kind === 'SINGLE_ELIMINATION' ||
  phase.kind === 'DOUBLE_ELIMINATION';

// Which placements leave each group for a later phase, so standings can show who goes on.
function advancingByGroup(plan: FormatPlan, phase: Extract<FormatPhase, { kind: 'GROUPS' }>) {
  const advancing: Record<string, number[]> = {};
  let group = 0;
  for (const tier of phase.tiers)
    for (let index = 0; index < tier.groupCount; index++) {
      group++;
      advancing[group] = plan.phases.flatMap((other) =>
        'entries' in other
          ? other.entries.flatMap((item) =>
              item.source.kind === 'PLACEMENT' &&
              item.source.phase === phase.key &&
              (!item.source.tier || item.source.tier === tier.key)
                ? [item.source.placement]
                : [],
            )
          : [],
      );
    }
  return advancing;
}

// Creates every phase's bracket at once, so match numbers run through the whole tournament
// in phase order before anyone has qualified. Numbers are permanent, hence an explicit step.
export async function lockFormat(
  transaction: Prisma.TransactionClient,
  actor: Actor,
  tournamentId: string,
  input: { baseToken: string },
) {
  assertPermission(actor, 'matches.manage');
  const tx = scopedDb(transaction, tournamentId);
  const current = await loadFormatPlan(transaction, tournamentId);
  if (current.token !== input.baseToken)
    throw new AppError('The tournament format changed. Reload and review before saving.', 409);
  if (current.locked) throw new AppError('This format is already locked.', 409);
  if (!current.plan) throw new AppError('Plan a valid format before locking it.', 409);
  const stages = orderedCompetitionStages(
    await tx.tournamentStage.findMany({
      where: { tournamentId, archivedAt: null, kind: { notIn: ['QUALIFIERS', 'QUALIFIER'] } },
    }),
  );
  const stageIds = stages.map((stage) => stage.id);
  // Stage reads above, then the counter, matching the established bracket lock order.
  await transaction.$queryRaw`
    SELECT "matchNumberSequence" FROM "Tournament" WHERE "id" = ${tournamentId} FOR UPDATE
  `;
  let matches = 0;
  for (const row of current.rows) {
    const phase = current.plan.phases.find((item) => item.key === row.key)!;
    if (!isGraphPhase(phase)) {
      await tx.tournamentPhase.update({
        where: { id: row.id },
        data: { state: 'LOCKED', version: { increment: 1 } },
      });
      continue;
    }
    const graph = await phaseGraph(current.plan.phases, phase, stageIds);
    for (const round of graph.rounds)
      if (!stageIds.includes(round.stageId))
        throw new AppError('{0} uses a stage that no longer exists.', 409, [phase.name]);
    const labels = sourceLabels(current.plan.phases, phase);
    const bracket = await tx.bracket.create({
      data: {
        tournamentId,
        generationKey: `phase-${row.id}`,
        name: phase.name,
        format: phase.kind === 'GROUPS' ? 'GROUPS' : phase.kind,
        seedOrder: [],
        config: json({
          type: 'competition.create',
          name: phase.name,
          format: phase.kind === 'GROUPS' ? 'GROUPS' : phase.kind,
          stageId: phase.stageId,
          teamIds: [],
          generationKey: `phase-${row.id}`,
          thirdPlace: phase.kind === 'SINGLE_ELIMINATION' && phase.thirdPlace,
          grandFinalReset: phase.kind === 'DOUBLE_ELIMINATION' && phase.grandFinalReset,
          byePlacement: 'TOP_SEEDS',
          groupCount:
            phase.kind === 'GROUPS'
              ? phase.tiers.reduce((total, tier) => total + tier.groupCount, 0)
              : 1,
          advancePerGroup: 2,
          roundStages: Object.fromEntries(graph.rounds.map((r) => [r.key, r.stageId])),
          manualMatches: false,
          phaseKey: phase.key,
          ...(phase.kind === 'GROUPS'
            ? {
                phaseRanking: {
                  tiebreakers: phase.tiebreakers,
                  forfeitMapDifference: phase.forfeitMapDifference,
                },
                phaseAdvancing: advancingByGroup(current.plan, phase),
              }
            : {}),
        }),
      },
    });
    const roundIds = new Map<string, string>();
    const nodeIds = new Map<string, string>();
    for (const round of graph.rounds)
      roundIds.set(
        round.key,
        (await tx.bracketRound.create({ data: { ...round, tournamentId, bracketId: bracket.id } }))
          .id,
      );
    for (const node of graph.nodes)
      nodeIds.set(
        node.key,
        (
          await tx.bracketNode.create({
            data: {
              tournamentId,
              bracketId: bracket.id,
              roundId: roundIds.get(node.roundKey)!,
              key: node.key,
              position: node.position,
            },
          })
        ).id,
      );
    for (const node of graph.nodes)
      for (const { sourceKey, ...slot } of node.slots) {
        const seed = slot.entryRef?.match(/^seed:(\d+)$/);
        await tx.bracketSlot.create({
          data: {
            ...slot,
            tournamentId,
            nodeId: nodeIds.get(node.key)!,
            sourceNodeId: sourceKey ? nodeIds.get(sourceKey)! : null,
            entryLabel: seed ? (labels.get(Number(seed[1])) ?? null) : null,
          },
        });
      }
    const nodes = recalculateCompetition(await allNodes(transaction, tournamentId)).filter(
      (node) => node.bracketId === bracket.id,
    );
    await reserveBracketMatchNumbers(
      transaction,
      tournamentId,
      nodes,
      graph.rounds.map((round) => ({
        ...round,
        id: roundIds.get(round.key)!,
        stagePosition: stageIds.indexOf(round.stageId),
      })),
    );
    await tx.tournamentPhase.update({
      where: { id: row.id },
      data: { state: 'LOCKED', bracketId: bracket.id, version: { increment: 1 } },
    });
    matches += graph.nodes.length;
  }
  return { phases: current.rows.length, matches };
}

// Undoes a lock while nothing has been played. Reserved numbers are only reused when the
// tournament has no other matches, the same exception as deleting a whole bracket.
export async function unlockFormat(
  transaction: Prisma.TransactionClient,
  actor: Actor,
  tournamentId: string,
  input: { baseToken: string },
) {
  assertPermission(actor, 'matches.manage');
  assertPermission(actor, 'matches.delete');
  const tx = scopedDb(transaction, tournamentId);
  const current = await loadFormatPlan(transaction, tournamentId);
  if (current.token !== input.baseToken)
    throw new AppError('The tournament format changed. Reload and review before saving.', 409);
  const bracketIds = current.rows.flatMap((row) => {
    const { bracketId } = row as { bracketId?: string | null };
    return bracketId ? [bracketId] : [];
  });
  const nodes = (await allNodes(transaction, tournamentId)).filter((node) =>
    bracketIds.includes(node.bracketId),
  );
  if (nodes.some(competitionNodeStarted))
    throw new AppError(
      'Matches in this format have started, so it can no longer be unlocked.',
      409,
    );
  const consumers = await tx.bracket.findMany({ where: { tournamentId } });
  if (
    consumers.some(
      (bracket) =>
        !bracketIds.includes(bracket.id) &&
        (bracket.config as { sourceBracketId?: string }).sourceBracketId &&
        bracketIds.includes((bracket.config as { sourceBracketId: string }).sourceBracketId),
    )
  )
    throw new AppError('Delete dependent brackets before unlocking this format.', 409);
  const matchIds = nodes.flatMap((node) => (node.matchId ? [node.matchId] : []));
  await tx.tournamentPhase.updateMany({
    where: { tournamentId },
    data: { state: 'PLANNED', bracketId: null, version: { increment: 1 } },
  });
  await tx.bracketSlot.deleteMany({
    where: { tournamentId, nodeId: { in: nodes.map((node) => node.id) } },
  });
  await tx.bracketNode.deleteMany({ where: { tournamentId, bracketId: { in: bracketIds } } });
  await tx.bracketEntry.deleteMany({ where: { tournamentId, bracketId: { in: bracketIds } } });
  await tx.bracketRound.deleteMany({ where: { tournamentId, bracketId: { in: bracketIds } } });
  await tx.bracket.deleteMany({ where: { tournamentId, id: { in: bracketIds } } });
  await tx.match.deleteMany({ where: { tournamentId, id: { in: matchIds } } });
  const remaining =
    (await tx.match.count({ where: { tournamentId } })) +
    (await tx.bracketNode.count({ where: { tournamentId, matchNumber: { not: null } } }));
  if (!remaining)
    await tx.tournament.update({ where: { id: tournamentId }, data: { matchNumberSequence: 0 } });
  return { unlocked: true };
}

export type AdvancementRequest = AdvancementInput & {
  phaseKey: string;
  randomSeed?: string;
  manual?: Record<string, string[][]>;
  overrides?: Record<string, string | null>;
  reason?: string;
};

// A staff decision can settle these, and the reason is kept with the advancement.
const OVERRIDABLE = new Set(['UNRESOLVED_TIE', 'REMATCH_INFEASIBLE', 'INACTIVE_ENTRANT']);

async function planAdvancement(
  transaction: Prisma.TransactionClient,
  tournamentId: string,
  request: AdvancementRequest,
) {
  const tx = scopedDb(transaction, tournamentId);
  const { plan } = await loadFormatPlan(transaction, tournamentId);
  if (!plan) throw new AppError('Plan a valid format before advancing entrants.', 409);
  const phase = plan.phases.find((item) => item.key === request.phaseKey);
  if (!phase || !isGraphPhase(phase)) throw new AppError('Choose a phase with matches.', 400);
  const row = await tx.tournamentPhase.findFirst({
    where: { tournamentId, key: phase.key },
    include: { bracket: { include: { entries: true, rounds: true } } },
  });
  if (!row?.bracket) throw new AppError('Lock the format before advancing entrants.', 409);
  const before = await allNodes(transaction, tournamentId);
  if (before.some((node) => node.bracketId === row.bracketId && competitionNodeStarted(node)))
    throw new AppError('This phase has started, so its entrants can no longer change.', 409);
  const loaded = await phaseSources(transaction, tournamentId, plan.phases, phase, request);
  const resolved = resolveEntries(phase, loaded.sources);
  const issues: AdvancementIssue[] = [...resolved.issues];
  let seats: AdvancementSeat[] = resolved.seats;
  let groups: DrawnGroup[] | undefined;
  let randomSeed = request.randomSeed;
  const changes: unknown[] = [];
  const overrides = request.overrides ?? {};
  if (Object.keys(overrides).length) {
    seats = seats.map((seat) =>
      String(seat.seed) in overrides
        ? { ...seat, teamId: overrides[seat.seed], detail: `${seat.detail} (set by organizer)` }
        : seat,
    );
    if (
      new Set(seats.flatMap((s) => (s.teamId ? [s.teamId] : []))).size !==
      seats.filter((s) => s.teamId).length
    )
      issues.push({
        code: 'DUPLICATE_ENTRANT',
        severity: 'ERROR',
        message: 'An entrant cannot hold two seats.',
      });
  }
  if (phase.kind === 'GROUPS') {
    if (phase.draw === 'RANDOM_BY_POT' && !randomSeed) randomSeed = randomBytes(12).toString('hex');
    const qualifierValues = new Map(
      Object.values(loaded.sources.qualifiers ?? {})
        .flat()
        .map((entrant) => [entrant.teamId, entrant.value ?? null]),
    );
    const entrants: SourceEntrant[] = seats.flatMap((seat) =>
      seat.teamId
        ? [
            {
              teamId: seat.teamId,
              seed: seat.seed,
              value: qualifierValues.get(seat.teamId) ?? null,
            },
          ]
        : [],
    );
    if (!issues.some((issue) => issue.severity === 'ERROR')) {
      const drawn = drawGroups(phase, entrants, { randomSeed, manual: request.manual });
      groups = drawn.groups;
      issues.push(...drawn.issues);
    }
  } else if (phase.rematch === 'AVOID_SAME_GROUP' && !Object.keys(overrides).length) {
    const drawn = Object.values(loaded.sources.groups ?? {}).flatMap((source) => source.drawn);
    const met = sharedGroup(drawn);
    const lanes =
      phase.kind === 'DOUBLE_ELIMINATION'
        ? [
            { lane: 'WINNERS', size: phase.winners.size, pairing: phase.winners.pairing },
            ...(phase.losers
              ? [{ lane: 'LOSERS', size: phase.losers.size, pairing: phase.losers.pairing }]
              : []),
          ]
        : [{ lane: 'WINNERS', size: phase.size, pairing: phase.pairing }];
    for (const lane of lanes) {
      const own = seats.filter((seat) => seat.lane === lane.lane);
      const solved = avoidRematches(
        lanePairs(
          lane.size,
          lane.pairing,
          own.map((seat) => seat.seed),
        ),
        own,
        met,
      );
      issues.push(...solved.issues);
      changes.push(...solved.changes);
      seats = [...seats.filter((seat) => seat.lane !== lane.lane), ...solved.seats].sort(
        (a, b) => a.seed - b.seed,
      );
    }
  }
  const effective = Object.keys(overrides).length
    ? issues.map((issue) =>
        OVERRIDABLE.has(issue.code) ? { ...issue, severity: 'WARNING' as const } : issue,
      )
    : issues;
  const assignment = {
    ...(request.explicit ? { explicit: request.explicit } : {}),
    ...(request.reviewedOrder ? { reviewedOrder: request.reviewedOrder } : {}),
    ...(randomSeed ? { randomSeed } : {}),
    ...(Object.keys(overrides).length ? { overrides } : {}),
    ...(changes.length ? { changes } : {}),
    ...(groups ? { groups } : { seats }),
  };
  const revision =
    ((
      await tx.phaseAdvancement.findFirst({
        where: { tournamentId, phaseId: row.id },
        orderBy: { revision: 'desc' },
      })
    )?.revision ?? 0) + 1;
  return {
    plan,
    phase,
    row,
    before,
    loaded,
    seats,
    groups,
    randomSeed,
    issues: effective,
    changes,
    assignment,
    revision,
    reviewHash: qualifierSourceHash({
      version: row.version,
      bracketVersion: row.bracket.version,
      sourceHash: loaded.sourceHash,
      assignment,
    }),
  };
}

export async function advancementPreview(
  transaction: Prisma.TransactionClient,
  actor: Actor,
  tournamentId: string,
  request: AdvancementRequest,
) {
  assertPermission(actor, 'matches.manage');
  const planned = await planAdvancement(transaction, tournamentId, request);
  const tx = scopedDb(transaction, tournamentId);
  const candidates = await tx.team.findMany({
    where: { tournamentId, status: 'APPROVED', supersededAt: null },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return {
    phaseKey: planned.phase.key,
    kind: planned.phase.kind,
    seats: planned.groups ? [] : planned.seats,
    groups: planned.groups ?? [],
    randomSeed: planned.randomSeed ?? null,
    // Messages name phases by their organizer-chosen name, not their internal key.
    issues: planned.issues.map((issue) => ({
      ...issue,
      values: issue.values?.map(
        (value) => planned.plan.phases.find((phase) => phase.key === value)?.name ?? value,
      ),
    })),
    changes: planned.changes,
    candidates,
    reviewHash: planned.reviewHash,
  };
}

// Group labels only exist after a draw, so later slots can now say exactly who they await.
async function relabelConsumers(
  transaction: Prisma.TransactionClient,
  tournamentId: string,
  plan: FormatPlan,
  phaseKey: string,
  groups: readonly DrawnGroup[],
) {
  const tx = scopedDb(transaction, tournamentId);
  for (const consumer of plan.phases) {
    if (!isGraphPhase(consumer) || consumer.kind === 'GROUPS') continue;
    const row = await tx.tournamentPhase.findFirst({
      where: { tournamentId, key: consumer.key },
    });
    if (!row?.bracketId) continue;
    for (const item of consumer.entries) {
      const from = item.source;
      if (
        from.kind !== 'PLACEMENT' ||
        from.phase !== phaseKey ||
        from.orderWithin !== 'GROUP_LABEL'
      )
        continue;
      const inTier = groups
        .filter((group) => !from.tier || group.tier === from.tier)
        .sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));
      for (const [index, group] of inTier.entries())
        await tx.bracketSlot.updateMany({
          where: {
            tournamentId,
            entryRef: `seed:${item.seedFrom + index}`,
            node: { bracketId: row.bracketId },
          },
          data: { entryLabel: `${group.label} #${from.placement}` },
        });
    }
  }
}

export async function applyAdvancement(
  transaction: Prisma.TransactionClient,
  actor: Actor,
  tournamentId: string,
  request: AdvancementRequest & { reviewHash: string },
) {
  assertPermission(actor, 'matches.manage');
  const planned = await planAdvancement(transaction, tournamentId, request);
  const { phase, row, before, seats, groups, plan } = planned;
  if (planned.reviewHash !== request.reviewHash)
    throw new AppError(
      'Results or entrants changed. Preview this phase again before applying.',
      409,
    );
  const blocking = planned.issues.find((issue) => issue.severity === 'ERROR');
  if (blocking) throw new AppError(blocking.message, 409, blocking.values);
  if (Object.keys(request.overrides ?? {}).length && (request.reason ?? '').trim().length < 3)
    throw new AppError('Explain why these seats were set by hand.');
  const tx = scopedDb(transaction, tournamentId);
  const bracketId = row.bracket!.id;

  const groupSeat = new Map<string, string>(
    (groups ?? []).flatMap((group) =>
      group.teams.map((team) => [`group:${group.group}:seat:${team.seat}`, team.teamId] as const),
    ),
  );
  const seatTeam = new Map(seats.map((seat) => [seat.seed, seat.teamId]));
  const slotTeam = (entryRef: string | null | undefined) => {
    if (entryRef === 'bye') return { teamId: null, resolved: true };
    const seed = entryRef?.match(/^seed:(\d+)$/);
    if (seed) return { teamId: seatTeam.get(Number(seed[1])) ?? null, resolved: true };
    const team = entryRef ? groupSeat.get(entryRef) : undefined;
    return team ? { teamId: team, resolved: true } : null;
  };
  const slots: Record<string, string | null> = {};
  const edited: CompetitionNode[] = before.map((node) =>
    node.bracketId !== bracketId
      ? node
      : {
          ...node,
          slots: node.slots.map((slot) => {
            const bound = slotTeam(slot.entryRef);
            if (!bound) return slot;
            slots[`${node.key}:${slot.side}`] = bound.teamId;
            return { ...slot, ...bound };
          }),
        },
  );

  await tx.bracketEntry.deleteMany({ where: { tournamentId, bracketId } });
  const entries = groups
    ? groups.flatMap((group) =>
        group.teams.map((team) => ({
          tournamentId,
          bracketId,
          teamId: team.teamId,
          seed: team.seed,
          groupIndex: group.group,
          pot: team.pot,
          tier: group.tier,
          provenance: group.label,
        })),
      )
    : seats.flatMap((seat) =>
        seat.teamId
          ? [
              {
                tournamentId,
                bracketId,
                teamId: seat.teamId,
                seed: seat.seed,
                entryLane: seat.lane,
                // Starting in Losers means there is no second life to lose.
                lossesAllowed: seat.lane === 'LOSERS' ? 1 : null,
                provenance: seat.detail,
              },
            ]
          : [],
      );
  await tx.bracketEntry.createMany({ data: entries });

  const teamIds = [...entries].sort((a, b) => a.seed - b.seed).map((entry) => entry.teamId);
  await tx.bracket.update({
    where: { id: bracketId },
    data: {
      seedOrder: teamIds,
      version: { increment: 1 },
      config: json({
        ...(row.bracket!.config as Record<string, unknown>),
        teamIds,
        sourceStandingIds: planned.loaded.standingIds,
        sourceBracketIds: planned.loaded.bracketIds,
      }),
    },
  });
  if (groups) {
    for (const group of groups)
      for (const round of row.bracket!.rounds.filter(
        (item) => item.lane === `GROUP_${group.group}`,
      ))
        await tx.bracketRound.update({
          where: { id: round.id },
          data: { name: `${group.label} ${round.key.split('-r')[1]}` },
        });
    await relabelConsumers(transaction, tournamentId, plan, phase.key, groups);
  }
  await persistRecalculation(
    transaction,
    tournamentId,
    before,
    recalculateCompetition(edited),
    actor.id,
    true,
  );
  await tx.phaseAdvancement.create({
    data: {
      tournamentId,
      phaseId: row.id,
      revision: planned.revision,
      kind: 'ENTRIES',
      sourceHash: planned.loaded.sourceHash,
      assignment: json({ ...planned.assignment, slots } satisfies EntriesAssignment),
      reason: request.reason?.trim() ?? '',
      actorId: actor.id,
    },
  });
  await tx.tournamentPhase.update({
    where: { id: row.id },
    data: { state: 'ACTIVE', version: { increment: 1 } },
  });
  return { phaseKey: phase.key, revision: planned.revision, entrants: entries.length };
}

// Fills the next waiting round from the survivors of the one just finished.
export async function reseedPhaseRound(
  transaction: Prisma.TransactionClient,
  actor: Actor,
  tournamentId: string,
  input: { phaseKey: string },
) {
  assertPermission(actor, 'matches.manage');
  const tx = scopedDb(transaction, tournamentId);
  const { plan } = await loadFormatPlan(transaction, tournamentId);
  const phase = plan?.phases.find((item) => item.key === input.phaseKey);
  if (phase?.kind !== 'SINGLE_ELIMINATION' || phase.reseed !== 'EACH_ROUND')
    throw new AppError('This phase does not reseed between rounds.', 400);
  const row = await tx.tournamentPhase.findFirst({
    where: { tournamentId, key: phase.key },
    include: { bracket: { include: { entries: true, rounds: true } } },
  });
  if (!row?.bracket) throw new AppError('Lock the format before advancing entrants.', 409);
  const before = await allNodes(transaction, tournamentId);
  const own = before.filter((node) => node.bracketId === row.bracket!.id);
  const roundOf = (node: CompetitionNode) =>
    row.bracket!.rounds.find((round) => round.id === node.roundId)!;
  const waiting = own
    .filter((node) =>
      node.slots.some((slot) => slot.entryRef?.startsWith('reseed:') && !slot.resolved),
    )
    .sort((a, b) => roundOf(a).position - roundOf(b).position || a.position - b.position);
  if (!waiting.length) throw new AppError('Every round has already been seeded.', 409);
  const target = roundOf(waiting[0]);
  const number = Number(target.key.split('-r')[1]);
  const previous = own.filter((node) => roundOf(node).key === `g1-r${number - 1}`);
  if (previous.some((node) => node.match?.status !== 'COMPLETED' && node.state !== 'BYE'))
    throw new AppError('Complete the previous round before reseeding the next one.', 409);
  const survivors = previous.flatMap((node) => {
    const winner =
      node.state === 'BYE'
        ? node.slots.find((slot) => slot.teamId)?.teamId
        : node.match?.winnerSide === 'A'
          ? node.match.teamAId
          : node.match?.teamBId;
    const entry = row.bracket!.entries.find((item) => item.teamId === winner);
    return winner && entry ? [{ teamId: winner, seed: entry.seed }] : [];
  });
  const pairs = reseededPairs(survivors);
  const inRound = own
    .filter((node) => node.roundId === target.id)
    .sort((a, b) => a.position - b.position);
  if (pairs.length !== inRound.length)
    throw new AppError('The surviving entrants do not fit the next round.', 409);
  const slots: Record<string, string | null> = {};
  const edited = before.map((node) => {
    const index = inRound.findIndex((item) => item.id === node.id);
    if (index < 0) return node;
    return {
      ...node,
      slots: node.slots.map((slot, side) => {
        slots[`${node.key}:${slot.side}`] = pairs[index][side];
        return { ...slot, teamId: pairs[index][side], resolved: true };
      }),
    };
  });
  await persistRecalculation(
    transaction,
    tournamentId,
    before,
    recalculateCompetition(edited),
    actor.id,
    true,
  );
  const revision =
    ((
      await tx.phaseAdvancement.findFirst({
        where: { tournamentId, phaseId: row.id },
        orderBy: { revision: 'desc' },
      })
    )?.revision ?? 0) + 1;
  await tx.phaseAdvancement.create({
    data: {
      tournamentId,
      phaseId: row.id,
      revision,
      kind: 'RESEED',
      sourceHash: qualifierSourceHash(previous.map((node) => [node.id, node.match?.winnerSide])),
      assignment: json({ round: target.key, pairs, slots }),
      actorId: actor.id,
    },
  });
  return { round: target.key, pairs };
}

export async function formatStatus(transaction: Prisma.TransactionClient, tournamentId: string) {
  const tx = scopedDb(transaction, tournamentId);
  const current = await loadFormatPlan(transaction, tournamentId);
  if (!current.locked || !current.plan) return null;
  const nodes = recalculateCompetition(await allNodes(transaction, tournamentId));
  const advancements = await tx.phaseAdvancement.findMany({
    where: { tournamentId, kind: 'ENTRIES' },
    orderBy: { revision: 'desc' },
  });
  const phases = [];
  for (const row of current.rows) {
    const phase = current.plan.phases.find((item) => item.key === row.key)!;
    const bracketId = (row as { bracketId?: string | null }).bracketId ?? null;
    const own = nodes.filter((node) => node.bracketId === bracketId);
    const latest = advancements.find((item) => item.phaseId === (row as { id: string }).id);
    let stale = false;
    if (latest && 'entries' in phase) {
      try {
        const sources = await phaseSources(
          transaction,
          tournamentId,
          current.plan.phases,
          phase,
          latest.assignment as EntriesAssignment,
        );
        stale = sources.sourceHash !== latest.sourceHash;
      } catch {
        stale = true;
      }
    }
    phases.push({
      key: row.key,
      name: row.name,
      kind: row.kind,
      state: row.state,
      bracketId,
      matches: own.length,
      played: own.filter((node) => node.match?.status === 'COMPLETED').length,
      started: own.some(competitionNodeStarted),
      revision: latest?.revision ?? null,
      stale,
      reseeds: phase.kind === 'SINGLE_ELIMINATION' && phase.reseed === 'EACH_ROUND',
      draw: phase.kind === 'GROUPS' ? phase.draw : null,
      tiers:
        phase.kind === 'GROUPS'
          ? phase.tiers.map((tier) => ({
              key: tier.key,
              name: tier.name,
              groupCount: tier.groupCount,
              groupSize: tier.groupSize,
            }))
          : [],
      explicit:
        'entries' in phase
          ? phase.entries.flatMap((item) =>
              item.source.kind === 'EXPLICIT'
                ? [{ phase: item.source.phase, count: item.source.count }]
                : [],
            )
          : [],
    });
  }
  return { phases, token: formatPlanToken(current.rows) };
}

// Hashes name database identities, so an imported tournament must re-witness its sources.
export async function rebindImportedAdvancements(
  transaction: Prisma.TransactionClient,
  tournamentId: string,
) {
  const tx = scopedDb(transaction, tournamentId);
  const { plan, rows } = await loadFormatPlan(transaction, tournamentId);
  if (!plan) return;
  for (const row of rows) {
    const phase = plan.phases.find((item) => item.key === row.key);
    if (!phase || !('entries' in phase)) continue;
    const latest = await tx.phaseAdvancement.findFirst({
      where: { tournamentId, phaseId: (row as { id: string }).id, kind: 'ENTRIES' },
      orderBy: { revision: 'desc' },
    });
    if (!latest) continue;
    const { sourceHash } = await phaseSources(
      transaction,
      tournamentId,
      plan.phases,
      phase,
      latest.assignment as EntriesAssignment,
    );
    await tx.phaseAdvancement.update({ where: { id: latest.id }, data: { sourceHash } });
  }
}
