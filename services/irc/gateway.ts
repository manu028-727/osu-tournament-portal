import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Client } from 'irc-framework';
import { BanchoClient } from './bancho-client';
import { WebSocketServer, WebSocket } from 'ws';
import {
  ircClientMessage,
  lobbyFromResponse,
  validateLobbyCommand,
  ircPeer,
  type IrcClientMessage,
} from '../../src/lib/irc-protocol';
import { ircNickname, readTicket } from '../../src/lib/irc-security';
import type {
  IrcIdentity,
  IrcChatMessage,
  IrcDelivery,
  IrcLobby,
  IrcServerEvent,
  IrcConnectionDiagnostic,
} from '../../src/lib/irc-types';

export type GatewayRpc = (
  identity: IrcIdentity,
  operation: string,
  extra?: Record<string, unknown>,
) => Promise<Record<string, unknown>>;
type Viewer = { socket: WebSocket; identity: IrcIdentity };
type Pending = {
  identity: IrcIdentity;
  delivery: IrcDelivery;
  timer: ReturnType<typeof setTimeout>;
  requestId?: string;
};
type Session = {
  userId: string;
  username: string;
  irc?: Client;
  state: 'disconnected' | 'connecting' | 'connected';
  viewers: Set<Viewer>;
  channels: Set<string>;
  messages: IrcChatMessage[];
  deliveries: IrcDelivery[];
  lobbies: IrcLobby[];
  pending: Map<string, Pending>;
  seen: Set<string>;
  lastActivity: number;
  uncertainCreate?: Pending;
  rate: number[];
  connectAttempts: number[];
  cleanup?: ReturnType<typeof setTimeout>;
  loginTimer?: ReturnType<typeof setTimeout>;
};
export function createGateway(options: {
  origin: string;
  secret: string;
  rpc: GatewayRpc;
  host?: string;
  port?: number;
  outcomeMs?: number;
  idleMs?: number;
  onDiagnostic?: (diagnostic: IrcConnectionDiagnostic) => void;
}) {
  const sessions = new Map<string, Session>();
  const tickets = new Map<string, number>();
  const upgrades = new Map<string, number[]>();
  const sockets = new Set<WebSocket>();
  const alive = new Set<WebSocket>();
  function diagnose(
    nickname: string,
    stage: IrcConnectionDiagnostic['stage'],
    source: IrcConnectionDiagnostic['source'],
    code: string,
  ): IrcConnectionDiagnostic {
    const diagnostic = { nickname: ircNickname(nickname), stage, source, code };
    options.onDiagnostic?.(diagnostic);
    return diagnostic;
  }
  const server = createServer((req, res) => {
    res.writeHead(req.url === '/health' ? 200 : 404, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(req.url === '/health' ? '{"status":"ready"}' : '{}');
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  const send = (socket: WebSocket, event: IrcServerEvent) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 256000) {
      socket.close(1013, 'Slow connection');
      return;
    }
    socket.send(JSON.stringify(event));
  };
  const broadcast = (session: Session, event: IrcServerEvent) => {
    for (const v of session.viewers) send(v.socket, event);
  };
  const snapshot = (s: Session): IrcServerEvent => ({
    type: 'state',
    state: s.state,
    username: s.username,
    channels: [...s.channels],
    messages: s.messages,
    deliveries: s.deliveries,
    lobbies: s.lobbies,
  });
  const state = (s: Session) => broadcast(s, snapshot(s));
  function delivery(s: Session, d: IrcDelivery) {
    const index = s.deliveries.findIndex((item) => item.id === d.id);
    if (index < 0) s.deliveries.push(d);
    else s.deliveries[index] = d;
    s.deliveries = s.deliveries.slice(-100);
    broadcast(s, { type: 'delivery', delivery: d });
  }
  function message(s: Session, target: string, sender: string, text: string) {
    const m = {
      id: randomUUID(),
      target,
      sender,
      text: text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0, 1000),
      at: new Date().toISOString(),
    };
    s.messages.push(m);
    s.messages = s.messages.slice(-500);
    broadcast(s, { type: 'message', message: m });
  }
  function query(s: Session, target: string) {
    if (!s.channels.has(target) && [...s.channels].filter((c) => !c.startsWith('#')).length >= 10)
      throw new Error('Private conversation limit reached. Reconnect to clear old conversations.');
    if (!s.channels.has(target)) {
      s.channels.add(target);
      state(s);
    }
  }
  async function finish(
    s: Session,
    target: string,
    outcome: 'confirmed' | 'failed' | 'unknown',
    note?: string,
    url?: string,
  ) {
    const p = s.pending.get(target) || (target === 'BanchoBot' ? s.uncertainCreate : undefined);
    if (!p) return;
    clearTimeout(p.timer);
    s.pending.delete(target);
    if (p.requestId) s.uncertainCreate = outcome === 'unknown' ? p : undefined;
    delivery(s, { ...p.delivery, state: outcome, note });
    if (p.requestId) {
      try {
        await options.rpc(p.identity, 'complete', {
          requestId: p.requestId,
          status: outcome === 'confirmed' ? 'CREATED' : outcome === 'failed' ? 'FAILED' : 'UNKNOWN',
          ...(url ? { url } : {}),
        });
      } catch {
        broadcast(s, {
          type: 'error',
          error:
            'Lobby outcome could not be saved. The unresolved request blocks duplicate creation; inspect BanchoBot and resolve it explicitly.',
        });
      }
    }
  }
  function forgetPassword(client: Client) {
    client.options.password = undefined;
    client.connection.options.password = undefined;
    if (client.connection.transport) client.connection.transport.options.password = undefined;
  }
  function disconnect(s: Session) {
    clearTimeout(s.loginTimer);
    for (const target of s.pending.keys())
      void finish(s, target, 'unknown', 'Connection ended. Inspect BanchoBot before retrying.');
    if (s.irc) {
      forgetPassword(s.irc);
      s.irc.connection.end();
      s.irc.removeAllListeners();
      s.irc = undefined;
    }
    s.state = 'disconnected';
    s.channels.clear();
    state(s);
  }
  function release(s: Session) {
    clearTimeout(s.cleanup);
    disconnect(s);
    sessions.delete(s.userId);
    s.messages = [];
    s.deliveries = [];
    s.seen.clear();
  }
  function connected(s: Session): Client {
    if (s.state !== 'connected' || !s.irc)
      throw new Error('IRC is not connected. Reenter your IRC password to reconnect.');
    return s.irc;
  }
  function consume(s: Session, id: string) {
    if (s.seen.has(id)) throw new Error('This command was already submitted. No retry was sent.');
    const now = Date.now();
    s.rate = s.rate.filter((at) => at > now - 10000);
    if (s.rate.length >= 5) throw new Error('Please wait before sending more IRC messages.');
    s.rate.push(now);
    s.seen.add(id);
    if (s.seen.size > 2000) s.seen.delete(s.seen.values().next().value!);
  }
  async function checkRoom(v: Viewer, s: Session, target: string, commandKind?: string) {
    const info = await options.rpc(
      v.identity,
      'control',
      commandKind ? { commandKind, channel: target } : undefined,
    );
    if (info.multiplayerId && target !== `#mp_${info.multiplayerId}`)
      throw new Error(
        'The selected match now points to a different lobby. Refresh before sending commands.',
      );
    const known = s.lobbies.find(
      (l) =>
        l.channel === target &&
        l.matchId === v.identity.matchId &&
        l.tournamentId === v.identity.tournamentId,
    );
    const persisted = info.createdLobby as { lobbyUrl: string } | null;
    const createdId = persisted?.lobbyUrl.match(/\/([1-9]\d*)$/)?.[1];
    if (target !== `#mp_${info.multiplayerId}` && target !== `#mp_${createdId}` && !known)
      throw new Error('This channel is not linked to the selected website match.');
    return !!known || target === `#mp_${createdId}`;
  }
  function beginCreate(s: Session, v: Viewer, d: IrcDelivery, requestId: string) {
    if (s.pending.has(d.target))
      throw new Error('Wait for the lobby creation outcome before creating another lobby.');
    delivery(s, { ...d, state: 'sending' });
    s.pending.set(d.target, {
      identity: v.identity,
      delivery: d,
      requestId,
      timer: setTimeout(
        () =>
          void finish(
            s,
            d.target,
            'unknown',
            'No lobby URL received. Inspect BanchoBot before resolving this creation request.',
          ),
        options.outcomeMs || 15000,
      ),
    });
    connected(s).say(d.target, d.command);
    message(s, d.target, s.username, d.command);
    delivery(s, { ...d, state: 'awaiting' });
  }
  async function handle(s: Session, v: Viewer, input: Exclude<IrcClientMessage, { type: 'auth' }>) {
    s.lastActivity = Date.now();
    const authorization = await options.rpc(v.identity, 'authorize');
    const authorizedNick = ircNickname(String(authorization.username));
    if (authorizedNick !== ircNickname(v.identity.username)) {
      diagnose(authorizedNick, 'identity', 'gateway', 'USERNAME_CHANGED');
      throw new Error('Your osu! username changed. Refresh before reconnecting.');
    }
    if (input.type === 'connect') {
      if (s.state !== 'disconnected')
        throw new Error(
          'Your account already has an active IRC connection, shared with your other tabs.',
        );
      s.connectAttempts = s.connectAttempts.filter((at) => at > Date.now() - 60000);
      if (s.connectAttempts.length >= 3)
        throw new Error('Too many connection attempts. Wait one minute.');
      s.connectAttempts.push(Date.now());
      const nick = authorizedNick;
      const client = new BanchoClient();
      let stage: IrcConnectionDiagnostic['stage'] = 'connecting';
      s.username = nick;
      s.irc = client;
      s.state = 'connecting';
      state(s);
      diagnose(nick, stage, 'gateway', 'CONNECTING');
      client.on('socket connected', () => {
        stage = 'registration';
        diagnose(nick, stage, 'transport', 'TCP_CONNECTED');
      });
      client.on('registered', (event: { nick: string }) => {
        if (s.irc !== client || s.state !== 'connecting') return;
        if (event.nick.toLowerCase() !== nick.toLowerCase()) {
          stage = 'identity';
          failed('gateway', 'NICKNAME_MISMATCH');
          return;
        }
        clearTimeout(s.loginTimer);
        forgetPassword(client);
        stage = 'connected';
        s.state = 'connected';
        diagnose(nick, stage, 'bancho', '001');
        client.join('#osu');
        state(s);
      });
      client.on('join', (event: { nick: string; channel: string }) => {
        if (event.nick === nick && (/^#mp_\d+$/.test(event.channel) || event.channel === '#osu')) {
          s.channels.add(event.channel);
          state(s);
        }
      });
      client.on('part', (event: { nick: string; channel: string }) => {
        if (event.nick === nick) {
          s.channels.delete(event.channel);
          state(s);
        }
      });
      const incoming = (event: { nick?: string; target?: string; message?: string }) => {
        if (s.irc !== client || s.state !== 'connected') return;
        const sender = event.nick || '',
          text = event.message || '';
        const target = event.target?.startsWith('#')
          ? event.target
          : sender.toLowerCase() === 'banchobot'
            ? 'BanchoBot'
            : ircPeer.safeParse(sender).success
              ? sender
              : '';
        if (target && !target.startsWith('#') && target !== 'BanchoBot') {
          try {
            query(s, target);
          } catch {
            return;
          }
        }
        if (!target || (target !== 'BanchoBot' && !s.channels.has(target))) return;
        message(s, target, sender, text);
        if (sender.toLowerCase() !== 'banchobot') return;
        const pending =
          s.pending.get(target) || (target === 'BanchoBot' ? s.uncertainCreate : undefined);
        if (!pending) return;
        const room =
          target === 'BanchoBot' && pending.requestId ? lobbyFromResponse(sender, text) : null;
        if (room && pending.requestId) {
          const lobby = {
            ...room,
            requestId: pending.requestId,
            matchId: pending.identity.matchId,
            kind: pending.identity.kind,
            tournamentId: pending.identity.tournamentId,
          };
          s.lobbies.push(lobby);
          s.lobbies = s.lobbies.slice(-4);
          client.join(room.channel);
          broadcast(s, { type: 'lobby', lobby });
          void finish(s, target, 'confirmed', 'BanchoBot returned this room URL.', room.url);
        } else if (
          /^(?:Invalid|Failed|Cannot|You (?:cannot|are not|have reached)|Too many|Not allowed|You do not have)/i.test(
            text,
          )
        )
          void finish(s, target, 'failed', text.slice(0, 200));
      };
      client.on('message', incoming);
      client.on('notice', incoming);
      const failed = (source: IrcConnectionDiagnostic['source'], code: string) => {
        if (s.irc !== client) return;
        const diagnostic = diagnose(nick, stage, source, code);
        const explanation =
          source === 'gateway'
            ? 'Gateway refused an IRC identity that does not match your authenticated account.'
            : source === 'bancho'
              ? code === '464'
                ? 'Bancho rejected IRC authentication.'
                : 'Bancho rejected or ended the IRC connection.'
              : code === 'TIMEOUT'
                ? 'IRC connection timed out; no password rejection was received.'
                : 'IRC transport disconnected; no password rejection was confirmed.';
        disconnect(s);
        broadcast(s, {
          type: 'error',
          error: `${explanation} Nickname: ${nick}; stage: ${stage}; source: ${source}; code: ${code}. Reconnect manually.`,
          diagnostic,
        });
      };
      // Inspect parsed reply codes only; raw server reasons may echo credentials.
      client.raw_middleware.use((command, _message, _line, _client, next) => {
        if (s.irc !== client) return;
        if ((s.state === 'connecting' && /^[45]\d{2}$/.test(command)) || command === 'ERROR') {
          failed('bancho', command);
          return;
        }
        next();
      });
      client.on('socket close', () => failed('transport', 'SOCKET_CLOSED'));
      client.on('socket error', () => failed('transport', 'SOCKET_ERROR'));
      client.on('nick in use', () => failed('bancho', '433'));
      client.on('nick invalid', () => failed('bancho', '432'));
      client.on('irc error', (event: { error?: string; channel?: string }) => {
        if (s.state === 'connecting' || ['irc', 'password_mismatch'].includes(event.error || '')) {
          failed('bancho', event.error === 'password_mismatch' ? '464' : 'ERROR');
          return;
        }
        if (event.channel)
          void finish(s, event.channel, 'failed', 'Bancho rejected the channel operation.');
        broadcast(s, {
          type: 'error',
          error:
            'Bancho rejected this channel or user operation. Check room membership and Bancho referee permissions.',
        });
      });
      s.loginTimer = setTimeout(() => failed('transport', 'TIMEOUT'), 20000);
      client.connect({
        host: options.host || 'irc.ppy.sh',
        port: options.port || 6667,
        tls: false,
        nick,
        username: nick,
        gecos: nick,
        password: input.password,
        account: {},
        auto_reconnect: false,
        ping_interval: 30,
        ping_timeout: 120,
        enable_echomessage: false,
      });
      input.password = '';
      client.connection.transport?.socket?.on('data', () => {
        if ((client.connection.transport?.incoming_buffer?.length || 0) > 65536)
          failed('transport', 'BUFFER_LIMIT');
      });
      return;
    }
    if (input.type === 'disconnect') {
      disconnect(s);
      return;
    }
    if (input.type === 'resolve') {
      await options.rpc(v.identity, 'resolve', { requestId: input.requestId });
      if (s.uncertainCreate?.requestId === input.requestId) s.uncertainCreate = undefined;
      s.lobbies = s.lobbies.filter((lobby) => lobby.requestId !== input.requestId);
      broadcast(s, { type: 'resolved', requestId: input.requestId });
      return;
    }
    const client = connected(s);
    if (input.type === 'query') {
      query(s, input.target);
      return;
    }
    if (input.type === 'close_query') {
      s.channels.delete(input.target);
      state(s);
      return;
    }
    if (input.type === 'join') {
      const info = await options.rpc(v.identity, 'authorize');
      const created = info.createdLobby as { lobbyUrl: string } | null;
      const id = info.multiplayerId || created?.lobbyUrl.match(/\/([1-9]\d*)$/)?.[1];
      if (!id) throw new Error('Link an existing multiplayer URL to this match first.');
      if (
        [...s.channels].filter((c) => c.startsWith('#mp_')).length >= 4 &&
        !s.channels.has(`#mp_${id}`)
      )
        throw new Error('Leave an unused lobby channel first.');
      client.join(`#mp_${id}`);
      return;
    }
    if (input.type === 'part') {
      client.part(input.channel);
      return;
    }
    if (input.type === 'make') {
      consume(s, input.id);
      if (s.pending.has('BanchoBot')) throw new Error('A BanchoBot command is still pending.');
      const result = await options.rpc(v.identity, 'create', {
        name: input.name,
        baseVersion: input.baseVersion,
      });
      const requestId = String(result.requestId);
      if (s.state !== 'connected') {
        await options.rpc(v.identity, 'complete', { requestId, status: 'FAILED' });
        throw new Error('Disconnected before dispatch. No create command was sent.');
      }
      beginCreate(
        s,
        v,
        { id: input.id, target: 'BanchoBot', command: `!mp make ${input.name}`, state: 'sending' },
        requestId,
      );
      return;
    }
    consume(s, input.id);
    if (input.type === 'chat') {
      const help = input.target === 'BanchoBot' && input.text === '!mp help';
      if (
        (!help && /^[!/]\s*(?:mp|pass|oper|identify|nickserv)\b/i.test(input.text)) ||
        input.text.startsWith('/')
      )
        throw new Error(
          'Use the authorized multiplayer command controls; raw IRC and authentication commands are blocked.',
        );
      if (input.target.startsWith('#mp_')) await checkRoom(v, s, input.target);
      if (!input.target.startsWith('#') && input.target !== 'BanchoBot') query(s, input.target);
      if (input.target !== 'BanchoBot' && !s.channels.has(input.target))
        throw new Error('Join this channel before sending messages.');
      client.say(input.target, input.text);
      message(s, input.target, s.username, input.text);
      return;
    }
    const kind = validateLobbyCommand(input.command, input.confirmed, true);
    const creator = await checkRoom(v, s, input.target, kind);
    validateLobbyCommand(input.command, input.confirmed, creator);
    if (!s.channels.has(input.target)) throw new Error('Join this lobby before sending commands.');
    connected(s).say(input.target, input.command);
    message(s, input.target, s.username, input.command);
    delivery(s, { id: input.id, target: input.target, command: input.command, state: 'sent' });
  }
  server.on('upgrade', (request, socket, head) => {
    const ip = request.socket.remoteAddress || '';
    const times = (upgrades.get(ip) || []).filter((at) => at > Date.now() - 60000);
    if (
      request.url !== '/api/irc/socket' ||
      request.headers.origin !== options.origin ||
      sockets.size >= 128 ||
      times.length >= 300
    ) {
      socket.destroy();
      return;
    }
    times.push(Date.now());
    upgrades.set(ip, times);
    if (upgrades.size > 1024) upgrades.delete(upgrades.keys().next().value!);
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws));
  });
  wss.on('connection', (socket) => {
    sockets.add(socket);
    alive.add(socket);
    socket.on('pong', () => alive.add(socket));
    let viewer: Viewer | undefined,
      session: Session | undefined,
      queued = 0;
    let queue = Promise.resolve();
    const deadline = setTimeout(() => socket.close(1008, 'Authentication required'), 5000);
    socket.on('error', () => socket.terminate());
    socket.on('message', (data, binary) => {
      if (binary || ++queued > 8) {
        socket.close(1008, 'Message limit');
        return;
      }
      queue = queue
        .then(async () => {
          let raw = data.toString();
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch {
            throw new Error('Invalid IRC request.');
          } finally {
            raw = '';
            if (Buffer.isBuffer(data)) data.fill(0);
          }
          const validated = ircClientMessage.safeParse(parsed);
          if (parsed && typeof parsed === 'object' && 'password' in parsed) parsed.password = '';
          if (!validated.success) {
            if (
              viewer &&
              session &&
              parsed &&
              typeof parsed === 'object' &&
              'type' in parsed &&
              parsed.type === 'connect'
            ) {
              const diagnostic = diagnose(
                session.username,
                'validation',
                'gateway',
                'INVALID_CONNECT_REQUEST',
              );
              send(socket, {
                type: 'error',
                error:
                  'Gateway validation rejected the IRC connection request before contacting Bancho. Use a single-line IRC password of 1-200 printable ASCII characters, without spaces.',
                diagnostic,
              });
              return;
            }
            throw new Error('Invalid IRC request.');
          }
          const input = validated.data;
          if (!viewer) {
            if (input.type !== 'auth') throw new Error('Authenticate first.');
            const identity = readTicket(input.ticket, options.secret);
            if (tickets.has(identity.nonce)) throw new Error('Ticket already used.');
            tickets.set(identity.nonce, identity.expires);
            if (tickets.size > 5000) throw new Error('Gateway is busy.');
            const current = await options.rpc(identity, 'authorize');
            if (socket.readyState !== WebSocket.OPEN) return;
            if (ircNickname(String(current.username)) !== ircNickname(identity.username))
              throw new Error('Your osu! username changed. Refresh before connecting.');
            session = sessions.get(identity.userId);
            if (!session) {
              if (sessions.size >= 100) throw new Error('Gateway connection limit reached.');
              session = {
                userId: identity.userId,
                username: ircNickname(identity.username),
                state: 'disconnected',
                viewers: new Set(),
                channels: new Set(),
                messages: [],
                deliveries: [],
                lobbies: [],
                pending: new Map(),
                seen: new Set(),
                lastActivity: Date.now(),
                rate: [],
                connectAttempts: [],
              };
              sessions.set(identity.userId, session);
            }
            if (session.viewers.size >= 5) throw new Error('Maximum five IRC tabs per account.');
            viewer = { socket, identity };
            clearTimeout(deadline);
            clearTimeout(session.cleanup);
            session.viewers.add(viewer);
            send(socket, snapshot(session));
            return;
          }
          if (input.type === 'auth') throw new Error('This socket is already authenticated.');
          try {
            await handle(session!, viewer, input);
          } finally {
            if (input.type === 'connect') input.password = '';
          }
        })
        .catch((error: unknown) => {
          send(socket, {
            type: 'error',
            error:
              error instanceof Error && error.name !== 'ZodError'
                ? error.message.slice(0, 300)
                : 'Invalid IRC request.',
          });
          if (!viewer) socket.close(1008, 'Authentication failed');
        })
        .finally(() => {
          queued--;
        });
    });
    socket.on('close', () => {
      clearTimeout(deadline);
      sockets.delete(socket);
      alive.delete(socket);
      if (viewer && session) {
        session.viewers.delete(viewer);
        if (!session.viewers.size) session.cleanup = setTimeout(() => release(session!), 30000);
      }
    });
  });
  const upkeep = setInterval(() => {
    for (const socket of sockets) {
      if (!alive.delete(socket)) socket.terminate();
      else socket.ping();
    }
    for (const [nonce, expires] of tickets) if (expires < Date.now()) tickets.delete(nonce);
    for (const s of sessions.values()) {
      if (Date.now() - s.lastActivity > (options.idleMs || 15 * 60000)) {
        for (const v of s.viewers) v.socket.close(1000, 'Idle timeout');
        release(s);
        continue;
      }
      for (const v of s.viewers)
        void options
          .rpc(v.identity, 'authorize')
          .catch(() => v.socket.close(1008, 'Session or permissions expired'));
    }
  }, 30000);
  return {
    server,
    sessions,
    async close() {
      clearInterval(upkeep);
      for (const s of sessions.values()) release(s);
      for (const socket of sockets) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
