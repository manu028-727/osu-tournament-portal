import { Prisma } from '@/generated/prisma/client';
import { createHash } from 'node:crypto';
import { db as rootDb } from './db';
import { scopedDb } from './scoped-db';
import { actorForTournament } from './auth';
import { AppError, assertPermission, type Actor } from './permissions';
import { inheritedRules } from './gameplay-scoring';
import { replayDraft } from './match-engine';
import { matchRulesSchema } from './match-rules';
import {
  canRebindStageSnapshot,
  normalizeStageLabel,
  objectMetadata,
  resolveStageLabel,
  snapshotProblems,
  sourceStageLabel,
  stageReconciliationActionSchema,
  type StageReconciliationAction,
} from './stage-reconciliation';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const matchInclude = {
  stage: true,
  poolRevision: { include: { slots: { orderBy: { position: 'asc' as const } } } },
  actions: { orderBy: { sequence: 'asc' as const } },
  results: true,
  multiplayerGames: true,
  events: { where: { kind: 'sheet.import' }, orderBy: { createdAt: 'asc' as const } },
};
const stageInclude = { mappool: { include: { publishedRevision: { include: { slots: true } } } } };
type RepairMatch = Prisma.MatchGetPayload<{ include: typeof matchInclude }>;
type RepairStage = Prisma.TournamentStageGetPayload<{ include: typeof stageInclude }>;
const snapshotKey = (poolRevisionId: string, rules: unknown) =>
  createHash('sha256').update(JSON.stringify({ poolRevisionId, rules })).digest('hex');

function inspect(match: RepairMatch, stages: RepairStage[]) {
  const sourceLabel = sourceStageLabel(match.source, match.events, match.stage.name);
  const mapping = resolveStageLabel(sourceLabel, stages);
  const reviewed =
    objectMetadata(objectMetadata(match.source).stageReconciliation).resolvedStageId ===
    match.stageId;
  const reasons: string[] = [];
  if (match.stage.archivedAt) reasons.push('Current stage is archived.');
  if (match.stage.kind === 'QUALIFIERS')
    reasons.push('Head-to-head match is linked to a qualifier stage.');
  if (normalizeStageLabel(match.stage.name).bracket)
    reasons.push('Current stage contains a bracket suffix.');
  if (mapping.bracket && !match.bracket)
    reasons.push('Source bracket context is missing from this match.');
  if (!reviewed && mapping.stage && mapping.stage.id !== match.stageId)
    reasons.push('Source label maps to a different existing gameplay stage.');
  if (!reviewed && mapping.ambiguous)
    reasons.push('Source label matches multiple configured stages; choose manually.');
  if (!reviewed && !mapping.candidates.length && sourceLabel !== match.stage.name)
    reasons.push('Source stage label has no known configured mapping; choose manually.');
  reasons.push(...snapshotProblems(match.rules, match.poolRevision?.slots));
  return { sourceLabel, mapping, reasons, canRebindPool: canRebindStageSnapshot(match) };
}

