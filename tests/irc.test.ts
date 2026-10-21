import { afterEach, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { createGateway, type GatewayRpc } from '../services/irc/gateway';
import { mockBancho, type MockBanchoOptions } from './helpers/mock-bancho';
import { ircClientMessage, lobbyFromResponse, validateLobbyCommand } from '../src/lib/irc-protocol';
import {
  signTicket,
  readTicket,
  rpcHeaders,
  verifyRpc,
  ircNickname,
} from '../src/lib/irc-security';
import type { IrcIdentity, IrcServerEvent, IrcConnectionDiagnostic } from '../src/lib/irc-types';

const secret = 'a'.repeat(64),
  origin = 'https://cup.example.com';
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const claims = (userId = 'ref-a'): IrcIdentity => ({
  userId,
  username: userId === 'ref-a' ? 'Ref A' : 'Ref B',
  sessionHash: '1'.repeat(64),
  tournamentId: 'event-a',
  matchId: 'match-a',
  expires: Date.now() + 60000,
  nonce: randomUUID(),
});
async function until(check: () => boolean, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for mock IRC event');
    await new Promise((r) => setTimeout(r, 10));
  }
}
async function fixture(rpc?: GatewayRpc, silentCreate = false, options: MockBanchoOptions = {}) {
  const mock = mockBancho({ silentCreate, ...options });
  mock.server.listen(0, '127.0.0.1');
  await once(mock.server, 'listening');
  cleanup.push(mock.close);
  const recorded: { operation: string; extra?: Record<string, unknown> }[] = [];
  const diagnostics: IrcConnectionDiagnostic[] = [];
  const gateway = createGateway({
    origin,
    secret,
    host: '127.0.0.1',
    port: (mock.server.address() as AddressInfo).port,
    outcomeMs: 120,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    rpc:
      rpc ||
      (async (identity, operation, extra) => {
        recorded.push({ operation, extra });
        return {
          username: identity.username,
          multiplayerId: 101,
          operate: true,
          requestId: 'request-1',
        };
      }),
  });
  gateway.server.listen(0, '127.0.0.1');
  await once(gateway.server, 'listening');
  cleanup.push(gateway.close);
  const url = `ws://127.0.0.1:${(gateway.server.address() as AddressInfo).port}/api/irc/socket`;
  async function browser(identity = claims()) {
    const socket = new WebSocket(url, { origin });
    const events: IrcServerEvent[] = [];
    socket.on('message', (data) => events.push(JSON.parse(data.toString())));
    await once(socket, 'open');
    socket.send(JSON.stringify({ type: 'auth', ticket: signTicket(identity, secret) }));
    await until(() => events.some((e) => e.type === 'state'));
    return { socket, events, send: (input: object) => socket.send(JSON.stringify(input)) };
  }
  return { mock, gateway, url, browser, recorded, diagnostics };
}
describe('IRC security and protocol', () => {
  it.each([true, false])(
    'sends consecutive commands without waiting for replies (bot replies: %s)',
    async (reply) => {
      const commands = [
        ['!mp invite Manu028', ['User not found']],
        ['!mp invite Manu028', ['Invited Manu028 to the room']],
        ['!mp lock', ['Locked the match']],
        ['!mp unlock', ['Unlocked the match']],
        ['!mp aborttimer', []],
      ] as const;
      let replyIndex = 0;
      const f = await fixture(undefined, false, {
        commandReplies: () => (reply ? [...commands[replyIndex++][1]] : []),
      });
      const a = await f.browser();
      a.send({ type: 'connect', acknowledged: true, password: 'separate-test-irc-password' });
      await until(() => f.gateway.sessions.get('ref-a')?.state === 'connected');
      a.send({ type: 'join' });
      await until(() => f.gateway.sessions.get('ref-a')?.channels.has('#mp_101') || false);
      const otherTab = await f.browser();
      for (const [command, replies] of commands) {
        const id = randomUUID();
        a.send({ type: 'command', id, target: '#mp_101', command, confirmed: true });
        await until(() =>
          otherTab.events.some(
            (e) => e.type === 'delivery' && e.delivery.id === id && e.delivery.state === 'sent',
          ),
        );
        expect(f.gateway.sessions.get('ref-a')?.pending.size).toBe(0);
        for (const text of reply ? replies : [])
          await until(() => a.events.some((e) => e.type === 'message' && e.message.text === text));
        await until(() => f.mock.lines.includes(`PRIVMSG #mp_101 :${command}`));
      }
      await new Promise((resolve) => setTimeout(resolve, 180));
      const deliveries = f.gateway.sessions.get('ref-a')?.deliveries;
      expect(deliveries).toHaveLength(5);
      expect(deliveries?.every((d) => d.state === 'sent')).toBe(true);
      expect(
        f.mock.lines.filter((line) => line === 'PRIVMSG #mp_101 :!mp invite Manu028'),
      ).toHaveLength(2);
      expect(
        f.mock.lines.filter((line) => line === 'PRIVMSG #mp_101 :!mp aborttimer'),
      ).toHaveLength(1);
      expect(a.events.filter((e) => e.type === 'error')).toEqual([]);
    },
  );
  it('keeps Bancho rejections visible in chat without claiming execution or retrying', async () => {
    const f = await fixture(undefined, false, {
      commandReplies: () => ['You do not have permission to use this command.'],
    });
    const a = await f.browser();
    a.send({ type: 'connect', acknowledged: true, password: 'separate-test-irc-password' });
    await until(() => f.gateway.sessions.get('ref-a')?.state === 'connected');
    a.send({ type: 'join' });
    await until(() => f.gateway.sessions.get('ref-a')?.channels.has('#mp_101') || false);
    const id = randomUUID();
    a.send({ type: 'command', id, target: '#mp_101', command: '!mp timer 90' });
    await until(() =>
      a.events.some(
        (e) =>
          e.type === 'message' &&
          e.message.text === 'You do not have permission to use this command.',
      ),
    );
    expect(f.gateway.sessions.get('ref-a')?.pending.size).toBe(0);
    expect(f.gateway.sessions.get('ref-a')?.deliveries.at(-1)?.state).toBe('sent');
    expect(f.mock.lines.filter((line) => line.includes('!mp timer 90'))).toHaveLength(1);
  });
  it('uses legacy registration without CAP and preserves the exact supplied password', async () => {
    const password = ':Mixed+%2F/\\"=&?Z' + 'x'.repeat(80);
    const f = await fixture(undefined, false, { strictRegistration: true, password });
    const a = await f.browser();
    a.send({ type: 'connect', acknowledged: true, password });
    await until(() =>
      a.events.some((event) => event.type === 'state' && event.channels.includes('#osu')),
    );
    expect(f.mock.registrations).toEqual([
      { nickname: 'Ref_A', commands: ['PASS', 'NICK', 'USER'], passwordMatches: true },
    ]);
    expect(f.mock.lines).toContain('USER Ref_A 0 * :Ref_A');
    expect(JSON.stringify(a.events)).not.toContain(password);
    expect(f.diagnostics).toEqual([
      { nickname: 'Ref_A', stage: 'connecting', source: 'gateway', code: 'CONNECTING' },
      { nickname: 'Ref_A', stage: 'registration', source: 'transport', code: 'TCP_CONNECTED' },
      { nickname: 'Ref_A', stage: 'connected', source: 'bancho', code: '001' },
    ]);
    expect(JSON.stringify(f.diagnostics)).not.toContain(password);
    expect(JSON.stringify(f.recorded)).not.toContain(password);
  });
  it('preserves a 200-character password and keeps different users credentials separate', async () => {
    const passwords: Record<string, string> = { Ref_A: 'a'.repeat(200), Ref_B: ':B+%2F=Secret' };
    const f = await fixture(undefined, false, {
      strictRegistration: true,
      password: (nick) => passwords[nick],
    });
    const a = await f.browser();
    const b = await f.browser(claims('ref-b'));
    a.send({ type: 'connect', acknowledged: true, password: passwords.Ref_A });
    b.send({ type: 'connect', acknowledged: true, password: passwords.Ref_B });
    await until(
      () =>
        a.events.some((e) => e.type === 'state' && e.channels.includes('#osu')) &&
        b.events.some((e) => e.type === 'state' && e.channels.includes('#osu')),
    );
    expect(
      f.mock.registrations.map((r) => ({
        nickname: r.nickname,
        passwordMatches: r.passwordMatches,
      })),
    ).toEqual(
      expect.arrayContaining([
        { nickname: 'Ref_A', passwordMatches: true },
        { nickname: 'Ref_B', passwordMatches: true },
      ]),
    );
    for (const password of Object.values(passwords)) {
      expect(JSON.stringify([...a.events, ...b.events])).not.toContain(password);
      expect(JSON.stringify(f.diagnostics)).not.toContain(password);
      expect(JSON.stringify(f.mock.lines)).not.toContain(password);
    }
  });
  it('rejects invalid passwords locally without trimming, truncating or contacting Bancho', async () => {
    const f = await fixture(undefined, false, { strictRegistration: true });
    const a = await f.browser();
    const invalid = ['', 'x'.repeat(201), ' correct ', 'secret\r\nNICK Other', 'secret\0'];
    for (const [index, password] of invalid.entries()) {
      a.send({ type: 'connect', acknowledged: true, password });
      await until(() => f.diagnostics.length > index);
      expect(f.diagnostics.at(-1)).toEqual({
        nickname: 'Ref_A',
        stage: 'validation',
        source: 'gateway',
        code: 'INVALID_CONNECT_REQUEST',
      });
    }
    expect(f.mock.registrations).toHaveLength(0);
    expect(a.events.filter((e) => e.type === 'error')).toHaveLength(invalid.length);
    expect(JSON.stringify(a.events)).not.toContain('secret');
  });
  it('reports a transport failure without claiming Bancho rejected the password', async () => {
    const f = await fixture();
    const a = await f.browser();
    await f.mock.close();
    a.send({ type: 'connect', acknowledged: true, password: 'separate-test-irc-password' });
    await until(() =>
      a.events.some((e) => e.type === 'error' && e.diagnostic?.source === 'transport'),
    );
    expect(f.diagnostics.at(-1)).toMatchObject({
      nickname: 'Ref_A',
      stage: 'connecting',
      source: 'transport',
    });
    expect(['SOCKET_ERROR', 'SOCKET_CLOSED']).toContain(f.diagnostics.at(-1)?.code);
    expect(f.gateway.sessions.get('ref-a')?.state).toBe('disconnected');
    expect(a.events.some((e) => e.type === 'error' && e.error.includes('Bancho rejected'))).toBe(
      false,
    );
  });
  it('rechecks the authenticated current username and refuses stale identity claims', async () => {
    let username = 'Ref A';
    const f = await fixture(async () => ({ username }), false, { strictRegistration: true });
    const old = await f.browser();
    username = '[Renamed Ref]';
    old.send({ type: 'connect', acknowledged: true, password: 'separate-test-irc-password' });
    await until(() =>
      old.events.some((e) => e.type === 'error' && e.error.includes('username changed')),
    );
    expect(f.mock.registrations).toHaveLength(0);
    expect(f.diagnostics.at(-1)).toEqual({
      nickname: '[Renamed_Ref]',
      stage: 'identity',
      source: 'gateway',
      code: 'USERNAME_CHANGED',
    });
    const current = await f.browser({ ...claims(), username });
    current.send({ type: 'connect', acknowledged: true, password: 'separate-test-irc-password' });
    await until(() => f.gateway.sessions.get('ref-a')?.state === 'connected');
    expect(f.mock.registrations[0]).toEqual({
      nickname: '[Renamed_Ref]',
      commands: ['PASS', 'NICK', 'USER'],
      passwordMatches: true,
    });
    expect(f.gateway.sessions.get('ref-a')?.username).toBe('[Renamed_Ref]');
  });
  it.each(['464', 'ERROR', '432', '433', '461'] as const)(
    'identifies upstream %s without exposing server reply text or reviving a failed login',
    async (code) => {
      const password = 'private-test-token-%2F+Secret';
      const f = await fixture(undefined, false, {
        strictRegistration: true,
        password,
        registrationError: {
          code,
          reason: `Bad authentication: PASS ${password}`,
          lateWelcome: true,
        },
      });
      const a = await f.browser();
      a.send({ type: 'connect', acknowledged: true, password });
      await until(() => a.events.some((e) => e.type === 'error' && e.diagnostic?.code === code));
      const errors = a.events.filter((e) => e.type === 'error');
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({
        diagnostic: { nickname: 'Ref_A', stage: 'registration', source: 'bancho', code },
      });
      expect(f.gateway.sessions.get('ref-a')?.state).toBe('disconnected');
      expect(a.events.some((e) => e.type === 'state' && e.state === 'connected')).toBe(false);
      expect(f.mock.lines.some((line) => line.startsWith('JOIN '))).toBe(false);
      expect(JSON.stringify(a.events)).not.toContain(password);
      expect(JSON.stringify(f.diagnostics)).not.toContain(password);
      expect(JSON.stringify(f.diagnostics)).not.toContain('PASS');
      expect(f.diagnostics.at(-1)).toEqual({
        nickname: 'Ref_A',
        stage: 'registration',
        source: 'bancho',
        code,
      });
    },
  );
  it('rejects forged/expired tickets and RPC replays with altered content', () => {
    const identity = claims();
    expect(readTicket(signTicket(identity, secret), secret)).toEqual(identity);
    expect(() => readTicket(signTicket(identity, secret) + 'x', secret)).toThrow();
    expect(() =>
      readTicket(signTicket({ ...identity, expires: Date.now() - 1 }, secret), secret),
    ).toThrow();
    const body = '{}',
      headers = new Headers(rpcHeaders(body, secret));
    expect(verifyRpc(body, headers, secret)).toBeTruthy();
    expect(() => verifyRpc('changed', headers, secret)).toThrow();
    expect(ircNickname('Ref A')).toBe('Ref_A');
    expect(() => ircNickname('x\r\nOPER root')).toThrow();
  });
  it('validates destinations, single-line messages, commands and creator-only controls', () => {
    expect(
      ircClientMessage.safeParse({
        type: 'chat',
        id: randomUUID(),
        target: '#osu\r\nOPER root',
        text: 'x',
      }).success,
    ).toBe(false);
    expect(
      ircClientMessage.safeParse({
        type: 'chat',
        id: randomUUID(),
        target: '#osu',
        text: 'x\r\nPASS secret',
      }).success,
    ).toBe(false);
    expect(() => validateLobbyCommand('!mp close', false, true)).toThrow();
    expect(() => validateLobbyCommand('!mp addref Ref', true, false)).toThrow();
    expect(() => validateLobbyCommand('!mp make Wrong', true, true)).toThrow();
    expect(() => validateLobbyCommand('!mp map 123 3', false, false)).not.toThrow();
    expect(
      lobbyFromResponse('Player', 'Created the tournament match https://osu.ppy.sh/mp/99'),
    ).toBeNull();
    expect(
      lobbyFromResponse('BanchoBot', 'Created the tournament match https://evil.example/mp/99'),
    ).toBeNull();
  });
  it('logs in independently, joins osu, handles PING and shares one connection across tabs', async () => {
    const f = await fixture();
    const a = await f.browser();
    a.send({ type: 'connect', acknowledged: true, password: 'separate-test-irc-password' });
    await until(() => a.events.some((e) => e.type === 'state' && e.channels.includes('#osu')));
    expect(f.gateway.sessions.get('ref-a')?.irc?.options.password).toBeUndefined();
    await until(() => f.mock.lines.some((line) => line.startsWith('PONG')));
    const second = await f.browser();
    expect(f.mock.sockets.size).toBe(1);
    const b = await f.browser(claims('ref-b'));
    b.send({ type: 'connect', acknowledged: true, password: 'separate-test-irc-password' });
    await until(() => f.mock.sockets.size === 2);
    a.send({ type: 'chat', id: randomUUID(), target: '#osu', text: '<script>plain text</script>' });
    await until(() =>
      second.events.some((e) => e.type === 'message' && e.message.text.includes('<script>')),
    );
    expect(b.events.some((e) => e.type === 'message' && e.message.text.includes('<script>'))).toBe(
      false,
    );
    expect(JSON.stringify(a.events)).not.toContain('separate-test-irc-password');
    a.send({ type: 'disconnect' });
    await until(() => f.gateway.sessions.get('ref-a')?.state === 'disconnected');
    expect(f.gateway.sessions.get('ref-b')?.state).not.toBe('disconnected');
    expect(f.mock.lines.some((line) => line.includes('!mp close'))).toBe(false);
  });
  it('verifies lobby creation only, sends ordinary commands and rejects duplicate submissions', async () => {
    const f = await fixture();
    const a = await f.browser();
    a.send({ type: 'connect', acknowledged: true, password: 'separate-test-irc-password' });
    await until(() => f.gateway.sessions.get('ref-a')?.state === 'connected');
    a.send({
      type: 'make',
      id: randomUUID(),
      name: 'Tournament: A vs B',
      baseVersion: 1,
      confirmed: true,
    });
    await until(() => a.events.some((e) => e.type === 'lobby'));
    await until(() => f.gateway.sessions.get('ref-a')?.channels.has('#mp_101') || false);
    expect(f.mock.lines).toContain('PRIVMSG BanchoBot :!mp make Tournament: A vs B');
    expect(f.mock.lines.some((line) => line.includes('PRIVMSG #osu :!mp make'))).toBe(false);
    expect(
      f.recorded.some((r) => r.operation === 'complete' && r.extra?.status === 'CREATED'),
    ).toBe(true);
    expect(f.gateway.sessions.get('ref-a')?.deliveries[0].state).toBe('confirmed');
    const id = randomUUID();
    a.send({ type: 'command', id, target: '#mp_101', command: '!mp settings' });
    await until(() =>
      a.events.some(
        (e) => e.type === 'delivery' && e.delivery.id === id && e.delivery.state === 'sent',
      ),
    );
    const sent = randomUUID();
    a.send({ type: 'command', id: sent, target: '#mp_101', command: '!mp mods NF HD' });
    await until(() =>
      a.events.some(
        (e) => e.type === 'delivery' && e.delivery.id === sent && e.delivery.state === 'sent',
      ),
    );
    a.send({ type: 'command', id: sent, target: '#mp_101', command: '!mp mods NF HD' });
    await until(() =>
      a.events.some((e) => e.type === 'error' && e.error.includes('already submitted')),
    );
    expect(f.mock.lines.filter((line) => line.includes('!mp mods NF HD'))).toHaveLength(1);
  });
  it('rejects replayed tickets, bad origins and server-side denied controls', async () => {
    const f = await fixture(async (identity, operation) => {
      if (operation === 'control') throw new Error('Read only match');
      return { username: identity.username, multiplayerId: 101 };
    });
    const identity = claims();
    const a = await f.browser(identity);
    const replay = new WebSocket(f.url, { origin });
    const errors: string[] = [];
    replay.on('message', (raw) => errors.push(raw.toString()));
    await once(replay, 'open');
    replay.send(JSON.stringify({ type: 'auth', ticket: signTicket(identity, secret) }));
    await until(() => errors.some((text) => text.includes('Ticket already used')));
    const bad = new WebSocket(f.url, { origin: 'https://evil.example' });
    bad.on('error', () => {});
    await new Promise<void>((resolve) => bad.once('close', () => resolve()));
    a.send({ type: 'connect', acknowledged: true, password: 'separate-test-irc-password' });
    await until(() => f.gateway.sessions.get('ref-a')?.state === 'connected');
    a.send({ type: 'join' });
    await until(() => f.gateway.sessions.get('ref-a')?.channels.has('#mp_101') || false);
    a.send({
      type: 'command',
      id: randomUUID(),
      target: '#mp_101',
      command: '!mp start 5',
      confirmed: true,
    });
    await until(() => a.events.some((e) => e.type === 'error' && e.error.includes('Read only')));
    expect(f.mock.lines.some((line) => line.includes('!mp start'))).toBe(false);
  });
  it('requires manual reconnect after failed authentication and never exposes the password', async () => {
    const f = await fixture();
    const a = await f.browser();
    a.send({ type: 'connect', acknowledged: true, password: 'incorrect-private-password' });
    await until(() =>
      a.events.some((e) => e.type === 'error' && e.error.includes('authentication')),
    );
    expect(f.gateway.sessions.get('ref-a')?.state).toBe('disconnected');
    expect(JSON.stringify(a.events)).not.toContain('incorrect-private-password');
    expect(f.mock.lines.filter((line) => line.startsWith('NICK '))).toHaveLength(1);
    a.send({ type: 'connect', acknowledged: true, password: 'separate-test-irc-password' });
    await until(() => f.gateway.sessions.get('ref-a')?.channels.has('#osu') || false);
    expect(f.gateway.sessions.get('ref-a')?.irc?.connection.options.password).toBeUndefined();
  });
  it('supports bounded player private messages and isolates channel errors from the connection', async () => {
    const f = await fixture();
    const a = await f.browser();
    a.send({ type: 'connect', acknowledged: true, password: 'separate-test-irc-password' });
    await until(() => f.gateway.sessions.get('ref-a')?.channels.has('#osu') || false);
    a.send({ type: 'query', target: 'Ref_B' });
    await until(() => f.gateway.sessions.get('ref-a')?.channels.has('Ref_B') || false);
    a.send({ type: 'chat', id: randomUUID(), target: 'Ref_B', text: 'Hello referee' });
    await until(() => f.mock.lines.includes('PRIVMSG Ref_B :Hello referee'));
    for (const socket of f.mock.sockets) {
      socket.write(':Ref_B!user@mock PRIVMSG Ref_A :Private response\r\n');
      socket.write(':mock 404 Ref_A #mp_404 :Cannot send to channel\r\n');
    }
    await until(() =>
      a.events.some(
        (e) =>
          e.type === 'message' &&
          e.message.target === 'Ref_B' &&
          e.message.text === 'Private response',
      ),
    );
    await until(() =>
      a.events.some((e) => e.type === 'error' && e.error.includes('channel or user operation')),
    );
    expect(f.gateway.sessions.get('ref-a')?.state).toBe('connected');
    a.send({ type: 'close_query', target: 'Ref_B' });
    await until(() => !f.gateway.sessions.get('ref-a')?.channels.has('Ref_B'));
  });
  it('rate limits messages and blocks raw multiplayer commands in osu chat', async () => {
    const f = await fixture();
    const a = await f.browser();
    a.send({ type: 'connect', acknowledged: true, password: 'separate-test-irc-password' });
    await until(() => f.gateway.sessions.get('ref-a')?.channels.has('#osu') || false);
    a.send({ type: 'chat', id: randomUUID(), target: '#osu', text: '!mp make wrong destination' });
    await until(() => a.events.some((e) => e.type === 'error' && e.error.includes('blocked')));
    for (let i = 0; i < 6; i++)
      a.send({ type: 'chat', id: randomUUID(), target: '#osu', text: `Message ${i}` });
    await until(() => a.events.some((e) => e.type === 'error' && e.error.includes('Please wait')));
    expect(
      f.mock.lines.filter((line) => line.startsWith('PRIVMSG #osu ')).length,
    ).toBeLessThanOrEqual(4);
    expect(f.mock.lines.some((line) => line.includes('!mp make wrong'))).toBe(false);
  });
  it('marks uncertain creation without retry and can recover a late genuine BanchoBot response', async () => {
    const f = await fixture(undefined, true);
    const a = await f.browser();
    a.send({ type: 'connect', acknowledged: true, password: 'separate-test-irc-password' });
    await until(() => f.gateway.sessions.get('ref-a')?.state === 'connected');
    const id = randomUUID();
    a.send({ type: 'make', id, name: 'Uncertain room', baseVersion: 1, confirmed: true });
    await until(() =>
      f.recorded.some((r) => r.operation === 'complete' && r.extra?.status === 'UNKNOWN'),
    );
    expect(f.mock.lines.filter((line) => line.includes('!mp make Uncertain room'))).toHaveLength(1);
    for (const socket of f.mock.sockets)
      socket.write(
        ':BanchoBot!bot@mock PRIVMSG Ref_A :Created the tournament match https://osu.ppy.sh/mp/999\r\n',
      );
    await until(() =>
      f.recorded.some((r) => r.operation === 'complete' && r.extra?.status === 'CREATED'),
    );
    expect(a.events.some((e) => e.type === 'lobby' && e.lobby.channel === '#mp_999')).toBe(true);
  });
});
