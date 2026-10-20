import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function freePort() {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  return port;
}
async function fixture(development: boolean) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'container-proxy-'));
  cleanups.push(() => rm(cwd, { recursive: true, force: true }));
  const standIn = `
const {createServer} = require('node:http');
const {createHash} = require('node:crypto');
const server = createServer((req,res) => res.end('upstream-ready'));
server.on('upgrade', (req,socket) => {
  const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: ' + accept + '\\r\\n\\r\\n');
});
server.listen(Number(process.env.PORT), '127.0.0.1');
process.once('SIGTERM', () => process.exit(0));
`;
  await writeFile(path.join(cwd, 'server.js'), standIn);
  await mkdir(path.join(cwd, 'node_modules/next/dist/bin'), { recursive: true });
  await writeFile(path.join(cwd, 'node_modules/next/dist/bin/next'), standIn);
  const port = await freePort();
  const internalPort = await freePort();
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../scripts/serve-container.mjs', import.meta.url))],
    {
      cwd,
      env: {
        ...process.env,
        PORT: String(port),
        NEXT_INTERNAL_PORT: String(internalPort),
        CONTAINER_DEVELOPMENT: String(development),
        IRC_ENABLED: 'false',
      },
      stdio: 'ignore',
    },
  );
  cleanups.push(async () => {
    if (child.exitCode !== null) return;
    const closed = once(child, 'exit');
    child.kill('SIGTERM');
    await closed;
  });
  const deadline = Date.now() + 5000;
  while (true) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok && (await response.text()) === 'upstream-ready') break;
    } catch {}
    if (Date.now() > deadline) throw new Error('Front proxy did not start');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  async function upgrade(target: string) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${target}`);
    cleanups.push(async () => socket.terminate());
    return await new Promise<boolean>((resolve) => {
      socket.once('open', () => resolve(true));
      socket.once('error', () => resolve(false));
      socket.once('close', () => resolve(false));
    });
  }
  return { upgrade };
}

describe('container front listener', () => {
  it('forwards both supported development HMR paths without allowing arbitrary upgrades', async () => {
    const front = await fixture(true);
    expect(await front.upgrade('/_next/hmr?id=next-16')).toBe(true);
    expect(await front.upgrade('/_next/webpack-hmr?page=legacy')).toBe(true);
    expect(await front.upgrade('/_next/hmr-not-allowed')).toBe(false);
    expect(await front.upgrade('/arbitrary')).toBe(false);
  });
  it('never exposes development upgrades or disabled IRC in production', async () => {
    const front = await fixture(false);
    expect(await front.upgrade('/_next/hmr?id=next-16')).toBe(false);
    expect(await front.upgrade('/_next/webpack-hmr')).toBe(false);
    expect(await front.upgrade('/api/irc/socket')).toBe(false);
  });
});
