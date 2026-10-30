'use client';
import { QUALIFIER_METHOD_LABELS } from '@/lib/qualifier-policy';
import { localeTag } from '@/lib/i18n';
import { localDateTimeInput } from '@/lib/utils';
import { Feedback, useLocale, useT } from '@/components/locale';

import Link from '@/components/tournament-scope';
import { useState, useEffect, useCallback, useRef } from 'react';
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
  api,
} from './shared';
import { RefereePool } from './referee-pool';
import { FreeModCalculator } from './freemod-calculator';
import { MATCH_STATUS_LABELS } from '@/lib/match-display';
import { useTournamentTime } from '@/components/tournament-scope';
import { QualifierCaptureDialog } from './qualifier-capture';
import { QualifierLobbyList } from './qualifier-bulk-tools';
import { qualifierProgress } from '@/lib/qualifier-progress';
import { QualifierMapBoard } from './qualifier-map-board';
import { IrcPanel } from './irc-panel';
import { QualifierSessionAssignments } from './qualifier-session-assignments';
type StatusCommand = Extract<QualifierAction, { type: 'qualifier.status' }>['command'];
export function QualifiersWorkspace({
  actor,
  acronym,
  id,
  ircEnabled = false,
}: {
  actor: Actor;
  acronym: string;
  id?: string;
  ircEnabled?: boolean;
}) {
  const language = useLocale();
  const tr = useT();
  const matchTime = useTournamentTime();
  const { data, error, reload } = useResource<QualifierData>(
    `qualifiers${id ? `&id=${encodeURIComponent(id)}` : ''}`,
  );
  const { busy, run, notify } = useTask();
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
    run: number;
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
  const [syncError, setSyncError] = useState('');
  const [scoreDirty, setScoreDirty] = useState(false);
  const retainedMap = useRef<{ id: string; run: number; slotName: string } | null>(null);
  const dirtyChanged = useCallback((value: boolean) => setScoreDirty(value), []);
  const session = id ? data?.lobbies[0] : null;
  useEffect(() => {
    if (
      !session?.access.score ||
      session.status !== 'IN_PROGRESS' ||
      !session.lobbyUrl ||
      session.gameplayScoring === 'LAZER'
    )
      return;
    let current = true,
      pending = false;
    const sync = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try {
        await api('/api/admin/qualifier-multiplayer', {
          method: 'POST',
          body: JSON.stringify({ id: session.id, sync: true }),
        });
        if (current) {
          setSyncError('');
          await reload();
        }
      } catch (error) {
        if (current) setSyncError((error as Error).message);
      } finally {
        pending = false;
      }
    };
    void sync();
    const timer = setInterval(() => void sync(), 20000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [
    session?.id,
    session?.status,
    session?.lobbyUrl,
    session?.access.score,
    session?.gameplayScoring,
    reload,
  ]);
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
      <legend className="mb-2 font-semibold">{tr('Assigned referees')}</legend>
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
    (s) => s.osuId === score?.osuId && s.slotName === score?.slotName && s.run === score?.run,
  );

  const roster =
    m?.participants.flatMap((team) => team.members.map((p) => ({ ...p, team: team.name }))) || [];
  const next = m ? qualifierProgress(m).find((item) => !item.complete) : null;
  const selection = (m?.selection ||
    m?.events.find((event) => event.kind === 'qualifier.map')?.data) as
    { run?: number; slotName?: string; warmup?: boolean } | undefined;
  const progress = m ? qualifierProgress(m) : [];
  const current =
    (scoreDirty && retainedMap.current?.id === m?.id
      ? progress.find(
          (item) =>
            item.run === retainedMap.current?.run &&
            item.slot.name === retainedMap.current?.slotName,
        )
      : null) ||
    progress.find(
      (item) => item.run === selection?.run && item.slot.name === selection?.slotName,
    ) ||
    next ||
    progress.at(-1);
  if (!scoreDirty && m && current)
    retainedMap.current = { id: m.id, run: current.run, slotName: current.slot.name };
  const nextTeam = current?.teams.find((team) => !team.complete);
  const selectMap = (run: number, slotName: string, warmup = false) => {
    if (scoreDirty && !window.confirm(tr('Discard unsaved changes?'))) return;
    setScoreDirty(false);
    void post(
      { type: 'qualifier.map', id: m!.id, baseVersion: m!.version, run, slotName, warmup },
      tr('Qualifier map selected.'),
    );
  };
  const command = m
    ? lobbyCommands(
        m.rules,
        acronym,
        {
          code: m.code,
          teamA: 'Qualifiers',
          teamB: `Lobby ${m.code}`,
        },
        current?.slot,
        { qualifierPlayers: m.capacity || 16 },
      )
    : null;
  const qualifierSetup =
    m && command && m.gameplayScoring !== 'LAZER'
      ? {
          make: command.make,
          settings: command.settings,
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
        {tr('All tournament matches')}
      </Link>
      {error && (
        <p role="alert" className="mb-3 text-red-200">
          {tr('Updates unavailable:')} <Feedback message={error} />
        </p>
      )}
      {!m ? (
        <>
          <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
            <h1 className="text-2xl font-semibold">{tr('Qualifier lobbies')}</h1>
            {manager && (
              <Button disabled={options?.scoringNeedsReview} onClick={() => setCreate(true)}>
                <Plus size={16} />
                {tr('Create qualifier lobby')}
              </Button>
            )}
          </header>
          {options?.scoringNeedsReview && (
            <p className="mb-4 text-sm text-muted">
              <Link className="text-primary" href="/admin/settings">
                {tr('Review tournament gameplay scoring')}
              </Link>{' '}
              {tr('before creating qualifier sessions.')}
            </p>
          )}
          <QualifierLobbyList actor={actor} data={data} reload={reload} />
        </>
      ) : (
        <>
          <header className="mb-5 space-y-3 border-b pb-4">
            <div className="flex flex-wrap justify-between gap-3">
              <h1 className="text-2xl font-semibold">
                {tr('Qualifier lobby')} {m.code}
              </h1>
              <p className="text-sm text-muted">
                {m.access.editable
                  ? tr('Editing qualifier lobby')
                  : tr('Viewing qualifier lobby · Read only')}
              </p>
            </div>
            <p>
              {m.stage.name} · {matchTime(m.scheduledAt)} · {tr(MATCH_STATUS_LABELS[m.status])}
            </p>
            <p className="text-sm text-muted">
              {tr('Assigned to')}{' '}
              {m.assignments.map((r) => r.user.username).join(', ') || tr('Unassigned')}{' '}
              {tr('· Saved version')} {m.version} · {matchTime(m.updatedAt)}
            </p>
            <div className="flex flex-wrap gap-2">
              {m.access.schedule && m.status === 'SCHEDULED' && (
                <Button
                  variant="outline"
                  onClick={() =>
                    setSchedule({
                      baseVersion: m.version,
                      scheduledAt: localDateTimeInput(m.scheduledAt),
                      refereeIds: m.assignments.map((r) => r.userId),
                      notes: m.notes,
                    })
                  }
                >
                  <CalendarClock size={16} />
                  {tr('Edit qualifier schedule')}
                </Button>
              )}
              {m.access.operate && ['SCHEDULED', 'IN_PROGRESS'].includes(m.status) && (
                <Button
                  variant="outline"
                  onClick={() => setLobby({ baseVersion: m.version, url: m.lobbyUrl })}
                >
                  {tr('Edit multiplayer link')}
                </Button>
              )}
              {m.status === 'SCHEDULED' && m.access.operate && (
                <Button
                  disabled={!m.participants.length}
                  onClick={() =>
                    setDecision({ command: 'START', baseVersion: m.version, reason: '' })
                  }
                >
                  {tr('Start qualifier lobby')}
                </Button>
              )}
              {m.status === 'IN_PROGRESS' && m.access.score && (
                <QualifierCaptureDialog lobby={m} onChanged={reload} />
              )}
              {m.status === 'IN_PROGRESS' && m.access.score && (
                <Button
                  onClick={() =>
                    setScore({
                      baseVersion: m.version,
                      osuId:
                        nextTeam?.team.members.find(
                          (p) => !nextTeam.scores.some((s) => s.osuId === p.osuId),
                        )?.osuId ||
                        roster[0]?.osuId ||
                        0,
                      slotName: current?.slot.name || m.poolRevision.slots[0]?.name || '',
                      run: current?.run || 1,
                      raw: 0,
                      mods: m.rules.enforceNoFail ? ['NF'] : [],
                      reason: '',
                    })
                  }
                >
                  <Save size={16} />
                  {tr('Record qualifier score')}
                </Button>
              )}
              {m.status === 'IN_PROGRESS' && m.access.submit && (
                <Button
                  onClick={() =>
                    setDecision({ command: 'SUBMIT', baseVersion: m.version, reason: '' })
                  }
                >
                  {tr('Submit qualifier results')}
                </Button>
              )}
              {m.status === 'AWAITING_CONFIRMATION' && manager && (
                <Button
                  onClick={() =>
                    setDecision({ command: 'CONFIRM', baseVersion: m.version, reason: '' })
                  }
                >
                  {tr('Confirm qualifier results')}
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
                    {tr('Reopen qualifier lobby')}
                  </Button>
                )}
              {!['COMPLETED', 'CANCELLED'].includes(m.status) && manager && (
                <Button
                  variant="destructive"
                  onClick={() =>
                    setDecision({ command: 'CANCEL', baseVersion: m.version, reason: '' })
                  }
                >
                  {tr('Cancel qualifier lobby')}
                </Button>
              )}
            </div>
          </header>
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <p className="mb-3 text-sm text-muted">
                {m.rules.gameplayScoring === 'LAZER'
                  ? tr('osu!lazer')
                  : m.rules.scoreMode === 'SCORE'
                    ? tr('ScoreV1')
                    : tr('ScoreV2')}{' '}
                · {m.policy.runs} {m.policy.runs === 1 ? tr('run') : tr('runs')} ·{' '}
                {tr(QUALIFIER_METHOD_LABELS[m.policy.method])}
              </p>
              <p className="mb-3 text-sm font-semibold" role="status">
                {!m.participants.length
                  ? tr('No entrants assigned yet')
                  : next && current
                    ? tr('Shared lobby: Run {0} · {1}', current.run, current.slot.name)
                    : m.participants.length
                      ? tr('All configured map scores recorded')
                      : tr('No entrants assigned yet')}
              </p>
              <div className="mb-3 flex flex-wrap items-end gap-2">
                {current && (
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!selection?.warmup}
                      disabled={!m.access.operate}
                      onChange={(event) =>
                        selectMap(current.run, current.slot.name, event.target.checked)
                      }
                    />
                    {tr('Warmup (exclude scores)')}
                  </label>
                )}
                <Field label={tr('Qualifier run')}>
                  <select
                    value={current?.run || 1}
                    onChange={(event) =>
                      selectMap(
                        Number(event.target.value),
                        current?.slot.name || m.poolRevision.slots[0].name,
                      )
                    }
                    disabled={!m.access.operate}
                  >
                    {Array.from({ length: m.policy.runs }, (_, i) => (
                      <option key={i} value={i + 1}>
                        {tr('Run {0}', i + 1)}
                      </option>
                    ))}
                  </select>
                </Field>
                {current && progress[progress.indexOf(current) + 1] && (
                  <Button
                    variant="outline"
                    disabled={!m.access.operate}
                    onClick={() => {
                      const item = progress[progress.indexOf(current) + 1];
                      selectMap(item.run, item.slot.name);
                    }}
                  >
                    {tr('Next map')}
                  </Button>
                )}
              </div>
              <RefereePool
                textActions
                slots={m.poolRevision.slots}
                rules={m.rules}
                copy={copy}
                label={tr('Qualifier mappool')}
                state={(slot) =>
                  slot.name === current?.slot.name ? tr('Selected map') : tr('Full qualifier pool')
                }
                action={(slot) => (
                  <Button
                    style={{ width: 'auto', minWidth: 56 }}
                    size="sm"
                    variant={slot.name === current?.slot.name ? 'default' : 'ghost'}
                    disabled={!m.access.operate}
                    onClick={() => selectMap(current?.run || 1, slot.name)}
                    aria-label={tr('Select qualifier map {0}', slot.name)}
                  >
                    {tr('Select')}
                  </Button>
                )}
              />
              {current && (
                <div className="mt-4">
                  <QualifierMapBoard
                    key={`${current.run}-${current.slot.name}`}
                    lobby={m}
                    selected={{ run: current.run, slotName: current.slot.name }}
                    onChanged={reload}
                    onDirty={dirtyChanged}
                  />
                </div>
              )}
              {command && (
                <IrcPanel
                  match={{
                    ...m,
                    multiplayerId: Number(m.lobbyUrl.match(/\/(\d+)\/?$/)?.[1]) || null,
                  }}
                  kind="qualifier"
                  commands={command}
                  editable={m.access.operate}
                  enabled={ircEnabled}
                  onLinked={reload}
                />
              )}
              <p className="mt-3 text-xs text-muted">
                {tr(
                  'Scores synchronize automatically from osu! while this session is running. Missing or ambiguous evidence requires review.',
                )}
              </p>
              {(syncError || m.multiplayerError) && (
                <p role="alert" className="mt-2 text-sm text-red-300">
                  <Feedback message={syncError || m.multiplayerError!} />
                </p>
              )}
              {m.multiplayerSyncedAt && (
                <p className="mt-2 text-xs text-muted">
                  {tr('Last osu! synchronization: {0}', matchTime(m.multiplayerSyncedAt))}
                </p>
              )}
              {m.games.some((game) => game.status === 'PENDING') && (
                <p role="status" className="mt-2 text-sm font-semibold">
                  {tr(
                    'Games requiring review: {0}',
                    m.games.filter((game) => game.status === 'PENDING').length,
                  )}
                </p>
              )}
              <FreeModCalculator rules={m.rules} />
            </div>
            <div className="min-w-0 space-y-5">
              {m.access.operate && (
                <QualifierSessionAssignments lobby={m} manager={manager} onChanged={reload} />
              )}
              <section className="space-y-3">
                <h2 className="font-semibold">{tr('Lobby preparation')}</h2>
                {m.lobbyUrl && (
                  <a
                    className="inline-flex items-center gap-2 text-sm text-primary"
                    href={m.lobbyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {tr('Open multiplayer lobby')}
                    <ExternalLink size={15} />
                  </a>
                )}
                <div className="flex flex-wrap gap-2">
                  {qualifierSetup && (
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
                                  p.captain ||
                                  m.participants.every((t) => t.format === 'INDIVIDUAL'),
                              )
                              .map((p) => `!mp invite #${p.osuId}`),
                            qualifierSetup!.timer,
                          ].join('\n'),
                        )
                      }
                    >
                      <Copy size={15} />
                      {tr('Copy Setup Commands')}
                    </Button>
                  )}
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
                    {tr('Copy Qualifier Ping')}
                  </Button>
                </div>
                {!qualifierSetup && (
                  <p className="text-sm text-muted">
                    {tr(
                      'Legacy Bancho commands are unavailable for osu!lazer rooms. Record standardized scores manually.',
                    )}
                  </p>
                )}
                {Object.entries(qualifierSetup || {}).map(([name, value]) => (
                  <div key={name} className="flex items-center justify-between gap-2 border-b py-1">
                    <code className="min-w-0 break-words text-xs">{value}</code>
                    <Button
                      size="icon"
                      variant="ghost"
                      title={tr('Copy {0}', name)}
                      aria-label={tr('Copy qualifier {0}', name)}
                      onClick={() => copy(value)}
                    >
                      <Copy size={15} />
                    </Button>
                  </div>
                ))}
                {qualifierSetup && (
                  <details>
                    <summary className="cursor-pointer text-sm font-semibold">
                      {tr('Participant invites')}
                    </summary>
                    {roster.map((p) => (
                      <div
                        key={p.osuId}
                        className="flex items-center justify-between gap-2 border-b py-1 text-sm"
                      >
                        <span>
                          {p.team} · {p.username}
                          {p.captain ? tr(' · Captain') : ''}
                        </span>
                        <Button
                          size="icon"
                          variant="ghost"
                          title={tr('Invite {0}', p.username)}
                          aria-label={tr('Copy invite {0}', p.username)}
                          onClick={() => copy(`!mp invite #${p.osuId}`)}
                        >
                          <Copy size={15} />
                        </Button>
                      </div>
                    ))}
                  </details>
                )}
              </section>
              <section>
                <h2 className="mb-3 font-semibold">{tr('Qualifier scores')}</h2>
                <div className="max-h-80 overflow-auto">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>{tr('Run')}</th>
                        <th>{tr('Slot')}</th>
                        <th>{tr('Player')}</th>
                        <th>{tr('Raw')}</th>
                        <th>{tr('Mods')}</th>
                        <th>{tr('Converted')}</th>
                        {m.access.score && m.status === 'IN_PROGRESS' && (
                          <th>{tr('Correction')}</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {m.scores.map((s) => (
                        <tr key={s.id}>
                          <td>{s.run}</td>
                          <td>{s.slotName}</td>
                          <td>{roster.find((p) => p.osuId === s.osuId)?.username || s.osuId}</td>
                          <td>{s.raw.toLocaleString(localeTag(language))}</td>
                          <td>{s.mods.join(' ') || tr('NM')}</td>
                          <td>
                            {s.adjusted.toLocaleString(localeTag(language), {
                              maximumFractionDigits: 8,
                            })}
                          </td>
                          {m.access.score && m.status === 'IN_PROGRESS' && (
                            <td>
                              <Button
                                variant="ghost"
                                size="icon"
                                title={tr('Remove incorrect score')}
                                aria-label={tr('Remove {0} score for {1}', s.slotName, s.osuId)}
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
                <p className="mt-3 text-xs text-muted">
                  {tr('Recorded totals across all runs. Final seedings use the stage policy.')}
                </p>
                <dl className="mt-3 space-y-2 text-sm">
                  {m.participants.map((team) => (
                    <div key={team.id} className="flex justify-between gap-2 border-b pb-2">
                      <dt>{team.name}</dt>
                      <dd>
                        {m.scores
                          .filter((s) => team.members.some((p) => p.osuId === s.osuId))
                          .reduce((total, s) => total + s.adjusted, 0)
                          .toLocaleString(localeTag(language), { maximumFractionDigits: 8 })}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section className="space-y-3">
                <h2 className="font-semibold">{tr('Discord result')}</h2>
                <Button disabled={!qualifiedResult} onClick={() => copy(qualifiedResult)}>
                  <Copy size={16} />
                  {tr('Copy Discord Result')}
                </Button>
                <pre className="whitespace-pre-wrap break-words text-sm">
                  {qualifiedResult.replaceAll('\r', '\n') || tr('Awaiting confirmed results')}
                </pre>
              </section>
              {m.notes && <p className="whitespace-pre-wrap border-y py-3 text-sm">{m.notes}</p>}
              <details>
                <summary className="cursor-pointer font-semibold">
                  {tr('Qualifier history')}
                </summary>
                <ol className="mt-3 space-y-3">
                  {m.events.map((event) => (
                    <li key={event.id} className="border-b pb-3 text-sm">
                      <p>
                        {tr('v')}
                        {event.version} · {event.kind} · {event.actor?.username || tr('System')} ·{' '}
                        {matchTime(event.createdAt)}
                      </p>
                      <p>{event.reason}</p>
                      <details>
                        <summary className="cursor-pointer text-muted">
                          {tr('Saved record')}
                        </summary>
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
        title={tr('Remove incorrect qualifier score')}
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
            <Field label={tr('Score removal reason')}>
              <textarea
                required
                minLength={3}
                value={remove.reason}
                onChange={(e) => setRemove({ ...remove, reason: e.target.value })}
              />
            </Field>
            <SaveButton busy={busy} disabled={remove.baseVersion !== m.version}>
              {tr('Confirm score removal')}
            </SaveButton>
          </form>
        )}
      </Modal>
      <Modal open={create} onOpenChange={setCreate} title={tr('Create qualifier lobby')} wide>
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
            <Field label={tr('Qualifier lobby code')}>
              <input
                required
                value={newLobby.code}
                onChange={(e) => setNewLobby({ ...newLobby, code: e.target.value })}
              />
            </Field>
            <Field label={tr('Qualifier stage')}>
              <select
                required
                value={newLobby.stageId}
                onChange={(e) => setNewLobby({ ...newLobby, stageId: e.target.value })}
              >
                <option value="">{tr('Select stage')}</option>
                {options?.stages
                  .filter((s) => s.published && s.kind === 'QUALIFIERS')
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={tr('Qualifier start time')}>
              <input
                type="datetime-local"
                value={newLobby.scheduledAt}
                onChange={(e) => setNewLobby({ ...newLobby, scheduledAt: e.target.value })}
              />
            </Field>
          </div>
          <fieldset className="max-h-60 space-y-2 overflow-auto">
            <legend className="mb-2 font-semibold">{tr('Approved entrants')}</legend>
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
          <Field label={tr('Qualifier notes')}>
            <textarea
              value={newLobby.notes}
              onChange={(e) => setNewLobby({ ...newLobby, notes: e.target.value })}
            />
          </Field>
          <SaveButton busy={busy}>{tr('Create qualifier lobby')}</SaveButton>
        </form>
      </Modal>
      <Modal
        open={!!score}
        onOpenChange={(open) => {
          if (!open) setScore(null);
        }}
        title={tr('Record qualifier score')}
      >
        {score && m && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void post(
                {
                  type: 'qualifier.score',
                  id: m.id,
                  ...score,
                  representation: m.rules.gameplayScoring === 'LAZER' ? 'STANDARDIZED' : 'LEGACY',
                },
                'Qualifier score saved.',
                () => setScore(null),
              );
            }}
          >
            {score.baseVersion !== m.version && (
              <p role="alert">{tr('This lobby changed. Reopen the score form.')}</p>
            )}
            {m.policy.runs === 2 && (
              <Field label={tr('Run')}>
                <select
                  value={score.run}
                  onChange={(e) => setScore({ ...score, run: Number(e.target.value) })}
                >
                  <option value={1}>{tr('Run 1')}</option>
                  <option value={2}>{tr('Run 2')}</option>
                </select>
              </Field>
            )}
            {m.rules.gameplayScoring === 'LAZER' && (
              <label className="flex items-center gap-3 text-sm">
                <input type="checkbox" required />
                {tr(
                  'Scores are actual standardized lazer values, not classic-scaled display values.',
                )}
              </label>
            )}
            <Field label={tr('Qualifier player')}>
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
            <Field label={tr('Qualifier score slot')}>
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
            <Field label={tr('Qualifier raw score')}>
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
                {tr('Existing score:')} {selected.raw}
                {tr('. Saving records a correction.')}
              </p>
            )}
            <Field label={tr('Qualifier score reason')}>
              <textarea
                required
                minLength={3}
                value={score.reason}
                onChange={(e) => setScore({ ...score, reason: e.target.value })}
              />
            </Field>
            <SaveButton busy={busy} disabled={score.baseVersion !== m.version}>
              {tr('Save qualifier score')}
            </SaveButton>
          </form>
        )}
      </Modal>
      <Modal
        open={!!schedule}
        onOpenChange={(open) => {
          if (!open) setSchedule(null);
        }}
        title={tr('Edit qualifier schedule')}
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
            <Field label={tr('Qualifier start time')}>
              <input
                type="datetime-local"
                value={schedule.scheduledAt}
                onChange={(e) => setSchedule({ ...schedule, scheduledAt: e.target.value })}
              />
            </Field>
            {refs(schedule.refereeIds, (refereeIds) => setSchedule({ ...schedule, refereeIds }))}
            <Field label={tr('Qualifier notes')}>
              <textarea
                value={schedule.notes}
                onChange={(e) => setSchedule({ ...schedule, notes: e.target.value })}
              />
            </Field>
            <SaveButton busy={busy} disabled={schedule.baseVersion !== m.version}>
              {tr('Save qualifier schedule')}
            </SaveButton>
          </form>
        )}
      </Modal>
      <Modal
        open={!!lobby}
        onOpenChange={(open) => {
          if (!open) setLobby(null);
        }}
        title={tr('Qualifier multiplayer link')}
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
            <Field label={tr('Qualifier multiplayer URL')}>
              <input
                type="url"
                value={lobby.url}
                onChange={(e) => setLobby({ ...lobby, url: e.target.value })}
              />
            </Field>
            <SaveButton busy={busy} disabled={lobby.baseVersion !== m.version}>
              {tr('Save multiplayer link')}
            </SaveButton>
          </form>
        )}
      </Modal>
      <Modal
        open={!!decision}
        onOpenChange={(open) => {
          if (!open) setDecision(null);
        }}
        title={tr('Review qualifier status')}
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
            <Field label={tr('Qualifier status reason')}>
              <textarea
                required
                minLength={3}
                value={decision.reason}
                onChange={(e) => setDecision({ ...decision, reason: e.target.value })}
              />
            </Field>
            <SaveButton busy={busy} disabled={decision.baseVersion !== m.version}>
              {tr('Confirm qualifier action')}
            </SaveButton>
          </form>
        )}
      </Modal>
    </>
  );
}
