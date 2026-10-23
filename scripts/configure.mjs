import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

/** @param {Record<string, string | undefined>} env */
export function createConfiguration(env = process.env, settings = {}) {
  const secret = () => randomBytes(32).toString('hex');
  const database = env.POSTGRES_DB || 'tournament';
  const port = settings.WEB_PORT || env.WEB_PORT || '3335';
  const stack = env.STACK_NAME || `portal-${secret().slice(0, 8)}`;
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(database))
    throw new Error('POSTGRES_DB must be a lowercase PostgreSQL identifier.');
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(stack)) throw new Error('Invalid STACK_NAME.');
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw new Error('Port must be a number between 1 and 65535.');
  const password = secret(),
    appPassword = secret();
  return {
    STACK_NAME: stack,
    COMPOSE_PROFILES: 'database,storage',
    WEB_BIND: '127.0.0.1',
    WEB_PORT: port,
    POSTGRES_DB: database,
    POSTGRES_USER: 'postgres',
    POSTGRES_PASSWORD: password,
    APP_DATABASE_USER: 'tournament_app',
    APP_DATABASE_PASSWORD: appPassword,
    APP_DATABASE_NAME: database,
    DATABASE_URL: `postgresql://tournament_app:${appPassword}@postgres:5432/${database}`,
    DIRECT_URL: `postgresql://postgres:${password}@postgres:5432/${database}`,
    APP_URL: `http://localhost:${port}`,
    OSU_CLIENT_ID: '',
    OSU_CLIENT_SECRET: '',
    OSU_REDIRECT_URI: `${settings.APP_URL || `http://localhost:${port}`}/api/auth/callback`,
    OWNER_OSU_ID: '',
    INITIAL_SITE_NAME: 'osu! Tournament Portal',
    STORAGE_DRIVER: 's3',
    STORAGE_LOCAL_DIR: '/var/lib/tournament/uploads',
    IRC_ENABLED: 'false',
    IRC_GATEWAY_SECRET: secret(),
    RUSTFS_ACCESS_KEY: `root${secret().slice(0, 16)}`,
    RUSTFS_SECRET_KEY: secret(),
    S3_ENDPOINT: 'http://object-storage:9000',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'tournament-media',
    S3_ACCESS_KEY_ID: `app${secret().slice(0, 16)}`,
    S3_SECRET_ACCESS_KEY: secret(),
    S3_FORCE_PATH_STYLE: 'true',
    ...settings,
  };
}

export function serializeConfiguration(values) {
  return (
    Object.entries(values)
      .map(([key, value]) => {
        if (/[\r\n\0]/.test(String(value))) throw new Error(`${key} must be a single line.`);
        return `${key}='${String(value).replace(/'/g, "\\'")}'`;
      })
      .join('\n') + '\n'
  );
}

export function validateSiteUrl(value) {
  const u = new URL(value);
  if (
    !['https:', 'http:'].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== '/' ||
    (u.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))
  )
    throw new Error('Use an HTTPS site URL, or HTTP localhost for local testing.');
  return u.origin;
}

function includesAddress(cidr, address) {
  const [base, prefix] = cidr.split('/');
  if (isIP(base) !== 4 || isIP(address) !== 4) return false;
  const bits = Number(prefix);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) throw new Error('Invalid Docker subnet.');
  const number = (s) => s.split('.').reduce((n, part) => (n * 256 + Number(part)) >>> 0, 0);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (number(base) & mask) >>> 0 === (number(address) & mask) >>> 0;
}

export function checkNetworkSafety({ pools, networks }, client) {
  if (!client) return;
  if (!Array.isArray(pools) || !pools.length || !Array.isArray(networks))
    throw new Error(
      'Cannot inspect Docker address pools. Ask your administrator to check network safety.',
    );
  const subnets = [
    ...pools.map((p) => p.Base),
    ...networks.flatMap((n) => (n.IPAM?.Config || []).map((c) => c.Subnet)),
  ];
  if (subnets.some((subnet) => subnet && includesAddress(subnet, client)))
    throw new Error(
      'A Docker address pool or existing network overlaps your SSH client. Nothing was started. Reserve a Docker-only range first; see docs/ARCHITECTURE.md#network-safety.',
    );
}