export async function stageReconciliationPreview(actor: Actor) {
  assertPermission(actor, 'matches.manage');
  const db = scopedDb(rootDb, actor.tournamentId || 'main');
  const [matches, stages, settings, tournament] = await Promise.all([
    db.match.findMany({ include: matchInclude, orderBy: { code: 'asc' } }),
    db.tournamentStage.findMany({ include: stageInclude, orderBy: { position: 'asc' } }),
    db.tournamentSettings.findUniqueOrThrow({
      where: { tournamentId: actor.tournamentId || 'main' },
    }),
    db.tournament.findUniqueOrThrow({
      where: { id: actor.tournamentId || 'main' },
      select: { id: true, slug: true, name: true, gameMode: true },
    }),
  ]);
  const targets = stages
    .filter(
      (stage) =>
        !stage.archivedAt &&
        stage.kind !== 'QUALIFIERS' &&
        !normalizeStageLabel(stage.name).bracket,
    )
    .map((stage) => {
      let rulesError: string | null = null;
      let rules: ReturnType<typeof inheritedRules> | null = null;
      try {
        rules = inheritedRules(
          stage.matchRules || settings.matchRules,
          settings.gameplayScoring,
          tournament.gameMode,
        );
      } catch (error) {
        rulesError = (error as Error).message;
      }
      const published =
        stage.mappool?.state === 'PUBLISHED' ? stage.mappool.publishedRevision : null;
      return {
        id: stage.id,
        name: stage.name,
        poolRevisionId: published?.id || null,
        canRebindPool: !!published?.slots.length && !rulesError,
        rulesError,
        rules: rules
          ? {
              bestOf: rules.bestOf,
              gameplayScoring: rules.gameplayScoring,
              gameMode: rules.gameMode,
            }
          : null,
        snapshotKey: published && rules ? snapshotKey(published.id, rules) : null,
      };
    });
  return {
    tournament: { id: tournament.id, slug: tournament.slug, name: tournament.name },
    stages: targets,
    matches: matches.flatMap((match) => {
      const result = inspect(match, stages);
      if (!result.reasons.length) return [];
      const problems = snapshotProblems(match.rules, match.poolRevision?.slots);
      return [
        {
          matchId: match.id,
          code: match.code,
          matchNumber: match.matchNumber,
          baseVersion: match.version,
          status: match.status,
          currentStage: { id: match.stageId, name: match.stage.name },
          sourceLabel: result.sourceLabel,
          bracket: match.bracket || result.mapping.bracket,
          roundLabel: result.mapping.roundLabel,
          reasons: result.reasons,
          suggestedStageId: targets.some((target) => target.id === result.mapping.stage?.id)
            ? result.mapping.stage!.id
            : null,
          candidateStageIds: result.mapping.candidates.map((stage) => stage.id),
          ambiguous: result.mapping.ambiguous,
          canRebindPool: result.canRebindPool,
          preserved: ['Actions', 'Results', 'Participants', 'Scheduling', 'Completed status'],
          poolRevisionId: match.poolRevisionId,
          rules: (() => {
            const parsed = matchRulesSchema.safeParse(match.rules);
            return parsed.success
              ? {
                  bestOf: parsed.data.bestOf,
                  gameplayScoring: parsed.data.gameplayScoring || parsed.data.scoreMode,
                  gameMode: parsed.data.gameMode,
                }
              : null;
          })(),
          snapshotProblems: problems,
          refereeUrl: `/t/${tournament.slug}/admin/referee/${match.matchNumber}`,
        },
      ];
    }),
  };
}
export type StageReconciliationPreview = Awaited<ReturnType<typeof stageReconciliationPreview>>;

