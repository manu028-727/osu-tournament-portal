import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { createProxyServer, proxyUpgrade } from 'httpxy';
const target = process.env.QA_HTTP_TARGET || 'http://localhost:3335';
const proxy = createProxyServer({ target, changeOrigin: false });
const server = createServer(
  { key: readFileSync('.data/qa/tls.key'), cert: readFileSync('.data/qa/tls.crt') },
  async (req, res) => {
    try {
      await proxy.web(req, res);
    } catch {
      res.writeHead(503);
      res.end();
    }
  },
);
server.on('upgrade', (req, socket, head) => {
  void proxyUpgrade(target, req, socket, head).catch(() => socket.destroy());
});
server.listen(3443, '127.0.0.1', () =>
  console.log('Isolated QA HTTPS/WSS proxy ready on https://localhost:3443'),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    server.close();
    process.exit(0);
  });
