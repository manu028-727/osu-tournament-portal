import { rebindImportedAdvancements } from './format-lifecycle-service';
import { FORMAT_PLAN_VERSION, formatPlanSchema } from './format-plan';
import { randomUUID } from 'node:crypto';
import { remapArchiveValue } from './archive-identities';
import sharp from 'sharp';
import { z } from 'zod';
import { inferLegacyScoring } from './gameplay-scoring';
import { db } from './db';
import { AppError, DEFAULT_ROLES, PERMISSIONS, type Actor } from './permissions';
import { getObject, putObject, deleteObject, contentHash } from './storage';
import { archiveDelegate, type TransferClient } from './tournament-export';
import {
  ARCHIVE_TABLES,
  archiveInsertionOrder,
  archiveDeferredFields,
  tableNames,
  tokens,
  readArchive,
  validateArchiveData,
  type ArchiveRow,
  type ArchiveData,
  type ArchiveTable,
  type ParsedArchive,
} from './tournament-archive-format';
import { cleanHtml } from './rich-text';
import { blockSchema, settingsFieldsSchema, safeUrl } from './validation';
import { matchRulesSchema } from './match-rules';
import type { Prisma } from '@/generated/prisma/client';
import { competitionStoredConfigSchema } from './competition-archive';
import { qualifierPolicySchema } from './qualifier-policy';
import { rebindImportedQualifierStandings } from './qualifier-standings-restoration';
import { rebindImportedCompetition, validateCompetitionArchive } from './competition-restoration';
import { restoreArchiveMatchNumbers } from './match-numbering';

export const importSlug = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export function assertImportPermission(actor: Actor | null): asserts actor is Actor {
  if (!actor) throw new AppError('Sign in to continue.', 401);
  if (!actor.platformAdmin)
    throw new AppError('Only a platform administrator can import tournaments.', 403);
}
function record(value: unknown): ArchiveRow {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as ArchiveRow) : {};
}
const snapshotSchema = z
  .object({
    name: z.string().min(1).max(200),
    members: z
      .array(
        z
          .object({
            osuId: z.number().int().positive(),
            username: z.string().max(200),
            avatarUrl: safeUrl,
            captain: z.boolean(),
            substitute: z.boolean(),
          })
          .passthrough(),
      )
      .max(64),
  })
  .passthrough();
const beatmapSchema = z
  .object({
    id: z.number().int().positive(),
    mode: z.enum(['osu', 'taiko', 'fruits', 'mania']),
    title: z.string(),
    artist: z.string(),
    mapper: z.string(),
    difficulty: z.string(),
    stars: z.number().finite().nonnegative(),
    bpm: z.number().finite().nonnegative(),
    length: z.number().finite().nonnegative(),
    ar: z.number().finite(),
    cs: z.number().finite(),
    od: z.number().finite(),
    hp: z.number().finite().nullable(),
    cover: safeUrl,
    url: safeUrl,
  })
  .passthrough();
