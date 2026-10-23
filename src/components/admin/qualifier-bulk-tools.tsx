'use client';

import { useRef, useState } from 'react';
import { ArrowRightLeft, CalendarClock, ListPlus, X } from 'lucide-react';
import Link, { useTournamentTime, useTournamentScope } from '@/components/tournament-scope';
import type { Actor } from '@/lib/permissions';
import type { QualifierData, QualifierView } from '@/lib/qualifiers-types';
import type { QualifierAction } from '@/lib/qualifiers-validation';
import { qualifierSessionPlan, type NewQualifierSession } from '@/lib/qualifier-scheduling';
import { Button } from '../ui/button';
import { action, Field, Modal, SaveButton, useTask, useUnsaved } from './shared';

type Options = NonNullable<QualifierData['options']>;
const toggle = (values: string[], value: string) =>
  values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
const localDate = (iso: string | null) =>
  iso
    ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16)
    : '';

function Referees({
  options,
  value,
  onChange,
}: {
  options: Options;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <fieldset className="max-h-40 space-y-2 overflow-auto">
      <legend className="mb-2 font-semibold">Referees</legend>
      {options.referees.map((ref) => (
        <label key={ref.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.includes(ref.id)}
            onChange={() => onChange(toggle(value, ref.id))}
          />
          {ref.username}
        </label>
      ))}
    </fieldset>
  );
}

