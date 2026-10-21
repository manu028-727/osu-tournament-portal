import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { db } from './db';
import { AppError, assertPermission, type Actor } from './permissions';
import { getObject } from './storage';
import path from 'node:path';
import { bundleStaticAssets } from './tournament-export-assets';
import { rebindLocalizedCompetition } from './competition-service';
import {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  ARCHIVE_TABLES,
  tableNames,
  tokens,
  archiveHash,
  secretKey,
  validateArchiveData,
  writeArchive,
  type ArchiveTable,
  type ArchiveRow,
  type ArchiveData,
  type ArchiveManifest,
} from './tournament-archive-format';

export type TransferClient = PrismaClient | Prisma.TransactionClient;
type Delegate = {
  findMany(args: Record<string, unknown>): Promise<ArchiveRow[]>;
  createMany(args: Record<string, unknown>): Promise<{ count: number }>;
  update(args: Record<string, unknown>): Promise<unknown>;
};
export function archiveDelegate(client: TransferClient, table: ArchiveTable): Delegate {
  return (client as unknown as Record<string, Delegate>)[ARCHIVE_TABLES[table].model];
}
export function assertExportPermission(actor: Actor | null): asserts actor is Actor {
  assertPermission(actor, 'settings.manage');
  assertPermission(actor, 'users.manage');
  assertPermission(actor, 'roles.manage');
  if (!actor.tournamentId || actor.tournamentId === 'none')
    throw new AppError('Select a tournament.', 400);
}
function scopedWhere(table: ArchiveTable, tournamentId: string): Record<string, unknown> {
  if (table === 'tournament') return { id: tournamentId };
  let where: Record<string, unknown> = { tournamentId };
  for (const relation of [...(ARCHIVE_TABLES[table].parent || [])].reverse())
    where = { [relation]: where };
  return where;
}
function redact(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) => !secretKey(key) && !['__proto__', 'prototype', 'constructor'].includes(key),
        )
        .map(([key, child]) => [key, redact(child)]),
    );
  return value;
}
export async function collectTournament(client: TransferClient, tournamentId: string) {
  const data = {} as ArchiveData;
  const mediaKeys = new Map<string, string>();
  for (const table of tableNames) {
    if (['identities', 'participants', 'beatmaps'].includes(table)) continue;
    const select = Object.fromEntries(tokens(table).map(({ name }) => [name, true]));
    if (table === 'media') select.key = true;
    data[table] = await archiveDelegate(client, table).findMany({
      where: scopedWhere(table, tournamentId),
      select,
    });
    if (table === 'media')
      for (const row of data.media) {
        mediaKeys.set(row.id as string, row.key as string);
        delete row.key;
      }
  }
  if (data.tournament.length !== 1) throw new AppError('Tournament not found.', 404);
  const userIds = new Set<string>(),
    participantIds = new Set<number>();
  for (const table of tableNames)
    for (const row of data[table] || []) {
      for (const [field, target] of Object.entries(ARCHIVE_TABLES[table].refs)) {
        if (row[field] != null && target === 'identities') userIds.add(row[field] as string);
        if (row[field] != null && target === 'participants')
          participantIds.add(row[field] as number);
      }
    }
  for (const [table, field, values] of [
    ['identities', 'id', [...userIds]],
    ['participants', 'osuId', [...participantIds]],
    ['beatmaps', 'id', [...new Set(data.slots.map((row) => row.beatmapId))]],
  ] as const) {
    data[table] = await archiveDelegate(client, table).findMany({
      where: { [field]: { in: values } },
      select: Object.fromEntries(tokens(table).map(({ name }) => [name, true])),
    });
  }
  return { data: redact(data) as ArchiveData, mediaKeys };
}