async function questions() {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error(
      'Guided setup needs a terminal. Run without --interactive to generate an editable .env.',
    );
  let hidden = false;
  const output = new Writable({
    write(chunk, encoding, done) {
      if (!hidden) process.stdout.write(chunk, encoding);
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  rl.on('SIGINT', () => {
    rl.close();
    process.exitCode = 130;
  });
  async function ask(label, validate, secret = false) {
    for (;;) {
      process.stdout.write(label);
      hidden = secret;
      let answer;
      try {
        answer = (await rl.question('')).trim();
      } finally {
        hidden = false;
        if (secret) process.stdout.write('\n');
      }
      try {
        return validate(answer);
      } catch (error) {
        console.log(error.message);
      }
    }
  }
  try {
    console.log('osu! Tournament Portal setup. Existing configuration is never overwritten.');
    const APP_URL = await ask('Public site URL: ', validateSiteUrl);
    const WEB_PORT = await ask('Local port [3335]: ', (v) => {
      v ||= '3335';
      if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 65535)
        throw new Error('Enter a port between 1 and 65535.');
      return v;
    });
    console.log(
      `Register an osu! OAuth application at https://osu.ppy.sh/home/account/edit#oauth\nCallback URL: ${APP_URL}/api/auth/callback`,
    );
    const OSU_CLIENT_ID = await ask('osu! client ID: ', (v) => {
      if (!/^[1-9]\d*$/.test(v)) throw new Error('Enter the numeric OAuth client ID.');
      return v;
    });
    const OSU_CLIENT_SECRET = await ask(
      'osu! client secret (hidden): ',
      (v) => {
        if (!v || /[\r\n\0]/.test(v)) throw new Error('Enter the client secret.');
        return v;
      },
      true,
    );
    const OWNER_OSU_ID = await ask('Your numeric osu! user ID: ', (v) => {
      if (!/^[1-9]\d{0,8}$/.test(v))
        throw new Error('Enter the number at the end of your osu! profile URL.');
      return v;
    });
    return { APP_URL, WEB_PORT, OSU_CLIENT_ID, OSU_CLIENT_SECRET, OWNER_OSU_ID };
  } finally {
    rl.close();
  }
}

export async function configure(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      interactive: { type: 'boolean' },
      'check-network': { type: 'boolean' },
      'add-storage': { type: 'boolean' },
    },
  });
  if (values['check-network']) {
    checkNetworkSafety(
      JSON.parse(readFileSync(0, 'utf8')),
      process.env.SSH_CONNECTION?.split(' ')[0],
    );
    return;
  }
  const destination = path.resolve(positionals[0] || '.env');
  const configuration = createConfiguration(
    process.env,
    values.interactive ? await questions() : {},
  );
  if (values['add-storage']) {
    const storage = Object.fromEntries(
      Object.entries(configuration).filter(([k]) => /^(S3_|RUSTFS_)/.test(k)),
    );
    const existing = await readFile(destination, 'utf8');
    if (Object.keys(storage).some((key) => new RegExp(`^${key}=`, 'm').test(existing)))
      throw new Error('Storage configuration already exists; nothing was overwritten.');
    await appendFile(destination, serializeConfiguration(storage));
  } else {
    await writeFile(destination, serializeConfiguration(configuration), {
      mode: 0o600,
      flag: 'wx',
    });
  }
  console.log(`Saved private configuration to ${destination}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  configure().catch((error) => {
    console.error(
      error.code === 'EEXIST'
        ? 'Configuration already exists. Nothing was overwritten.'
        : error.message,
    );
    process.exitCode = 1;
  });
}
