import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertStorageKey, createStorage, contentHash } from '../src/lib/storage';

describe('persistent media adapters', () => {
  it('validates keys for every provider', () => {
    for (const key of ['../a.webp', 'https://evil/a.webp', 'a.svg', '/a.webp', 'a.webp\r\n'])
      expect(() => assertStorageKey(key)).toThrow();
    expect(() => assertStorageKey('123abc-456.webp')).not.toThrow();
  });
  it('supports atomic filesystem CRUD and missing metadata', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'media-'));
    try {
      const store = createStorage({
        STORAGE_DRIVER: 'filesystem',
        STORAGE_LOCAL_DIR: root,
        NODE_ENV: 'production',
      });
      expect(await store.head('abc.webp')).toBeNull();
      await store.put('abc.webp', Buffer.from('first'));
      expect(await store.head('abc.webp')).toMatchObject({ size: 5 });
      await store.put('abc.webp', Buffer.from('second'));
      expect((await store.get('abc.webp')).toString()).toBe('second');
      expect(contentHash(await readFile(path.join(root, 'abc.webp')))).toBe(
        contentHash(Buffer.from('second')),
      );
      await store.delete('abc.webp');
      await store.delete('abc.webp');
      await expect(store.get('abc.webp')).rejects.toMatchObject({ status: 404 });
      await expect(store.put('abc.webp', Buffer.alloc(4194305))).rejects.toMatchObject({
        status: 413,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('refuses ephemeral production storage and missing S3 credentials', () => {
    expect(() => createStorage({ NODE_ENV: 'production', STORAGE_DRIVER: 'local' })).toThrow();
    expect(() => createStorage({ STORAGE_DRIVER: 's3' })).toThrow();
    expect(() => createStorage({ STORAGE_DRIVER: 'typo' })).toThrow();
  });
});
