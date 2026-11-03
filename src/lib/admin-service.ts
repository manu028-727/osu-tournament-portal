import { db as rootDb } from './db';
import { scopedDb } from './scoped-db';
import { assertOwnedMedia } from './media-access';
import { actorForTournament } from './auth';
import { PLATFORM_PERMISSIONS } from './permissions';
import { actionSchema, type AdminAction } from './validation';
import { type Actor, type PermissionKey, assertPermission, AppError } from './permissions';
import { cleanHtml } from './rich-text';
import { applyEligibilityAction, type EligibilityPrepared } from './eligibility-service';
import { beatmaps, osuProfile } from './osu';
import { playerRanks } from './registration-service';
import { applyResourceAction } from './resource-service';
import { applyFormationAction } from './team-formation-service';
import { Prisma } from '@/generated/prisma/client';
import { teamPermission, prepareTeamAction, applyTeamAction } from './teams-service';
import type { TeamAction } from './teams-validation';
import type { MatchAction } from './matches-validation';
import { applyMatchAction, matchPermission, assertMatchActionPermission } from './matches-service';
import { applyBulkScheduleAction } from './matches-bulk-service';
import { poolSlotErrors, sortPoolSlots } from './mappool-order';
import {
  qualifierPermission,
  assertQualifierPermission,
  applyQualifierAction,
} from './qualifiers-service';
import type { QualifierAction } from './qualifiers-validation';
import { inheritedRules } from './gameplay-scoring';
import { applySettingsAction } from './settings-service';
import { qualifierPolicySchema } from './qualifier-policy';
import { applyCompetitionAction, competitionPermission } from './competition-service';
import type { CompetitionAction } from './competition-validation';
import {
  applyQualifierStandingsAction,
  type QualifierStandingsAction,
} from './qualifier-standings-service';
import { applyStageReconciliation } from './stage-reconciliation-service';
import {
  applyPoolingAction,
  assertPoolingPermission,
  poolingPermission,
  preparePoolingAction,
  savePoolPlan,
  publishPoolDraft,
} from './pooling-service';
import type { PoolingAction } from './pooling-validation';
import { applyStageWorkflowAction, stageConfigurationToken } from './stage-workflows';
import { applyStaffBulkAction } from './staff-bulk';
import { applyUserRoles } from './user-roles-service';
import { roleConfiguration } from './role-configuration';
import { saveFormatPlan } from './format-plan-service';
import { previewFormatPlan } from './format-preview';
import {
  advancementPreview,
  applyAdvancement,
  lockFormat,
  reseedPhaseRound,
  unlockFormat,
} from './format-lifecycle-service';
export function actionPermission(a: AdminAction): PermissionKey {
  if (a.type === 'format.unlock') return 'matches.delete';
  if (a.type.startsWith('format.')) return 'matches.manage';
  if (a.type === 'setup.state') return 'settings.manage';
  if (a.type.startsWith('formation.') || a.type.startsWith('resource.')) return 'teams.edit';
  // Allowing a player is the same decision as approving them; a rank reading only edits rosters.
  if (a.type === 'eligibility.ranks.capture') return 'teams.edit';
  if (a.type.startsWith('eligibility.')) return 'teams.publish';
  if (a.type === 'stage.duplicate') return 'mappools.create';
  if (a.type === 'stage.rules.patch' || a.type === 'stage.rules.apply') return 'matches.manage';
  if (a.type === 'stage.reorder') return 'mappools.edit';
  if (a.type.startsWith('pooling.')) return poolingPermission(a as PoolingAction);
  if (a.type === 'matches.bulk.schedule' || a.type === 'matches.batch.schedule')
    return 'matches.manage';
  if (a.type.startsWith('competition.')) return competitionPermission(a as CompetitionAction);
  if (
    a.type.startsWith('qualifier.standings.') ||
    a.type === 'qualifier.policy.save' ||
    a.type === 'stage.reconcile'
  )
    return 'matches.manage';
  if (a.type.startsWith('qualifier.')) return qualifierPermission(a as QualifierAction);
  if (a.type.startsWith('match.')) return matchPermission(a as MatchAction);
  if (a.type.startsWith('team.')) return teamPermission(a as TeamAction);
  if (a.type.startsWith('page.'))
    return `${'slug' in a && a.slug === 'home' ? 'homepage' : 'rules'}.${a.type === 'page.publish' || a.type === 'page.unpublish' ? 'publish' : 'edit'}` as PermissionKey;
  if (a.type.startsWith('staff.')) return 'staff.edit';
  if (a.type.startsWith('role.')) return 'roles.manage';
  if (a.type === 'user.roles' || a.type === 'user.roles.bulk') return 'users.manage';
  if (a.type === 'settings.save') return 'settings.manage';
  if (a.type === 'stage.delete') return 'mappools.delete';
  if (a.type === 'stage.save') return 'id' in a && a.id ? 'mappools.edit' : 'mappools.create';
  if (a.type === 'pool.publish' || a.type === 'pool.unpublish') return 'mappools.publish';
  return 'mappools.edit';
}
function assertActionPermission(actor: Actor | null, action: AdminAction): asserts actor is Actor {
  if (action.type.startsWith('pooling.')) assertPoolingPermission(actor, action as PoolingAction);
  else if (
    action.type.startsWith('qualifier.') &&
    !action.type.startsWith('qualifier.standings.') &&
    action.type !== 'qualifier.policy.save'
  )
    assertQualifierPermission(actor, action as QualifierAction);
  else if (action.type.startsWith('match.'))
    assertMatchActionPermission(actor, action as MatchAction);
  // A composite save has no authority of its own: each operation needs its usual permission.
  else if (action.type === 'setup.apply') {
    if (!actor) throw new AppError('Sign in to continue.', 401);
    for (const operation of action.operations)
      assertActionPermission(actor, actionSchema.parse(operation));
  } else assertPermission(actor, actionPermission(action));
}
const resolveSetupRefs = (value: unknown, refs: ReadonlyMap<string, string>): unknown => {
  if (typeof value === 'string') return refs.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => resolveSetupRefs(item, refs));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveSetupRefs(item, refs)]),
    );
  return value;
};
export async function executeAction(
  originalActor: Actor | null,
  a: AdminAction,
  tournamentId = originalActor?.tournamentId || 'main',
) {
  const db = scopedDb(rootDb, tournamentId);
  assertActionPermission(originalActor, a);
  const tournament = await db.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
  const teamPrepared = a.type.startsWith('team.')
    ? await prepareTeamAction(originalActor, a as TeamAction)
    : null;
  const fetched =
    a.type === 'pool.save'
      ? await beatmaps(
          a.slots.map((s) => s.beatmapId),
          tournament.gameMode,
        )
      : null;
  const poolingPrepared = a.type.startsWith('pooling.')
    ? await preparePoolingAction({ ...originalActor, tournamentId }, a as PoolingAction)
    : null;
  if (fetched?.errors.length)
    throw AppError.fromMessages(
      fetched.errors.map((e) => `${e.id}: ${e.error}`),
      400,
      ' ',
    );
  const existingStaff =
    a.type === 'staff.save' && a.id
      ? await db.staffMember.findUnique({ where: { id: a.id } })
      : null;
  const profile =
    a.type === 'staff.save'
      ? existingStaff?.osuId === a.osuId
        ? { username: existingStaff.username, avatar_url: existingStaff.avatarUrl }
        : await osuProfile(a.osuId)
      : null;
  const eligibilityPrepared =
    a.type === 'eligibility.exception.grant'
      ? {
          username:
            (await rootDb.participant.findUnique({ where: { osuId: a.osuId } }))?.username ??
            (await osuProfile(a.osuId)).username,
        }
      : a.type === 'eligibility.ranks.capture'
        ? { ranks: await playerRanks(tournament.gameMode, a.osuIds) }
        : null;
  return db.$transaction(
    async (tx) => {
      // Serializes mutations and last-owner checks across every application instance.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
      const user = await tx.user.findUniqueOrThrow({
        where: { id: originalActor.id },
        include: {
          roles: { where: { tournamentId }, include: { role: { include: { permissions: true } } } },
        },
      });
      const actor = actorForTournament(user, tournamentId);
      return applyAdminOperation(tx, actor, tournamentId, tournament, a, {
        teamPrepared,
        fetched,
        poolingPrepared,
        profile,
        eligibilityPrepared,
      });
    },
    { timeout: 15000 },
  );
}

