import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
import { assertTestDatabase } from '../src/lib/instance';
import { uploadMedia, queueMediaCleanup, recoverMediaCleanup } from '../src/lib/media-cleanup';
import { isMediaReferenced } from '../src/lib/media-references';

assertTestDatabase(process.env.DATABASE_URL);
const tournamentId = randomUUID(),
  keys = new Set<string>();
const bytes = Buffer.from('Synthetic storage failure probe');
const storage = () => {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    put: vi.fn(async (key: string, body: Buffer) => {
      keys.add(key);
      objects.set(key, body);
    }),
    delete: vi.fn(async (key: string) => {
      objects.delete(key);
    }),
  };
};
const catalog = (tx: Parameters<Parameters<typeof uploadMedia>[1]>[0], key: string) =>
  tx.mediaAsset.create({
    data: {
      tournamentId,
      key,
      name: 'Synthetic',
      mimeType: 'image/webp',
      size: bytes.length,
      width: 1,
      height: 1,
    },
  });
const expire = (key: string) =>
  db.mediaCleanup.update({ where: { key }, data: { readyAfter: new Date(0) } });
beforeAll(async () => {
  await db.tournament.create({
    data: {
      id: tournamentId,
      slug: `media-cleanup-${tournamentId}`,
      name: 'Synthetic cleanup',
      acronym: 'TEST',
      description: '',
    },
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.mediaAsset.deleteMany({ where: { tournamentId } });
  await db.platformAsset.deleteMany({ where: { key: { in: [...keys] } } });
  await db.mediaCleanup.deleteMany({ where: { key: { in: [...keys] } } });
});
afterAll(async () => {
  await db.tournament.delete({ where: { id: tournamentId } });
});

it('completes catalog creation and journal removal atomically', async () => {
  const store = storage();
  const asset = await uploadMedia(bytes, catalog, store);
  expect(store.objects.get(asset.key)).toEqual(bytes);
  expect(await db.mediaCleanup.findUnique({ where: { key: asset.key } })).toBeNull();
});

it('journals an uncertain put and resumes cleanup after interruption without an orphan sweep', async () => {
  const store = storage();
  const put = store.put.getMockImplementation()!;
  store.put.mockImplementationOnce(async (key, body) => {
    await put(key, body);
    throw new Error('Put acknowledgement lost');
  });
  await expect(uploadMedia(bytes, catalog, store)).rejects.toThrow('Put acknowledgement lost');
  const key = store.put.mock.calls[0][0];
  expect(await db.mediaCleanup.findUnique({ where: { key } })).toMatchObject({ state: 'PENDING' });
  expect(store.delete).not.toHaveBeenCalled();
  await expire(key);
  expect(await recoverMediaCleanup({ keys: [key] }, store)).toHaveLength(1);
  expect(store.objects.has(key)).toBe(true); // preview is read-only
  expect(await recoverMediaCleanup({ apply: true, keys: [key] }, store)).toEqual([
    { key, state: 'REMOVED' },
  ]);
});

it('retains failed compensation and retries a journaled key', async () => {
  const store = storage();
  store.delete.mockRejectedValueOnce(new Error('Storage offline'));
  await expect(
    uploadMedia(
      bytes,
      async (tx, key) => {
        await catalog(tx, key);
        throw new Error('Catalog rollback');
      },
      store,
    ),
  ).rejects.toThrow('Catalog rollback');
  const key = store.put.mock.calls[0][0];
  expect(await db.mediaAsset.count({ where: { key } })).toBe(0);
  expect(await db.mediaCleanup.findUnique({ where: { key } })).toMatchObject({
    state: 'PENDING',
    attempts: 1,
  });
  await expire(key);
  await recoverMediaCleanup({ apply: true, keys: [key] }, store);
  expect(store.objects.has(key)).toBe(false);
});

it('preserves committed objects when the commit acknowledgement is lost', async () => {
  const store = storage(),
    transaction = db.$transaction;
  vi.spyOn(db, '$transaction').mockImplementationOnce(async (...args) => {
    await Reflect.apply(transaction, db, args);
    throw new Error('Commit acknowledgement lost');
  });
  await expect(uploadMedia(bytes, catalog, store)).rejects.toThrow('Commit acknowledgement lost');
  const key = store.put.mock.calls[0][0];
  expect(await db.mediaAsset.count({ where: { key } })).toBe(1);
  expect(store.objects.get(key)).toEqual(bytes);
  expect(store.delete).not.toHaveBeenCalled();
});

it('recovers deletion failures and preserves both committed catalog types', async () => {
  const store = storage();
  const asset = await uploadMedia(bytes, catalog, store);
  await db.$transaction(async (tx) => {
    await queueMediaCleanup(tx, asset.key);
    await tx.mediaAsset.delete({ where: { id: asset.id } });
  });
  store.delete.mockRejectedValueOnce(new Error('Delete failed'));
  expect(await recoverMediaCleanup({ apply: true, keys: [asset.key] }, store)).toEqual([
    { key: asset.key, state: 'RETRY' },
  ]);
  await expire(asset.key);
  await recoverMediaCleanup({ apply: true, keys: [asset.key] }, store);
  expect(store.objects.has(asset.key)).toBe(false);
  for (const platform of [false, true]) {
    const key = `${randomUUID()}.webp`;
    keys.add(key);
    store.objects.set(key, bytes);
    await db.$transaction(async (tx) => {
      if (platform) await tx.platformAsset.create({ data: { key, name: 'Synthetic', size: 1 } });
      else await catalog(tx, key);
      await queueMediaCleanup(tx, key);
    });
    await recoverMediaCleanup({ apply: true, keys: [key] }, store);
    expect(store.objects.has(key)).toBe(true);
  }
});

it('can reclaim an abandoned upload but prevents its late catalog commit', async () => {
  const store = storage();
  await expect(
    uploadMedia(bytes, async () => undefined, {
      ...store,
      put: async (key, body) => {
        await store.put(key, body);
        await expire(key);
        await recoverMediaCleanup({ apply: true, keys: [key] }, store);
      },
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(await db.mediaAsset.count({ where: { tournamentId } })).toBe(0);
});

it.each(['UPLOADING', 'CLEANING'])(
  'recovers an expired %s journal after process interruption',
  async (state) => {
    const store = storage(),
      key = `${randomUUID()}.webp`;
    keys.add(key);
    store.objects.set(key, bytes);
    await db.mediaCleanup.create({ data: { key, state, readyAfter: new Date(0) } });
    await recoverMediaCleanup({ apply: true, keys: [key] }, store);
    expect(store.objects.has(key)).toBe(false);
    expect(await db.mediaCleanup.findUnique({ where: { key } })).toBeNull();
  },
);

it('rolls back a queued deletion together with its catalog mutation', async () => {
  const store = storage(),
    asset = await uploadMedia(bytes, catalog, store);
  await expect(
    db.$transaction(async (tx) => {
      await queueMediaCleanup(tx, asset.key);
      await tx.mediaAsset.delete({ where: { id: asset.id } });
      throw new Error('Deletion rollback');
    }),
  ).rejects.toThrow('Deletion rollback');
  expect(await db.mediaAsset.count({ where: { id: asset.id } })).toBe(1);
  expect(await db.mediaCleanup.findUnique({ where: { key: asset.key } })).toBeNull();
  expect(store.objects.has(asset.key)).toBe(true);
});

it('protects hidden blocks and historical snapshot IDs, with a bounded full reference scan', async () => {
  const rollback = new Error('Rollback synthetic reference fixtures');
  try {
    await db.$transaction(async (tx) => {
      const id = 'synthetic-image';
      expect(await isMediaReferenced(tx, tournamentId, id)).toBe(false);
      const page = await tx.page.create({ data: { tournamentId, slug: 'probe', title: 'Probe' } });
      await tx.pageRevision.create({
        data: {
          tournamentId,
          pageId: page.id,
          title: 'Probe',
          blocks: {
            create: {
              type: 'image',
              position: 0,
              visible: false,
              content: { image: `/api/media/${id}` },
            },
          },
        },
      });
      expect(await isMediaReferenced(tx, tournamentId, id)).toBe(true);
      const stage = await tx.tournamentStage.create({
        data: { tournamentId, slug: 'probe', name: 'Probe' },
      });
      const match = await tx.match.create({
        data: { tournamentId, stageId: stage.id, code: 'probe', participants: {}, rules: {} },
      });
      await tx.matchResultRevision.create({
        data: {
          matchId: match.id,
          version: 1,
          kind: 'synthetic',
          reason: 'Retained history',
          snapshot: { participants: { A: { logoImageId: 'historical-image' } } },
        },
      });
      expect(await isMediaReferenced(tx, tournamentId, 'historical-image')).toBe(true);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
});
