import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createProxyServer, proxyUpgrade } from 'httpxy';

const dev = process.env.CONTAINER_DEVELOPMENT === 'true';
const port = Number(process.env.PORT || 3000);
const internalPort = Number(process.env.NEXT_INTERNAL_PORT || 3002);
const next = spawn(
  process.execPath,
  dev
    ? [
        'node_modules/next/dist/bin/next',
        'dev',
        '--webpack',
        '--hostname',
        '127.0.0.1',
        '--port',
        String(internalPort),
      ]
    : ['server.js'],
  {
    stdio: 'inherit',
    env: { ...process.env, PORT: String(internalPort), HOSTNAME: '127.0.0.1' },
  },
);
const upstream = `http://127.0.0.1:${internalPort}`;
const proxy = createProxyServer({ target: upstream, changeOrigin: false, proxyTimeout: 120000 });
const connections = new Set();
const upgraded = new Set();
const server = createServer(async (req, res) => {
  if (!req.url?.startsWith('/') || req.url.startsWith('//')) {
    res.writeHead(400);
    res.end();
    return;
  }
  try {
    await proxy.web(req, res);
  } catch {
    if (!res.headersSent) res.writeHead(503, { 'Cache-Control': 'no-store' });
    res.end('Application unavailable');
  }
});
server.headersTimeout = 15000;
server.requestTimeout = 120000;
server.on('connection', (socket) => {
  connections.add(socket);
  socket.on('close', () => connections.delete(socket));
});
server.on('upgrade', (req, socket, head) => {
  upgraded.add(socket);
  socket.once('close', () => upgraded.delete(socket));
  const irc = process.env.IRC_ENABLED === 'true' && req.url === '/api/irc/socket';
  const upgradePath = new URL(req.url || '/', 'http://internal').pathname;
  const hmr = dev && ['/_next/hmr', '/_next/webpack-hmr'].includes(upgradePath);
  if ((!irc && !hmr) || (irc && req.headers.origin !== new URL(process.env.APP_URL).origin)) {
    socket.destroy();
    return;
  }
  // IRC authenticates with a one-use first-frame ticket, never cookies or URL secrets.
  if (irc) {
    delete req.headers.cookie;
    delete req.headers.authorization;
  }
  void proxyUpgrade(
    irc ? process.env.IRC_GATEWAY_URL || 'http://irc-gateway:8080' : upstream,
    req,
    socket,
    head,
  ).catch(() => socket.destroy());
});
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const socket of upgraded) socket.destroy();
  server.close(() => next.kill('SIGTERM'));
  server.closeIdleConnections();
  const timer = setTimeout(() => {
    for (const socket of connections) socket.destroy();
    next.kill('SIGKILL');
    process.exit(1);
  }, 20000);
  timer.unref();
  next.once('exit', () => process.exit(code));
  if (next.exitCode !== null) process.exit(code);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop());
next.on('exit', (code) => {
  if (!stopping) {
    server.close();
    process.exit(code || 1);
  }
});
server.listen(port, '0.0.0.0', () => console.log(`Web listener ready on port ${port}.`));
