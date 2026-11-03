import { Prisma } from '@/generated/prisma/client';
import { assertNoFormationFrom } from './team-formation-guard';
import { AppError, assertPermission, type Actor } from './permissions';
import { canonicalQualifierJson, resolveQualifierTies } from './qualifier-seeding';
import type { QualifierStandingSnapshot } from './qualifier-standings-contract';
import { qualifierStandingSnapshot } from './qualifier-standings-contract';
import {
  loadQualifierCalculation,
  lockStage,
  qualifierCorrectionImpact,
} from './qualifier-standings-sources';
import {
  qualifierStandingsActionSchema,
  type QualifierStandingsAction,
} from './qualifier-standings-validation';
import { scopedDb } from './scoped-db';
export {
  qualifierStandingsActionSchema,
  type QualifierStandingsAction,
} from './qualifier-standings-validation';
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

export async function assertQualifierMutable(
  tx: Prisma.TransactionClient,
  stageId: string,
  tournamentId = 'main',
) {
  tx = scopedDb(tx, tournamentId);
  await lockStage(tx, stageId, tournamentId);
  const versions = await tx.qualifierStanding.findMany({
    where: { stageId, tournamentId },
    orderBy: { version: 'desc' },
    take: 1,
    select: { snapshot: true },
  });
  if (versions[0] && qualifierStandingSnapshot(versions[0].snapshot).state === 'FINALIZED')
    throw new AppError(
      'Finalized qualifier results are locked. A controlled standings and downstream-bracket review is required before changing source records.',
      409,
    );
}

// The caller supplies a transaction. No source writes, team seed rewrites, or bracket reseeding happen here.
export async function applyQualifierStandingsAction(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: QualifierStandingsAction,
) {
  assertPermission(actor, 'matches.manage');
  const action = qualifierStandingsActionSchema.parse(input);
  const tournamentId = actor.tournamentId || 'main';
  tx = scopedDb(tx, tournamentId);
  if (action.type === 'qualifier.standings.reopen')
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
  await lockStage(tx, action.stageId, tournamentId);
  const { calculation } = await loadQualifierCalculation(tx, action.stageId, tournamentId);
  const versions = await tx.qualifierStanding.findMany({
    where: { stageId: action.stageId, tournamentId },
    orderBy: { version: 'desc' },
  });
  const latest = versions[0];
  if ((latest?.version || 0) !== action.baseVersion)
    throw new AppError('Standings changed. Reload and review the latest version.', 409);
  if (action.sourceHash !== calculation.sourceHash)
    throw new AppError('Qualifier sources changed. Recalculate and review before continuing.', 409);
  const locked = !!latest && qualifierStandingSnapshot(latest.snapshot).state === 'FINALIZED';
  if (action.type === 'qualifier.standings.reopen') {
    if (!latest || !locked)
      throw new AppError('Only the current finalized standings can be reopened.', 409);
    await assertNoFormationFrom(tx, tournamentId, action.stageId);
    const impact = await qualifierCorrectionImpact(tx, tournamentId, action.stageId);
    if (
      impact.impactHash !== action.impactHash ||
      new Set(action.affectedBracketIds).size !== action.affectedBracketIds.length ||
      canonicalQualifierJson([...action.affectedBracketIds].sort()) !==
        canonicalQualifierJson(impact.brackets.map((b) => b.id).sort())
    )
      throw new AppError(
        'Downstream competition changed. Reload and acknowledge every affected bracket before reopening.',
        409,
      );
    if (!impact.canReopen)
      throw new AppError(
        'Started or scored downstream matches require manual historical reconciliation: {0}.',
        409,
        [impact.blockingMatches.map((m) => m.code).join(', ')],
      );
    const now = new Date().toISOString();
    const snapshot: QualifierStandingSnapshot = {
      state: 'REOPENED',
      calculation,
      calculatedBy: actor.id,
      calculatedAt: now,
      finalizedAt: null,
      cutoff: null,
      tieResolution: null,
      seeds: [],
      correctionReview: { standingId: latest.id, reason: action.reason, actorId: actor.id, impact },
    };
    await tx.qualifierStanding.updateMany({
      where: { tournamentId, stageId: action.stageId, published: true },
      data: { published: false },
    });
    const record = await tx.qualifierStanding.create({
      data: {
        tournamentId,
        stageId: action.stageId,
        version: action.baseVersion + 1,
        sourceHash: calculation.sourceHash,
        snapshot: json(snapshot),
      },
    });
    await audit(tx, actor, action, {
      standingId: record.id,
      supersededStandingId: latest.id,
      sourceHash: record.sourceHash,
      reason: action.reason,
      impact,
    });
    return record;
  }
  if (action.type === 'qualifier.standings.publish') {
    if (
      !latest ||
      qualifierStandingSnapshot(latest.snapshot).state !== 'FINALIZED' ||
      (action.published && latest.sourceHash !== calculation.sourceHash)
    )
      throw new AppError('Only current finalized standings can be published.', 409);
    await tx.qualifierStanding.updateMany({
      where: { tournamentId, stageId: action.stageId, published: true },
      data: { published: false },
    });
    const record = await tx.qualifierStanding.update({
      where: { id: latest.id, tournamentId },
      data: { published: action.published },
    });
    await audit(tx, actor, action, { standingId: record.id, sourceHash: record.sourceHash });
    return record;
  }
  if (locked)
    throw new AppError(
      'Finalized standings are immutable. A controlled downstream competition review is required to revise them.',
      409,
    );
  if (action.type === 'qualifier.policy.save') {
    const unsafe = await tx.qualifierLobby.count({
      where: {
        stageId: action.stageId,
        tournamentId,
        OR: [{ status: { not: 'SCHEDULED' } }, { scores: { some: {} } }],
      },
    });
    if (unsafe)
      throw new AppError(
        'Qualifier policy is locked after a session starts or records scores.',
        409,
      );
    await tx.tournamentStage.update({
      where: { id: action.stageId, tournamentId },
      data: { qualifierPolicy: json(action.policy) },
    });
    await tx.qualifierLobby.updateMany({
      where: { stageId: action.stageId, tournamentId, status: 'SCHEDULED' },
      data: { policy: json(action.policy), version: { increment: 1 } },
    });
    await audit(tx, actor, action, { before: calculation.policy, after: action.policy });
    return { saved: true };
  }
  let reviewed = calculation;
  let tieResolution: QualifierStandingSnapshot['tieResolution'] = null;
  if (
    action.type === 'qualifier.standings.resolve' ||
    action.type === 'qualifier.standings.finalize'
  ) {
    let order = action.tieOrder,
      reason = action.reason;
    const previous = latest ? qualifierStandingSnapshot(latest.snapshot) : null;
    if (!order.length && previous?.tieResolution && latest.sourceHash === calculation.sourceHash) {
      order = previous.tieResolution.order;
      reason = previous.tieResolution.reason;
    }
    if (order.length) {
      if (!reason.trim()) throw new AppError('Record the approved tiebreak decision.');
      try {
        reviewed = resolveQualifierTies(calculation, order);
      } catch (error) {
        throw new AppError(error instanceof Error ? error.message : 'Invalid tie resolution.');
      }
      tieResolution = { order, reason, actorId: actor.id };
    }
  }
  const finalizing = action.type === 'qualifier.standings.finalize';
  if (
    finalizing &&
    (!latest ||
      qualifierStandingSnapshot(latest.snapshot).state !== 'PROVISIONAL' ||
      latest.sourceHash !== calculation.sourceHash)
  )
    throw new AppError('Save and review a provisional calculation before finalizing.', 409);
  if (finalizing && !reviewed.canFinalize)
    throw new AppError(
      'Resolve missing scores, incompatible data and tied seeds before finalizing.',
      409,
    );
  const cutoff = finalizing ? (action.cutoff ?? null) : null;
  if (cutoff !== null && cutoff > reviewed.rows.filter((r) => r.seed !== null).length)
    throw new AppError('The cutoff exceeds the seeded cohort.');
  const now = new Date().toISOString();
  const snapshot: QualifierStandingSnapshot = {
    state: finalizing ? 'FINALIZED' : 'PROVISIONAL',
    calculation: reviewed,
    calculatedBy: actor.id,
    calculatedAt: now,
    finalizedAt: finalizing ? now : null,
    cutoff,
    tieResolution,
    seeds: finalizing
      ? reviewed.rows
          .filter((r) => r.seed !== null)
          .map((r) => ({
            teamId: r.participantId,
            seed: r.seed!,
            qualified: cutoff === null || r.seed! <= cutoff,
          }))
      : [],
  };
  const record = await tx.qualifierStanding.create({
    data: {
      tournamentId,
      stageId: action.stageId,
      version: action.baseVersion + 1,
      sourceHash: reviewed.sourceHash,
      snapshot: json(snapshot),
    },
  });
  await audit(tx, actor, action, {
    standingId: record.id,
    version: record.version,
    sourceHash: record.sourceHash,
    tieResolution,
    cutoff,
  });
  return record;
}

