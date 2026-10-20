import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { mkdir, readFile, writeFile, unlink, stat, rename } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { AppError } from './permissions';

export const MAX_OBJECT_SIZE = 4 * 1024 * 1024;
export type ObjectMetadata = { size: number; contentType: string; sha256?: string };
export interface ObjectStorage {
  put(key: string, body: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  head(key: string): Promise<ObjectMetadata | null>;
  delete(key: string): Promise<void>;
}
export function assertStorageKey(key: string) {
  if (!/^[a-f0-9-]{1,100}\.webp$/.test(key)) throw new AppError('Invalid storage key.');
}
export const contentHash = (body: Buffer) => createHash('sha256').update(body).digest('hex');

// Media delivery stays same-origin: database publication and ownership grant access.
export function createStorage(env: Record<string, string | undefined>): ObjectStorage {
  if (['local', 'filesystem'].includes(env.STORAGE_DRIVER || '')) {
    const persistent = env.STORAGE_DRIVER === 'filesystem';
    if (env.NODE_ENV === 'production' && !persistent)
      throw new AppError('Configure filesystem or S3 storage for production.', 503);
    const root = persistent ? env.STORAGE_LOCAL_DIR : path.join(process.cwd(), '.data/uploads');
    if (!root || !path.isAbsolute(root))
      throw new AppError('Set an absolute STORAGE_LOCAL_DIR.', 503);
    const file = (key: string) => {
      assertStorageKey(key);
      return path.join(root, key);
    };
    return {
      async put(key, body) {
        if (body.length > MAX_OBJECT_SIZE) throw new AppError('Image exceeds 4 MB.', 413);
        const target = file(key);
        await mkdir(root, { recursive: true });
        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, body, { flag: 'wx', mode: 0o600 });
          await rename(temporary, target);
        } finally {
          await unlink(temporary).catch(() => {});
        }
      },
      async get(key) {
        const target = file(key);
        try {
          if ((await stat(target)).size > MAX_OBJECT_SIZE)
            throw new AppError('Stored image exceeds the limit.', 503);
          return await readFile(target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT')
            throw new AppError('Image not found.', 404);
          throw error;
        }
      },
      async head(key) {
        try {
          const info = await stat(file(key));
          return { size: info.size, contentType: 'image/webp' };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw error;
        }
      },
      async delete(key) {
        await unlink(file(key)).catch((e) => {
          if (e.code !== 'ENOENT') throw e;
        });
      },
    };
  }
  if (env.STORAGE_DRIVER && env.STORAGE_DRIVER !== 's3')
    throw new AppError('Unknown storage driver.', 503);
  if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY)
    throw new AppError('Object storage is not configured.', 503);
  const bucket = env.S3_BUCKET;
  const s3 = new S3Client({
    region: env.S3_REGION || 'us-east-1',
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: env.S3_FORCE_PATH_STYLE
      ? env.S3_FORCE_PATH_STYLE === 'true'
      : !!env.S3_ENDPOINT,
    maxAttempts: 2,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  });
  async function send<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    try {
      return await run(AbortSignal.timeout(15000));
    } catch (error) {
      if (['NoSuchKey', 'NotFound'].includes((error as Error).name))
        throw new AppError('Image not found.', 404);
      throw new AppError('Media storage is unavailable. Please retry shortly.', 503);
    }
  }
  return {
    async put(key, body) {
      assertStorageKey(key);
      if (body.length > MAX_OBJECT_SIZE) throw new AppError('Image exceeds 4 MB.', 413);
      await send((abortSignal) =>
        s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: 'image/webp',
            Metadata: { sha256: contentHash(body) },
          }),
          { abortSignal },
        ),
      );
    },
    async get(key) {
      assertStorageKey(key);
      return send(async (abortSignal) => {
        const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
          abortSignal,
        });
        if (!object.Body) throw new Error('Missing body');
        const parts: Uint8Array[] = [];
        let size = 0;
        for await (const part of object.Body as AsyncIterable<Uint8Array>) {
          size += part.length;
          if (size > MAX_OBJECT_SIZE) throw new Error('Object too large');
          parts.push(part);
        }
        return Buffer.concat(parts);
      });
    },
    async head(key) {
      assertStorageKey(key);
      try {
        const result = await send((abortSignal) =>
          s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), { abortSignal }),
        );
        return {
          size: result.ContentLength || 0,
          contentType: result.ContentType || 'application/octet-stream',
          sha256: result.Metadata?.sha256,
        };
      } catch (error) {
        if (error instanceof AppError && error.status === 404) return null;
        throw error;
      }
    },
    async delete(key) {
      assertStorageKey(key);
      await send((abortSignal) =>
        s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal }),
      );
    },
  };
}
let cached: { key: string; store: ObjectStorage } | undefined;
function storage() {
  const key = JSON.stringify(
    [
      'NODE_ENV',
      'STORAGE_DRIVER',
      'STORAGE_LOCAL_DIR',
      'S3_ENDPOINT',
      'S3_REGION',
      'S3_BUCKET',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'S3_FORCE_PATH_STYLE',
    ].map((k) => process.env[k]),
  );
  if (cached?.key !== key) cached = { key, store: createStorage(process.env) };
  return cached.store;
}
export const putObject = async (key: string, body: Buffer) => storage().put(key, body);
export const getObject = async (key: string) => storage().get(key);
export const headObject = async (key: string) => storage().head(key);
export const objectExists = async (key: string) => !!(await headObject(key));
export const deleteObject = async (key: string) => storage().delete(key);
