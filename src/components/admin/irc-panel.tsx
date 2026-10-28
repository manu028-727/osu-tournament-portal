'use client';
import { humanizeCode, localeTag } from '@/lib/i18n';
import { Feedback, useLocale, useT } from '@/components/locale';

import { useEffect, useRef, useState } from 'react';
import {
  Cable,
  Copy,
  ExternalLink,
  Link2,
  LogIn,
  LogOut,
  Play,
  Send,
  Settings,
  ShieldAlert,
  Timer,
  UserPlus,
  MessageSquare,
  X,
} from 'lucide-react';
import { Button } from '../ui/button';
import { api, action, Field, Modal, useTask } from './shared';
import type { MatchView } from '@/lib/matches-types';
import type { IrcChatMessage, IrcDelivery, IrcLobby, IrcServerEvent } from '@/lib/irc-types';
import type { lobbyCommands } from '@/lib/match-engine';
import { ircClientMessage } from '@/lib/irc-protocol';

type Ticket = {
  ticket: string;
  activeRequest?: { id: string; status: string; name: string } | null;
  createdLobby?: { id: string; lobbyUrl: string } | null;
};
export function IrcPanel({
  match,
  commands,
  editable,
  enabled,
  onLinked,
}: {
  match: MatchView;
  commands: ReturnType<typeof lobbyCommands>;
  editable: boolean;
  enabled: boolean;
  onLinked: () => Promise<unknown>;
}) {
  const language = useLocale();
  const tr = useT();
  const [open, setOpen] = useState(false),
    [ready, setReady] = useState(false);
  const [state, setState] = useState('disconnected'),
    [username, setUsername] = useState('');
  const [acknowledged, setAcknowledged] = useState(false),
    [error, setError] = useState('');
  const [messages, setMessages] = useState<IrcChatMessage[]>([]),
    [deliveries, setDeliveries] = useState<IrcDelivery[]>([]);
  const [channels, setChannels] = useState<string[]>([]),
    [active, setActive] = useState('#osu');
  const [unread, setUnread] = useState<Record<string, number>>({}),
    [text, setText] = useState('');
  const [proposal, setProposal] = useState<IrcLobby | null>(null),
    [unresolved, setUnresolved] = useState<Ticket['activeRequest']>(null);
  const [dialog, setDialog] = useState<{
    kind: 'create' | 'command' | 'link' | 'resolve';
    command: string;
  } | null>(null);
  const [name, setName] = useState(commands.name),
    [invite, setInvite] = useState(''),
    [referee, setReferee] = useState('');
  const socket = useRef<WebSocket | null>(null),
    password = useRef<HTMLInputElement>(null),
    log = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active),
    stick = useRef(true);
  const { busy, run, notify } = useTask();
  useEffect(() => {
    activeRef.current = active;
    setUnread((previous) => ({ ...previous, [active]: 0 }));
    stick.current = true;
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [active]);
  useEffect(() => {
    if (stick.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages, open]);
  useEffect(
    () => () => {
      socket.current?.close();
      socket.current = null;
      if (password.current) password.current.value = '';
    },
    [],
  );
  function send(input: object) {
    if (socket.current?.readyState !== WebSocket.OPEN) {
      setError('Open the gateway connection first.');
      return;
    }
    setError('');
    socket.current.send(JSON.stringify(input));
  }
  async function attach() {
    if (socket.current?.readyState === WebSocket.OPEN) return;
    if (
      location.protocol !== 'https:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
    )
      throw new Error('IRC credentials require HTTPS.');
    const ticket = await api<Ticket>('/api/irc/ticket', {
      method: 'POST',
      body: JSON.stringify({ matchId: match.id }),
    });
    setUnresolved(ticket.activeRequest);
    if (ticket.createdLobby) {
      const id = ticket.createdLobby.lobbyUrl.match(/\/(\d+)$/)?.[1];
      if (id)
        setProposal({
          requestId: ticket.createdLobby.id,
          matchId: match.id,
          tournamentId: '',
          channel: `#mp_${id}`,
          url: ticket.createdLobby.lobbyUrl,
        });
    }
    const connection = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/api/irc/socket`);
    socket.current = connection;
    connection.onopen = () => {
      connection.send(JSON.stringify({ type: 'auth', ticket: ticket.ticket }));
    };
    connection.onerror = () =>
      setError('IRC gateway unavailable. The manual referee workflow is unaffected.');
    connection.onclose = () => {
      if (socket.current !== connection) return;
      setReady(false);
      setState('disconnected');
      setAcknowledged(false);
      if (password.current) password.current.value = '';
    };
    connection.onmessage = ({ data }: MessageEvent<string>) => {
      const event = JSON.parse(data) as IrcServerEvent;
      if (event.type === 'error') {
        setError(event.error);
        return;
      }
      if (event.type === 'resolved') {
        setUnresolved((previous) => (previous?.id === event.requestId ? null : previous));
        setProposal((previous) => (previous?.requestId === event.requestId ? null : previous));
        return;
      }
      if (event.type === 'state') {
        setReady(true);
        setState(event.state);
        setUsername(event.username);
        setChannels(event.channels);
        setMessages(event.messages);
        setDeliveries(event.deliveries);
        const created = event.lobbies.findLast((l) => l.matchId === match.id);
        if (created) setProposal(created);
      } else if (event.type === 'message') {
        setMessages((previous) => [...previous, event.message].slice(-500));
        if (event.message.target !== activeRef.current)
          setUnread((previous) => ({
            ...previous,
            [event.message.target]:
              (Object.hasOwn(previous, event.message.target) ? previous[event.message.target] : 0) +
              1,
          }));
      } else if (event.type === 'delivery') {
        setDeliveries((previous) =>
          [...previous.filter((d) => d.id !== event.delivery.id), event.delivery].slice(-100),
        );
        if (
          event.delivery.command.startsWith('!mp make ') &&
          ['sending', 'awaiting', 'unknown'].includes(event.delivery.state)
        )
          setUnresolved({
            id: '',
            status: event.delivery.state,
            name: event.delivery.command.slice(9),
          });
      } else if (event.type === 'lobby') {
        if (event.lobby.matchId === match.id) {
          setProposal(event.lobby);
          setUnresolved(null);
          setActive(event.lobby.channel);
        }
      }
    };
  }
  const target = match.multiplayerId ? `#mp_${match.multiplayerId}` : proposal?.channel || '';
  const connected = ready && state === 'connected';
  const canSend = connected && editable && !!target && channels.includes(target);
  const copy = (value: string) =>
    void navigator.clipboard
      .writeText(value)
      .then(() => notify('Copied.'))
      .catch(() => notify('Clipboard unavailable.', true));
  function command(value: string) {
    if (!value || !canSend) return;
    if (/^!mp (?:start|abort|close|name|lock|unlock|set)(?: |$)/i.test(value)) {
      setDialog({ kind: 'command', command: value });
      return;
    }
    send({ type: 'command', id: crypto.randomUUID(), target, command: value });
  }
  const players = [...match.participants.A.members, ...match.participants.B.members].sort(
    (a, b) => Number(b.captain) - Number(a.captain),
  );
  return (
    <details
      className="mt-4 min-w-0 border-y py-3"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm font-semibold">
        <Cable size={16} className="mr-2 inline" />
        {tr('Bancho IRC')}{' '}
        <span className="ml-2 text-xs font-normal text-muted">
          {enabled ? tr(humanizeCode(state)).toLowerCase() : tr('Disabled')}
        </span>
      </summary>
      {open && (
        <div className="min-w-0 space-y-4 pt-4">
          {!enabled ? (
            <p className="text-sm text-muted">{tr('IRC is disabled on this installation.')}</p>
          ) : (
            <>
              {!connected && (
                <div
                  className="border-l-2 border-amber-300/60 pl-4 text-sm text-muted"
                  role="note"
                  aria-label={tr('IRC security notice')}
                >
                  <p className="mb-2 flex items-center gap-2 font-semibold text-amber-200">
                    <ShieldAlert size={18} />
                    {tr('Security notice')}
                  </p>
                  <p>
                    {tr(
                      'This client connects your osu! account to Bancho through this tournament server. Enter only your',
                    )}{' '}
                    <strong>{tr('separate osu! IRC password')}</strong>
                    {tr(', never your regular osu! password.')}
                  </p>
                  <p className="mt-2">
                    {tr(
                      'The server handles it temporarily in memory. It is not saved to the database, object storage, browser storage or logs. Browser traffic uses HTTPS/WSS, but osu! documents an',
                    )}{' '}
                    <strong>{tr('unencrypted')}</strong>{' '}
                    {tr(
                      'server-to-Bancho connection: credentials and messages may be visible to network observers.',
                    )}
                  </p>
                  <p className="mt-2">
                    {tr(
                      'Only connect if you trust this website’s operator. Each self-hoster runs their own gateway. Normal website and manual refereeing do not require IRC.',
                    )}{' '}
                    <a
                      className="text-primary underline"
                      href="https://osu.ppy.sh/wiki/en/Community/Internet_Relay_Chat"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {tr('Official osu! IRC documentation')}
                    </a>
                  </p>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {!ready && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void run(attach)}
                  >
                    <Cable size={16} />
                    {tr('Open IRC')}
                  </Button>
                )}
                <span className="text-xs text-muted" role="status">
                  {username ? `${username} · ` : ''}
                  {ready ? tr(humanizeCode(state)).toLowerCase() : tr('Gateway disconnected')}
                </span>
                {connected && (
                  <Button size="sm" variant="ghost" onClick={() => send({ type: 'disconnect' })}>
                    <LogOut size={16} />
                    {tr('Disconnect all tabs')}
                  </Button>
                )}
                {connected && !!target && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      send({ type: 'join' });
                      setActive(target);
                    }}
                  >
                    <LogIn size={16} />
                    {tr('Join lobby')}
                  </Button>
                )}
                {match.lobbyUrl && (
                  <Button asChild size="sm" variant="ghost">
                    <a href={match.lobbyUrl} target="_blank" rel="noreferrer">
                      <ExternalLink size={16} />
                      {tr('Multiplayer')}
                    </a>
                  </Button>
                )}
              </div>
              {ready && state === 'disconnected' && (
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!acknowledged || !password.current) return;
                    let value = password.current.value;
                    password.current.value = '';
                    const request = ircClientMessage.safeParse({
                      type: 'connect',
                      acknowledged: true,
                      password: value,
                    });
                    value = '';
                    if (!request.success) {
                      setError(
                        'Browser validation rejected the password before contacting the gateway. Use 1-200 printable ASCII characters without spaces or line breaks; the password is never trimmed or truncated.',
                      );
                      return;
                    }
                    send(request.data);
                    if (request.data.type === 'connect') request.data.password = '';
                  }}
                >
                  <label className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1 size-4"
                      checked={acknowledged}
                      onChange={(e) => setAcknowledged(e.target.checked)}
                    />
                    {tr(
                      'I understand the unencrypted connection and trust this server with my separate IRC password.',
                    )}
                  </label>
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label={tr('Separate osu! IRC password')}>
                      <input
                        ref={password}
                        type="password"
                        name="separate-irc-password"
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        required
                        className="max-w-full"
                      />
                    </Field>
                    <Button type="submit" size="sm" disabled={!acknowledged}>
                      <LogIn size={16} />
                      {tr('Connect to Bancho')}
                    </Button>
                  </div>
                </form>
              )}
              {error && (
                <p role="alert" className="text-sm text-red-200">
                  <Feedback message={error} />
                </p>
              )}
              {unresolved && (
                <div className="flex flex-wrap items-center gap-2 text-sm text-amber-200">
                  <span>
                    {tr('Unresolved lobby request:')} {unresolved.name}
                    {tr('. Inspect BanchoBot; do not blindly retry.')}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!unresolved.id || !editable}
                    onClick={() => setDialog({ kind: 'resolve', command: unresolved.id })}
                  >
                    {tr('Resolve request')}
                  </Button>
                  {!unresolved.id && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        socket.current?.close();
                        void run(attach);
                      }}
                    >
                      {tr('Refresh request')}
                    </Button>
                  )}
                </div>
              )}
              {proposal && proposal.url !== match.lobbyUrl && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <a
                    href={proposal.url}
                    className="break-all text-primary"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {proposal.url}
                  </a>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!editable}
                    onClick={() => setDialog({ kind: 'link', command: proposal.url })}
                  >
                    <Link2 size={16} />
                    {tr('Link to match')} {match.matchNumber}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!editable}
                    onClick={() => setDialog({ kind: 'resolve', command: proposal.requestId })}
                  >
                    {tr('Dismiss old lobby')}
                  </Button>
                </div>
              )}
              {connected && (
                <>
                  <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(240px,320px)]">
                    <div className="min-w-0">
                      <div
                        className="flex flex-wrap gap-1 border-b pb-2"
                        role="tablist"
                        aria-label={tr('IRC conversations')}
                      >
                        {[
                          ...new Set([
                            '#osu',
                            'BanchoBot',
                            ...channels.filter((c) => c !== '#osu'),
                          ]),
                        ].map((channel) => (
                          <button
                            key={channel}
                            type="button"
                            role="tab"
                            aria-selected={active === channel}
                            className={`min-h-10 rounded-md px-3 text-xs ${active === channel ? 'bg-[var(--surface-hover)] text-foreground' : 'text-muted'}`}
                            onClick={() => setActive(channel)}
                          >
                            {channel}
                            {unread[channel] ? ` (${unread[channel]})` : ''}
                          </button>
                        ))}
                      </div>
                      <div
                        ref={log}
                        role="log"
                        aria-label={tr('{0} messages', active)}
                        aria-live="polite"
                        className="h-60 overflow-y-auto overscroll-contain py-2 text-xs"
                        onScroll={() => {
                          const el = log.current;
                          if (el)
                            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70;
                        }}
                      >
                        {messages
                          .filter((m) => m.target === active)
                          .map((m) => (
                            <p key={m.id} className="break-words py-1 [overflow-wrap:anywhere]">
                              <time className="mr-2 text-muted">
                                {new Date(m.at).toLocaleTimeString(localeTag(language), {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </time>
                              <strong className="mr-2 text-primary">{m.sender}</strong>
                              {m.text}
                            </p>
                          ))}
                      </div>
                      <form
                        className="flex min-w-0 gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const value = text.trim();
                          if (!value) return;
                          if (
                            /^!mp /i.test(value) &&
                            !(active === 'BanchoBot' && value === '!mp help')
                          ) {
                            if (active !== target || !canSend) {
                              setError(
                                'Join the selected match lobby first. Use Create lobby for !mp make.',
                              );
                              return;
                            }
                            command(value);
                          } else
                            send({
                              type: 'chat',
                              id: crypto.randomUUID(),
                              target: active,
                              text: value,
                            });
                          setText('');
                        }}
                      >
                        <input
                          aria-label={tr('Message {0}', active)}
                          maxLength={300}
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          className="min-w-0 flex-1"
                          autoComplete="off"
                        />
                        <Button
                          type="submit"
                          variant="outline"
                          size="icon"
                          aria-label={tr('Send message')}
                          title={tr('Send message')}
                          className="min-h-11 min-w-11"
                        >
                          <Send size={17} />
                        </Button>
                        {active !== '#osu' && active !== 'BanchoBot' && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={tr('Close conversation without closing lobby')}
                            title={tr('Close conversation without closing lobby')}
                            onClick={() => {
                              send(
                                active.startsWith('#mp_')
                                  ? { type: 'part', channel: active }
                                  : { type: 'close_query', target: active },
                              );
                              setActive('#osu');
                            }}
                          >
                            <X size={16} />
                          </Button>
                        )}
                      </form>
                    </div>
                    <div className="min-w-0 space-y-3">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            !editable || !!match.multiplayerId || !!unresolved || !!proposal
                          }
                          onClick={() => {
                            setName(commands.name);
                            setDialog({ kind: 'create', command: '' });
                          }}
                        >
                          <Cable size={16} />
                          {tr('Create lobby')}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canSend || !commands.map}
                          onClick={() => command(commands.map)}
                        >
                          <Play size={16} />
                          {tr('Set map')}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canSend || !commands.mods}
                          onClick={() => command(commands.mods)}
                        >
                          <Settings size={16} />
                          {tr('Set mods')}
                        </Button>
                      </div>
                      {commands.map && (
                        <div className="flex min-w-0 items-center gap-2 text-xs">
                          <code className="truncate">
                            {commands.map} · {commands.mods}
                          </code>
                          <Button
                            size="icon"
                            variant="ghost"
                            title={tr('Copy map and mod commands')}
                            aria-label={tr('Copy map and mod commands')}
                            onClick={() => copy(`${commands.map}\n${commands.mods}`)}
                          >
                            <Copy size={15} />
                          </Button>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {[
                          ['Settings', '!mp settings'],
                          ['Set rules', commands.settings],
                          ['Timer', commands.timer],
                          ['Cancel timer', '!mp aborttimer'],
                          ['Start', commands.start],
                          ['Lock', '!mp lock'],
                          ['Unlock', '!mp unlock'],
                          ['List referees', '!mp listrefs'],
                          ['Abort', '!mp abort'],
                          ['Close room', '!mp close'],
                        ].map(([label, value]) => (
                          <Button
                            key={label}
                            size="sm"
                            variant={
                              label === 'Close room' || label === 'Abort' ? 'destructive' : 'ghost'
                            }
                            disabled={!canSend}
                            onClick={() => command(value)}
                          >
                            {label === 'Timer' ? (
                              <Timer size={14} />
                            ) : label === 'Start' ? (
                              <Play size={14} />
                            ) : (
                              <Send size={14} />
                            )}
                            {tr(label)}
                          </Button>
                        ))}
                      </div>
                      <div className="flex min-w-0 gap-2">
                        <select
                          aria-label={tr('Player to invite')}
                          className="min-w-0 flex-1"
                          value={invite}
                          onChange={(e) => setInvite(e.target.value)}
                        >
                          <option value="">{tr('Invite player')}</option>
                          {players.map((p) => (
                            <option key={p.osuId} value={p.osuId}>
                              {p.username}
                              {p.captain
                                ? tr(' (captain)')
                                : p.substitute
                                  ? tr(' (substitute)')
                                  : ''}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="icon"
                          variant="outline"
                          title={tr('Invite selected player')}
                          aria-label={tr('Invite selected player')}
                          disabled={!canSend || !invite}
                          onClick={() => command(`!mp invite #${invite}`)}
                        >
                          <UserPlus size={16} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title={tr('Private message selected player')}
                          aria-label={tr('Private message selected player')}
                          disabled={!invite}
                          onClick={() => {
                            const peer = players
                              .find((player) => String(player.osuId) === invite)
                              ?.username.replace(/ /g, '_');
                            if (peer) {
                              send({ type: 'query', target: peer });
                              setActive(peer);
                            }
                          }}
                        >
                          <MessageSquare size={16} />
                        </Button>
                      </div>
                      <div className="flex min-w-0 gap-2">
                        <select
                          aria-label={tr('Referee to add (creator only)')}
                          className="min-w-0 flex-1"
                          value={referee}
                          onChange={(e) => setReferee(e.target.value)}
                        >
                          <option value="">{tr('Add referee (creator only)')}</option>
                          {match.assignments.map((r) => (
                            <option key={r.userId} value={r.user.osuId}>
                              {r.user.username}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="icon"
                          variant="outline"
                          title={tr('Add selected referee, creator only')}
                          aria-label={tr('Add selected referee, creator only')}
                          disabled={!canSend || !referee || !proposal}
                          onClick={() => command(`!mp addref #${referee}`)}
                        >
                          <UserPlus size={16} />
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div
                    className="max-h-32 overflow-y-auto border-t pt-2 text-xs"
                    aria-label={tr('Command delivery history')}
                  >
                    {deliveries
                      .slice(-5)
                      .reverse()
                      .map((d) => (
                        <p key={d.id} className="break-words py-1">
                          <code>{d.command}</code>
                          <span
                            className={`ml-2 ${d.state === 'confirmed' ? 'text-emerald-200' : d.state === 'failed' ? 'text-red-200' : 'text-muted'}`}
                          >
                            {d.state === 'sent'
                              ? tr('Sent')
                              : tr(humanizeCode(d.state)).toLowerCase()}
                            {d.note && (
                              <>
                                : <Feedback message={d.note} />
                              </>
                            )}
                          </span>
                          <button
                            type="button"
                            className="ml-2 inline-flex size-8 items-center justify-center"
                            title={tr('Copy command')}
                            aria-label={tr('Copy {0}', d.command)}
                            onClick={() => copy(d.command)}
                          >
                            <Copy size={13} />
                          </button>
                        </p>
                      ))}
                  </div>
                </>
              )}
            </>
          )}
          <Modal
            open={!!dialog}
            onOpenChange={(value) => {
              if (!value) setDialog(null);
            }}
            title={
              dialog?.kind === 'create'
                ? tr('Create multiplayer lobby')
                : dialog?.kind === 'link'
                  ? tr('Link multiplayer lobby')
                  : dialog?.kind === 'resolve'
                    ? tr('Resolve uncertain creation')
                    : tr('Confirm lobby command')
            }
          >
            {dialog && (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  const chosen = dialog;
                  setDialog(null);
                  if (chosen.kind === 'create')
                    send({
                      type: 'make',
                      id: crypto.randomUUID(),
                      name,
                      baseVersion: match.version,
                      confirmed: true,
                    });
                  else if (chosen.kind === 'command')
                    send({
                      type: 'command',
                      id: crypto.randomUUID(),
                      target,
                      command: chosen.command,
                      confirmed: true,
                    });
                  else if (chosen.kind === 'resolve') {
                    send({ type: 'resolve', requestId: chosen.command, confirmed: true });
                  } else
                    void run(async () => {
                      await action({
                        type: 'match.lobby',
                        id: match.id,
                        baseVersion: match.version,
                        lobbyUrl: chosen.command,
                        multiplayerId: Number(chosen.command.match(/\/(\d+)$/)?.[1]),
                      });
                      await onLinked();
                    }, tr('Multiplayer lobby linked.'));
                }}
              >
                {dialog.kind === 'create' ? (
                  <>
                    <Field label={tr('Lobby name')}>
                      <input
                        value={name}
                        maxLength={250}
                        onChange={(e) => setName(e.target.value)}
                        required
                      />
                    </Field>
                    <p className="text-sm text-muted">
                      {tr(
                        'BanchoBot will receive !mp make privately. A tournament room remains open when everyone leaves; close it explicitly when finished.',
                      )}
                    </p>
                  </>
                ) : dialog.kind === 'resolve' ? (
                  <p className="text-sm text-muted">
                    {tr(
                      'Confirm that you inspected BanchoBot and any created rooms. Resolving this request permits a new creation attempt; it does not close an existing room.',
                    )}
                  </p>
                ) : (
                  <p className="break-all text-sm">
                    {dialog.command}
                    {dialog.kind === 'link' && match.lobbyUrl
                      ? tr(' will replace the existing match URL.')
                      : ''}
                  </p>
                )}
                <Button type="submit" disabled={busy || (dialog.kind === 'create' && !name.trim())}>
                  <Send size={16} />
                  {tr('Confirm')}
                </Button>
              </form>
            )}
          </Modal>
        </div>
      )}
    </details>
  );
}