function CreateSessions({
  options,
  lobbies,
  close,
  reload,
}: {
  options: Options;
  lobbies: QualifierView[];
  close: () => void;
  reload: () => Promise<unknown>;
}) {
  const { run, busy, notify } = useTask();
  const [form, setForm] = useState({
    stageId: '',
    prefix: 'Q',
    firstNumber: 1,
    count: 3,
    entrantsPerLobby: 8,
    startAt: '',
    intervalMinutes: 60,
    refereeIds: [] as string[],
    teamIds: [] as string[],
    format: options.teams.some((team) => team.format === 'TEAM') ? 'TEAM' : 'INDIVIDUAL',
  });
  const [preview, setPreview] = useState<NewQualifierSession[] | null>(null);
  useUnsaved(!!preview || !!form.stageId);
  const stage = options.qualifierStages?.find((stage) => stage.id === form.stageId);
  const available = options.teams.filter(
    (team) =>
      team.format === form.format &&
      !lobbies.some(
        (lobby) =>
          lobby.stage.id === form.stageId &&
          lobby.status !== 'CANCELLED' &&
          lobby.participants.some((entrant) => entrant.id === team.id),
      ),
  );
  const selectable = available.filter(
    (team) => !stage || (team.startingPlayers ?? 0) >= stage.policy.requiredPlayers,
  );
  const capacity = Math.min(
    16,
    Math.floor(16 / (stage?.policy.requiredPlayers || 1)),
    form.teamIds.some((id) => options.teams.find((team) => team.id === id)?.format !== 'INDIVIDUAL')
      ? 8
      : 16,
  );
  const build = () => {
    try {
      if (form.entrantsPerLobby > capacity)
        throw new Error(
          `This stage and entrant format allow at most ${capacity} entrants per session.`,
        );
      const sessions = qualifierSessionPlan({
        ...form,
        startAt: form.startAt ? new Date(form.startAt).toISOString() : null,
      });
      const codes = new Set(lobbies.map((lobby) => lobby.code));
      if (sessions.some((session) => codes.has(session.code)))
        throw new Error('A lobby code is already in use. Change the prefix or first number.');
      setPreview(sessions);
    } catch (error) {
      notify((error as Error).message, true);
    }
  };
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!preview) {
          build();
          return;
        }
        void run(async () => {
          await action({ type: 'qualifier.batch.create', sessions: preview });
          await reload();
          close();
        }, `${preview.length} qualifier sessions created.`);
      }}
    >
      {!preview ? (
        <>
          <div className="grid-fields">
            <Field label="Entrant format">
              <select
                value={form.format}
                onChange={(event) => setForm({ ...form, format: event.target.value, teamIds: [] })}
              >
                <option value="TEAM">Teams</option>
                <option value="INDIVIDUAL">Individuals</option>
              </select>
            </Field>
            <Field label="Qualifier stage">
              <select
                required
                value={form.stageId}
                onChange={(event) =>
                  setForm({
                    ...form,
                    stageId: event.target.value,
                    teamIds: [],
                    entrantsPerLobby: Math.min(
                      form.entrantsPerLobby,
                      Math.floor(
                        16 /
                          (options.qualifierStages?.find((stage) => stage.id === event.target.value)
                            ?.policy.requiredPlayers || 1),
                      ),
                    ),
                  })
                }
              >
                <option value="">Select stage</option>
                {options.stages
                  .filter((stage) => stage.kind === 'QUALIFIERS' && stage.published)
                  .map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Lobby prefix">
              <input
                required
                maxLength={71}
                value={form.prefix}
                onChange={(event) => setForm({ ...form, prefix: event.target.value })}
              />
            </Field>
            <Field label="First lobby number">
              <input
                type="number"
                min={1}
                max={1000000}
                value={form.firstNumber}
                onChange={(event) => setForm({ ...form, firstNumber: event.target.valueAsNumber })}
              />
            </Field>
            <Field label="Number of sessions">
              <input
                type="number"
                min={1}
                max={50}
                value={form.count}
                onChange={(event) => setForm({ ...form, count: event.target.valueAsNumber })}
              />
            </Field>
            <Field label="Entrants per session">
              <input
                type="number"
                min={1}
                max={capacity}
                value={form.entrantsPerLobby}
                onChange={(event) =>
                  setForm({ ...form, entrantsPerLobby: event.target.valueAsNumber })
                }
              />
            </Field>
            <Field label="First session time (your timezone)">
              <input
                type="datetime-local"
                value={form.startAt}
                onChange={(event) => setForm({ ...form, startAt: event.target.value })}
              />
            </Field>
            <Field label="Interval (minutes)">
              <input
                type="number"
                min={0}
                max={10080}
                value={form.intervalMinutes}
                onChange={(event) =>
                  setForm({ ...form, intervalMinutes: event.target.valueAsNumber })
                }
              />
            </Field>
          </div>
          {stage && (
            <p className="text-sm text-muted">
              {stage.policy.runs} run(s) · {stage.policy.requiredPlayers} active player(s) per
              entrant · {stage.policy.method.replaceAll('_', ' ')}
            </p>
          )}
          <fieldset className="max-h-52 space-y-2 overflow-auto">
            <legend className="mb-2 font-semibold">
              Entrants ({form.teamIds.length} selected)
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label="Select all available qualifier entrants"
                disabled={!selectable.length}
                checked={
                  !!selectable.length && selectable.every((team) => form.teamIds.includes(team.id))
                }
                onChange={(event) =>
                  setForm({
                    ...form,
                    teamIds: event.target.checked ? selectable.map((team) => team.id) : [],
                  })
                }
              />
              Select all available
            </label>
            {available.map((team) => (
              <label key={team.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.teamIds.includes(team.id)}
                  disabled={!!stage && (team.startingPlayers ?? 0) < stage.policy.requiredPlayers}
                  onChange={() => setForm({ ...form, teamIds: toggle(form.teamIds, team.id) })}
                />
                {team.name}
              </label>
            ))}
          </fieldset>
          <Referees
            options={options}
            value={form.refereeIds}
            onChange={(refereeIds) => setForm({ ...form, refereeIds })}
          />
          <Button type="submit">
            <ListPlus size={16} />
            Preview sessions
          </Button>
        </>
      ) : (
        <>
          <div className="overflow-auto">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Lobby</th>
                  <th>Time</th>
                  <th>Entrants</th>
                  <th>Referee</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((session, index) => (
                  <tr key={index}>
                    <td>
                      <input
                        aria-label={`Lobby code ${index + 1}`}
                        maxLength={80}
                        value={session.code}
                        onChange={(event) =>
                          setPreview(
                            preview.map((row, i) =>
                              i === index ? { ...row, code: event.target.value } : row,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Session time ${index + 1}`}
                        type="datetime-local"
                        value={localDate(session.scheduledAt)}
                        onChange={(event) =>
                          setPreview(
                            preview.map((row, i) =>
                              i === index
                                ? {
                                    ...row,
                                    scheduledAt: event.target.value
                                      ? new Date(event.target.value).toISOString()
                                      : null,
                                  }
                                : row,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="min-w-40">
                      {session.teamIds
                        .map((id) => options.teams.find((team) => team.id === id)?.name)
                        .join(', ') || 'No entrants'}
                    </td>
                    <td>
                      <select
                        aria-label={`Referee for session ${index + 1}`}
                        value={
                          session.refereeIds.length === 1
                            ? session.refereeIds[0]
                            : session.refereeIds.length
                              ? 'multiple'
                              : ''
                        }
                        onChange={(event) =>
                          setPreview(
                            preview.map((row, i) =>
                              i === index
                                ? {
                                    ...row,
                                    refereeIds: event.target.value ? [event.target.value] : [],
                                  }
                                : row,
                            ),
                          )
                        }
                      >
                        <option value="">Unassigned</option>
                        {session.refereeIds.length > 1 && (
                          <option value="multiple" disabled>
                            Multiple referees
                          </option>
                        )}
                        {options.referees.map((ref) => (
                          <option key={ref.id} value={ref.id}>
                            {ref.username}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-3">
            <Button type="button" variant="outline" onClick={() => setPreview(null)}>
              Back
            </Button>
            <SaveButton busy={busy}>Create {preview.length} sessions</SaveButton>
          </div>
        </>
      )}
    </form>
  );
}

function BulkSchedule({
  selected,
  options,
  reload,
  close,
}: {
  selected: QualifierView[];
  options: Options;
  reload: () => Promise<unknown>;
  close: () => void;
}) {
  const { run, busy } = useTask();
  const [schedule, setSchedule] = useState<'keep' | 'set' | 'shift' | 'clear'>('keep');
  const [scheduledAt, setScheduledAt] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [changeRefs, setChangeRefs] = useState(false);
  const [refereeIds, setRefereeIds] = useState<string[]>([]);
  const [changeNotes, setChangeNotes] = useState(false);
  const [notes, setNotes] = useState('');
  const changed = schedule !== 'keep' || changeRefs || changeNotes;
  useUnsaved(changed);
  const [versions] = useState(() =>
    selected.map((lobby) => ({ id: lobby.id, baseVersion: lobby.version })),
  );
  const stale =
    selected.length !== versions.length ||
    selected.some(
      (lobby) => versions.find((row) => row.id === lobby.id)?.baseVersion !== lobby.version,
    );
  const invalid = selected.some((lobby) => lobby.status !== 'SCHEDULED') || stale;
  const mixedRefs =
    new Set(
      selected.map((lobby) =>
        lobby.assignments
          .map((ref) => ref.userId)
          .sort()
          .join(','),
      ),
    ).size > 1;
  const nextDate = (lobby: QualifierView) =>
    schedule === 'clear'
      ? null
      : schedule === 'set'
        ? scheduledAt
          ? new Date(scheduledAt).toISOString()
          : null
        : schedule === 'shift' && lobby.scheduledAt && Number.isFinite(minutes)
          ? new Date(new Date(lobby.scheduledAt).getTime() + minutes * 60_000).toISOString()
          : lobby.scheduledAt;
  const time = useTournamentTime();
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (invalid) return;
        void run(async () => {
          const body: Extract<QualifierAction, { type: 'qualifier.bulk.schedule' }> = {
            type: 'qualifier.bulk.schedule',
            lobbies: versions,
            ...(schedule === 'set' || schedule === 'clear'
              ? { scheduledAt: schedule === 'clear' ? null : new Date(scheduledAt).toISOString() }
              : {}),
            ...(schedule === 'shift' ? { shiftMinutes: minutes } : {}),
            ...(changeRefs ? { refereeIds } : {}),
            ...(changeNotes ? { notes } : {}),
          };
          await action(body);
          await reload();
          close();
        }, `${selected.length} sessions updated.`);
      }}
    >
      {invalid && (
        <p role="alert">
          A selected lobby changed or is no longer scheduled. Close and review the selection.
        </p>
      )}
      <div className="grid-fields">
        <Field label="Schedule">
          <select
            value={schedule}
            onChange={(event) => setSchedule(event.target.value as typeof schedule)}
          >
            <option value="keep">Keep existing times</option>
            <option value="set">Set a start time</option>
            <option value="shift">Shift existing times</option>
            <option value="clear">Clear times</option>
          </select>
        </Field>
        {schedule === 'set' && (
          <Field label="New start time (your timezone)">
            <input
              required
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
            />
          </Field>
        )}
        {schedule === 'shift' && (
          <Field label="Shift (minutes)">
            <input
              required
              type="number"
              min={-525600}
              max={525600}
              value={Number.isFinite(minutes) ? minutes : ''}
              onChange={(event) => setMinutes(event.target.valueAsNumber)}
            />
          </Field>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={changeRefs}
          onChange={(event) => setChangeRefs(event.target.checked)}
        />
        Replace referee assignments{mixedRefs ? ' (currently mixed)' : ''}
      </label>
      {changeRefs && <Referees options={options} value={refereeIds} onChange={setRefereeIds} />}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={changeNotes}
          onChange={(event) => setChangeNotes(event.target.checked)}
        />
        Replace notes
      </label>
      {changeNotes && (
        <Field label="New session notes">
          <textarea
            maxLength={4000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
      )}
      <div className="max-h-56 overflow-auto">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Lobby</th>
              <th>New time</th>
              <th>Referees</th>
            </tr>
          </thead>
          <tbody>
            {selected.map((lobby) => (
              <tr key={lobby.id}>
                <td>{lobby.code}</td>
                <td>{time(nextDate(lobby))}</td>
                <td>
                  {changeRefs
                    ? refereeIds
                        .map((id) => options.referees.find((ref) => ref.id === id)?.username)
                        .join(', ') || 'Unassigned'
                    : lobby.assignments.map((ref) => ref.user.username).join(', ') || 'Unassigned'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SaveButton
        busy={busy}
        disabled={
          !changed ||
          invalid ||
          (schedule === 'shift' &&
            (!Number.isInteger(minutes) ||
              !minutes ||
              selected.some((lobby) => !lobby.scheduledAt)))
        }
      >
        Apply to {selected.length} sessions
      </SaveButton>
    </form>
  );
}

function MoveEntrants({
  options,
  lobbies,
  reload,
  close,
}: {
  options: Options;
  lobbies: QualifierView[];
  reload: () => Promise<unknown>;
  close: () => void;
}) {
  const { run, busy } = useTask();
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [versions, setVersions] = useState<Record<string, number>>({});
  const source = lobbies.find((lobby) => lobby.id === sourceId);
  const target = lobbies.find((lobby) => lobby.id === targetId);
  const unstarted = lobbies.filter((lobby) => lobby.canTransfer);
  const candidates = source
    ? source.participants
    : options.teams.filter(
        (team) =>
          target &&
          !lobbies.some(
            (lobby) =>
              lobby.stage.id === target.stage.id &&
              lobby.status !== 'CANCELLED' &&
              lobby.participants.some((entrant) => entrant.id === team.id),
          ),
      );
  const nextCount = (target?.participants.length || 0) + teamIds.length;
  const activePlayers = nextCount * (target?.policy.requiredPlayers || 1);
  const combined = target
    ? [...target.participants, ...candidates.filter((team) => teamIds.includes(team.id!))]
    : [];
  const overCapacity =
    activePlayers > 16 ||
    nextCount > (combined.every((team) => team.format === 'INDIVIDUAL') ? 16 : 8);
  const mixed =
    target &&
    new Set(
      [...target.participants, ...candidates.filter((team) => teamIds.includes(team.id!))].map(
        (team) => team.format === 'INDIVIDUAL',
      ),
    ).size > 1;
  const stale = [source, target].some((lobby) => lobby && versions[lobby.id] !== lobby.version);
  useUnsaved(teamIds.length > 0);
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!target || !teamIds.length || stale) return;
        void run(async () => {
          await action({
            type: 'qualifier.participants.move',
            fromLobbyId: sourceId || null,
            ...(source ? { sourceVersion: versions[source.id] } : {}),
            toLobbyId: target.id,
            baseVersion: versions[target.id],
            teamIds,
          });
          await reload();
          close();
        }, `${teamIds.length} entrants assigned.`);
      }}
    >
      <div className="grid-fields">
        <Field label="From">
          <select
            value={sourceId}
            onChange={(event) => {
              const lobby = lobbies.find((lobby) => lobby.id === event.target.value);
              setSourceId(event.target.value);
              setTargetId('');
              setTeamIds([]);
              setVersions(lobby ? { [lobby.id]: lobby.version } : {});
            }}
          >
            <option value="">Unassigned entrants</option>
            {unstarted.map((lobby) => (
              <option key={lobby.id} value={lobby.id}>
                {lobby.code} · {lobby.stage.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="To">
          <select
            required
            value={targetId}
            onChange={(event) => {
              const lobby = lobbies.find((lobby) => lobby.id === event.target.value);
              setTargetId(event.target.value);
              setTeamIds([]);
              if (lobby) setVersions({ ...versions, [lobby.id]: lobby.version });
            }}
          >
            <option value="">Choose a session</option>
            {unstarted
              .filter(
                (lobby) =>
                  lobby.id !== sourceId &&
                  (!source ||
                    (lobby.stage.id === source.stage.id &&
                      lobby.poolRevision.id === source.poolRevision.id)),
              )
              .map((lobby) => (
                <option key={lobby.id} value={lobby.id}>
                  {lobby.code} · {lobby.stage.name}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <fieldset className="max-h-56 space-y-2 overflow-auto">
        <legend className="mb-2 font-semibold">Entrants ({teamIds.length} selected)</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            aria-label="Select all source entrants"
            disabled={!candidates.length}
            checked={!!candidates.length && candidates.every((team) => teamIds.includes(team.id!))}
            onChange={(event) =>
              setTeamIds(event.target.checked ? candidates.map((team) => team.id!) : [])
            }
          />
          Select all
        </label>
        {candidates.map((team) => (
          <label key={team.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={teamIds.includes(team.id!)}
              onChange={() => setTeamIds(toggle(teamIds, team.id!))}
            />
            {team.name}
          </label>
        ))}
      </fieldset>
      {target && (
        <p className="text-sm">
          {target.code}: {nextCount} entrants · {activePlayers}/16 active players
        </p>
      )}
      {(stale || mixed || overCapacity) && (
        <p role="alert">
          {stale
            ? 'A session changed. Reopen this form.'
            : mixed
              ? 'Team and individual entrants need separate sessions.'
              : 'The destination exceeds its entrant or sixteen-player capacity.'}
        </p>
      )}
      <SaveButton
        busy={busy}
        disabled={!target || !teamIds.length || stale || !!mixed || overCapacity}
      >
        Assign {teamIds.length} entrants
      </SaveButton>
    </form>
  );
}

export function QualifierLobbyList({
  actor,
  data,
  reload,
}: {
  actor: Actor;
  data: QualifierData;
  reload: () => Promise<unknown>;
}) {
  const time = useTournamentTime();
  const { timezone = 'UTC' } = useTournamentScope();
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const [dialog, setDialog] = useState<'create' | 'schedule' | 'move' | null>(null);
  const manager = actor.permissions.includes('matches.manage');
  const scheduler = manager || actor.permissions.includes('matches.assign_referees');
  const visible = data.lobbies.filter(
    (lobby) =>
      (!filter ||
        (filter === 'me'
          ? lobby.assignments.some((ref) => ref.userId === actor.id)
          : filter === 'unassigned'
            ? !lobby.assignments.length
            : lobby.status === filter)) &&
      `${lobby.code} ${lobby.stage.name} ${lobby.assignments.map((ref) => ref.user.username).join(' ')} ${lobby.participants.map((team) => team.name).join(' ')}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const chosen = visible.filter((lobby) => selected.includes(lobby.id));
  const eligible = visible.filter((lobby) => lobby.status === 'SCHEDULED');
  const close = () => {
    setDialog(null);
    setSelected([]);
  };
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          className="max-w-sm"
          aria-label="Search qualifier lobbies"
          placeholder="Search lobbies, entrants, referees"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected([]);
            anchor.current = null;
          }}
        />
        <select
          aria-label="Filter qualifier lobbies"
          className="max-w-xs"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            setSelected([]);
            anchor.current = null;
          }}
        >
          <option value="">All qualifier lobbies</option>
          <option value="me">My assigned lobbies</option>
          <option value="unassigned">Unassigned</option>
          {[
            'SCHEDULED',
            'IN_PROGRESS',
            'AWAITING_CONFIRMATION',
            'COMPLETED',
            'DISPUTED',
            'CANCELLED',
          ].map((status) => (
            <option key={status} value={status}>
              {status.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
        {manager && data.options && (
          <>
            <Button
              variant="outline"
              disabled={data.options.scoringNeedsReview}
              onClick={() => setDialog('create')}
            >
              <ListPlus size={16} />
              Create several sessions
            </Button>
            <Button variant="outline" onClick={() => setDialog('move')}>
              <ArrowRightLeft size={16} />
              Assign entrants
            </Button>
          </>
        )}
      </div>
      {!!chosen.length && (
        <div
          role="toolbar"
          aria-label="Qualifier bulk actions"
          className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 text-sm"
        >
          <span>{chosen.length} visible sessions selected</span>
          <Button variant="outline" onClick={() => setDialog('schedule')}>
            <CalendarClock size={16} />
            Edit schedule and assignments
          </Button>
          <Button
            size="icon"
            variant="ghost"
            title="Clear selection"
            aria-label="Clear qualifier selection"
            onClick={() => setSelected([])}
          >
            <X size={16} />
          </Button>
        </div>
      )}
      <p className="mb-3 text-sm text-muted">
        {visible.length} of {data.lobbies.length} lobbies ·{' '}
        {data.lobbies.filter((lobby) => lobby.status === 'IN_PROGRESS').length} in progress
      </p>
      <div className="overflow-auto">
        <table className="admin-table">
          <thead>
            <tr>
              {scheduler && (
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all visible scheduled qualifier sessions"
                    disabled={!eligible.length}
                    checked={
                      !!eligible.length && eligible.every((lobby) => selected.includes(lobby.id))
                    }
                    onChange={(event) =>
                      setSelected(event.target.checked ? eligible.map((lobby) => lobby.id) : [])
                    }
                  />
                </th>
              )}
              <th>Lobby</th>
              <th>Stage</th>
              <th>Entrants</th>
              <th>Schedule ({timezone})</th>
              <th>Referees</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((lobby) => (
              <tr key={lobby.id} aria-selected={selected.includes(lobby.id)}>
                {scheduler && (
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select qualifier ${lobby.code}`}
                      disabled={lobby.status !== 'SCHEDULED'}
                      checked={selected.includes(lobby.id)}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        if (
                          event.nativeEvent instanceof MouseEvent &&
                          event.nativeEvent.shiftKey &&
                          anchor.current
                        ) {
                          const start = visible.findIndex((row) => row.id === anchor.current),
                            end = visible.findIndex((row) => row.id === lobby.id);
                          const range = visible
                            .slice(Math.min(start, end), Math.max(start, end) + 1)
                            .filter((row) => row.status === 'SCHEDULED')
                            .map((row) => row.id);
                          setSelected(
                            checked
                              ? [...new Set([...selected, ...range])]
                              : selected.filter((id) => !range.includes(id)),
                          );
                        } else
                          setSelected(
                            checked
                              ? [...selected, lobby.id]
                              : selected.filter((id) => id !== lobby.id),
                          );
                        anchor.current = lobby.id;
                      }}
                    />
                  </td>
                )}
                <td>
                  <Link className="text-primary" href={`/admin/referee/qualifiers/${lobby.id}`}>
                    {lobby.code}
                  </Link>
                </td>
                <td>{lobby.stage.name}</td>
                <td>{lobby.participants.map((team) => team.name).join(', ') || 'No entrants'}</td>
                <td>{time(lobby.scheduledAt)}</td>
                <td>
                  {lobby.assignments.map((ref) => ref.user.username).join(', ') || 'Unassigned'}
                </td>
                <td>{lobby.status.replaceAll('_', ' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visible.length && <p className="py-8 text-muted">No matching qualifier lobbies.</p>}
      <Modal
        open={!!dialog}
        onOpenChange={(open) => {
          if (!open && window.confirm('Close this form and discard unsaved changes?'))
            setDialog(null);
        }}
        title={
          dialog === 'create'
            ? 'Create qualifier sessions'
            : dialog === 'move'
              ? 'Assign qualifier entrants'
              : 'Bulk qualifier schedule'
        }
        wide
      >
        {data.options && dialog === 'create' && (
          <CreateSessions
            options={data.options}
            lobbies={data.lobbies}
            reload={reload}
            close={close}
          />
        )}
        {data.options && dialog === 'schedule' && (
          <BulkSchedule selected={chosen} options={data.options} reload={reload} close={close} />
        )}
        {data.options && dialog === 'move' && (
          <MoveEntrants
            options={data.options}
            lobbies={data.lobbies}
            reload={reload}
            close={close}
          />
        )}
      </Modal>
    </>
  );
}