// One audited operation inside an already locked transaction. Permission and media
// ownership are checked here so a composite save cannot skip what a single action enforces.
async function applyAdminOperation(
  tx: Prisma.TransactionClient,
  actor: Actor,
  tournamentId: string,
  tournament: { gameMode: string },
  a: AdminAction,
  prepared: AdminOperationPrepared,
): Promise<unknown> {
  const { teamPrepared, fetched, poolingPrepared, profile, eligibilityPrepared } = prepared;
  assertActionPermission(actor, a);
  if (['page.save', 'settings.save', 'staff.save'].includes(a.type))
    await assertOwnedMedia(tx as Parameters<typeof assertOwnedMedia>[0], a);
  let result: unknown = { ok: true };
  let entityId = tournamentId;
  switch (a.type) {
    case 'format.plan.save':
      result = await saveFormatPlan(tx, actor, tournamentId, a);
      break;
    case 'format.plan.preview':
      result = await previewFormatPlan(
        a.plan,
        (
          await tx.tournamentStage.findMany({
            where: { tournamentId, archivedAt: null, kind: { not: 'QUALIFIERS' } },
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
            select: { id: true },
          })
        ).map((stage) => stage.id),
      );
      break;
    case 'format.lock':
      result = await lockFormat(tx, actor, tournamentId, a);
      break;
    case 'format.unlock':
      result = await unlockFormat(tx, actor, tournamentId, a);
      break;
    case 'format.advance.preview':
      result = await advancementPreview(tx, actor, tournamentId, a);
      break;
    case 'format.advance':
      result = await applyAdvancement(tx, actor, tournamentId, a);
      break;
    case 'format.reseed':
      result = await reseedPhaseRound(tx, actor, tournamentId, a);
      break;
    case 'formation.start':
    case 'formation.assign':
    case 'formation.unassign':
    case 'formation.reserve':
    case 'formation.fill':
    case 'formation.paste':
    case 'formation.rename':
    case 'formation.confirm':
    case 'formation.reopen':
    case 'formation.restart':
      result = await applyFormationAction(tx, actor, tournamentId, a);
      break;
    case 'resource.item.save':
    case 'resource.item.archive':
    case 'resource.purchase':
    case 'resource.purchase.reverse':
    case 'resource.adjust':
      result = await applyResourceAction(tx, actor, tournamentId, a);
      break;
    case 'eligibility.exception.grant':
    case 'eligibility.exception.revoke':
    case 'eligibility.ranks.capture':
      result = await applyEligibilityAction(tx, actor, tournamentId, a, eligibilityPrepared ?? {});
      break;
    case 'setup.state':
      await tx.tournamentSettings.update({
        where: { tournamentId },
        data: { setupState: { dismissed: a.dismissed } },
      });
      break;
    case 'setup.apply': {
      const refs = new Map<string, string>();
      const results: unknown[] = [];
      for (const { ref, ...raw } of a.operations) {
        const operation = actionSchema.parse(resolveSetupRefs(raw, refs));
        const outcome = await applyAdminOperation(
          tx,
          actor,
          tournamentId,
          tournament,
          operation,
          {},
        );
        const created = (outcome as { id?: unknown }).id;
        if (ref && typeof created === 'string') refs.set(`ref:${ref}`, created);
        results.push(outcome);
      }
      result = { refs: Object.fromEntries(refs), results };
      break;
    }
    case 'stage.rules.patch':
    case 'stage.rules.apply':
    case 'stage.reorder':
    case 'stage.duplicate':
      result = await applyStageWorkflowAction(tx, actor, a);
      break;
    case 'pooling.plan.save':
    case 'pooling.pool.transfer':
    case 'pooling.pools.release':
    case 'pooling.plan.review':
    case 'pooling.suggest':
    case 'pooling.bulk':
    case 'pooling.review.save':
    case 'pooling.select':
    case 'pooling.skillset.save':
    case 'pooling.skillset.delete':
    case 'pooling.warning.save':
    case 'pooling.warning.delete':
      result = await applyPoolingAction(tx, actor, a, poolingPrepared);
      break;
    case 'matches.bulk.schedule':
    case 'matches.batch.schedule':
      result = await applyBulkScheduleAction(tx, actor, tournamentId, a);
      entityId = 'bulk';
      break;
    case 'competition.create':
    case 'competition.lifecycle.preview':
    case 'competition.delete':
    case 'competition.regenerate':
    case 'competition.regenerate-missing':
    case 'competition.preview':
    case 'competition.publish':
    case 'competition.link-match':
    case 'competition.rounds.stage':
    case 'competition.sync':
    case 'competition.slot':
    case 'competition.route':
    case 'competition.entry':
    case 'competition.group.resolve':
      result = await applyCompetitionAction(tx, actor, a as CompetitionAction);
      break;
    case 'qualifier.policy.save':
    case 'qualifier.standings.calculate':
    case 'qualifier.standings.resolve':
    case 'qualifier.standings.finalize':
    case 'qualifier.standings.publish':
    case 'qualifier.standings.reopen':
      result = await applyQualifierStandingsAction(tx, actor, a as QualifierStandingsAction);
      break;
    case 'stage.reconcile':
      result = await applyStageReconciliation(tx, actor, a);
      break;
    case 'qualifier.create':
    case 'qualifier.delete':
    case 'qualifier.edit':
    case 'qualifier.scores.resolve':
    case 'qualifier.batch.create':
    case 'qualifier.bulk.schedule':
    case 'qualifier.participants.move':
    case 'qualifier.participants.remove':
    case 'qualifier.booking':
    case 'qualifier.map':
    case 'qualifier.scores':
    case 'qualifier.schedule':
    case 'qualifier.lobby':
    case 'qualifier.score':
    case 'qualifier.score.remove':
    case 'qualifier.status': {
      result = await applyQualifierAction(tx, actor, a);
      entityId = (result as { id?: string }).id || 'bulk';
      break;
    }
    case 'match.create':
    case 'match.resolve':
    case 'match.schedule':
    case 'match.rules.save':
    case 'match.start':
    case 'match.roll':
    case 'match.draft':
    case 'match.undo':
    case 'match.score':
    case 'match.winner':
    case 'match.import':
    case 'match.multiplayer.ignore':
    case 'match.multiplayer.associate':
    case 'match.timer':
    case 'match.incident':
    case 'match.attempt':
    case 'match.sanction':
    case 'match.lobby':
    case 'match.submit':
    case 'match.confirm':
    case 'match.reopen':
    case 'match.dispute':
    case 'match.cancel':
    case 'match.delete':
    case 'match.correct':
    case 'match.detected_pick':
    case 'match.forfeit':
    case 'match.visibility':
    case 'match.summary':
    case 'match.result.set':
    case 'match.result.import': {
      result = await applyMatchAction(tx, actor, a);
      entityId = (result as { id: string }).id;
      break;
    }
    case 'team.save':
    case 'team.patch':
    case 'team.bulk':
    case 'team.status':
    case 'team.delete':
    case 'team.import.preview':
    case 'team.import.apply': {
      result = await applyTeamAction(tx, actor, a, teamPrepared!);
      entityId =
        a.type === 'team.save' ? (result as { id: string }).id : 'id' in a && a.id ? a.id : 'main';
      break;
    }
    case 'page.save':
    case 'page.restore': {
      let page = await tx.page.findFirst({ where: { slug: a.slug } });
      if (!page && a.type === 'page.save' && a.baseRevisionId === null)
        page = await tx.page.create({ data: { slug: a.slug, title: a.title } });
      if (!page) throw new AppError('This page no longer exists. Reload before continuing.', 409);
      entityId = page.id;
      if (page.draftRevisionId !== a.baseRevisionId)
        throw new AppError('A newer draft exists. Reload before saving your changes.', 409);
      let title, html, blocks;
      if (a.type === 'page.restore') {
        const revision = await tx.pageRevision.findFirstOrThrow({
          where: { id: a.revisionId, pageId: page.id },
          include: { blocks: { orderBy: { position: 'asc' } } },
        });
        title = revision.title;
        html = revision.html;
        blocks = revision.blocks.map((b) => ({
          type: b.type,
          visible: b.visible,
          content: b.content,
        }));
      } else {
        title = a.title;
        html = cleanHtml(a.html);
        blocks = a.blocks.map((b) => ({
          ...b,
          content: {
            ...b.content,
            ...(b.content.html ? { html: cleanHtml(b.content.html) } : {}),
          },
        }));
      }
      const revision = await tx.pageRevision.create({
        data: {
          pageId: page.id,
          title,
          html,
          createdBy: actor.id,
          blocks: {
            create: blocks.map((b, i) => ({
              type: b.type,
              visible: b.visible,
              content: b.content as Prisma.InputJsonValue,
              position: i,
            })),
          },
        },
      });
      await tx.page.update({ where: { id: page.id }, data: { draftRevisionId: revision.id } });
      result = { revisionId: revision.id };
      break;
    }
    case 'page.publish': {
      const page = await tx.page.findFirstOrThrow({ where: { slug: a.slug } });
      entityId = page.id;
      if (page.draftRevisionId !== a.revisionId)
        throw new AppError(
          'The draft changed. Reload and review the latest version before publishing.',
          409,
        );
      await tx.page.update({
        where: { id: page.id },
        data: { publishedRevisionId: page.draftRevisionId, state: 'PUBLISHED' },
      });
      break;
    }
    case 'page.unpublish':
      await tx.page.update({
        where: { tournamentId_slug: { tournamentId, slug: a.slug } },
        data: { state: 'UNPUBLISHED', publishedRevisionId: null },
      });
      entityId = a.slug;
      break;
    case 'stage.save': {
      const { type, id, matchRules, qualifierPolicy, baseConfigurationToken, ...fields } = a;
      void type;
      const beforeStage = id ? await tx.tournamentStage.findUniqueOrThrow({ where: { id } }) : null;
      if (
        id &&
        (!baseConfigurationToken ||
          !beforeStage ||
          stageConfigurationToken(beforeStage) !== baseConfigurationToken)
      )
        throw new AppError('This stage changed. Reload and review before saving.', 409);
      if (qualifierPolicy !== undefined) assertPermission(actor, 'matches.manage');
      const kind = a.kind || beforeStage?.kind || 'CUSTOM';
      if (kind === 'QUALIFIERS' && matchRules)
        throw new AppError(
          'Qualifier stages use qualifier policy, not Best-of or pick/ban settings.',
        );
      if (id && a.kind && a.kind !== beforeStage?.kind) {
        if (
          (a.kind === 'QUALIFIERS' &&
            ((await tx.match.count({ where: { stageId: id } })) ||
              (await tx.bracketRound.count({ where: { stageId: id } })))) ||
          (a.kind !== 'QUALIFIERS' && (await tx.qualifierLobby.count({ where: { stageId: id } })))
        )
          throw new AppError(
            'This stage type is already used by incompatible competition records.',
            409,
          );
      }
      if (
        id &&
        a.qualifierPolicy !== undefined &&
        JSON.stringify(qualifierPolicySchema.parse(a.qualifierPolicy || {})) !==
          JSON.stringify(qualifierPolicySchema.parse(beforeStage?.qualifierPolicy || {}))
      ) {
        if (await tx.qualifierLobby.count({ where: { stageId: id } }))
          throw new AppError(
            'Qualifier policy is snapshotted by existing sessions. Use Reprocess scoring in Qualifier results to review changes across the stage.',
            409,
          );
      }
      if (matchRules !== undefined) assertPermission(actor, 'matches.manage');
      const data = {
        ...fields,
        ...(qualifierPolicy !== undefined
          ? {
              qualifierPolicy: qualifierPolicy
                ? JSON.parse(JSON.stringify(qualifierPolicy))
                : Prisma.DbNull,
            }
          : {}),
        ...(matchRules !== undefined
          ? {
              matchRules: matchRules
                ? JSON.parse(
                    JSON.stringify(
                      inheritedRules(
                        matchRules,
                        (
                          await tx.tournamentSettings.findUniqueOrThrow({
                            where: { tournamentId },
                          })
                        ).gameplayScoring,
                        tournament.gameMode,
                      ),
                    ),
                  )
                : null,
            }
          : {}),
      };
      if (data.nextStageId) {
        if (data.nextStageId === id) throw new AppError('A stage cannot advance to itself.');
        let cursor: string | null = data.nextStageId;
        const seen = new Set([id]);
        while (cursor) {
          if (seen.has(cursor)) throw new AppError('Stage progression cannot contain a cycle.');
          seen.add(cursor);
          cursor = (await tx.tournamentStage.findUniqueOrThrow({ where: { id: cursor } }))
            .nextStageId;
        }
      }
      if (
        data.bannerImageId &&
        !(await tx.mediaAsset.findUnique({ where: { id: data.bannerImageId } }))
      )
        throw new AppError('The selected stage banner no longer exists.');
      const stage = id
        ? await tx.tournamentStage.update({ where: { id }, data })
        : await tx.tournamentStage.create({ data: { ...data, mappool: { create: {} } } });
      entityId = stage.id;
      result = { id: stage.id };
      break;
    }
    case 'stage.delete':
      if (await tx.tournamentPhase.count({ where: { stageId: a.id } }))
        throw new AppError(
          'This stage is part of the tournament format. Change the format before deleting it.',
          409,
        );
      if (await tx.poolCandidate.count({ where: { stageId: a.id } }))
        throw new AppError(
          'Move this stage’s suggestions to another stage or archive the stage to preserve their reviews.',
          409,
        );
      if (await tx.bracketRound.count({ where: { stageId: a.id } }))
        throw new AppError(
          'This stage is assigned to a competition bracket. Archive it instead of deleting its history.',
          409,
        );
      if (await tx.qualifierStanding.count({ where: { stageId: a.id } }))
        throw new AppError(
          'This stage has versioned qualifier standings and cannot be deleted.',
          409,
        );
      if (await tx.match.count({ where: { stageId: a.id } }))
        throw new AppError('This stage is used in match history and cannot be deleted.', 409);
      if (await tx.qualifierLobby.count({ where: { stageId: a.id } }))
        throw new AppError('This stage is used by a qualifier lobby and cannot be deleted.', 409);
      await tx.tournamentStage.delete({ where: { id: a.id } });
      entityId = a.id;
      break;
    case 'pool.save': {
      const pool = await tx.mappool.findUniqueOrThrow({ where: { id: a.id } });
      entityId = pool.id;
      if (pool.draftRevisionId !== a.baseRevisionId)
        throw new AppError('A newer mappool draft exists. Reload before saving.', 409);
      if (a.plan) await savePoolPlan(tx, actor, pool.stageId, a.plan);
      else
        await tx.poolPlan.updateMany({
          where: { stageId: pool.stageId },
          data: { reviewState: 'DRAFT', version: { increment: 1 } },
        });
      const categories = await tx.modCategory.findMany();
      const problems = poolSlotErrors(a.slots, categories);
      if (problems.length) throw AppError.fromMessages(problems, 400, ' ');
      const slots = sortPoolSlots(a.slots, categories).map((s, position) => {
        const category = categories.find((c) => c.acronym === s.category);
        if (!category) throw new AppError('Unknown mod category: {0}', 400, [s.category]);
        const metadata = fetched!.maps.find((m) => m.id === s.beatmapId)!;
        return {
          name: s.name,
          category: category.acronym,
          categoryName: category.name,
          categoryPriority: category.position,
          color: category.color,
          position,
          beatmapId: s.beatmapId,
          metadata,
        };
      });
      const revision = await tx.mappoolRevision.create({
        data: {
          mappoolId: pool.id,
          notes: a.notes,
          createdBy: actor.id,
          slots: { create: slots },
        },
      });
      await tx.mappool.update({
        where: { id: pool.id },
        data: { draftRevisionId: revision.id },
      });
      result = { revisionId: revision.id };
      break;
    }
    case 'pool.publish': {
      await publishPoolDraft(tx, actor, a.id, a.revisionId);
      entityId = a.id;
      break;
    }
    case 'pool.unpublish':
      await tx.mappool.update({
        where: { id: a.id },
        data: { state: 'UNPUBLISHED', publishedRevisionId: null },
      });
      entityId = a.id;
      break;
    case 'category.save': {
      const { type, id, baseVersion, ...data } = a;
      void type;
      if (
        id &&
        (!baseVersion || !(await tx.modCategory.findFirst({ where: { id, version: baseVersion } })))
      )
        throw new AppError('Category changed. Reload and review before saving.', 409);
      const category = id
        ? await tx.modCategory.update({
            where: { id, version: baseVersion },
            data: { ...data, version: { increment: 1 } },
          })
        : await tx.modCategory.create({ data });
      entityId = category.id;
      break;
    }
    case 'category.delete':
      {
        const category = await tx.modCategory.findFirst({
          where: { id: a.id, version: a.baseVersion },
        });
        if (!category) throw new AppError('Category changed. Reload before deleting.', 409);
        const plans = await tx.poolPlan.findMany();
        if (
          (await tx.poolCandidate.count({ where: { category: category.acronym } })) ||
          plans.some(
            (plan) =>
              Array.isArray(plan.slots) &&
              plan.slots.some(
                (slot) =>
                  slot &&
                  typeof slot === 'object' &&
                  !Array.isArray(slot) &&
                  slot.category === category.acronym,
              ),
          )
        )
          throw new AppError(
            'This category is used by suggestions or a pool plan. Reassign those entries before deleting it.',
            409,
          );
      }
      await tx.modCategory.delete({ where: { id: a.id, version: a.baseVersion } });
      entityId = a.id;
      break;
    case 'staff.bulk':
      result = await applyStaffBulkAction(tx, actor, a);
      entityId = 'bulk';
      break;
    case 'staff.category.save': {
      const { type, id, baseVersion, ...data } = a;
      void type;
      if (
        id &&
        (!baseVersion ||
          !(await tx.staffCategory.findFirst({ where: { id, version: baseVersion } })))
      )
        throw new AppError('Staff category changed. Reload and review before saving.', 409);
      const category = id
        ? await tx.staffCategory.update({
            where: { id, version: baseVersion },
            data: { ...data, version: { increment: 1 } },
          })
        : await tx.staffCategory.create({ data });
      entityId = category.id;
      break;
    }
    case 'staff.category.delete':
      if (!(await tx.staffCategory.findFirst({ where: { id: a.id, version: a.baseVersion } })))
        throw new AppError('Category changed. Reload before deleting.', 409);
      await tx.staffMember.updateMany({
        where: { assignments: { some: { categoryId: a.id } } },
        data: { version: { increment: 1 } },
      });
      await tx.staffCategory.delete({ where: { id: a.id, version: a.baseVersion } });
      entityId = a.id;
      break;
    case 'staff.save': {
      if (
        a.id &&
        (!a.baseVersion ||
          !(await tx.staffMember.findFirst({ where: { id: a.id, version: a.baseVersion } })))
      )
        throw new AppError('Staff member changed. Reload and review before saving.', 409);
      const data = {
        osuId: a.osuId,
        username: profile!.username,
        avatarUrl: profile!.avatar_url,
        profileUrl: `https://osu.ppy.sh/users/${a.osuId}`,
        bio: a.bio,
        customImage: a.customImage,
        visible: a.visible,
        position: a.position,
      };
      if (a.id) await tx.staffAssignment.deleteMany({ where: { memberId: a.id } });
      const assignments = { create: a.assignments };
      const member = a.id
        ? await tx.staffMember.update({
            where: { id: a.id, version: a.baseVersion },
            data: { ...data, assignments, version: { increment: 1 } },
          })
        : await tx.staffMember.create({ data: { ...data, assignments } });
      entityId = member.id;
      break;
    }
    case 'staff.delete':
      if (!(await tx.staffMember.findFirst({ where: { id: a.id, version: a.baseVersion } })))
        throw new AppError('Staff member changed. Reload before deleting.', 409);
      await tx.staffMember.delete({ where: { id: a.id, version: a.baseVersion } });
      entityId = a.id;
      break;
    case 'role.save': {
      if (a.permissions.some((key) => PLATFORM_PERMISSIONS.includes(key)))
        throw new AppError('Platform permissions cannot be granted through tournament roles.', 403);
      const role = a.id
        ? await tx.role.findUniqueOrThrow({
            where: { id: a.id },
            include: { users: true, permissions: true },
          })
        : null;
      if (role && a.baseRole && a.baseRole !== roleConfiguration(role))
        throw new AppError('Role configuration changed. Reload before saving.', 409);
      if ((role?.templateKey || role?.systemKey) === 'Owner')
        throw new AppError('The Owner role is protected.', 403);
      if (role?.users.some((u) => u.userId === actor.id))
        throw new AppError('You cannot edit a role assigned to yourself.', 403);
      if (a.permissions.some((p) => !actor.permissions.includes(p)))
        throw new AppError('You cannot grant permissions you do not hold.', 403);
      if (
        role?.permissions.some((p) => !actor.permissions.includes(p.permissionKey as PermissionKey))
      )
        throw new AppError('This role contains protected permissions.', 403);
      if (a.name === 'Owner') throw new AppError('This role name is reserved.', 403);
      if (role) await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      const data = {
        name: a.name,
        description: a.description,
        permissions: {
          create: [...new Set(a.permissions)].map((permissionKey) => ({ permissionKey })),
        },
      };
      const saved = role
        ? await tx.role.update({ where: { id: role.id }, data })
        : await tx.role.create({ data });
      entityId = saved.id;
      break;
    }
    case 'role.delete': {
      const role = await tx.role.findUniqueOrThrow({
        where: { id: a.id },
        include: { users: true, permissions: true },
      });
      if (a.baseRole && a.baseRole !== roleConfiguration(role))
        throw new AppError('Role configuration changed. Reload before saving.', 409);
      if (role.systemKey || role.templateKey)
        throw new AppError('Default system roles cannot be deleted.', 403);
      if (role.users.some((u) => u.userId === actor.id))
        throw new AppError('You cannot delete a role assigned to yourself.', 403);
      if (
        role.permissions.some((p) => !actor.permissions.includes(p.permissionKey as PermissionKey))
      )
        throw new AppError('This role contains protected permissions.', 403);
      await tx.role.delete({ where: { id: a.id } });
      entityId = a.id;
      break;
    }
    case 'user.roles': {
      result = await applyUserRoles(tx, actor, tournamentId, a);
      entityId = a.userId;
      break;
    }
    case 'user.roles.bulk': {
      if (new Set(a.users.map((u) => u.userId)).size !== a.users.length)
        throw new AppError('Select each user once.');
      const changes = [];
      for (const user of a.users) {
        const roleIds =
          a.operation === 'ADD'
            ? [...new Set([...user.baseRoleIds, ...a.roleIds])]
            : user.baseRoleIds.filter((id) => !a.roleIds.includes(id));
        changes.push(
          await applyUserRoles(tx, actor, tournamentId, {
            ...user,
            roleIds,
            baseRoles: a.baseRoles,
          }),
        );
      }
      result = { changes };
      break;
    }
    case 'settings.save':
      await applySettingsAction(tx, actor, tournamentId, a);
      break;
    default: {
      const unsupported: never = a;
      void unsupported;
      throw new AppError('This administrative action is not implemented.', 400);
    }
  }
  if (
    !a.type.startsWith('competition.') &&
    !a.type.startsWith('qualifier.standings.') &&
    !a.type.endsWith('.preview') &&
    // Checking pasted lines changes nothing; only applying them belongs in the history.
    !(a.type === 'formation.paste' && !a.apply) &&
    a.type !== 'qualifier.policy.save' &&
    a.type !== 'stage.reconcile'
  )
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: a.type,
        tournamentId,
        entityType: a.type.split('.')[0],
        entityId,
        details:
          a.type === 'team.patch' ||
          a.type === 'team.bulk' ||
          a.type.startsWith('role.') ||
          a.type === 'user.roles' ||
          a.type === 'user.roles.bulk'
            ? JSON.parse(JSON.stringify({ input: a, result }))
            : a.type === 'match.delete'
              ? { code: a.confirmCode, reason: a.reason }
              : a.type.startsWith('pooling.') ||
                  a.type.startsWith('format.') ||
                  a.type.startsWith('eligibility.') ||
                  a.type.startsWith('formation.') ||
                  a.type.startsWith('resource.') ||
                  a.type.startsWith('matches.') ||
                  a.type === 'staff.bulk'
                ? JSON.parse(JSON.stringify(a))
                : {},
      },
    });
  return result;
}
type AdminOperationPrepared = {
  teamPrepared?: Awaited<ReturnType<typeof prepareTeamAction>> | null;
  fetched?: Awaited<ReturnType<typeof beatmaps>> | null;
  poolingPrepared?: Awaited<ReturnType<typeof preparePoolingAction>> | null;
  profile?: { username: string; avatar_url: string } | null;
  eligibilityPrepared?: EligibilityPrepared | null;
};