// All UUID-like database identifiers become archive-local references; osu! IDs stay numeric.
export function localizeArchive(data: ArchiveData) {
  const ids = new Map<string, string>();
  for (const table of tableNames) {
    data[table].sort((a, b) =>
      String(a.id ?? a.osuId ?? JSON.stringify(a)).localeCompare(
        String(b.id ?? b.osuId ?? JSON.stringify(b)),
      ),
    );
    data[table].forEach((row, index) => {
      if (typeof row.id === 'string') ids.set(row.id, `${table}_${index + 1}`);
    });
  }
  function visit(value: unknown, field = '', path: string[] = []): unknown {
    if (typeof value === 'string') {
      const identityField =
        /^(?:id|.*Id|.*Ids|createdBy|calculatedBy|seedOrder|groupTieOrder)$/.test(field) ||
        path.at(-2) === 'roundStages' ||
        (field === 'order' && path.at(-2) === 'tieResolution');
      if (identityField && ids.has(value)) return ids.get(value)!;
      return value.replace(/(\/api\/media\/)([a-zA-Z0-9_-]+)/g, (match, base, id) =>
        ids.has(id) ? base + ids.get(id) : match,
      );
    }
    if (Array.isArray(value)) return value.map((child) => visit(child, field, path));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, visit(child, key, [...path, key])]),
      );
    return value;
  }
  const localized = visit(data) as ArchiveData;
  rebindLocalizedCompetition(data, localized, ids);
  return { data: localized, ids };
}
export async function exportTournament(
  actor: Actor,
  origin: string,
  source: ArchiveManifest['source'] = 'portal',
  publicDirectory = path.join(process.cwd(), 'public'),
) {
  assertExportPermission(actor);
  const tournamentId = actor.tournamentId!;
  const collected = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return collectTournament(tx, tournamentId);
    },
    {
      isolationLevel: 'RepeatableRead',
      timeout: 60000,
    },
  );
  const staticAssets = await bundleStaticAssets(collected.data, publicDirectory);
  const { data, ids } = localizeArchive(collected.data);
  validateArchiveData(data);
  const files = new Map<string, Buffer>();
  let totalMediaBytes = 0;
  const media: ArchiveManifest['media'] = [];
  for (const id of [...collected.mediaKeys.keys(), ...staticAssets.keys()]) {
    const key = collected.mediaKeys.get(id);
    let bytes: Buffer;
    try {
      bytes = staticAssets.get(id) || (await getObject(key!));
    } catch {
      throw new AppError(
        'An uploaded image could not be read. Restore storage access before exporting.',
        503,
      );
    }
    const localId = ids.get(id)!;
    const path = `media/${localId}.webp`;
    const row = data.media.find((row) => row.id === localId)!;
    if (bytes.length !== row.size || bytes.length > 4 * 1024 * 1024)
      throw new AppError(
        'An uploaded image has an unexpected size. Verify storage before exporting.',
        409,
      );
    totalMediaBytes += bytes.length;
    if (totalMediaBytes > 112 * 1024 * 1024)
      throw new AppError('Tournament media exceeds the archive expansion limit.', 413);
    files.set(path, bytes);
    media.push({ id: localId, path, size: bytes.length, sha256: archiveHash(bytes) });
  }
  const manifest: ArchiveManifest = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    exportedAt: new Date().toISOString(),
    source,
    sourceOrigin: new URL(origin).origin,
    sourceSlug: data.tournament[0].slug as string,
    data: { path: 'tournament.json', sha256: archiveHash(Buffer.from(JSON.stringify(data))) },
    media,
    warnings: [
      'Role memberships and referee assignments are review-only; imports never grant imported access.',
      'Sessions, OAuth state/tokens, platform administrators, IRC credentials, pending IRC jobs and workbook upload previews are excluded.',
      'Remote image URLs remain remote. Uploaded media and referenced local raster artwork are bundled; local PNG/JPEG/AVIF artwork is normalized to WebP.',
    ],
  };
  const bytes = await writeArchive(manifest, data, files);
  if (source === 'portal')
    await db.auditLog.create({
      data: {
        tournamentId,
        actorId: actor.id,
        action: 'tournament.export',
        entityType: 'tournament',
        entityId: tournamentId,
        details: { version: ARCHIVE_VERSION, bytes: bytes.length, media: media.length },
      },
    });
  return { bytes, filename: `${manifest.sourceSlug}-tournament-v${ARCHIVE_VERSION}.zip` };
}
