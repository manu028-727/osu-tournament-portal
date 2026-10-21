import { db as rootDb } from './db';
import { scopedDb } from './scoped-db';
import { assertOwnedMedia } from './media-access';
import { actorForTournament } from './auth';
import { PLATFORM_PERMISSIONS } from './permissions';
import { type AdminAction } from './validation';
import {
  type Actor,
  type PermissionKey,
  assertPermission,
  assertRoleGrant,
  AppError,
} from './permissions';
import { cleanHtml } from './rich-text';
import { beatmaps, osuProfile } from './osu';
import { Prisma } from '@/generated/prisma/client';
import { teamPermission, prepareTeamAction, applyTeamAction } from './teams-service';
import type { TeamAction } from './teams-validation';
import type { MatchAction } from './matches-validation';
import { applyMatchAction, matchPermission, assertMatchActionPermission } from './matches-service';
import { poolSlotErrors, sortPoolSlots } from './mappool-order';
import {
  qualifierPermission,
  assertQualifierPermission,
  applyQualifierAction,
} from './qualifiers-service';
import type { QualifierAction } from './qualifiers-validation';
import { inheritedRules } from './gameplay-scoring';
import { assertScoringChange } from './gameplay-scoring-service';
import { qualifierPolicySchema } from './qualifier-policy';
import { applyCompetitionAction } from './competition-service';
import type { CompetitionAction } from './competition-validation';
import {
  applyQualifierStandingsAction,
  type QualifierStandingsAction,
} from './qualifier-standings-service';
import { applyStageReconciliation } from './stage-reconciliation-service';
export function actionPermission(a: AdminAction): PermissionKey {
  if (
    a.type.startsWith('competition.') ||
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
  if (a.type === 'user.roles') return 'users.manage';
  if (a.type === 'settings.save') return 'settings.manage';
  if (a.type === 'media.delete') return 'media.upload';
  if (a.type === 'stage.delete') return 'mappools.delete';
  if (a.type === 'stage.save') return 'id' in a && a.id ? 'mappools.edit' : 'mappools.create';
  if (a.type === 'pool.publish' || a.type === 'pool.unpublish') return 'mappools.publish';
  return 'mappools.edit';
}
function assertActionPermission(actor: Actor | null, action: AdminAction): asserts actor is Actor {
  if (
    action.type.startsWith('qualifier.') &&
    !action.type.startsWith('qualifier.standings.') &&
    action.type !== 'qualifier.policy.save'
  )
    assertQualifierPermission(actor, action as QualifierAction);
  else if (action.type.startsWith('match.'))
    assertMatchActionPermission(actor, action as MatchAction);
  else assertPermission(actor, actionPermission(action));
}
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
  if (fetched?.errors.length)
    throw new AppError(fetched.errors.map((e) => `${e.id}: ${e.error}`).join(' '));
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
      assertActionPermission(actor, a);
      if (['page.save', 'settings.save', 'staff.save'].includes(a.type))
        await assertOwnedMedia(tx as typeof db, a);
      let result: unknown = { ok: true };
      let entityId = tournamentId;
      switch (a.type) {
        case 'competition.create':
        case 'competition.preview':
        case 'competition.publish':
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
        case 'qualifier.schedule':
        case 'qualifier.lobby':
        case 'qualifier.score':
        case 'qualifier.score.remove':
        case 'qualifier.status': {
          result = await applyQualifierAction(tx, actor, a);
          entityId = (result as { id: string }).id;
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
        case 'match.summary': {
          result = await applyMatchAction(tx, actor, a);
          entityId = (result as { id: string }).id;
          break;
        }
        case 'team.save':
        case 'team.status':
        case 'team.delete':
        case 'team.import.preview':
        case 'team.import.apply': {
          result = await applyTeamAction(tx, actor, a, teamPrepared!);
          entityId =
            a.type === 'team.save'
              ? (result as { id: string }).id
              : 'id' in a && a.id
                ? a.id
                : 'main';
          break;
        }
        case 'page.save':
        case 'page.restore': {
          let page = await tx.page.findFirst({ where: { slug: a.slug } });
          if (!page && a.type === 'page.save' && a.baseRevisionId === null)
            page = await tx.page.create({ data: { slug: a.slug, title: a.title } });
          if (!page)
            throw new AppError('This page no longer exists. Reload before continuing.', 409);
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
          const { type, id, matchRules, qualifierPolicy, ...fields } = a;
          void type;
          const beforeStage = id
            ? await tx.tournamentStage.findUniqueOrThrow({ where: { id } })
            : null;
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
              (a.kind !== 'QUALIFIERS' &&
                (await tx.qualifierLobby.count({ where: { stageId: id } })))
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
                'Qualifier policy is snapshotted by existing sessions. Create a new qualifier stage to use a different policy.',
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
            throw new AppError(
              'This stage is used by a qualifier lobby and cannot be deleted.',
              409,
            );
          await tx.tournamentStage.delete({ where: { id: a.id } });
          entityId = a.id;
          break;
        case 'pool.save': {
          const pool = await tx.mappool.findUniqueOrThrow({ where: { id: a.id } });
          entityId = pool.id;
          if (pool.draftRevisionId !== a.baseRevisionId)
            throw new AppError('A newer mappool draft exists. Reload before saving.', 409);
          const categories = await tx.modCategory.findMany();
          const problems = poolSlotErrors(a.slots, categories);
          if (problems.length) throw new AppError(problems.join(' '));
          const slots = sortPoolSlots(a.slots, categories).map((s, position) => {
            const category = categories.find((c) => c.acronym === s.category);
            if (!category) throw new AppError(`Unknown mod category: ${s.category}`);
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
          const pool = await tx.mappool.findUniqueOrThrow({
            where: { id: a.id },
            include: { draftRevision: { include: { slots: true } } },
          });
          entityId = pool.id;
          if (pool.draftRevisionId !== a.revisionId || !pool.draftRevision?.slots.length)
            throw new AppError('Review and save a non-empty current draft before publishing.', 409);
          if (
            pool.draftRevision.slots.some(
              (s) => (s.metadata as { mode?: string }).mode !== tournament.gameMode,
            )
          )
            throw new AppError(
              'This draft contains beatmaps from a different game mode. Edit and save it again.',
            );
          await tx.mappool.update({
            where: { id: pool.id },
            data: { state: 'PUBLISHED', publishedRevisionId: pool.draftRevisionId },
          });
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
          const { type, id, ...data } = a;
          void type;
          const category = id
            ? await tx.modCategory.update({ where: { id }, data })
            : await tx.modCategory.create({ data });
          entityId = category.id;
          break;
        }
        case 'category.delete':
          await tx.modCategory.delete({ where: { id: a.id } });
          entityId = a.id;
          break;
        case 'staff.category.save': {
          const { type, id, ...data } = a;
          void type;
          const category = id
            ? await tx.staffCategory.update({ where: { id }, data })
            : await tx.staffCategory.create({ data });
          entityId = category.id;
          break;
        }
        case 'staff.category.delete':
          await tx.staffCategory.delete({ where: { id: a.id } });
          entityId = a.id;
          break;
        case 'staff.save': {
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
            ? await tx.staffMember.update({ where: { id: a.id }, data: { ...data, assignments } })
            : await tx.staffMember.create({ data: { ...data, assignments } });
          entityId = member.id;
          break;
        }
        case 'staff.delete':
          await tx.staffMember.delete({ where: { id: a.id } });
          entityId = a.id;
          break;
        case 'role.save': {
          if (a.permissions.some((key) => PLATFORM_PERMISSIONS.includes(key)))
            throw new AppError(
              'Platform permissions cannot be granted through tournament roles.',
              403,
            );
          const role = a.id
            ? await tx.role.findUniqueOrThrow({
                where: { id: a.id },
                include: { users: true, permissions: true },
              })
            : null;
          if ((role?.templateKey || role?.systemKey) === 'Owner')
            throw new AppError('The Owner role is protected.', 403);
          if (role?.users.some((u) => u.userId === actor.id))
            throw new AppError('You cannot edit a role assigned to yourself.', 403);
          if (a.permissions.some((p) => !actor.permissions.includes(p)))
            throw new AppError('You cannot grant permissions you do not hold.', 403);
          if (
            role?.permissions.some(
              (p) => !actor.permissions.includes(p.permissionKey as PermissionKey),
            )
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
          if (role.systemKey || role.templateKey)
            throw new AppError('Default system roles cannot be deleted.', 403);
          if (role.users.some((u) => u.userId === actor.id))
            throw new AppError('You cannot delete a role assigned to yourself.', 403);
          if (
            role.permissions.some(
              (p) => !actor.permissions.includes(p.permissionKey as PermissionKey),
            )
          )
            throw new AppError('This role contains protected permissions.', 403);
          await tx.role.delete({ where: { id: a.id } });
          entityId = a.id;
          break;
        }
        case 'user.roles': {
          const target = await tx.user.findUniqueOrThrow({
            where: { id: a.userId },
            include: {
              roles: {
                where: { tournamentId },
                include: { role: { include: { permissions: true } } },
              },
            },
          });
          const roles = await tx.role.findMany({
            where: { id: { in: [...new Set(a.roleIds)] } },
            include: { permissions: true },
          });
          if (roles.length !== new Set(a.roleIds).size)
            throw new AppError('One of the selected roles no longer exists.');
          const owner = roles.find(
            (r) => (('templateKey' in r && r.templateKey) || r.systemKey) === 'Owner',
          );
          assertRoleGrant(
            actor,
            target.id,
            roles.flatMap((r) => r.permissions.map((p) => p.permissionKey as PermissionKey)),
            !!owner,
          );
          if (
            target.roles.some((r) => (r.role.templateKey || r.role.systemKey) === 'Owner') &&
            !actor.platformAdmin &&
            !actor.roles.some((r) => r.systemKey === 'Owner')
          )
            throw new AppError('Only an Owner can change another Owner’s roles.', 403);
          if (
            target.roles.some((r) => (r.role.templateKey || r.role.systemKey) === 'Owner') &&
            !owner
          ) {
            const ownerRole = target.roles.find(
              (r) => (r.role.templateKey || r.role.systemKey) === 'Owner',
            )!;
            if ((await tx.userRole.count({ where: { roleId: ownerRole.roleId } })) <= 1)
              throw new AppError('The last Owner cannot be removed.', 409);
          }
          // Also protect removal of privileges the actor does not hold.
          if (
            target.roles.some((r) =>
              r.role.permissions.some(
                (p) => !actor.permissions.includes(p.permissionKey as PermissionKey),
              ),
            )
          )
            throw new AppError('This account contains protected permissions.', 403);
          await tx.userRole.deleteMany({ where: { userId: target.id } });
          await tx.userRole.createMany({
            data: roles.map((r) => ({ userId: target.id, roleId: r.id })),
          });
          entityId = target.id;
          break;
        }
        case 'settings.save': {
          const {
            type,
            name,
            acronym,
            description,
            status,
            gameMode,
            timezone,
            format,
            startsAt,
            endsAt,
            scoringReview,
            ...settings
          } = a;
          void type;
          const currentSettings = await tx.tournamentSettings.findUniqueOrThrow({
            where: { tournamentId },
          });
          if (a.gameplayScoring === null && currentSettings.gameplayScoring)
            throw new AppError(
              'An established gameplay scoring system cannot be cleared. Choose a supported mode and review its impact.',
              409,
            );
          if (a.gameplayScoring && a.gameplayScoring !== currentSettings.gameplayScoring) {
            await assertScoringChange(
              tx,
              tournamentId,
              currentSettings.gameplayScoring,
              a.gameplayScoring,
              !!scoringReview,
            );
            // Scheduled, unplayed snapshots may follow a configuration change.
            // Recorded competitive snapshots are never rewritten.
            for (const match of await tx.match.findMany({
              where: { status: 'SCHEDULED' },
              include: { actions: true, results: true },
            })) {
              if (match.actions.length || match.results.length) continue;
              await tx.match.update({
                where: { id: match.id },
                data: {
                  rules: JSON.parse(
                    JSON.stringify(inheritedRules(match.rules, a.gameplayScoring, gameMode)),
                  ),
                  version: { increment: 1 },
                },
              });
              await tx.matchEvent.create({
                data: {
                  matchId: match.id,
                  version: match.version + 1,
                  actorId: actor.id,
                  kind: 'scoring.configuration',
                  data: { before: currentSettings.gameplayScoring, after: a.gameplayScoring },
                },
              });
            }
            for (const lobby of await tx.qualifierLobby.findMany({
              where: { status: 'SCHEDULED' },
              include: { scores: true },
            })) {
              if (lobby.scores.length) continue;
              await tx.qualifierLobby.update({
                where: { id: lobby.id },
                data: {
                  gameplayScoring: a.gameplayScoring,
                  rules: JSON.parse(
                    JSON.stringify(inheritedRules(lobby.rules, a.gameplayScoring, gameMode)),
                  ),
                  version: { increment: 1 },
                },
              });
              await tx.qualifierEvent.create({
                data: {
                  lobbyId: lobby.id,
                  version: lobby.version + 1,
                  actorId: actor.id,
                  kind: 'scoring.configuration',
                  data: { before: currentSettings.gameplayScoring, after: a.gameplayScoring },
                },
              });
            }
          }
          if (timezone)
            try {
              new Intl.DateTimeFormat('en', { timeZone: timezone });
            } catch {
              throw new AppError('Choose a valid IANA timezone.');
            }
          if (
            gameMode !== tournament.gameMode &&
            (await tx.mappool.count({ where: { state: 'PUBLISHED' } })) > 0
          )
            throw new AppError('Unpublish all mappools before changing the game mode.');
          await tx.tournament.update({
            where: { id: tournamentId },
            data: {
              name,
              acronym,
              description,
              status,
              gameMode,
              timezone,
              format,
              startsAt,
              endsAt,
              settings: { update: settings },
            },
          });
          break;
        }
        case 'media.delete':
          throw new AppError('Use the media deletion endpoint.');
      }
      if (
        !a.type.startsWith('competition.') &&
        !a.type.startsWith('qualifier.standings.') &&
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
            details: a.type === 'match.delete' ? { code: a.confirmCode, reason: a.reason } : {},
          },
        });
      return result;
    },
    { timeout: 15000 },
  );
}
