import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import { createStorage, contentHash } from '../src/lib/storage';

const store = createStorage({ ...process.env, STORAGE_DRIVER: 's3' });
const key = `${randomUUID()}.webp`;
const body = process.argv[2]
  ? await readFile(process.argv[2])
  : await sharp({ create: { width: 32, height: 32, channels: 3, background: '#709990' } })
      .webp()
      .toBuffer();
assert.equal(await store.head(key), null);
try {
  await store.put(key, body);
  assert.equal((await store.head(key))?.size, body.length);
  assert.equal((await store.head(key))?.contentType, 'image/webp');
  assert.equal(contentHash(await store.get(key)), contentHash(body));
  await store.put(key, Buffer.from('replacement'));
  assert.equal((await store.get(key)).toString(), 'replacement');
  const anonymous = await fetch(`${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}/${key}`);
  assert.equal(anonymous.status, 403);
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
  await assert.rejects(
    client.send(new CreateBucketCommand({ Bucket: `forbidden-${randomUUID()}` })),
    (e: { $metadata?: { httpStatusCode: number } }) => e.$metadata?.httpStatusCode === 403,
  );
  client.destroy();
  await assert.rejects(store.put('../unsafe.webp', body));
  await assert.rejects(store.put(key, Buffer.alloc(4 * 1024 * 1024 + 1)));
} finally {
  await store.delete(key);
}
assert.equal(await store.head(key), null);
await assert.rejects(store.get(key), (e: { status: number }) => e.status === 404);
const offline = createStorage({
  ...process.env,
  STORAGE_DRIVER: 's3',
  S3_ENDPOINT: 'http://127.0.0.1:1',
});
await assert.rejects(offline.put(key, body), (e: { status: number }) => e.status === 503);
const wrong = createStorage({
  ...process.env,
  STORAGE_DRIVER: 's3',
  S3_SECRET_ACCESS_KEY: randomUUID(),
});
await assert.rejects(wrong.put(key, body), (e: { status: number }) => e.status === 503);
console.log(
  'Real S3 CRUD, metadata, private access, scoped identity, validation and failure checks passed.',
);
