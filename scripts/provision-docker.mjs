import { randomBytes } from 'node:crypto';
import { writeFile, readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';

const destination = path.resolve(process.argv[2] || '.env.docker');
const secret = () => randomBytes(32).toString('hex');
const password = secret();
const appPassword = secret();
const database = process.env.POSTGRES_DB || 'tournament';
if (!/^[a-z][a-z0-9_]{0,62}$/.test(database))
  throw new Error('POSTGRES_DB must be a lowercase PostgreSQL identifier.');
const storage = {
  RUSTFS_ACCESS_KEY: `root${secret().slice(0, 16)}`,
  RUSTFS_SECRET_KEY: secret(),
  S3_ENDPOINT: 'http://object-storage:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'tournament-media',
  S3_ACCESS_KEY_ID: `app${secret().slice(0, 16)}`,
  S3_SECRET_ACCESS_KEY: secret(),
  S3_FORCE_PATH_STYLE: 'true',
};
const serialize = (values) =>
  Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n') + '\n';
if (process.argv.includes('--add-storage')) {
  const existing = await readFile(destination, 'utf8');
  if (Object.keys(storage).some((key) => new RegExp(`^${key}=`, 'm').test(existing)))
    throw new Error('Storage configuration already exists; nothing was overwritten.');
  await appendFile(destination, serialize(storage));
  console.log('Added generated storage credentials. Storage backend was not switched.');
  process.exit(0);
}
const values = {
  STACK_NAME: process.env.STACK_NAME || 'tournament',
  STACK_ENV_FILE: destination,
  COMPOSE_PROFILES: 'database,storage',
  WEB_BIND: '127.0.0.1',
  WEB_PORT: process.env.WEB_PORT || '3335',
  POSTGRES_DB: database,
  POSTGRES_USER: 'postgres',
  POSTGRES_PASSWORD: password,
  APP_DATABASE_USER: 'tournament_app',
  APP_DATABASE_PASSWORD: appPassword,
  APP_DATABASE_NAME: database,
  DATABASE_URL: `postgresql://tournament_app:${appPassword}@postgres:5432/${database}`,
  DIRECT_URL: `postgresql://postgres:${password}@postgres:5432/${database}`,
  APP_URL: `http://localhost:${process.env.WEB_PORT || '3335'}`,
  OSU_CLIENT_ID: '',
  OSU_CLIENT_SECRET: '',
  OSU_REDIRECT_URI: `http://localhost:${process.env.WEB_PORT || '3335'}/api/auth/callback`,
  OWNER_OSU_ID: '',
  STORAGE_DRIVER: 's3',
  STORAGE_LOCAL_DIR: '/var/lib/tournament/uploads',
  IRC_ENABLED: 'false',
  IRC_GATEWAY_SECRET: secret(),
  ...storage,
};
await writeFile(destination, serialize(values), { mode: 0o600, flag: 'wx' });
console.log(`Created ${destination}. No existing configuration was overwritten.`);
