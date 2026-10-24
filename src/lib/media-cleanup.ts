import { randomUUID } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import { db } from './db';
import { AppError } from './permissions';
import { assertStorageKey, putObject, deleteObject } from './storage';

type Store = { put: typeof putObject; delete: typeof deleteObject };
const store: Store = { put: putObject, delete: deleteObject };
const later = (milliseconds: number) => new Date(Date.now() + milliseconds);
const uploadGrace = 60 * 60_000;
const cleanupLease = 5 * 60_000;

// The key is durable before a possibly uncertain provider write. Catalog creation
// and journal completion share one transaction, including the established lock.
export async function uploadMedia<T>(
  body: Buffer,
  commit: (tx: Prisma.TransactionClient, key: string) => Promise<T>,
  storage: Store = store,
): Promise<T> {
  const key = `${randomUUID()}.webp`;
  await db.mediaCleanup.create({ data: { key, readyAfter: later(uploadGrace) } });
  let stored = false;
  try {
    await storage.put(key, body);
    stored = true;
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
      const job = await tx.mediaCleanup.deleteMany({ where: { key, state: 'UPLOADING' } });
      if (job.count !== 1)
        throw new AppError('Upload expired during recovery. Upload the image again.', 409);
      return commit(tx, key);
    });
  } catch (error) {
    // A failed commit can be uncertain. Recovery checks catalogs before deleting.
    await db.mediaCleanup
      .updateMany({
        where: { key, state: 'UPLOADING' },
        data: {
          state: 'PENDING',
          readyAfter: stored ? new Date() : later(uploadGrace),
        },
      })
      .catch(() => {});
    if (stored) await recoverMediaCleanup({ apply: true, keys: [key] }, storage).catch(() => {});
    throw error;
  }
}

export async function queueMediaCleanup(tx: Prisma.TransactionClient, key: string) {
  assertStorageKey(key);
  await tx.mediaCleanup.upsert({
    where: { key },
    create: { key, state: 'PENDING', readyAfter: new Date() },
    update: { state: 'PENDING', readyAfter: new Date() },
  });
}

// Bounded, explicit recovery of journaled keys only; no orphan inventory or sweep.
export async function recoverMediaCleanup(
  options: { apply?: boolean; limit?: number; keys?: string[] } = {},
  storage: Pick<Store, 'delete'> = store,
) {
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw new AppError('Choose a cleanup limit from 1 to 200.');
  const jobs = await db.mediaCleanup.findMany({
    where: {
      readyAfter: { lte: new Date() },
      ...(options.keys ? { key: { in: options.keys } } : {}),
    },
    orderBy: [{ readyAfter: 'asc' }, { key: 'asc' }],
    take: limit,
  });
  const results: { key: string; state: string }[] = [];
  for (const job of jobs) {
    assertStorageKey(job.key);
    if (!options.apply) {
      results.push({ key: job.key, state: job.state });
      continue;
    }
    const claimed = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
      const current = await tx.mediaCleanup.findFirst({
        where: { key: job.key, readyAfter: { lte: new Date() } },
      });
      if (!current) return false;
      const tenantAsset = await tx.mediaAsset.findUnique({
        where: { key: job.key },
        select: { id: true },
      });
      const platformAsset = await tx.platformAsset.findUnique({
        where: { key: job.key },
        select: { id: true },
      });
      if (tenantAsset || platformAsset) {
        await tx.mediaCleanup.delete({ where: { key: job.key } });
        return false;
      }
      await tx.mediaCleanup.update({
        where: { key: job.key },
        data: { state: 'CLEANING', readyAfter: later(cleanupLease), attempts: { increment: 1 } },
      });
      return true;
    });
    if (!claimed) {
      results.push({ key: job.key, state: 'PRESERVED_OR_BUSY' });
      continue;
    }
    try {
      await storage.delete(job.key);
      await db.mediaCleanup.deleteMany({ where: { key: job.key, state: 'CLEANING' } });
      results.push({ key: job.key, state: 'REMOVED' });
    } catch {
      // Retain the key across process/provider/database failures, without logging secrets.
      await db.mediaCleanup
        .updateMany({
          where: { key: job.key, state: 'CLEANING' },
          data: { state: 'PENDING', readyAfter: later(cleanupLease) },
        })
        .catch(() => {});
      results.push({ key: job.key, state: 'RETRY' });
    }
  }
  return results;
}
