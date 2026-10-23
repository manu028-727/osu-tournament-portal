import { Prisma } from '@/generated/prisma/client';
import { db } from './db';
import { AppError, assertPermission, can, type Actor, type PermissionKey } from './permissions';
import { beatmaps, type BeatmapMetadata } from './osu';
import { normalizedSlot, poolSlotErrors, sortPoolSlots } from './mappool-order';
import { poolPlanSchema, type PoolingAction, type PoolPlanInput } from './pooling-validation';
import type { PoolingData } from './pooling-types';
import { stagePoolProblems } from './stage-pool-validation';
import { inheritedRules } from './gameplay-scoring';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const tenant = (actor: Actor) => {
  if (!actor.tournamentId || actor.tournamentId === 'none')
    throw new AppError('Select a tournament.');
  return actor.tournamentId;
};
export const artistKey = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en');
export function poolingPermission(action: PoolingAction): PermissionKey {
  if (action.type === 'pooling.pools.release') return 'mappools.publish';
  if (action.type === 'pooling.suggest' || action.type === 'pooling.review.save')
    return 'mappools.view_drafts';
  if (action.type === 'pooling.plan.review' && action.state === 'APPROVED')
    return 'mappools.publish';
  return 'mappools.edit';
}
export function assertPoolingPermission(
  actor: Actor | null,
  action?: PoolingAction,
): asserts actor is Actor {
  if (!action || ['pooling.suggest', 'pooling.review.save'].includes(action.type)) {
    if (
      !actor ||
      !['mappools.view_drafts', 'mappools.edit', 'mappools.publish'].some((permission) =>
        can(actor, permission as PermissionKey),
      )
    )
      throw new AppError('Pool staff access is required.', 403);
  } else assertPermission(actor, poolingPermission(action));
}
export async function poolingData(actor: Actor): Promise<PoolingData> {
  assertPoolingPermission(actor);
  const tournamentId = tenant(actor);
  const [candidates, stages, categories, skillsets, warnings, reviewers] = await Promise.all([
    db.poolCandidate.findMany({
      where: { tournamentId },
      orderBy: { createdAt: 'desc' },
      include: {
        submitter: { select: { id: true, username: true } },
        tags: true,
        reviews: {
          include: { reviewer: { select: { username: true } } },
          orderBy: { updatedAt: 'desc' },
        },
      },
    }),
    db.tournamentStage.findMany({
      where: { tournamentId, archivedAt: null },
      orderBy: { position: 'asc' },
      include: {
        poolPlan: true,
        mappool: { select: { draftRevisionId: true, publishedRevisionId: true } },
      },
    }),
    db.modCategory.findMany({ where: { tournamentId }, orderBy: { position: 'asc' } }),
    db.poolSkillset.findMany({
      where: { tournamentId },
      orderBy: [{ group: 'asc' }, { name: 'asc' }],
    }),
    db.poolArtistWarning.findMany({ where: { tournamentId }, orderBy: { artist: 'asc' } }),
    db.user.findMany({
      where: {
        roles: {
          some: {
            tournamentId,
            role: {
              permissions: {
                some: { permissionKey: { in: ['mappools.view_drafts', 'mappools.edit'] } },
              },
            },
          },
        },
      },
      select: { id: true, username: true },
      orderBy: { username: 'asc' },
    }),
  ]);
  return {
    candidates: candidates.map((candidate) => ({
      ...candidate,
      metadata: candidate.metadata as unknown as BeatmapMetadata,
    })),
    stages: stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      pool: stage.mappool,
      plan: stage.poolPlan
        ? { ...stage.poolPlan, slots: poolPlanSchema.shape.slots.parse(stage.poolPlan.slots) }
        : null,
    })),
    categories,
    skillsets,
    warnings,
    reviewers,
  };
}
export async function preparePoolingAction(actor: Actor, action: PoolingAction) {
  assertPoolingPermission(actor, action);
  if (action.type !== 'pooling.suggest') return null;
  const tournament = await db.tournament.findUniqueOrThrow({ where: { id: tenant(actor) } });
  const fetched = await beatmaps(action.beatmapIds, tournament.gameMode);
  if (fetched.errors.length)
    throw new AppError(fetched.errors.map((error) => `${error.id}: ${error.error}`).join(' '));
  return fetched.maps;
}
export async function savePoolPlan(
  tx: Prisma.TransactionClient,
  actor: Actor,
  stageId: string,
  input: PoolPlanInput,
) {
  assertPermission(actor, 'mappools.edit');
  const plan = poolPlanSchema.parse(input),
    tournamentId = tenant(actor);
  if (!(await tx.tournamentStage.findFirst({ where: { id: stageId, tournamentId } })))
    throw new AppError('Stage not found.', 404);
  const categories = await tx.modCategory.findMany({ where: { tournamentId } });
  const errors = poolSlotErrors(
    plan.slots.map((slot) => ({ ...slot, beatmapId: 1 })),
    categories,
  );
  if (errors.length) throw new AppError(errors.join(' '));
  const existing = await tx.poolPlan.findFirst({ where: { stageId, tournamentId } });
  if ((existing?.version ?? null) !== plan.baseVersion)
    throw new AppError('The pool plan changed. Reload before saving.', 409);
  const fields = {
    slots: json(
      sortPoolSlots(
        plan.slots.map((slot) => ({ ...slot, beatmapId: 1 })),
        categories,
      ).map(({ name, category }) => ({ name, category })),
    ),
    minStars: plan.minStars,
    maxStars: plan.maxStars,
    reviewState: 'DRAFT',
  };
  if (!existing) return tx.poolPlan.create({ data: { tournamentId, stageId, ...fields } });
  return tx.poolPlan.update({
    where: { id: existing.id },
    data: { ...fields, version: { increment: 1 } },
  });
}
export async function assertPlanComplete(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  stageId: string,
  slots: { name: string; category: string; metadata: Prisma.JsonValue }[],
) {
  const plan = await tx.poolPlan.findFirst({ where: { tournamentId, stageId } });
  const required = plan ? poolPlanSchema.shape.slots.parse(plan.slots) : [];
  const missing = required.filter(
    (expected) =>
      !slots.some((slot) => slot.name === expected.name && slot.category === expected.category),
  );
  if (missing.length)
    throw new AppError(
      `Fill the planned slots before publishing: ${missing.map((slot) => slot.name).join(', ')}.`,
      409,
    );
  const warnings = await tx.poolArtistWarning.findMany({
    where: { tournamentId, severity: 'BANNED' },
  });
  for (const slot of slots) {
    const map = slot.metadata as unknown as BeatmapMetadata;
    const warning = warnings.find((item) => item.artistKey === artistKey(map.artist));
    if (warning) {
      const candidate = await tx.poolCandidate.findUnique({
        where: { tournamentId_beatmapId: { tournamentId, beatmapId: map.id } },
        select: { warningResolution: true },
      });
      const resolution = candidate?.warningResolution as {
        warningId?: string;
        reason?: string;
        resolution?: string;
      } | null;
      if (
        resolution?.warningId !== warning.id ||
        resolution.reason !== warning.reason ||
        !resolution.resolution
      )
        throw new AppError(
          `${slot.name}: ${map.artist} is banned for this tournament. Resolve the warning when selecting this suggestion, or amend the warning before publishing.`,
        );
    }
  }
}
export async function publishPoolDraft(
  tx: Prisma.TransactionClient,
  actor: Actor,
  poolId: string,
  revisionId: string,
) {
  assertPermission(actor, 'mappools.publish');
  const tournamentId = tenant(actor);
  const pool = await tx.mappool.findFirst({
    where: { id: poolId, tournamentId },
    include: { stage: true, draftRevision: { include: { slots: true } } },
  });
  if (!pool) throw new AppError('Mappool not found in this tournament.', 404);
  if (pool.draftRevisionId !== revisionId || !pool.draftRevision?.slots.length)
    throw new AppError(
      `${pool.stage.name}: Review and save a non-empty current draft before publishing.`,
      409,
    );
  const tournament = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
  if (
    pool.draftRevision.slots.some(
      (slot) => (slot.metadata as { mode?: string }).mode !== tournament.gameMode,
    )
  )
    throw new AppError(
      `${pool.stage.name}: this draft contains beatmaps from a different game mode. Edit and save it again.`,
    );
  await assertPlanComplete(tx, tournamentId, pool.stageId, pool.draftRevision.slots);
  if (['ELIMINATION', 'GROUPS'].includes(pool.stage.kind)) {
    const settings = await tx.tournamentSettings.findUniqueOrThrow({ where: { tournamentId } });
    const problems = stagePoolProblems(
      pool.stage.kind,
      inheritedRules(
        pool.stage.matchRules || settings.matchRules,
        settings.gameplayScoring,
        tournament.gameMode,
      ),
      pool.draftRevision.slots,
    );
    if (problems.length) throw new AppError(`${pool.stage.name}: ${problems.join(' ')}`, 409);
  }
  await tx.poolPlan.updateMany({
    where: { tournamentId, stageId: pool.stageId },
    data: { reviewState: 'APPROVED', version: { increment: 1 } },
  });
  await tx.mappool.update({
    where: { id: pool.id, tournamentId },
    data: { state: 'PUBLISHED', publishedRevisionId: revisionId },
  });
}
async function validateReferences(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  stageId: string | null | undefined,
  category: string | undefined,
  primary?: string[],
  secondary?: string[],
) {
  if (
    stageId &&
    !(await tx.tournamentStage.findFirst({
      where: { id: stageId, tournamentId, archivedAt: null },
    }))
  )
    throw new AppError('Choose an active stage from this tournament.');
  if (category && !(await tx.modCategory.findFirst({ where: { tournamentId, acronym: category } })))
    throw new AppError(`Unknown mod category: ${category}.`);
  const tags = [...(primary || []), ...(secondary || [])];
  if (new Set(tags).size !== tags.length)
    throw new AppError('A skillset can be primary or secondary, not both.');
  if (
    tags.length &&
    (await tx.poolSkillset.count({ where: { tournamentId, id: { in: tags } } })) !== tags.length
  )
    throw new AppError('Choose skillsets from this tournament.');
}
export async function applyPoolingAction(
  tx: Prisma.TransactionClient,
  actor: Actor,
  action: PoolingAction,
  fetched: BeatmapMetadata[] | null = null,
): Promise<unknown> {
  assertPoolingPermission(actor, action);
  const tournamentId = tenant(actor);
  if (action.type === 'pooling.pools.release') {
    const pools = await tx.mappool.findMany({
      where: { tournamentId, id: { in: action.pools.map((pool) => pool.id) } },
    });
    if (pools.length !== action.pools.length)
      throw new AppError('A selected pool does not exist in this tournament.', 404);
    for (const pool of pools) {
      const expected = action.pools.find((item) => item.id === pool.id)!;
      if (
        pool.draftRevisionId !== expected.draftRevisionId ||
        pool.publishedRevisionId !== expected.publishedRevisionId ||
        pool.state !== expected.state
      )
        throw new AppError('A selected pool changed. Reload before releasing.', 409);
    }
    for (const pool of pools) {
      if (action.operation === 'PUBLISH')
        await publishPoolDraft(tx, actor, pool.id, pool.draftRevisionId || '');
      else
        await tx.mappool.update({
          where: { id: pool.id, tournamentId },
          data: { state: 'UNPUBLISHED', publishedRevisionId: null },
        });
    }
    return { updated: pools.length };
  }
  if (action.type === 'pooling.plan.save') return savePoolPlan(tx, actor, action.stageId, action);
  if (action.type === 'pooling.pool.transfer') {
    const include = {
      draftRevision: { include: { slots: true } },
      publishedRevision: { include: { slots: true } },
    };
    const source = await tx.mappool.findFirst({
      where: { id: action.sourcePoolId, tournamentId },
      include,
    });
    const target = await tx.mappool.findFirst({
      where: { stageId: action.targetStageId, tournamentId },
      include,
    });
    if (!source || !target || source.id === target.id)
      throw new AppError('Choose a different destination stage from this tournament.');
    const revision = source.draftRevision || source.publishedRevision;
    if (
      revision?.id !== action.sourceRevisionId ||
      target.draftRevisionId !== action.targetBaseRevisionId
    )
      throw new AppError('A source or destination draft changed. Reload before transferring.', 409);
    const selected = revision.slots.filter((slot) => action.slotNames.includes(slot.name));
    if (selected.length !== action.slotNames.length)
      throw new AppError('Some selected slots no longer exist.', 409);
    const destination = target.draftRevision || target.publishedRevision;
    if (!action.replace && destination?.slots.some((slot) => action.slotNames.includes(slot.name)))
      throw new AppError(
        'Destination slots are filled. Confirm replacement or rename the source slots.',
        409,
      );
    const categories = await tx.modCategory.findMany({ where: { tournamentId } });
    const combined = [
      ...(destination?.slots || []).filter((slot) => !action.slotNames.includes(slot.name)),
      ...selected,
    ];
    if (combined.length > 100)
      throw new AppError(
        'A pool supports at most 100 slots. Remove destination slots before transferring.',
      );
    const problems = poolSlotErrors(combined, categories);
    if (problems.length) throw new AppError(problems.join(' '));
    if (new Set(combined.map((slot) => slot.beatmapId)).size !== combined.length)
      throw new AppError('The destination would contain the same beatmap in multiple slots.');
    const createRevision = async (poolId: string, notes: string, slots: typeof combined) => {
      const created = await tx.mappoolRevision.create({
        data: {
          tournamentId,
          mappoolId: poolId,
          notes,
          createdBy: actor.id,
          slots: {
            create: sortPoolSlots(slots, categories).map((slot, position) => ({
              name: slot.name,
              category: slot.category,
              categoryName: slot.categoryName,
              categoryPriority: slot.categoryPriority,
              color: slot.color,
              beatmapId: slot.beatmapId,
              metadata: json(slot.metadata),
              position,
            })),
          },
        },
      });
      await tx.mappool.update({ where: { id: poolId }, data: { draftRevisionId: created.id } });
      return created.id;
    };
    const revisionId = await createRevision(target.id, destination?.notes || '', combined);
    if (action.mode === 'MOVE')
      await createRevision(
        source.id,
        revision.notes,
        revision.slots.filter((slot) => !action.slotNames.includes(slot.name)),
      );
    await tx.poolPlan.updateMany({
      where: {
        tournamentId,
        stageId: {
          in: action.mode === 'MOVE' ? [source.stageId, target.stageId] : [target.stageId],
        },
      },
      data: { reviewState: 'DRAFT', version: { increment: 1 } },
    });
    return { revisionId, transferred: selected.length };
  }
  if (action.type === 'pooling.plan.review') {
    if (action.state === 'APPROVED') {
      const stage = await tx.tournamentStage.findFirst({
        where: { id: action.stageId, tournamentId },
        include: { mappool: { include: { draftRevision: { include: { slots: true } } } } },
      });
      const slots = stage?.mappool?.draftRevision?.slots;
      if (!stage || !slots?.length)
        throw new AppError('Save a non-empty mappool draft before approval.');
      await assertPlanComplete(tx, tournamentId, stage.id, slots);
      if (['ELIMINATION', 'GROUPS'].includes(stage.kind)) {
        const settings = await tx.tournamentSettings.findUniqueOrThrow({ where: { tournamentId } });
        const problems = stagePoolProblems(
          stage.kind,
          inheritedRules(stage.matchRules || settings.matchRules, settings.gameplayScoring),
          slots,
        );
        if (problems.length) throw new AppError(problems.join(' '));
      }
    }
    const result = await tx.poolPlan.updateMany({
      where: { tournamentId, stageId: action.stageId, version: action.baseVersion },
      data: { reviewState: action.state, version: { increment: 1 } },
    });
    if (result.count !== 1)
      throw new AppError('The plan changed. Reload before changing review status.', 409);
    return { updated: 1 };
  }
  if (action.type === 'pooling.skillset.save') {
    const data = { name: action.name, group: action.group };
    return action.id
      ? tx.poolSkillset.update({ where: { id: action.id, tournamentId }, data })
      : tx.poolSkillset.create({ data: { tournamentId, ...data } });
  }
  if (action.type === 'pooling.skillset.delete') {
    if (await tx.poolCandidateTag.count({ where: { tournamentId, skillsetId: action.id } }))
      throw new AppError('Remove this skillset from its suggestions before deleting it.');
    return tx.poolSkillset.delete({ where: { id: action.id, tournamentId } });
  }
  if (action.type === 'pooling.warning.save') {
    const data = {
      artist: action.artist,
      artistKey: artistKey(action.artist),
      severity: action.severity,
      reason: action.reason,
      source: action.source,
    };
    return action.id
      ? tx.poolArtistWarning.update({ where: { id: action.id, tournamentId }, data })
      : tx.poolArtistWarning.create({ data: { tournamentId, ...data } });
  }
  if (action.type === 'pooling.warning.delete')
    return tx.poolArtistWarning.delete({ where: { id: action.id, tournamentId } });
  if (action.type === 'pooling.suggest') {
    await validateReferences(
      tx,
      tournamentId,
      action.stageId,
      action.category,
      action.primaryTagIds,
      action.secondaryTagIds,
    );
    const skipped: number[] = [],
      created: string[] = [];
    for (const beatmapId of action.beatmapIds) {
      if (
        await tx.poolCandidate.findUnique({
          where: { tournamentId_beatmapId: { tournamentId, beatmapId } },
        })
      ) {
        skipped.push(beatmapId);
        continue;
      }
      const metadata = fetched?.find((map) => map.id === beatmapId);
      if (!metadata)
        throw new AppError(
          `Beatmap ${beatmapId} metadata is unavailable. Fetch it before suggesting.`,
        );
      const candidate = await tx.poolCandidate.create({
        data: {
          tournamentId,
          beatmapId,
          metadata: json(metadata),
          stageId: action.stageId,
          category: action.category,
          notes: action.notes,
          submitterId: actor.id,
        },
      });
      const tags = [
        ...(action.primaryTagIds || []).map((skillsetId) => ({ skillsetId, primary: true })),
        ...(action.secondaryTagIds || []).map((skillsetId) => ({ skillsetId, primary: false })),
      ];
      if (tags.length)
        await tx.poolCandidateTag.createMany({
          data: tags.map((tag) => ({ ...tag, candidateId: candidate.id, tournamentId })),
        });
      created.push(candidate.id);
    }
    return { created: created.length, skipped };
  }
  if (action.type === 'pooling.bulk') {
    const rows = await tx.poolCandidate.findMany({
      where: { tournamentId, id: { in: action.candidates.map((row) => row.id) } },
      include: { tags: true },
    });
    if (
      rows.length !== action.candidates.length ||
      rows.some(
        (row) => row.version !== action.candidates.find((item) => item.id === row.id)!.baseVersion,
      )
    )
      throw new AppError('A suggestion changed or was removed. Reload the selection.', 409);
    const patch = action.patch;
    await validateReferences(
      tx,
      tournamentId,
      patch.stageId,
      patch.category,
      patch.primaryTagIds,
      patch.secondaryTagIds,
    );
    if (patch.reviewerIds?.length) {
      const count = await tx.user.count({
        where: {
          id: { in: patch.reviewerIds },
          roles: {
            some: {
              tournamentId,
              role: {
                permissions: {
                  some: { permissionKey: { in: ['mappools.edit', 'mappools.view_drafts'] } },
                },
              },
            },
          },
        },
      });
      if (count !== patch.reviewerIds.length)
        throw new AppError('Playtesters need pool staff access in this tournament.');
    }
    for (const row of rows) {
      const primary =
        patch.primaryTagIds ?? row.tags.filter((tag) => tag.primary).map((tag) => tag.skillsetId);
      const secondary =
        patch.secondaryTagIds ??
        row.tags.filter((tag) => !tag.primary).map((tag) => tag.skillsetId);
      await validateReferences(tx, tournamentId, undefined, undefined, primary, secondary);
      const { reviewerIds, primaryTagIds, secondaryTagIds, ...fields } = patch;
      await tx.poolCandidate.update({
        where: { id: row.id },
        data: { ...fields, version: { increment: 1 } },
      });
      if (primaryTagIds !== undefined || secondaryTagIds !== undefined) {
        await tx.poolCandidateTag.deleteMany({ where: { candidateId: row.id, tournamentId } });
        const tags = [
          ...primary.map((skillsetId) => ({ skillsetId, primary: true })),
          ...secondary.map((skillsetId) => ({ skillsetId, primary: false })),
        ];
        if (tags.length)
          await tx.poolCandidateTag.createMany({
            data: tags.map((tag) => ({ ...tag, tournamentId, candidateId: row.id })),
          });
      }
      if (reviewerIds?.length)
        await tx.poolReview.createMany({
          data: reviewerIds.map((reviewerId) => ({
            tournamentId,
            candidateId: row.id,
            reviewerId,
          })),
          skipDuplicates: true,
        });
    }
    return { updated: rows.length };
  }
  if (action.type === 'pooling.review.save') {
    const candidate = await tx.poolCandidate.findFirst({
      where: { id: action.candidateId, tournamentId },
    });
    if (!candidate) throw new AppError('Suggestion not found.', 404);
    const existing = await tx.poolReview.findUnique({
      where: { candidateId_reviewerId: { candidateId: candidate.id, reviewerId: actor.id } },
    });
    if (!existing && !can(actor, 'mappools.edit'))
      throw new AppError('Only assigned playtesters can submit feedback.', 403);
    if ((existing?.version ?? null) !== action.baseVersion)
      throw new AppError('Your review changed. Reload before saving.', 409);
    const data = {
      fit: action.fit,
      difficulty: action.difficulty,
      flags: action.flags,
      notes: action.notes,
      completed: true,
    };
    return existing
      ? tx.poolReview.update({
          where: { id: existing.id },
          data: { ...data, version: { increment: 1 } },
        })
      : tx.poolReview.create({
          data: { tournamentId, candidateId: candidate.id, reviewerId: actor.id, ...data },
        });
  }
  if (action.type === 'pooling.select') {
    const candidate = await tx.poolCandidate.findFirst({
      where: { id: action.candidateId, tournamentId },
    });
    if (!candidate || candidate.version !== action.baseVersion)
      throw new AppError('The suggestion changed. Reload before selecting it.', 409);
    if (!['ACCEPTED', 'SELECTED'].includes(candidate.status))
      throw new AppError('Accept the suggestion before assigning it to a pool.');
    await validateReferences(tx, tournamentId, action.stageId, candidate.category);
    const stage = await tx.tournamentStage.findFirstOrThrow({
      where: { id: action.stageId, tournamentId },
      include: {
        poolPlan: true,
        mappool: {
          include: {
            draftRevision: { include: { slots: true } },
            publishedRevision: { include: { slots: true } },
          },
        },
      },
    });
    const pool = stage.mappool;
    if (!pool || pool.draftRevisionId !== action.baseRevisionId)
      throw new AppError('The destination draft changed. Reload before selecting.', 409);
    const metadata = candidate.metadata as unknown as BeatmapMetadata;
    const tournament = await tx.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
      select: { gameMode: true },
    });
    if (metadata.mode !== tournament.gameMode)
      throw new AppError('This suggestion uses a different game mode from the tournament.');
    const warning = await tx.poolArtistWarning.findUnique({
      where: { tournamentId_artistKey: { tournamentId, artistKey: artistKey(metadata.artist) } },
    });
    if (warning?.severity === 'BANNED' && action.warningResolution.length < 3)
      throw new AppError(`Artist ban: ${warning.reason}. An explicit resolution is required.`);
    const revision = pool.draftRevision || pool.publishedRevision;
    const name = normalizedSlot({
      name: action.slotName,
      category: candidate.category,
      beatmapId: candidate.beatmapId,
    }).name;
    if (revision?.slots.some((slot) => slot.name === name) && !action.replace)
      throw new AppError('That slot is filled. Confirm replacement explicitly.', 409);
    if (
      revision?.slots.some((slot) => slot.beatmapId === candidate.beatmapId && slot.name !== name)
    )
      throw new AppError('This beatmap is already assigned to a different slot.');
    const categories = await tx.modCategory.findMany({ where: { tournamentId } });
    const category = categories.find((item) => item.acronym === candidate.category)!;
    const slots = [
      ...(revision?.slots || [])
        .filter((slot) => slot.name !== name)
        .map(({ name, category, categoryName, categoryPriority, color, beatmapId, metadata }) => ({
          name,
          category,
          categoryName,
          categoryPriority,
          color,
          beatmapId,
          metadata,
        })),
      {
        name,
        category: category.acronym,
        categoryName: category.name,
        categoryPriority: category.position,
        color: category.color,
        beatmapId: candidate.beatmapId,
        metadata: json(metadata),
      },
    ];
    if (slots.length > 100)
      throw new AppError(
        'A pool supports at most 100 slots. Replace an existing slot or remove one before selecting.',
      );
    const problems = poolSlotErrors(slots, categories);
    if (problems.length) throw new AppError(problems.join(' '));
    const created = await tx.mappoolRevision.create({
      data: {
        tournamentId,
        mappoolId: pool.id,
        notes: revision?.notes || '',
        createdBy: actor.id,
        slots: {
          create: sortPoolSlots(slots, categories).map((slot, position) => ({
            ...slot,
            position,
            metadata: json(slot.metadata),
          })),
        },
      },
    });
    await tx.mappool.update({ where: { id: pool.id }, data: { draftRevisionId: created.id } });
    if (stage.poolPlan)
      await tx.poolPlan.update({
        where: { id: stage.poolPlan.id },
        data: { reviewState: 'DRAFT', version: { increment: 1 } },
      });
    await tx.poolCandidate.update({
      where: { id: candidate.id },
      data: {
        status: 'SELECTED',
        stageId: stage.id,
        selectedSlot: name,
        version: { increment: 1 },
        warningResolution:
          warning?.severity === 'BANNED'
            ? {
                warningId: warning.id,
                reason: warning.reason,
                resolution: action.warningResolution,
              }
            : Prisma.DbNull,
      },
    });
    return { revisionId: created.id };
  }
}
