import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { inheritedRules } from './gameplay-scoring';
import { matchRulesSchema } from './match-rules';
import { qualifierPolicySchema } from './qualifier-policy';
import { poolPlanSchema } from './pooling-validation';
import { sortPoolSlots } from './mappool-order';
import { AppError, assertPermission, can, type Actor } from './permissions';
import {
  patchStageRules,
  stagePoolIssues,
  stageWorkflowActionSchema,
  type StageWorkflowAction,
} from './stage-workflows-validation';

type Client = Prisma.TransactionClient | PrismaClient;
function stable(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export const stageConfigurationToken = (value: unknown) =>
  createHash('sha256').update(stable(value)).digest('hex');

function assertScope(actor: Actor, tournamentId: string) {
  if (!tournamentId || actor.tournamentId !== tournamentId)
    throw new AppError('Select the correct tournament workspace.', 403);
}
async function configuration(tx: Client, tournamentId: string) {
  const tournament = await tx.tournament.findUnique({
    where: { id: tournamentId },
    select: { gameMode: true },
  });
  const settings = await tx.tournamentSettings.findUnique({
    where: { tournamentId },
    select: { matchRules: true, gameplayScoring: true },
  });
  if (!tournament || !settings) throw new AppError('Tournament settings no longer exist.', 404);
  const defaults = settings.gameplayScoring
    ? inheritedRules(settings.matchRules, settings.gameplayScoring, tournament.gameMode)
    : matchRulesSchema.parse({
        ...matchRulesSchema.parse(settings.matchRules),
        gameMode: tournament.gameMode,
      });
  return {
    defaults,
    defaultsToken: stageConfigurationToken({ settings, gameMode: tournament.gameMode }),
    gameMode: tournament.gameMode,
    scoring: settings.gameplayScoring,
  };
}

function normalizedRules(base: unknown, context: Awaited<ReturnType<typeof configuration>>) {
  return context.scoring
    ? inheritedRules(base, context.scoring, context.gameMode)
    : matchRulesSchema.parse({ ...matchRulesSchema.parse(base), gameMode: context.gameMode });
}

export async function stageWorkflowData(
  tx: Client,
  actor: Actor,
  tournamentId = actor.tournamentId!,
) {
  assertScope(actor, tournamentId);
  if (
    !(['mappools.view_drafts', 'mappools.create', 'mappools.edit', 'matches.manage'] as const).some(
      (key) => can(actor, key),
    )
  )
    throw new AppError('You do not have permission to view stage configuration.', 403);
  const context = await configuration(tx, tournamentId);
  const stages = await tx.tournamentStage.findMany({
    where: { tournamentId },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  });
  return {
    defaults: context.defaults,
    defaultsToken: context.defaultsToken,
    stages: stages.map((stage) => ({
      ...stage,
      configurationToken: stageConfigurationToken(stage),
      rulesOrigin:
        stage.kind === 'QUALIFIERS' ? 'QUALIFIER' : stage.matchRules ? 'OVERRIDDEN' : 'INHERITED',
      matchRules: stage.matchRules ? normalizedRules(stage.matchRules, context) : null,
    })),
  };
}

// Called inside the existing administrative transaction; the same lock also covers stage.save.
export async function applyStageWorkflowAction(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: StageWorkflowAction,
) {
  const action = stageWorkflowActionSchema.parse(input);
  const tournamentId = actor.tournamentId!;
  assertScope(actor, tournamentId);
  if (action.type === 'stage.duplicate') {
    assertPermission(actor, 'mappools.create');
    if (action.copyRules) assertPermission(actor, 'matches.manage');
    if (
      action.poolMode !== 'EMPTY' &&
      !(['mappools.view_drafts', 'mappools.edit', 'mappools.publish'] as const).some((key) =>
        can(actor, key),
      )
    )
      throw new AppError('Permission to view mappool drafts is required to copy a pool.', 403);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
    return duplicateStage(tx, actor, action);
  }
  assertPermission(actor, 'mappools.edit');
  if (action.type !== 'stage.reorder') assertPermission(actor, 'matches.manage');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
  const ids = action.stages.map((stage) => stage.id);
  const all = await tx.tournamentStage.findMany({
    where: { tournamentId },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  });
  const selected = action.stages.map((item) => {
    const record = all.find((stage) => stage.id === item.id);
    if (!record) throw new AppError('A selected stage no longer exists in this tournament.', 404);
    if (stageConfigurationToken(record) !== item.baseConfigurationToken)
      throw new AppError('{0} changed. Reload and review before applying.', 409, [record.name]);
    return record;
  });
  if (action.type === 'stage.reorder') {
    if (ids.length !== all.length)
      throw new AppError('Reorder the complete stage list. Reload to include new stages.', 409);
    for (const [position, stage] of selected.entries())
      await tx.tournamentStage.update({
        where: { id: stage.id, tournamentId },
        data: { position },
      });
    await tx.auditLog.create({
      data: {
        tournamentId,
        actorId: actor.id,
        action: action.type,
        entityType: 'TournamentStage',
        entityId: tournamentId,
        details: { before: all.map((s) => s.id), after: ids },
      },
    });
    return { updated: selected.length, warnings: [] };
  }
  const context = await configuration(tx, tournamentId);
  if (action.defaultsToken !== context.defaultsToken)
    throw new AppError('Tournament defaults changed. Reload and review before applying.', 409);
  let sourceRules = null;
  if (action.type === 'stage.rules.apply' && action.source.kind === 'STAGE') {
    const requestedSource = action.source;
    const source = all.find((stage) => stage.id === requestedSource.id);
    if (!source || source.kind === 'QUALIFIERS' || source.archivedAt)
      throw new AppError('Choose an active head-to-head source stage.');
    if (stageConfigurationToken(source) !== action.source.baseConfigurationToken)
      throw new AppError('The source stage changed. Reload and review its rules.', 409);
    sourceRules = normalizedRules(source.matchRules || context.defaults, context);
  }
  const proposed = selected.map((stage) => {
    if (stage.kind === 'QUALIFIERS')
      throw new AppError('{0} uses qualifier policy, not Best-of or pick/ban rules.', 400, [
        stage.name,
      ]);
    if (stage.archivedAt)
      throw new AppError('{0} is archived. Unarchive it before changing rules.', 409, [stage.name]);
    try {
      const rules =
        action.type === 'stage.rules.patch'
          ? patchStageRules(
              normalizedRules(stage.matchRules || context.defaults, context),
              action.patch,
            )
          : sourceRules;
      return { stage, rules };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Invalid rule configuration.';
      throw new AppError('{0}: {1}', 400, [stage.name, detail]);
    }
  });
  const warnings: { id: string; name: string; messages: string[] }[] = [];
  for (const { stage, rules } of proposed) {
    const pool = await tx.mappool.findFirst({
      where: { tournamentId, stageId: stage.id },
      include: {
        draftRevision: { include: { slots: true } },
        publishedRevision: { include: { slots: true } },
      },
    });
    const issues = stagePoolIssues(
      rules || context.defaults,
      (pool?.draftRevision || pool?.publishedRevision)?.slots || null,
    );
    if (issues.length)
      warnings.push({
        id: stage.id,
        name: stage.name,
        messages: issues.map((issue) => issue.message),
      });
    await tx.tournamentStage.update({
      where: { id: stage.id, tournamentId },
      data: { matchRules: rules ? JSON.parse(JSON.stringify(rules)) : Prisma.DbNull },
    });
    await tx.auditLog.create({
      data: {
        tournamentId,
        actorId: actor.id,
        action: action.type,
        entityType: 'TournamentStage',
        entityId: stage.id,
        details: { before: stage.matchRules, after: rules, snapshotsPreserved: true },
      },
    });
  }
  return { updated: proposed.length, warnings };
}

async function duplicateStage(
  tx: Prisma.TransactionClient,
  actor: Actor,
  action: Extract<StageWorkflowAction, { type: 'stage.duplicate' }>,
) {
  const tournamentId = actor.tournamentId!;
  const source = await tx.tournamentStage.findFirst({
    where: { id: action.sourceId, tournamentId },
  });
  if (!source) throw new AppError('The source stage no longer exists in this tournament.', 404);
  if (stageConfigurationToken(source) !== action.baseConfigurationToken)
    throw new AppError('The source stage changed. Reload and review before duplicating.', 409);
  if (
    await tx.tournamentStage.findFirst({
      where: { tournamentId, slug: action.slug },
      select: { id: true },
    })
  )
    throw new AppError('This stage URL slug is already in use. Choose another slug.', 409);
  const plan =
    action.poolMode === 'EMPTY'
      ? null
      : await tx.poolPlan.findFirst({ where: { tournamentId, stageId: source.id } });
  const sourcePool =
    action.poolMode === 'EMPTY'
      ? null
      : await tx.mappool.findFirst({
          where: { tournamentId, stageId: source.id },
          include: {
            draftRevision: { include: { slots: { orderBy: { position: 'asc' } } } },
            publishedRevision: { include: { slots: { orderBy: { position: 'asc' } } } },
          },
        });
  const revision = sourcePool?.draftRevision || sourcePool?.publishedRevision;
  if (action.poolMode === 'CONTENTS' && !revision)
    throw new AppError(
      'The source stage has no saved pool draft or published revision to copy.',
      409,
    );
  const planSlots = plan ? poolPlanSchema.shape.slots.parse(plan.slots) : [];
  const slots = planSlots.length
    ? planSlots
    : revision?.slots.map(({ name, category }) => ({ name, category })) || [];
  const context =
    action.copyRules && source.matchRules && source.kind !== 'QUALIFIERS'
      ? await configuration(tx, tournamentId)
      : null;
  const last = await tx.tournamentStage.aggregate({
    where: { tournamentId },
    _max: { position: true },
  });
  const created = await tx.tournamentStage.create({
    data: {
      tournamentId,
      name: action.name,
      slug: action.slug,
      kind: source.kind,
      description: source.description,
      position: (last._max.position ?? -1) + 1,
      bannerImageId: action.copyAppearance ? source.bannerImageId : null,
      matchRules: context
        ? JSON.parse(JSON.stringify(normalizedRules(source.matchRules, context)))
        : Prisma.DbNull,
      qualifierPolicy:
        source.kind === 'QUALIFIERS' && action.copyRules
          ? JSON.parse(JSON.stringify(qualifierPolicySchema.parse(source.qualifierPolicy || {})))
          : Prisma.DbNull,
      mappool: { create: {} },
    },
    include: { mappool: true },
  });
  if (action.poolMode !== 'EMPTY') {
    await tx.poolPlan.create({
      data: {
        tournamentId,
        stageId: created.id,
        slots: JSON.parse(JSON.stringify(slots)),
        minStars: plan?.minStars ?? null,
        maxStars: plan?.maxStars ?? null,
        reviewState: 'DRAFT',
        version: 1,
      },
    });
  }
  if (action.poolMode === 'CONTENTS' && revision) {
    const copied = await tx.mappoolRevision.create({
      data: {
        tournamentId,
        mappoolId: created.mappool!.id,
        createdBy: actor.id,
        notes: revision.notes,
        slots: {
          create: sortPoolSlots(revision.slots).map((slot, position) => ({
            name: slot.name,
            category: slot.category,
            categoryName: slot.categoryName,
            categoryPriority: slot.categoryPriority,
            color: slot.color,
            beatmapId: slot.beatmapId,
            metadata: JSON.parse(JSON.stringify(slot.metadata)),
            position,
          })),
        },
      },
    });
    await tx.mappool.update({
      where: { id: created.mappool!.id, tournamentId },
      data: { draftRevisionId: copied.id, state: 'DRAFT' },
    });
  }
  await tx.auditLog.create({
    data: {
      tournamentId,
      actorId: actor.id,
      action: action.type,
      entityType: 'TournamentStage',
      entityId: created.id,
      details: {
        sourceId: source.id,
        copyRules: action.copyRules,
        copyAppearance: action.copyAppearance,
        poolMode: action.poolMode,
        sourceRevisionId: revision?.id ?? null,
        copiedSlots: action.poolMode === 'CONTENTS' ? (revision?.slots.length ?? 0) : 0,
      },
    },
  });
  return { id: created.id, poolMode: action.poolMode, updated: 1, warnings: [] };
}