export async function inspectArchive(bytes: Buffer) {
  const archive = await readArchive(bytes);
  validateCompetitionArchive(archive.data);
  // Validate real CMS/rule contracts before staging files, not just the ZIP envelope.
  const t = archive.data.tournament[0],
    settings = archive.data.settings[0];
  settingsFieldsSchema.parse({ ...t, ...settings });
  matchRulesSchema.parse(settings.matchRules);
  for (const block of archive.data.blocks) blockSchema.parse(block);
  for (const stage of archive.data.stages)
    if (stage.matchRules) matchRulesSchema.parse(stage.matchRules);
  for (const stage of archive.data.stages)
    if (stage.qualifierPolicy) qualifierPolicySchema.parse(stage.qualifierPolicy);
  for (const lobby of archive.data.qualifierLobbies)
    if (lobby.policy) qualifierPolicySchema.parse(lobby.policy);
  if (archive.data.tournamentPhases?.length)
    formatPlanSchema.parse({
      version: FORMAT_PLAN_VERSION,
      phases: [...archive.data.tournamentPhases]
        .sort((a, b) => Number(a.position) - Number(b.position))
        .map((phase) => ({
          ...(phase.config as Record<string, unknown>),
          key: phase.key,
          kind: phase.kind,
          name: phase.name,
          ...(phase.stageId ? { stageId: phase.stageId } : {}),
        })),
    });
  for (const bracket of archive.data.brackets) {
    const config = competitionStoredConfigSchema.parse(bracket.config);
    if (config.teamIds.some((id) => !archive.data.teams.some((team) => team.id === id)))
      throw new AppError('Bracket configuration refers to a participant outside the archive.');
    if (
      config.sourceBracketId &&
      (!archive.data.brackets.some(
        (source) => source.id === config.sourceBracketId && source.format === 'GROUPS',
      ) ||
        config.sourceBracketId === bracket.id)
    )
      throw new AppError('Bracket configuration refers to an invalid source group.');
    if (
      config.sourceStandingId &&
      !archive.data.qualifierStandings.some((standing) => standing.id === config.sourceStandingId)
    )
      throw new AppError('Bracket configuration refers to an unknown qualifier standing.');
    if (
      [config.stageId, ...Object.values(config.roundStages)].some(
        (id) => !archive.data.stages.some((stage) => stage.id === id),
      )
    )
      throw new AppError('Bracket configuration refers to an unknown stage.');
  }
  for (const match of [...archive.data.matches, ...archive.data.qualifierLobbies])
    matchRulesSchema.parse(match.rules);
  for (const row of archive.data.matches)
    z.object({ A: snapshotSchema, B: snapshotSchema }).parse(row.participants);
  for (const row of archive.data.qualifierLobbies)
    z.array(snapshotSchema).max(16).parse(row.participants);
  for (const row of [...archive.data.beatmaps, ...archive.data.slots]) {
    const metadata = beatmapSchema.parse(row.metadata);
    if (metadata.id !== (row.beatmapId ?? row.id))
      throw new AppError('Beatmap metadata refers to a different beatmap.');
  }
  for (const row of [...archive.data.playerScores, ...archive.data.qualifierScores])
    z.array(z.string().max(20)).max(32).parse(row.mods);
  for (const asset of archive.manifest.media) {
    let info;
    try {
      info = await sharp(archive.files.get(asset.path)!, { limitInputPixels: 40000000 }).metadata();
    } catch {
      throw new AppError('Archive contains an invalid image.');
    }
    const row = archive.data.media.find((row) => row.id === asset.id)!;
    if (
      info.format !== 'webp' ||
      (info.pages || 1) > 1 ||
      info.width !== row.width ||
      info.height !== row.height ||
      asset.size !== row.size ||
      row.mimeType !== 'image/webp'
    )
      throw new AppError('Archive media must match its declared static WebP dimensions and size.');
  }
  const conflicts = await db.tournament.count({ where: { slug: archive.manifest.sourceSlug } });
  return {
    archive,
    preview: {
      fingerprint: archive.fingerprint,
      name: t.name,
      slug: archive.manifest.sourceSlug,
      source: archive.manifest.source,
      version: archive.manifest.version,
      slugConflict: conflicts > 0,
      counts: Object.fromEntries(tableNames.map((table) => [table, archive.data[table].length])),
      mediaBytes: archive.manifest.media.reduce((sum, file) => sum + file.size, 0),
      warnings: [
        ...archive.manifest.warnings,
        'This import creates a separate unpublished tournament. Content-level draft/published states are retained behind that gate.',
        'Existing osu! profiles and beatmap cache records are reused without overwriting them.',
        'Only the importing administrator receives the new Owner role. Imported role memberships and referee assignments require manual review.',
      ],
      review: {
        roles: archive.data.roles,
        memberships: archive.data.memberships,
        matchAssignments: archive.data.matchAssignments,
        qualifierAssignments: archive.data.qualifierAssignments,
        identities: archive.data.identities,
      },
    },
  };
}
export type ArchivePreview = Awaited<ReturnType<typeof inspectArchive>>['preview'];

