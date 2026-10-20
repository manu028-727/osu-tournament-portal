import { createGateway } from './gateway';
import { ircSecret, rpcHeaders } from '../../src/lib/irc-security';

const secret = ircSecret();
const origin = new URL(process.env.APP_URL!).origin;
const backend = new URL('/api/internal/irc', process.env.IRC_WEB_INTERNAL_URL || 'http://web:3000');
const gateway = createGateway({
  origin,
  secret,
  host: process.env.IRC_SERVER_HOST || 'irc.ppy.sh',
  port: Number(process.env.IRC_SERVER_PORT || 6667),
  async rpc(identity, operation, extra) {
    const body = JSON.stringify({ identity, operation, ...extra });
    const result = await fetch(backend, {
      method: 'POST',
      headers: rpcHeaders(body, secret),
      body,
      signal: AbortSignal.timeout(10000),
    });
    const data = (await result.json()) as Record<string, unknown>;
    if (!result.ok)
      throw new Error(
        typeof data.error === 'string' ? data.error : 'Website authorization unavailable.',
      );
    return data;
  },
});
gateway.server.listen(Number(process.env.PORT || 8080), '0.0.0.0', () =>
  console.log('IRC gateway ready; credentials and chat are never logged.'),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void gateway.close().then(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