// Caller owns the transaction. This function always restores the actor's tenant scope.
export async function applyStageReconciliation(
  transaction: Prisma.TransactionClient,
  original: Actor,
  action: StageReconciliationAction,
) {
  const input = stageReconciliationActionSchema.parse(action);
  assertPermission(original, 'matches.manage');
  const tournamentId = original.tournamentId || 'main';
  const tx = scopedDb(transaction, tournamentId);
  const user = await tx.user.findUniqueOrThrow({
    where: { id: original.id },
    include: {
      roles: { where: { tournamentId }, include: { role: { include: { permissions: true } } } },
    },
  });
  const actor = actorForTournament(user, tournamentId);
  assertPermission(actor, 'matches.manage');
  const stages = await tx.tournamentStage.findMany({ include: stageInclude });
  const settings = await tx.tournamentSettings.findUniqueOrThrow({ where: { tournamentId } });
  const tournament = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
  const results: {
    matchId: string;
    alreadyApplied: boolean;
    version: number;
    refereeReady: boolean;
  }[] = [];
  for (const change of input.changes) {
    const match = await tx.match.findUnique({
      where: { id: change.matchId },
      include: matchInclude,
    });
    if (!match) throw new AppError('Match not found in this tournament.', 404);
    const previous = await tx.matchEvent.findFirst({
      where: {
        matchId: match.id,
        kind: 'stage.reconcile',
        data: { path: ['baseVersion'], equals: change.baseVersion },
      },
    });
    const previousData = objectMetadata(previous?.data);
    if (
      previous &&
      previousData.stageId === change.stageId &&
      previousData.rebindPool === change.rebindPool &&
      previousData.targetSnapshotKey === change.targetSnapshotKey &&
      match.stageId === change.stageId &&
      match.version === previous.version
    ) {
      results.push({
        matchId: match.id,
        alreadyApplied: true,
        version: match.version,
        refereeReady: !snapshotProblems(match.rules, match.poolRevision?.slots).length,
      });
      continue;
    }
    if (match.version !== change.baseVersion)
      throw new AppError('Match {0} changed after preview. Refresh the review.', 409, [match.code]);
    const stage = stages.find(
      (stage) =>
        stage.id === change.stageId &&
        !stage.archivedAt &&
        stage.kind !== 'QUALIFIERS' &&
        !normalizeStageLabel(stage.name).bracket,
    );
    if (!stage) throw new AppError('Select an existing active head-to-head gameplay stage.');
    const review = inspect(match, stages);
    if (!review.reasons.length)
      throw new AppError('This match no longer needs stage reconciliation.', 409);
    let rules: unknown = match.rules;
    let poolRevisionId = match.poolRevisionId;
    let slots = match.poolRevision?.slots;
    if (change.rebindPool) {
      if (!review.canRebindPool)
        throw new AppError('Started matches must retain frozen rules and pool.', 409);
      if (stage.mappool?.state !== 'PUBLISHED' || !stage.mappool.publishedRevision?.slots.length)
        throw new AppError('Target stage must already have a published nonempty mappool.', 409);
      rules = inheritedRules(
        stage.matchRules || settings.matchRules,
        settings.gameplayScoring,
        tournament.gameMode,
      );
      poolRevisionId = stage.mappool.publishedRevision.id;
      slots = stage.mappool.publishedRevision.slots;
      if (snapshotKey(poolRevisionId, rules) !== change.targetSnapshotKey)
        throw new AppError(
          'Target published pool or inherited rules changed after preview. Refresh the review.',
          409,
        );
    }
    const problems = snapshotProblems(rules, slots);
    if (problems.length) throw AppError.fromMessages(problems, 409, ' ');
    try {
      replayDraft(matchRulesSchema.parse(rules), match, slots!, match.actions, match.results);
    } catch {
      throw new AppError(
        'Frozen referee history cannot be replayed. Resolve it manually; no history was changed.',
        409,
      );
    }
    const bracket = match.bracket || review.mapping.bracket || '';
    const source = {
      ...objectMetadata(match.source),
      stageReconciliation: {
        ...objectMetadata(objectMetadata(match.source).stageReconciliation),
        originalStageLabel: review.sourceLabel,
        originalStageId:
          objectMetadata(objectMetadata(match.source).stageReconciliation).originalStageId ||
          match.stageId,
        originalSource:
          objectMetadata(objectMetadata(match.source).stageReconciliation).originalSource ??
          match.source,
        bracket: review.mapping.bracket,
        roundLabel: review.mapping.roundLabel,
        resolvedStageId: stage.id,
      },
    };
    const updated = await tx.match.updateMany({
      where: { id: match.id, version: change.baseVersion },
      data: {
        stageId: stage.id,
        bracket,
        source: json(source),
        ...(change.rebindPool ? { rules: json(rules), poolRevisionId } : {}),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new AppError('Match changed during reconciliation.', 409);
    const audit = {
      ...change,
      fromStageId: match.stageId,
      sourceLabel: review.sourceLabel,
      bracket,
      roundLabel: review.mapping.roundLabel,
      reason: input.reason,
      before: {
        stageId: match.stageId,
        poolRevisionId: match.poolRevisionId,
        rules: match.rules,
        source: match.source,
      },
      after: { stageId: stage.id, poolRevisionId, rules, source },
    };
    await tx.matchEvent.create({
      data: {
        matchId: match.id,
        actorId: actor.id,
        version: match.version + 1,
        kind: 'stage.reconcile',
        notes: input.reason,
        data: json(audit),
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'stage.reconcile',
        entityType: 'match',
        entityId: match.id,
        details: json(audit),
      },
    });
    results.push({
      matchId: match.id,
      alreadyApplied: false,
      version: match.version + 1,
      refereeReady: true,
    });
  }
  return { results, changed: results.filter((result) => !result.alreadyApplied).length };
}