async function audit(
  tx: Prisma.TransactionClient,
  actor: Actor,
  action: QualifierStandingsAction,
  details: unknown,
) {
  await tx.auditLog.create({
    data: {
      tournamentId: actor.tournamentId || 'main',
      actorId: actor.id,
      action: action.type,
      entityType: 'qualifierStanding',
      entityId: action.stageId,
      details: json(details),
    },
  });
}

export async function finalizedQualifierSeeds(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  standingId: string,
) {
  tx = scopedDb(tx, tournamentId);
  const record = await tx.qualifierStanding.findFirst({ where: { id: standingId, tournamentId } });
  if (!record) throw new AppError('Qualifier standings not found.', 404);
  await lockStage(tx, record.stageId, tournamentId);
  const latest = await tx.qualifierStanding.findFirst({
    where: { stageId: record.stageId, tournamentId },
    orderBy: { version: 'desc' },
  });
  if (latest?.id !== record.id)
    throw new AppError(
      'Qualifier seeds were reopened or superseded. Review and explicitly rebuild or reconcile the affected bracket before starting it.',
      409,
    );
  const snapshot = qualifierStandingSnapshot(record.snapshot);
  if (snapshot.state !== 'FINALIZED' || !snapshot.calculation.canFinalize)
    throw new AppError('Use finalized, resolved qualifier seeds.', 409);
  const { calculation } = await loadQualifierCalculation(tx, record.stageId, tournamentId);
  if (record.sourceHash !== calculation.sourceHash)
    throw new AppError(
      'Finalized standings are stale. Review source and downstream competition changes.',
      409,
    );
  return snapshot.seeds.filter((s) => s.qualified).map(({ teamId, seed }) => ({ teamId, seed }));
}