function remapJson(
  value: unknown,
  ids: Map<string, string>,
  archive: ParsedArchive,
  slug: string,
): unknown {
  return remapArchiveValue(value, ids, (value) => {
    const sourcePrefix = `/t/${archive.manifest.sourceSlug}`;
    const text = value.replace(
      /(?:https?:\/\/[^\s"'<>]+)?\/api\/media\/([a-zA-Z0-9_-]+)/g,
      (match, id) =>
        ids.has(id)
          ? `/api/media/${ids.get(id)}`
          : match.startsWith('/')
            ? archive.manifest.sourceOrigin + match
            : match,
    );
    return text
      .replaceAll(archive.manifest.sourceOrigin + sourcePrefix, `/t/${slug}`)
      .replace(new RegExp(sourcePrefix + '(?=[/?#"\'\\s<]|$)', 'g'), `/t/${slug}`);
  });
}
async function insert(client: TransferClient, table: ArchiveTable, rows: ArchiveRow[]) {
  for (let index = 0; index < rows.length; index += 500)
    await archiveDelegate(client, table).createMany({ data: rows.slice(index, index + 500) });
}
async function cleanupKeys(keys: string[]) {
  const failed: string[] = [];
  for (const key of keys)
    try {
      await deleteObject(key);
    } catch {
      failed.push(key);
    }
  return failed;
}
export async function recoverTransfer(actor: Actor, id: string) {
  assertImportPermission(actor);
  const claimed = await db.tournamentTransfer.updateMany({
    where: {
      id,
      tournamentId: null,
      OR: [
        { status: { in: ['CLEANUP_REQUIRED', 'FAILED'] } },
        {
          status: { in: ['PREPARING', 'CLEANING'] },
          updatedAt: { lt: new Date(Date.now() - 30 * 60000) },
        },
      ],
    },
    data: { status: 'CLEANING' },
  });
  if (!claimed.count)
    throw new AppError('This transfer is completed, active or already being cleaned.', 409);
  const job = await db.tournamentTransfer.findUniqueOrThrow({ where: { id } });
  const failed = await cleanupKeys(job.objectKeys as string[]);
  await db.tournamentTransfer.update({
    where: { id },
    data: {
      status: failed.length ? 'CLEANUP_REQUIRED' : 'FAILED',
      report: { remainingObjects: failed.length, recovered: true },
    },
  });
  return { remainingObjects: failed.length, status: failed.length ? 'CLEANUP_REQUIRED' : 'FAILED' };
}
export async function importTournament(
  actor: Actor,
  archive: ParsedArchive,
  requestedSlug: string,
) {
  assertImportPermission(actor);
  const slug = importSlug.parse(requestedSlug);
  validateArchiveData(archive.data);
  if (await db.tournament.count({ where: { slug } }))
    throw new AppError('That tournament slug already exists. Choose a new slug.', 409);
  const tournamentId = randomUUID(),
    transferId = randomUUID();
  const ids = new Map<string, string>();
  for (const table of tableNames)
    for (const row of archive.data[table])
      if (typeof row.id === 'string') ids.set(row.id, randomUUID());
  ids.set(archive.data.tournament[0].id as string, tournamentId);
  const mediaKeys = new Map(
    archive.manifest.media.map((asset) => [asset.id, `${randomUUID()}.webp`]),
  );
  const keys = [...mediaKeys.values()];
  const mappedMediaKeys = new Map([...mediaKeys].map(([id, key]) => [ids.get(id), key]));
  await db.tournamentTransfer.create({
    data: {
      id: transferId,
      initiatedBy: actor.id,
      sourceFingerprint: archive.fingerprint,
      status: 'PREPARING',
      objectKeys: keys,
      report: {},
    },
  });
  try {
    for (const asset of archive.manifest.media) {
      const lease = await db.tournamentTransfer.updateMany({
        where: { id: transferId, status: 'PREPARING' },
        data: { updatedAt: new Date() },
      });
      if (!lease.count) throw new AppError('This import was cancelled during recovery.', 409);
      const key = mediaKeys.get(asset.id)!;
      await putObject(key, archive.files.get(asset.path)!);
      if (contentHash(await getObject(key)) !== asset.sha256)
        throw new AppError('Media storage verification failed.', 503);
    }
    const report = await db.$transaction(
      async (tx) => {
        const currentActor = await tx.user.findUnique({
          where: { id: actor.id },
          select: { platformAdmin: true },
        });
        if (!currentActor?.platformAdmin) throw new AppError('Platform access was revoked.', 403);
        // Profiles carry no sessions or role grants. Existing profiles are never updated by an archive.
        await tx.user.createMany({
          data: archive.data.identities.map((row) => ({
            osuId: row.osuId as number,
            username: row.username as string,
            avatarUrl: row.avatarUrl as string,
            profileUrl: row.profileUrl as string,
            country: row.country as string | null,
            platformAdmin: false,
          })),
          skipDuplicates: true,
        });
        const users = await tx.user.findMany({
          where: { osuId: { in: archive.data.identities.map((row) => row.osuId as number) } },
          select: { id: true, osuId: true },
        });
        for (const row of archive.data.identities)
          ids.set(row.id as string, users.find((user) => user.osuId === row.osuId)!.id);
        const mapped = remapJson(archive.data, ids, archive, slug) as ArchiveData;
        const matchNumberSequence = restoreArchiveMatchNumbers(
          mapped.matches,
          mapped.bracketNodes,
          mapped.tournament[0].matchNumberSequence,
        );
        const tournament = {
          ...mapped.tournament[0],
          id: tournamentId,
          slug,
          published: false,
          version: 1,
          matchNumberSequence,
        };
        // Archive publication never overrides the unpublished tournament-level safety gate.
        await insert(tx, 'tournament', [
          Object.fromEntries(
            Object.entries(tournament).map(([key, value]) => [
              key,
              tokens('tournament').some((token) => token.name === key && token.type === 'd') &&
              value
                ? new Date(value as string)
                : value,
            ]),
          ),
        ]);
        for (const [key, description] of Object.entries(PERMISSIONS))
          await tx.permission.upsert({ where: { key }, create: { key, description }, update: {} });
        for (const [name, permissions] of Object.entries(DEFAULT_ROLES)) {
          const role = await tx.role.create({
            data: {
              tournamentId,
              name,
              templateKey: name,
              permissions: { create: permissions.map((permissionKey) => ({ permissionKey })) },
            },
          });
          if (name === 'Owner')
            await tx.userRole.create({ data: { tournamentId, roleId: role.id, userId: actor.id } });
        }
        const settings = {
          ...mapped.settings[0],
          gameplayScoring:
            mapped.settings[0].gameplayScoring ??
            inferLegacyScoring([
              mapped.settings[0].matchRules,
              ...mapped.stages.map((row) => row.matchRules),
              ...mapped.matches.map((row) => row.rules),
              ...mapped.qualifierLobbies.map((row) => row.rules),
            ]),
          tournamentId,
          updatedAt: new Date(mapped.settings[0].updatedAt as string),
        };
        await insert(tx, 'settings', [settings]);
        await tx.participant.createMany({
          data: mapped.participants.map((row) => ({
            ...row,
            updatedAt: new Date(row.updatedAt as string),
          })) as Prisma.ParticipantCreateManyInput[],
          skipDuplicates: true,
        });
        await tx.beatmap.createMany({
          data: mapped.beatmaps.map((row) => ({
            ...row,
            fetchedAt: new Date(row.fetchedAt as string),
          })) as Prisma.BeatmapCreateManyInput[],
          skipDuplicates: true,
        });
        const deferred: { table: ArchiveTable; id: unknown; fields: ArchiveRow }[] = [];
        for (const table of archiveInsertionOrder) {
          const rows = mapped[table].map((row) => {
            const data: ArchiveRow = { ...row };
            for (const { name, type } of tokens(table)) {
              if (type === 'd' && data[name]) data[name] = new Date(data[name] as string);
              if (type === 'j' && data[name] === null) data[name] = undefined;
            }
            const fields: ArchiveRow = {};
            for (const key of archiveDeferredFields[table] || []) {
              fields[key] = data[key];
              data[key] = null;
            }
            if (Object.keys(fields).length) deferred.push({ table, id: data.id, fields });
            if ('sourceKey' in data && data.sourceKey)
              data.sourceKey = `${tournamentId}:${data.sourceKey}`;
            if (table === 'media') data.key = mappedMediaKeys.get(row.id as string);
            if (table === 'pageRevisions') data.html = cleanHtml(data.html as string);
            if (table === 'blocks') {
              const content = record(data.content);
              data.content =
                typeof content.html === 'string'
                  ? { ...content, html: cleanHtml(content.html) }
                  : content;
            }
            return data;
          });
          await insert(tx, table, rows);
        }
        for (const item of deferred)
          await archiveDelegate(tx, item.table).update({
            where: { id: item.id },
            data: item.fields,
          });
        const standingsRestore = await rebindImportedQualifierStandings(tx, tournamentId);
        const competitionRestore = await rebindImportedCompetition(
          tx,
          tournamentId,
          archive.data,
          ids,
        );
        await rebindImportedAdvancements(tx, tournamentId);
        const counts: Record<string, number> = {};
        for (const table of archiveInsertionOrder) {
          const rows = await archiveDelegate(tx, table).findMany({
            where: (() => {
              let where: ArchiveRow = { tournamentId };
              for (const relation of [...(ARCHIVE_TABLES[table].parent || [])].reverse())
                where = { [relation]: where };
              return where;
            })(),
            select: Object.fromEntries(
              tokens(table)
                .slice(0, 1)
                .map((token) => [token.name, true]),
            ),
          });
          counts[table] = rows.length;
          if (rows.length !== archive.data[table].length)
            throw new AppError('Imported {0} verification failed.', 409, [table]);
        }
        const report = {
          tournamentId,
          slug,
          published: false,
          sourceFingerprint: archive.fingerprint,
          imported: counts,
          standingsRestore,
          competitionRestore,
          mediaFilesVerified: keys.length,
          errors: [],
          review: {
            roles: archive.data.roles,
            rolePermissions: archive.data.rolePermissions,
            memberships: archive.data.memberships,
            matchAssignments: archive.data.matchAssignments,
            qualifierAssignments: archive.data.qualifierAssignments,
            identities: archive.data.identities,
          },
          warnings: [
            ...standingsRestore.warnings,
            ...archive.manifest.warnings,
            'Imported role memberships and referee assignments were not applied. Review them before assigning access.',
            'Existing global osu! profiles and beatmap cache records were not overwritten.',
            'All tournament content is hidden until this new tournament is explicitly published.',
          ],
        };
        await tx.auditLog.create({
          data: {
            tournamentId,
            actorId: actor.id,
            action: 'tournament.import',
            entityType: 'tournament',
            entityId: tournamentId,
            details: report as unknown as Prisma.InputJsonValue,
          },
        });
        const completed = await tx.tournamentTransfer.updateMany({
          where: { id: transferId, status: 'PREPARING' },
          data: {
            status: 'COMPLETED',
            tournamentId,
            report: report as unknown as Prisma.InputJsonValue,
          },
        });
        if (!completed.count) throw new AppError('Transfer was cancelled during recovery.', 409);
        return report;
      },
      { isolationLevel: 'Serializable', timeout: 120000, maxWait: 10000 },
    );
    return { ...report, transferId };
  } catch (error) {
    // A connection failure during COMMIT can be ambiguous. Claim the journal before
    // deleting objects; a completed transaction must never lose its media.
    let claimed;
    try {
      claimed = await db.tournamentTransfer.updateMany({
        where: {
          id: transferId,
          tournamentId: null,
          status: { in: ['PREPARING', 'FAILED', 'CLEANUP_REQUIRED'] },
        },
        data: { status: 'CLEANING' },
      });
    } catch {
      throw new AppError(
        'Import confirmation was interrupted. Check Recent imports and recover the stopped transfer when the database is available.',
        503,
      );
    }
    if (!claimed.count)
      throw new AppError(
        'Import confirmation was interrupted. Check Recent imports; completed tournament media was preserved.',
        409,
      );
    const failed = await cleanupKeys(keys);
    await db.tournamentTransfer.updateMany({
      where: { id: transferId, tournamentId: null },
      data: {
        status: failed.length ? 'CLEANUP_REQUIRED' : 'FAILED',
        report: {
          error: 'Import did not commit. No public tournament was created.',
          remainingObjects: failed.length,
        },
      },
    });
    throw error;
  }
}
