import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'dotenv';
import {
  checkNetworkSafety,
  createConfiguration,
  serializeConfiguration,
  validateSiteUrl,
} from '../scripts/configure.mjs';
describe('portable configuration', () => {
  it('generates distinct private credentials and refuses overwrite', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'platform-setup-'));
    try {
      const script = path.resolve('scripts/configure.mjs');
      const run = () =>
        spawnSync(process.execPath, [script], {
          cwd: dir,
          encoding: 'utf8',
          env: { ...process.env, STACK_NAME: '', POSTGRES_DB: '', WEB_PORT: '' },
        });
      expect(run().status).toBe(0);
      const file = path.join(dir, '.env');
      const original = readFileSync(file);
      const c = parse(original);
      expect(c.S3_SECRET_ACCESS_KEY).not.toBe(c.RUSTFS_SECRET_KEY);
      expect(c.POSTGRES_PASSWORD).not.toBe(c.APP_DATABASE_PASSWORD);
      expect(c.IRC_ENABLED).toBe('false');
      expect(c.COMPOSE_PROFILES).toBe('database,storage');
      expect(c.STACK_NAME).toMatch(/^portal-[a-f0-9]{8}$/);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(run().status).not.toBe(0);
      expect(readFileSync(file)).toEqual(original);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('generates the matching callback and preserves literal env values', () => {
    const settings = { APP_URL: 'https://cup.example.com', WEB_PORT: '3456' };
    const c = createConfiguration({}, settings);
    expect(c.OSU_REDIRECT_URI).toBe('https://cup.example.com/api/auth/callback');
    expect(c.WEB_PORT).toBe('3456');
    expect(parse(serializeConfiguration({ VALUE: '$literal # value' })).VALUE).toBe(
      '$literal # value',
    );
    expect(() => serializeConfiguration({ VALUE: 'line\nINJECTED=yes' })).toThrow('single line');
  });
  it('collects native image-library attribution from the installed README', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'portal-notices-'));
    try {
      const pkg = 'node_modules/@img/sharp-libvips-test';
      mkdirSync(path.join(dir, pkg), { recursive: true });
      writeFileSync(
        path.join(dir, 'package-lock.json'),
        JSON.stringify({ packages: { [pkg]: {} } }),
      );
      writeFileSync(
        path.join(dir, pkg, 'package.json'),
        JSON.stringify({ name: '@img/sharp-libvips-test', version: '0.0.0' }),
      );
      writeFileSync(path.join(dir, pkg, 'README.md'), 'Native libvips attribution: LGPLv3.');
      writeFileSync(path.join(dir, pkg, 'versions.json'), '{"vips":"test"}');
      const r = spawnSync(process.execPath, [path.resolve('scripts/collect-notices.mjs')], {
        cwd: dir,
        encoding: 'utf8',
      });
      expect(r.status, r.stderr).toBe(0);
      expect(
        readFileSync(path.join(dir, '.data/licenses/THIRD_PARTY_NOTICES.txt'), 'utf8'),
      ).toContain('Native libvips attribution: LGPLv3.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it.each(['0', '65536', 'abc'])('rejects invalid port %s', (WEB_PORT) => {
    expect(() => createConfiguration({ WEB_PORT })).toThrow('Port');
  });
  it.each([
    'http://cup.example.com',
    'https://cup.example.com/path',
    'https://user:pass@cup.example.com',
    'https://cup.example.com/?secret=1',
  ])('rejects unsafe public URL %s', (value) => {
    expect(() => validateSiteUrl(value)).toThrow();
  });
  it('normalizes site origins and permits local testing', () => {
    expect(validateSiteUrl('https://cup.example.com/')).toBe('https://cup.example.com');
    expect(validateSiteUrl('http://localhost:3456')).toBe('http://localhost:3456');
  });
  it('blocks both address-pool and existing-network SSH collisions', () => {
    expect(() =>
      checkNetworkSafety({ pools: [{ Base: '192.0.2.0/24' }], networks: [] }, '192.0.2.20'),
    ).toThrow('overlaps');
    expect(() =>
      checkNetworkSafety(
        {
          pools: [{ Base: '198.51.100.0/24' }],
          networks: [{ IPAM: { Config: [{ Subnet: '192.0.2.0/24' }] } }],
        },
        '192.0.2.20',
      ),
    ).toThrow('overlaps');
    expect(() =>
      checkNetworkSafety({ pools: [{ Base: '198.51.100.0/24' }], networks: [] }, '192.0.2.20'),
    ).not.toThrow();
    expect(() => checkNetworkSafety({ pools: [], networks: [] }, '192.0.2.20')).toThrow(
      'Cannot inspect',
    );
    expect(() => checkNetworkSafety({ pools: [], networks: [] }, undefined)).not.toThrow();
  });
  it('pins the test migration child independently of inherited live URLs', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'platform-migration-'));
    try {
      mkdirSync(path.join(dir, 'node_modules/prisma/build'), { recursive: true });
      writeFileSync(
        path.join(dir, 'node_modules/prisma/build/index.js'),
        'console.log(JSON.stringify([process.env.DATABASE_URL,process.env.DIRECT_URL]));',
      );
      const url = 'postgresql://test:test@localhost/tournament_platform_test';
      const r = spawnSync(process.execPath, [path.resolve('scripts/migrate-test.mjs')], {
        cwd: dir,
        env: {
          ...process.env,
          TEST_DATABASE_URL: url,
          DIRECT_URL: 'postgresql://live:secret@localhost/production',
        },
        encoding: 'utf8',
      });
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual([url, url]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
