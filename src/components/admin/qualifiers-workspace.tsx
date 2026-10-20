'use client';
import Link from '@/components/tournament-scope';
import { useState } from 'react';
import { Copy, Plus, Save, CalendarClock, ArrowLeft, ExternalLink, Trash2 } from 'lucide-react';
import type { Actor } from '@/lib/permissions';
import type { QualifierData } from '@/lib/qualifiers-types';
import type { QualifierAction } from '@/lib/qualifiers-validation';
import { MODS } from '@/lib/match-rules';
import { lobbyCommands } from '@/lib/match-engine';
import { matchPing } from '@/lib/discord-result';
import { Button } from '../ui/button';
import {
  action,
  Field,
  LoadingState,
  Modal,
  SaveButton,
  useResource,
  useTask,
  usePolling,
} from './shared';
import { RefereePool } from './referee-pool';
import { FreeModCalculator } from './freemod-calculator';
import { MATCH_STATUS_LABELS } from './matches-dashboard';
import { useTournamentTime } from '@/components/tournament-scope';
type StatusCommand = Extract<QualifierAction, { type: 'qualifier.status' }>['command'];
export function QualifiersWorkspace({
  actor,
  acronym,
  id,
}: {
  actor: Actor;
  acronym: string;
  id?: string;
}) {
  const matchTime = useTournamentTime();
  const { data, error, reload } = useResource<QualifierData>(
    `qualifiers${id ? `&id=${encodeURIComponent(id)}` : ''}`,
  );
  const { busy, run, notify } = useTask();
  const [filter, setFilter] = useState(''),
    [q, setQ] = useState('');
  const [create, setCreate] = useState(false),
    [newLobby, setNewLobby] = useState({
      code: '',
      stageId: '',
      teamIds: [] as string[],
      refereeIds: [] as string[],
      scheduledAt: '',
      notes: '',
    });
  const [score, setScore] = useState<{
    baseVersion: number;
    osuId: number;
    slotName: string;
    raw: number;
    mods: string[];
    reason: string;
  } | null>(null);
  const [schedule, setSchedule] = useState<{
    baseVersion: number;
    scheduledAt: string;
    refereeIds: string[];
    notes: string;
  } | null>(null);
  const [lobby, setLobby] = useState<{ baseVersion: number; url: string } | null>(null);
  const [remove, setRemove] = useState<{
    scoreId: string;
    baseVersion: number;
    reason: string;
  } | null>(null);
  const [decision, setDecision] = useState<{
    command: StatusCommand;
    baseVersion: number;
    reason: string;
  } | null>(null);
  usePolling(reload);
  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  const m = id ? data.lobbies[0] : null;
  const manager = actor.permissions.includes('matches.manage');
  const post = (body: object, message: string, close?: () => void) =>
    run(async () => {
      await action(body);
      close?.();
      await reload();
    }, message);
  const copy = (value: string) =>
    void navigator.clipboard
      .writeText(value)
      .then(() => notify('Copied to clipboard.'))
      .catch(() => notify('Clipboard unavailable.', true));
  const options = data.options;
  const toggle = (values: string[], value: string) =>
    values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
  const refs = (ids: string[], change: (ids: string[]) => void) => (
    <fieldset className="space-y-2">
      <legend className="mb-2 font-semibold">Assigned referees</legend>
      {options?.referees.map((ref) => (
        <label key={ref.id} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={ids.includes(ref.id)}
            onChange={() => change(toggle(ids, ref.id))}
          />
          {ref.username}
        </label>
      ))}
    </fieldset>
  );
  const selected = m?.scores.find(
    (s) => s.osuId === score?.osuId && s.slotName === score?.slotName,
  );
  const localDate = (iso: string | null) =>
    iso
      ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16)
      : '';
  const roster =
    m?.participants.flatMap((team) => team.members.map((p) => ({ ...p, team: team.name }))) || [];
  const command = m
    ? lobbyCommands(m.rules, acronym, {
        code: m.code,
        teamA: 'Qualifiers',
        teamB: `Lobby ${m.code}`,
      })
    : null;
  const qualifierSetup =
    m && command
      ? {
          make: command.make,
          settings: command.settings.replace(/ \d+$/, ' 8'),
          timer: command.timer,
          start: command.start,
          abort: command.abort,
          inspect: command.inspect,
        }
      : null;
  const qualifiedResult =
    m?.status === 'COMPLETED' && m.lobbyUrl
      ? `**Qualifiers:** Lobby ${m.code}\rMP Link: <${m.lobbyUrl}>`
      : '';
  return (
    <>
      <Link
        className="mb-4 inline-flex items-center gap-2 text-sm text-primary"
        href="/admin/referee"
      >
        <ArrowLeft size={16} />
        All tournament matches
      </Link>
      {error && (
        <p role="alert" className="mb-3 text-red-200">
          Updates unavailable: {error}
        </p>
      )}
      {!m ? (
        <>
          <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
            <h1 className="text-2xl font-semibold">Qualifier lobbies</h1>
            {manager && (
              <Button onClick={() => setCreate(true)}>
                <Plus size={16} />
                Create qualifier lobby
              </Button>
            )}
          </header>
          <div className="mb-5 grid gap-3 sm:grid-cols-2">
            <Field label="Find qualifier lobby">
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} />
            </Field>
            <Field label="Qualifier view">
              <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="">All Matches</option>
                <option value="me">My Assigned Matches</option>
                <option value="unassigned">Unassigned Matches</option>
                {Object.entries(MATCH_STATUS_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="mb-3 text-sm text-muted">
            {data.lobbies.length} lobbies ·{' '}
            {data.lobbies.filter((l) => l.status === 'IN_PROGRESS').length} in progress
          </p>
          <div className="overflow-auto">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Lobby</th>
                  <th>Stage</th>
                  <th>Entrants</th>
                  <th>Schedule</th>
                  <th>Referees</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.lobbies
                  .filter(
                    (l) =>
                      (!filter ||
                        (filter === 'me'
                          ? l.assignments.some((r) => r.userId === actor.id)
                          : filter === 'unassigned'
                            ? !l.assignments.length
                            : l.status === filter)) &&
                      `${l.code} ${l.stage.name} ${l.participants.map((t) => t.name).join(' ')}`
                        .toLowerCase()
                        .includes(q.toLowerCase()),
                  )
                  .map((l) => (
                    <tr key={l.id}>
                      <td>
                        <Link className="text-primary" href={`/admin/referee/qualifiers/${l.id}`}>
                          {l.code}
                        </Link>
                      </td>
                      <td>{l.stage.name}</td>
                      <td>{l.participants.map((t) => t.name).join(', ')}</td>
                      <td>{matchTime(l.scheduledAt)}</td>
                      <td>
                        {l.assignments.map((r) => r.user.username).join(', ') || 'Unassigned'}
                      </td>
                      <td>{MATCH_STATUS_LABELS[l.status]}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!data.lobbies.length && (
            <p className="py-8 text-muted">No qualifier lobbies scheduled.</p>
          )}
        </>
      ) : (
        <>
          <header className="mb-5 space-y-3 border-b pb-4">
            <div className="flex flex-wrap justify-between gap-3">
              <h1 className="text-2xl font-semibold">Qualifier lobby {m.code}</h1>
              <p className="text-sm text-muted">
                {m.access.editable
                  ? 'Editing qualifier lobby'
                  : 'Viewing qualifier lobby · Read only'}
              </p>
            </div>
            <p>
              {m.stage.name} · {matchTime(m.scheduledAt)} · {MATCH_STATUS_LABELS[m.status]}
            </p>
            <p className="text-sm text-muted">
              Assigned to {m.assignments.map((r) => r.user.username).join(', ') || 'Unassigned'} ·
              Saved version {m.version} · {matchTime(m.updatedAt)}
            </p>
            <div className="flex flex-wrap gap-2">
              {m.access.schedule && m.status === 'SCHEDULED' && (
                <Button
                  variant="outline"
                  onClick={() =>
                    setSchedule({
                      baseVersion: m.version,
                      scheduledAt: localDate(m.scheduledAt),
                      refereeIds: m.assignments.map((r) => r.userId),
                      notes: m.notes,
                    })
                  }
                >
                  <CalendarClock size={16} />
                  Edit qualifier schedule
                </Button>
              )}
              {m.access.operate && ['SCHEDULED', 'IN_PROGRESS'].includes(m.status) && (
                <Button
                  variant="outline"
                  onClick={() => setLobby({ baseVersion: m.version, url: m.lobbyUrl })}
                >
                  Edit multiplayer link
                </Button>
              )}
              {m.status === 'SCHEDULED' && m.access.operate && (
                <Button
                  onClick={() =>
                    setDecision({ command: 'START', baseVersion: m.version, reason: '' })
                  }
                >
                  Start qualifier lobby
                </Button>
              )}
              {m.status === 'IN_PROGRESS' && m.access.score && (
                <Button
                  onClick={() =>
                    setScore({
                      baseVersion: m.version,
                      osuId: roster[0]?.osuId || 0,
                      slotName: m.poolRevision.slots[0]?.name || '',
                      raw: 0,
                      mods: m.rules.enforceNoFail ? ['NF'] : [],
                      reason: '',
                    })
                  }
                >
                  <Save size={16} />
                  Record qualifier score
                </Button>
              )}
              {m.status === 'IN_PROGRESS' && m.access.submit && (
                <Button
                  onClick={() =>
                    setDecision({ command: 'SUBMIT', baseVersion: m.version, reason: '' })
                  }
                >
                  Submit qualifier results
                </Button>
              )}
              {m.status === 'AWAITING_CONFIRMATION' && manager && (
                <Button
                  onClick={() =>
                    setDecision({ command: 'CONFIRM', baseVersion: m.version, reason: '' })
                  }
                >
                  Confirm qualifier results
                </Button>
              )}
              {['COMPLETED', 'AWAITING_CONFIRMATION', 'DISPUTED', 'CANCELLED'].includes(m.status) &&
                manager && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      setDecision({ command: 'REOPEN', baseVersion: m.version, reason: '' })
                    }
                  >
                    Reopen qualifier lobby
                  </Button>
                )}
              {!['COMPLETED', 'CANCELLED'].includes(m.status) && manager && (
                <Button
                  variant="destructive"
                  onClick={() =>
                    setDecision({ command: 'CANCEL', baseVersion: m.version, reason: '' })
                  }
                >
                  Cancel qualifier lobby
                </Button>
              )}
            </div>
          </header>
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <div className="min-w-0 xl:sticky xl:top-5">
              <RefereePool slots={m.poolRevision.slots} rules={m.rules} copy={copy} />
              <FreeModCalculator rules={m.rules} />
            </div>
            <div className="min-w-0 space-y-5">
              <section className="space-y-3">
                <h2 className="font-semibold">Lobby preparation</h2>
                {m.lobbyUrl && (
                  <a
                    className="inline-flex items-center gap-2 text-sm text-primary"
                    href={m.lobbyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open multiplayer lobby
                    <ExternalLink size={15} />
                  </a>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      copy(
                        [
                          qualifierSetup!.make,
                          qualifierSetup!.settings,
                          ...m.assignments.map((r) => `!mp addref #${r.user.osuId}`),
                          ...roster
                            .filter(
                              (p) =>
                                p.captain || m.participants.every((t) => t.format === 'INDIVIDUAL'),
                            )
                            .map((p) => `!mp invite #${p.osuId}`),
                          qualifierSetup!.timer,
                        ].join('\n'),
                      )
                    }
                  >
                    <Copy size={15} />
                    Copy Setup Commands
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      copy(
                        matchPing(
                          'Qualifiers',
                          m.code,
                          m.entries.flatMap((entry) => entry.team.members.map((p) => p.discordId)),
                          true,
                        ),
                      )
                    }
                  >
                    <Copy size={15} />
                    Copy Qualifier Ping
                  </Button>
                </div>
                {Object.entries(qualifierSetup!).map(([name, value]) => (
                  <div key={name} className="flex items-center justify-between gap-2 border-b py-1">
                    <code className="min-w-0 break-words text-xs">{value}</code>
                    <Button
                      size="icon"
                      variant="ghost"
                      title={`Copy ${name}`}
                      aria-label={`Copy qualifier ${name}`}
                      onClick={() => copy(value)}
                    >
                      <Copy size={15} />
                    </Button>
                  </div>
                ))}
                <details>
                  <summary className="cursor-pointer text-sm font-semibold">
                    Participant invites
                  </summary>
                  {roster.map((p) => (
                    <div
                      key={p.osuId}
                      className="flex items-center justify-between gap-2 border-b py-1 text-sm"
                    >
                      <span>
                        {p.team} · {p.username}
                        {p.captain ? ' · Captain' : ''}
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        title={`Invite ${p.username}`}
                        aria-label={`Copy invite ${p.username}`}
                        onClick={() => copy(`!mp invite #${p.osuId}`)}
                      >
                        <Copy size={15} />
                      </Button>
                    </div>
                  ))}
                </details>
              </section>
              <section>
                <h2 className="mb-3 font-semibold">Qualifier scores</h2>
                <div className="max-h-80 overflow-auto">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Slot</th>
                        <th>Player</th>
                        <th>Raw</th>
                        <th>Mods</th>
                        <th>Converted</th>
                        {m.access.score && m.status === 'IN_PROGRESS' && <th>Correction</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {m.scores.map((s) => (
                        <tr key={s.id}>
                          <td>{s.slotName}</td>
                          <td>{roster.find((p) => p.osuId === s.osuId)?.username || s.osuId}</td>
                          <td>{s.raw.toLocaleString()}</td>
                          <td>{s.mods.join(' ') || 'NM'}</td>
                          <td>
                            {s.adjusted.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                          </td>
                          {m.access.score && m.status === 'IN_PROGRESS' && (
                            <td>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Remove incorrect score"
                                aria-label={`Remove ${s.slotName} score for ${s.osuId}`}
                                onClick={() =>
                                  setRemove({ scoreId: s.id, baseVersion: m.version, reason: '' })
                                }
                              >
                                <Trash2 size={15} />
                              </Button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <dl className="mt-3 space-y-2 text-sm">
                  {m.participants.map((team) => (
                    <div key={team.id} className="flex justify-between gap-2 border-b pb-2">
                      <dt>{team.name}</dt>
                      <dd>
                        {m.scores
                          .filter((s) => team.members.some((p) => p.osuId === s.osuId))
                          .reduce((total, s) => total + s.adjusted, 0)
                          .toLocaleString(undefined, { maximumFractionDigits: 8 })}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section className="space-y-3">
                <h2 className="font-semibold">Discord result</h2>
                <Button disabled={!qualifiedResult} onClick={() => copy(qualifiedResult)}>
                  <Copy size={16} />
                  Copy Discord Result
                </Button>
                <pre className="whitespace-pre-wrap break-words text-sm">
                  {qualifiedResult.replaceAll('\r', '\n') || 'Awaiting confirmed results'}
                </pre>
              </section>
              {m.notes && <p className="whitespace-pre-wrap border-y py-3 text-sm">{m.notes}</p>}
              <details>
                <summary className="cursor-pointer font-semibold">Qualifier history</summary>
                <ol className="mt-3 space-y-3">
                  {m.events.map((event) => (
                    <li key={event.id} className="border-b pb-3 text-sm">
                      <p>
                        v{event.version} · {event.kind} · {event.actor?.username || 'System'} ·{' '}
                        {matchTime(event.createdAt)}
                      </p>
                      <p>{event.reason}</p>
                      <details>
                        <summary className="cursor-pointer text-muted">Saved record</summary>
                        <pre className="overflow-auto text-xs">
                          {JSON.stringify(event.data, null, 2)}
                        </pre>
                      </details>
                    </li>
                  ))}
                </ol>
              </details>
            </div>
          </div>
        </>
      )}
      <Modal
        open={!!remove}
        onOpenChange={(open) => {
          if (!open) setRemove(null);
        }}
        title="Remove incorrect qualifier score"
      >
        {remove && m && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void post(
                { type: 'qualifier.score.remove', id: m.id, ...remove },
                'Score removed; original retained in history.',
                () => setRemove(null),
              );
            }}
          >
            <Field label="Score removal reason">
              <textarea
                required
                minLength={3}
                value={remove.reason}
                onChange={(e) => setRemove({ ...remove, reason: e.target.value })}
              />
            </Field>
            <SaveButton busy={busy} disabled={remove.baseVersion !== m.version}>
              Confirm score removal
            </SaveButton>
          </form>
        )}
      </Modal>
      <Modal open={create} onOpenChange={setCreate} title="Create qualifier lobby" wide>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void post(
              {
                type: 'qualifier.create',
                ...newLobby,
                scheduledAt: newLobby.scheduledAt
                  ? new Date(newLobby.scheduledAt).toISOString()
                  : null,
              },
              'Qualifier lobby created.',
              () => setCreate(false),
            );
          }}
        >
          <div className="grid-fields">
            <Field label="Qualifier lobby code">
              <input
                required
                value={newLobby.code}
                onChange={(e) => setNewLobby({ ...newLobby, code: e.target.value })}
              />
            </Field>
            <Field label="Qualifier stage">
              <select
                required
                value={newLobby.stageId}
                onChange={(e) => setNewLobby({ ...newLobby, stageId: e.target.value })}
              >
                <option value="">Select stage</option>
                {options?.stages
                  .filter((s) => s.published)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Qualifier start time">
              <input
                type="datetime-local"
                value={newLobby.scheduledAt}
                onChange={(e) => setNewLobby({ ...newLobby, scheduledAt: e.target.value })}
              />
            </Field>
          </div>
          <fieldset className="max-h-60 space-y-2 overflow-auto">
            <legend className="mb-2 font-semibold">Approved entrants</legend>
            {options?.teams.map((team) => (
              <label key={team.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={newLobby.teamIds.includes(team.id)}
                  onChange={() =>
                    setNewLobby({ ...newLobby, teamIds: toggle(newLobby.teamIds, team.id) })
                  }
                />
                {team.name}
              </label>
            ))}
          </fieldset>
          {refs(newLobby.refereeIds, (refereeIds) => setNewLobby({ ...newLobby, refereeIds }))}
          <Field label="Qualifier notes">
            <textarea
              value={newLobby.notes}
              onChange={(e) => setNewLobby({ ...newLobby, notes: e.target.value })}
            />
          </Field>
          <SaveButton busy={busy}>Create qualifier lobby</SaveButton>
        </form>
      </Modal>
      <Modal
        open={!!score}
        onOpenChange={(open) => {
          if (!open) setScore(null);
        }}
        title="Record qualifier score"
      >
        {score && m && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void post(
                { type: 'qualifier.score', id: m.id, ...score },
                'Qualifier score saved.',
                () => setScore(null),
              );
            }}
          >
            {score.baseVersion !== m.version && (
              <p role="alert">This lobby changed. Reopen the score form.</p>
            )}
            <Field label="Qualifier player">
              <select
                value={score.osuId}
                onChange={(e) => {
                  const osuId = Number(e.target.value),
                    old = m.scores.find((s) => s.osuId === osuId && s.slotName === score.slotName);
                  setScore({
                    ...score,
                    osuId,
                    raw: old?.raw ?? 0,
                    mods: old?.mods || (m.rules.enforceNoFail ? ['NF'] : []),
                  });
                }}
              >
                {roster.map((p) => (
                  <option key={p.osuId} value={p.osuId}>
                    {p.team} · {p.username}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Qualifier score slot">
              <select
                value={score.slotName}
                onChange={(e) => {
                  const slotName = e.target.value,
                    old = m.scores.find((s) => s.osuId === score.osuId && s.slotName === slotName);
                  setScore({
                    ...score,
                    slotName,
                    raw: old?.raw ?? 0,
                    mods: old?.mods || (m.rules.enforceNoFail ? ['NF'] : []),
                  });
                }}
              >
                {m.poolRevision.slots.map((s) => (
                  <option key={s.name}>{s.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Qualifier raw score">
              <input
                type="number"
                step={m.rules.scoreMode === 'ACCURACY' ? 'any' : 1}
                required
                min={0}
                value={score.raw}
                onChange={(e) => setScore({ ...score, raw: Number(e.target.value) })}
              />
            </Field>
            <div className="flex flex-wrap gap-3">
              {MODS.map((mod) => (
                <label key={mod} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={score.mods.includes(mod)}
                    onChange={() => setScore({ ...score, mods: toggle(score.mods, mod) })}
                  />
                  {mod}
                </label>
              ))}
            </div>
            {selected && (
              <p className="text-sm text-muted">
                Existing score: {selected.raw}. Saving records a correction.
              </p>
            )}
            <Field label="Qualifier score reason">
              <textarea
                required
                minLength={3}
                value={score.reason}
                onChange={(e) => setScore({ ...score, reason: e.target.value })}
              />
            </Field>
            <SaveButton busy={busy} disabled={score.baseVersion !== m.version}>
              Save qualifier score
            </SaveButton>
          </form>
        )}
      </Modal>
      <Modal
        open={!!schedule}
        onOpenChange={(open) => {
          if (!open) setSchedule(null);
        }}
        title="Edit qualifier schedule"
      >
        {schedule && m && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void post(
                {
                  type: 'qualifier.schedule',
                  id: m.id,
                  ...schedule,
                  scheduledAt: schedule.scheduledAt
                    ? new Date(schedule.scheduledAt).toISOString()
                    : null,
                },
                'Qualifier schedule saved.',
                () => setSchedule(null),
              );
            }}
          >
            <Field label="Qualifier start time">
              <input
                type="datetime-local"
                value={schedule.scheduledAt}
                onChange={(e) => setSchedule({ ...schedule, scheduledAt: e.target.value })}
              />
            </Field>
            {refs(schedule.refereeIds, (refereeIds) => setSchedule({ ...schedule, refereeIds }))}
            <Field label="Qualifier notes">
              <textarea
                value={schedule.notes}
                onChange={(e) => setSchedule({ ...schedule, notes: e.target.value })}
              />
            </Field>
            <SaveButton busy={busy} disabled={schedule.baseVersion !== m.version}>
              Save qualifier schedule
            </SaveButton>
          </form>
        )}
      </Modal>
      <Modal
        open={!!lobby}
        onOpenChange={(open) => {
          if (!open) setLobby(null);
        }}
        title="Qualifier multiplayer link"
      >
        {lobby && m && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void post(
                {
                  type: 'qualifier.lobby',
                  id: m.id,
                  baseVersion: lobby.baseVersion,
                  lobbyUrl: lobby.url,
                },
                'Multiplayer link saved.',
                () => setLobby(null),
              );
            }}
          >
            <Field label="Qualifier multiplayer URL">
              <input
                type="url"
                value={lobby.url}
                onChange={(e) => setLobby({ ...lobby, url: e.target.value })}
              />
            </Field>
            <SaveButton busy={busy} disabled={lobby.baseVersion !== m.version}>
              Save multiplayer link
            </SaveButton>
          </form>
        )}
      </Modal>
      <Modal
        open={!!decision}
        onOpenChange={(open) => {
          if (!open) setDecision(null);
        }}
        title="Review qualifier status"
      >
        {decision && m && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void post(
                { type: 'qualifier.status', id: m.id, ...decision },
                'Qualifier status saved.',
                () => setDecision(null),
              );
            }}
          >
            <p>
              {decision.command} · {m.code}
            </p>
            <Field label="Qualifier status reason">
              <textarea
                required
                minLength={3}
                value={decision.reason}
                onChange={(e) => setDecision({ ...decision, reason: e.target.value })}
              />
            </Field>
            <SaveButton busy={busy} disabled={decision.baseVersion !== m.version}>
              Confirm qualifier action
            </SaveButton>
          </form>
        )}
      </Modal>
    </>
  );
}
