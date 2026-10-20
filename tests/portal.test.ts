import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function runPortal(
  command: string,
  options: {
    services?: string;
    denyNetwork?: boolean;
    legacy?: boolean;
    missingConfig?: boolean;
  } = {},
) {
  const dir = mkdtempSync(path.join(tmpdir(), 'portal-cli-'));
  try {
    mkdirSync(path.join(dir, 'bin'));
    writeFileSync(path.join(dir, 'portal'), readFileSync('portal'));
    writeFileSync(path.join(dir, 'compose.yaml'), 'services: {}\n');
    if (!options.missingConfig)
      writeFileSync(path.join(dir, options.legacy ? '.env.docker' : '.env'), 'STACK_NAME=test\n');
    const log = path.join(dir, 'calls.jsonl');
    writeFileSync(
      path.join(dir, 'bin/docker'),
      `#!${process.execPath}
const fs = require('node:fs');
const a = process.argv.slice(2);
fs.appendFileSync(process.env.CALL_LOG, JSON.stringify(a) + '\\n');
if (a[0] === 'info' && a.includes('--format')) console.log('[{"Base":"198.51.100.0/24","Size":28}]');
if (a[0] === 'network' && a[1] === 'ls') console.log('abc');
if (a[0] === 'network' && a[1] === 'inspect') console.log('[]');
if (a[0] === 'run' && a.includes('--check-network')) { fs.readFileSync(0); if (process.env.DENY_NETWORK === 'yes') process.exit(1); }
if (a[0] === 'compose' && a.includes('--services')) console.log(process.env.SERVICES);
`,
      { mode: 0o755 },
    );
    const r = spawnSync('bash', [path.join(dir, 'portal'), command], {
      env: {
        ...process.env,
        PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`,
        CALL_LOG: log,
        SERVICES: options.services ?? 'web\npostgres\nobject-storage\nstorage-init',
        DENY_NETWORK: options.denyNetwork ? 'yes' : 'no',
        PORTAL_ENV_FILE: '',
      },
      encoding: 'utf8',
    });
    const calls: string[][] = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const commands = calls
      .filter((a) => a[0] === 'compose' && a.includes('--env-file'))
      .map((a) => a.slice(a.indexOf('--env-file') + 2));
    return { ...r, calls, commands, dir };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('deployment command', () => {
  it('installs bundled services in order without destructive operations', () => {
    const r = runPortal('install');
    expect(r.status, r.stderr).toBe(0);
    expect(r.commands).toEqual([
      ['config', '--services'],
      ['build', 'web', 'migrate'],
      ['up', '-d', '--wait', 'postgres', 'object-storage'],
      ['run', '--rm', 'migrate'],
      ['run', '--rm', 'bootstrap'],
      ['run', '--rm', 'storage-init'],
      ['up', '-d', '--wait', '--no-build', 'postgres', 'object-storage', 'web'],
    ]);
    expect(r.calls.flat()).not.toContain('--volumes');
    expect(r.calls.flat()).not.toContain('down');
    expect(r.calls.find((a) => a[0] === 'run')).toContain('none');
  });
  it('starts an installed external-service deployment without running migrations', () => {
    const r = runPortal('start', { services: 'web' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.commands).toEqual([
      ['config', '--services'],
      ['up', '-d', '--wait', '--no-build', 'web'],
    ]);
  });
  it('builds and starts optional IRC only when configured', () => {
    const r = runPortal('install', { services: 'web\nirc-gateway' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.commands).toContainEqual(['build', 'web', 'migrate', 'irc-gateway']);
    expect(r.commands.at(-1)).toEqual(['up', '-d', '--wait', '--no-build', 'irc-gateway', 'web']);
    expect(r.commands).not.toContainEqual(['run', '--rm', 'storage-init']);
  });
  it('refuses unsafe networks before starting any services', () => {
    const r = runPortal('start', { denyNetwork: true });
    expect(r.status).not.toBe(0);
    expect(r.commands).toEqual([]);
  });
  it('keeps legacy configuration and stops without deleting data', () => {
    const r = runPortal('stop', { legacy: true });
    expect(r.status, r.stderr).toBe(0);
    expect(r.commands).toEqual([['stop']]);
    expect(r.calls.find((a) => a.includes('--env-file'))).toContain(
      path.join(r.dir, '.env.docker'),
    );
  });
  it('does not start without configuration', () => {
    const r = runPortal('start', { missingConfig: true });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('./portal setup');
    expect(r.commands).toEqual([]);
  });
});
