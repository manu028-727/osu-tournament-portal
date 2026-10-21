'use client';
import Link from '@/components/tournament-scope';
import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Plus,
  SlidersHorizontal,
  Play,
  Users,
  Pencil,
  RefreshCw,
  Trash2,
  Link2,
} from 'lucide-react';
import { DeleteMatchDialog, type DeleteMatchSelection } from './delete-match-dialog';
import { Button } from '../ui/button';
import { MatchStatusBadge } from '../ui/badge';
import { can, type Actor } from '@/lib/permissions';
import { matchAccess } from '@/lib/match-access';
import type { MatchListData, MatchSummary } from '@/lib/matches-types';
import { type MatchRules } from '@/lib/match-rules';
import { matchCredits } from '@/lib/match-display';
import { useTournamentTime, useTournamentScope } from '@/components/tournament-scope';
export { matchTime } from '@/lib/match-display';
import { MatchRulesFields } from './match-rules-fields';
import { RefereeSheetImporter } from './referee-sheet-importer';
import { StageReconciliation } from './stage-reconciliation';
import {
  action,
  Field,
  LoadingState,
  Modal,
  SaveButton,
  SectionTitle,
  useResource,
  useTask,
  useUnsaved,
  usePolling,
} from './shared';
export const MATCH_STATUS_LABELS = {
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In progress',
  AWAITING_CONFIRMATION: 'Awaiting confirmation',
  COMPLETED: 'Completed',
  DISPUTED: 'Disputed',
  CANCELLED: 'Cancelled',
};
export function MatchesDashboard({ actor }: { actor: Actor }) {
  const [filters, setFilters] = useState({
    stage: '',
    status: '',
    assigned: '',
    date: '',
    time: '',
    q: '',
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = [
    filters.stage,
    filters.status,
    filters.assigned,
    filters.date,
    filters.date ? filters.time : '',
  ].filter(Boolean).length;
  const [deleting, setDeleting] = useState<DeleteMatchSelection | null>(null);
  const params = new URLSearchParams();
  for (const key of ['stage', 'status', 'assigned', 'q'] as const)
    if (filters[key]) params.set(key, filters[key]);
  if (filters.date) {
    const from = new Date(`${filters.date}T${filters.time || '00:00'}:00`),
      to = filters.time
        ? new Date(from.getTime() + 59999)
        : new Date(`${filters.date}T23:59:59.999`);
    params.set('from', from.toISOString());
    params.set('to', to.toISOString());
  }
  const matchTime = useTournamentTime();
  const { timezone } = useTournamentScope();
  const { data, error, reload } = useResource<MatchListData>(`matches&${params}`, true);
  const { run, busy } = useTask();
  const [lobby, setLobby] = useState<{
    id: string;
    code: string;
    version: number;
    url: string;
  } | null>(null);
  const query = useSearchParams(),
    rulesOpened = useRef(false);
  const [create, setCreate] = useState(false),
    [code, setCode] = useState(''),
    [stageId, setStageId] = useState(''),
    [teamAId, setTeamA] = useState(''),
    [teamBId, setTeamB] = useState(''),
    [scheduledAt, setScheduled] = useState(''),
    [bestOf, setBestOf] = useState(11),
    [refereeIds, setReferees] = useState<string[]>([]),
    [notes, setNotes] = useState(''),
    [published, setPublished] = useState(false),
    [edit, setEdit] = useState<MatchSummary | null>(null);
  const [pathId, setPathId] = useState(''),
    [allowIneligible, setAllowIneligible] = useState(false),
    [overrideReason, setOverrideReason] = useState('');
  const [ruleEditor, setRuleEditor] = useState(false),
    [ruleStage, setRuleStage] = useState(''),
    [rules, setRules] = useState<MatchRules | null>(null),
    [baseHash, setBaseHash] = useState(''),
    [dirty, setDirty] = useState(false);
  useUnsaved(dirty);
  usePolling(reload, 10000, !create && !ruleEditor && !edit && !lobby);
  const options = data?.options;
  useEffect(() => {
    if (
      options &&
      query.get('rules') === '1' &&
      can(actor, 'matches.manage') &&
      !rulesOpened.current
    ) {
      rulesOpened.current = true;
      setRules(options.defaults);
      setBaseHash(options.defaultsHash);
      setRuleEditor(true);
    }
  }, [options, query, actor]);
  const chooseRules = (id: string) => {
    if (!options) return;
    const stage = options.stages.find((s) => s.id === id);
    setRuleStage(id);
    setRules(stage?.rules || options.defaults);
    setBaseHash(stage ? stage.rulesHash : options.defaultsHash);
    setDirty(false);
  };
  const begin = (match?: MatchSummary) => {
    setPathId('');
    setAllowIneligible(false);
    setOverrideReason('');
    setCode(data?.nextCode || '');
    const first = options?.stages.filter((stage) => stage.published && stage.kind !== 'QUALIFIERS');
    setStageId(first?.length === 1 ? first[0].id : '');
    setTeamA(match?.participants.A.id || '');
    setTeamB(match?.participants.B.id || '');
    setScheduled(
      match?.scheduledAt
        ? new Date(
            new Date(match.scheduledAt).getTime() -
              new Date(match.scheduledAt).getTimezoneOffset() * 60000,
          )
            .toISOString()
            .slice(0, 16)
        : '',
    );
    setReferees(match?.assignments.map((r) => r.userId) || []);
    setNotes(match?.notes || '');
    setPublished(match?.published || false);
    setBestOf(
      (first?.length === 1 ? first[0].rules?.bestOf : undefined) || options?.defaults.bestOf || 11,
    );
    setEdit(match || null);
    setCreate(true);
    setDirty(false);
  };
  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  const paths = options?.paths?.filter((p) => p.stageIds.includes(stageId)) || [];
  const path = paths.find((p) => p.id === pathId) || (paths.length === 1 ? paths[0] : null);
  const eligibleTeams =
    options?.teams.filter(
      (t) => allowIneligible || !path || path.teams.some((e) => e.teamId === t.id && e.eligible),
    ) || [];
  const stats = [
    ['SCHEDULED', 'Upcoming'],
    ['IN_PROGRESS', 'Live'],
    ['AWAITING_CONFIRMATION', 'To confirm'],
    ['COMPLETED', 'Completed'],
  ] as const;
  const matchActions = (m: MatchSummary) => (
    <div className="flex gap-1">
      <Button asChild size="sm" variant="outline">
        <Link
          href={`/admin/referee/${m.id}`}
          aria-label={`Open match ${m.code}`}
          title={
            matchAccess(actor, m).editable
              ? 'Referee this match'
              : 'View match history and live state'
          }
        >
          <Play size={17} />
          {matchAccess(actor, m).editable ? 'Referee' : 'View'}
        </Link>
      </Button>
      {matchAccess(actor, m).operate && !['COMPLETED', 'CANCELLED'].includes(m.status) && (
        <Button
          size="icon"
          variant="ghost"
          title="Multiplayer link"
          aria-label={`Multiplayer link for ${m.code}`}
          onClick={() =>
            setLobby({ id: m.id, code: m.code, version: m.version, url: m.lobbyUrl || '' })
          }
        >
          <Link2 size={17} />
        </Button>
      )}
      {matchAccess(actor, m).schedule && !['COMPLETED', 'CANCELLED'].includes(m.status) && (
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Assign ${m.code}`}
          title="Schedule and referee assignments"
          onClick={() => begin(m)}
        >
          <Pencil size={17} />
        </Button>
      )}
      {can(actor, 'matches.delete') && (
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Delete match ${m.code}`}
          title="Permanently delete match"
          onClick={() => setDeleting({ id: m.id, code: m.code, version: m.version })}
        >
          <Trash2 size={17} className="text-red-200" />
        </Button>
      )}
    </div>
  );
  return (
    <>
      <SectionTitle
        title="Matches"
        description={
          can(actor, 'matches.manage') || can(actor, 'matches.view_all')
            ? `Tournament matches · ${timezone || 'UTC'}`
            : `Your assigned matches · ${timezone || 'UTC'}`
        }
      >
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/referee/qualifiers">Qualifier lobbies</Link>
          </Button>
          <Button
            size="icon"
            variant="outline"
            aria-label="Refresh matches"
            title="Refresh matches"
            onClick={() => void reload().catch(() => {})}
          >
            <RefreshCw size={18} />
          </Button>
          {can(actor, 'matches.manage') && (
            <>
              <Button size="sm" disabled={options?.scoringNeedsReview} onClick={() => begin()}>
                <Plus size={17} />
                New match
              </Button>
            </>
          )}
        </div>
      </SectionTitle>
      {options?.scoringNeedsReview && (
        <p className="mb-4 text-sm text-muted">
          Historical matches remain accessible.{' '}
          <Link className="text-primary" href="/admin/settings">
            Review tournament gameplay scoring
          </Link>{' '}
          before creating new competition records.
        </p>
      )}
      {(can(actor, 'matches.import') || can(actor, 'matches.manage')) && (
        <details className="mb-4 border-b pb-2">
          <summary className="min-h-11 cursor-pointer py-2 text-sm text-muted">
            Import & rule presets
          </summary>
          <div className="flex flex-wrap gap-2 pb-3">
            {can(actor, 'matches.import') && <RefereeSheetImporter onChanged={reload} />}{' '}
            {can(actor, 'matches.manage') && <StageReconciliation onChanged={reload} />}
            {can(actor, 'matches.manage') && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  chooseRules('');
                  setRuleEditor(true);
                }}
              >
                <SlidersHorizontal size={17} />
                Match rules
              </Button>
            )}
          </div>
        </details>
      )}
      <p className="mb-3 text-sm text-muted">
        {Object.values(data.counts).reduce((sum, n) => sum + (n || 0), 0)} matches ·{' '}
        {data.counts.IN_PROGRESS || 0} in progress · {data.matches.length} shown
      </p>
      <div
        role="group"
        aria-label="Match views"
        className="mb-5 flex flex-wrap gap-2 border-b pb-4"
      >
        <Button
          variant="outline"
          size="sm"
          aria-pressed={!filters.status && !filters.assigned}
          className="aria-pressed:border-primary/40 aria-pressed:bg-primary/10 aria-pressed:text-primary"
          onClick={() => setFilters({ ...filters, status: '', assigned: '' })}
        >
          All Matches
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={filters.assigned === 'me'}
          className="aria-pressed:border-primary/40 aria-pressed:bg-primary/10 aria-pressed:text-primary"
          onClick={() => setFilters({ ...filters, status: '', assigned: 'me' })}
        >
          My Matches
        </Button>
        {stats.map(([status, label]) => (
          <Button
            key={status}
            variant="outline"
            size="sm"
            aria-pressed={filters.status === status}
            className="aria-pressed:border-primary/40 aria-pressed:bg-primary/10 aria-pressed:text-primary"
            onClick={() => setFilters({ ...filters, status, assigned: '' })}
          >
            {label} · {data.counts[status] || 0}
          </Button>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mb-3 sm:hidden"
        aria-expanded={filtersOpen}
        aria-controls="match-filters"
        onClick={() => setFiltersOpen(!filtersOpen)}
      >
        <SlidersHorizontal size={16} />
        {filtersOpen ? 'Hide filters' : 'Filters'}
        {activeFilters ? ` (${activeFilters})` : ''}
      </Button>
      <div
        id="match-filters"
        className={`match-filters mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5 ${filtersOpen ? 'filters-open' : ''}`}
      >
        <Field label="Search matches">
          <input
            type="search"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          />
        </Field>
        <Field label="Stage">
          <select
            value={filters.stage}
            onChange={(e) => setFilters({ ...filters, stage: e.target.value })}
          >
            <option value="">All stages</option>
            {data.stages.map((s) => (
              <option value={s.id} key={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Match status">
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="">All statuses</option>
            {Object.entries(MATCH_STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Match date">
          <input
            type="date"
            value={filters.date}
            onChange={(e) => setFilters({ ...filters, date: e.target.value })}
          />
        </Field>
        <Field label="Match time">
          <input
            type="time"
            disabled={!filters.date}
            value={filters.time}
            onChange={(e) => setFilters({ ...filters, time: e.target.value })}
          />
        </Field>
        <Field label="Assigned referee">
          <select
            value={filters.assigned}
            onChange={(e) => setFilters({ ...filters, assigned: e.target.value })}
          >
            <option value="">All Matches</option>
            <option value="me">My Assigned Matches</option>
            <option value="unassigned">Unassigned Matches</option>
            {options?.referees
              .filter((r) => r.id !== actor.id)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.username}
                </option>
              ))}
          </select>
        </Field>
      </div>
      {data.matches.length ? (
        <>
          <div className="border-t md:hidden">
            {data.matches.map((m) => (
              <article key={m.id} className="border-b py-4" aria-label={`Match ${m.code}`}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <Link
                    href={`/admin/referee/${m.id}`}
                    className="min-w-0 max-w-full break-words font-mono text-primary"
                  >
                    #{m.code} · {m.stage.name}
                  </Link>
                  <MatchStatusBadge status={m.status}>
                    {MATCH_STATUS_LABELS[m.status]}
                  </MatchStatusBadge>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <Link href={`/admin/referee/${m.id}`} className="min-w-0 space-y-1 font-semibold">
                    <p className="text-red-200">{m.participants.A.name}</p>
                    <p className="text-sky-200">{m.participants.B.name}</p>
                  </Link>
                  <p className="whitespace-nowrap font-mono text-xl tabular-nums">
                    {m.scoreA} : {m.scoreB}
                  </p>
                </div>
                <p className="mt-2 text-xs text-muted">
                  {matchTime(m.scheduledAt)}
                  {m.bracket ? ' · ' + m.bracket : ''}
                </p>
                <div className="mt-3 flex flex-col items-start gap-3">
                  <p className="min-w-0 break-words text-xs text-muted">
                    {m.assignments.map((r) => r.user.username).join(', ') ||
                      matchCredits(m.source).referee ||
                      'Unassigned'}
                    <span className="mt-1 block">{m.published ? 'Public' : 'Private'}</span>
                  </p>
                  {matchActions(m)}
                </div>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Match</th>
                  <th>Stage / date</th>
                  <th>Teams</th>
                  <th>Score</th>
                  <th>Referees</th>
                  <th>Status</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {data.matches.map((m) => (
                  <tr key={m.id}>
                    <td className="font-semibold">{m.code}</td>
                    <td>
                      <p>
                        {m.stage.name}
                        {m.bracket ? ` · ${m.bracket}` : ''}
                      </p>
                      <p className="whitespace-nowrap text-xs text-muted">
                        {matchTime(m.scheduledAt)}
                      </p>
                      {m.lobbyUrl && (
                        <a
                          href={m.lobbyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary"
                        >
                          MP link
                        </a>
                      )}
                    </td>
                    <td className="min-w-40">
                      <p className="text-red-200">{m.participants.A.name}</p>
                      <p className="text-sky-200">{m.participants.B.name}</p>
                    </td>
                    <td className="whitespace-nowrap font-semibold">
                      {m.scoreA} : {m.scoreB}
                    </td>
                    <td>
                      {matchCredits(m.source).referee && (
                        <p className="text-xs">{matchCredits(m.source).referee} · Sheet</p>
                      )}
                      {m.assignments.map((r) => (
                        <p key={r.userId} className="text-xs">
                          {r.user.username}
                          {r.primary ? ' · Lead' : ''}
                        </p>
                      ))}
                    </td>
                    <td>
                      <MatchStatusBadge status={m.status}>
                        {MATCH_STATUS_LABELS[m.status]}
                      </MatchStatusBadge>
                      <p className="mt-1 text-xs text-muted">
                        {m.published ? 'Public' : 'Private'}
                      </p>
                    </td>
                    <td>{matchActions(m)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="border-y py-16 text-center text-muted">
          <Users size={30} className="mx-auto mb-4" />
          No matches found.
        </div>
      )}
      <DeleteMatchDialog match={deleting} onClose={() => setDeleting(null)} onDeleted={reload} />
      <Modal
        open={create}
        onOpenChange={(open) => {
          if (!open && (!dirty || window.confirm('Discard unsaved match changes?'))) {
            setCreate(false);
            setEdit(null);
            setDirty(false);
          }
        }}
        title={edit ? 'Schedule & assignment' : 'New match'}
        wide
      >
        {options && (
          <form
            className="space-y-6"
            onChange={() => setDirty(true)}
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                async () => {
                  const response = await action<{ id: string }>(
                    edit
                      ? {
                          type: 'match.schedule',
                          id: edit.id,
                          baseVersion: edit.version,
                          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
                          refereeIds,
                          notes,
                          ...(can(actor, 'matches.manage') ? { published } : {}),
                          ...(edit.status === 'SCHEDULED' && can(actor, 'matches.manage')
                            ? { teamAId: teamAId || undefined, teamBId: teamBId || undefined }
                            : {}),
                        }
                      : {
                          type: 'match.create',
                          bracketId: path?.id,
                          allowIneligible,
                          overrideReason,
                          code,
                          stageId,
                          teamAId,
                          teamBId,
                          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
                          refereeIds,
                          notes,
                          published,
                        },
                  );
                  setDirty(false);
                  setCreate(false);
                  setEdit(null);
                  await reload();
                  return response;
                },
                edit ? 'Match assignment saved.' : 'Match scheduled.',
              );
            }}
          >
            <div className="grid-fields">
              {!edit && (
                <>
                  <Field label="Match code">
                    <input
                      required
                      maxLength={80}
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </Field>
                  <Field label="Tournament stage">
                    <select
                      required
                      value={stageId}
                      onChange={(e) => {
                        const stage = options.stages.find((s) => s.id === e.target.value);
                        setStageId(e.target.value);
                        setPathId('');
                        setTeamA('');
                        setTeamB('');
                        setBestOf((stage?.rules || options.defaults).bestOf);
                      }}
                    >
                      <option value="">Select stage</option>
                      {options.stages
                        .filter((s) => s.published && s.kind !== 'QUALIFIERS')
                        .map((s) => (
                          <option value={s.id} key={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Team A / red">
                    <select required value={teamAId} onChange={(e) => setTeamA(e.target.value)}>
                      <option value="">Select approved entry</option>
                      {eligibleTeams.map((t) => (
                        <option value={t.id} key={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Team B / blue">
                    <select required value={teamBId} onChange={(e) => setTeamB(e.target.value)}>
                      <option value="">Select approved entry</option>
                      {eligibleTeams
                        .filter((t) => t.id !== teamAId)
                        .map((t) => (
                          <option value={t.id} key={t.id}>
                            {t.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  {paths.length > 0 && (
                    <Field label="Competition path">
                      <select
                        value={path?.id || ''}
                        required={!allowIneligible}
                        onChange={(e) => {
                          setPathId(e.target.value);
                          setTeamA('');
                          setTeamB('');
                        }}
                      >
                        <option value="">Select competition path</option>
                        {paths.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {paths.length > 0 && (
                    <label className="flex items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={allowIneligible}
                        onChange={(e) => setAllowIneligible(e.target.checked)}
                      />
                      Allow ineligible participants (exhibition or custom match)
                    </label>
                  )}
                  {path && path.teams.some((team) => !team.eligible) && (
                    <details className="text-sm text-muted">
                      <summary>Unavailable participants</summary>
                      <ul className="mt-2 space-y-1">
                        {path.teams
                          .filter((team) => !team.eligible)
                          .map((team) => (
                            <li key={team.teamId}>
                              {options.teams.find((t) => t.id === team.teamId)?.name || team.teamId}
                              : {team.reason}
                            </li>
                          ))}
                      </ul>
                    </details>
                  )}
                  {allowIneligible && (
                    <Field label="Eligibility override reason">
                      <textarea
                        required
                        minLength={3}
                        maxLength={2000}
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value)}
                      />
                    </Field>
                  )}
                  <p className="self-end py-3 text-sm text-muted">
                    Best of {bestOf} · Inherited from stage rules
                  </p>
                </>
              )}
              <Field label="Scheduled time (your timezone)">
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduled(e.target.value)}
                  disabled={!!edit && edit.status !== 'SCHEDULED'}
                />
              </Field>
            </div>
            {edit?.status === 'SCHEDULED' && can(actor, 'matches.manage') && (
              <div className="grid-fields">
                {(['A', 'B'] as const).map((side) => (
                  <Field key={side} label={side === 'A' ? 'Red opponent' : 'Blue opponent'}>
                    <select
                      value={side === 'A' ? teamAId : teamBId}
                      onChange={(e) =>
                        side === 'A' ? setTeamA(e.target.value) : setTeamB(e.target.value)
                      }
                    >
                      <option value="">
                        {edit.participants[side].id ? 'Keep current' : 'Unresolved'} ·{' '}
                        {edit.participants[side].name}
                      </option>
                      {options.teams.map((t) => (
                        <option value={t.id} key={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                ))}
              </div>
            )}
            {can(actor, 'matches.manage') && (
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={published}
                  onChange={(e) => setPublished(e.target.checked)}
                />
                Public match
              </label>
            )}
            <fieldset className="border-t pt-5">
              <legend className="text-lg font-semibold">Referee assignments</legend>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {options.referees.map((r) => (
                  <label key={r.id} className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={refereeIds.includes(r.id)}
                      onChange={(e) =>
                        setReferees(
                          e.target.checked
                            ? [...refereeIds, r.id]
                            : refereeIds.filter((id) => id !== r.id),
                        )
                      }
                    />
                    <span className="min-w-0 break-words">
                      {r.username}
                      {refereeIds[0] === r.id ? ' · Lead' : ''}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="Match notes">
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            {!edit && !options.stages.some((s) => s.published) && (
              <p className="text-sm text-muted">
                A published mappool is required.{' '}
                <Link className="text-primary" href="/admin/mappools">
                  Stages & mappools
                </Link>
              </p>
            )}
            {!edit && options.teams.length < 2 && (
              <p className="text-sm text-muted">
                Two approved entries are required.{' '}
                <Link className="text-primary" href="/admin/teams">
                  Teams & players
                </Link>
              </p>
            )}
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (!dirty || window.confirm('Discard unsaved match changes?')) {
                    setCreate(false);
                    setEdit(null);
                    setDirty(false);
                  }
                }}
              >
                Cancel
              </Button>
              <SaveButton busy={busy}>Save match</SaveButton>
            </div>
          </form>
        )}
      </Modal>
      <Modal
        title={`Multiplayer link · ${lobby?.code || ''}`}
        open={!!lobby}
        onOpenChange={(open) => {
          if (!open && !busy && (!dirty || window.confirm('Discard unsaved multiplayer link?'))) {
            setLobby(null);
            setDirty(false);
          }
        }}
      >
        {lobby && (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await action({
                  type: 'match.lobby',
                  id: lobby.id,
                  baseVersion: lobby.version,
                  lobbyUrl: lobby.url,
                });
                setDirty(false);
                setLobby(null);
                await reload();
              }, 'Multiplayer link saved.');
            }}
          >
            <Field label="Multiplayer URL">
              <input
                disabled={busy}
                type="url"
                value={lobby.url}
                onChange={(e) => {
                  setLobby({ ...lobby, url: e.target.value });
                  setDirty(true);
                }}
                placeholder="https://osu.ppy.sh/community/matches/123456"
              />
            </Field>
            <SaveButton busy={busy}>Save multiplayer link</SaveButton>
          </form>
        )}
      </Modal>
      <Modal
        open={ruleEditor}
        onOpenChange={(open) => {
          if (!open && (!dirty || window.confirm('Discard rule changes?'))) {
            setRuleEditor(false);
            setDirty(false);
          }
        }}
        title="Match rule presets"
        wide
      >
        {rules && options && (
          <form
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await action({
                  type: 'match.rules.save',
                  stageId: ruleStage || null,
                  rules,
                  baseHash,
                });
                setDirty(false);
                setRuleEditor(false);
                await reload();
              }, 'Rule preset saved. Existing matches unchanged.');
            }}
          >
            <Field label="Rule scope">
              <select
                value={ruleStage}
                onChange={(e) => {
                  if (!dirty || window.confirm('Discard changes and switch rule scope?'))
                    chooseRules(e.target.value);
                }}
              >
                <option value="">Tournament defaults</option>
                {options.stages.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name}
                    {s.rules ? '' : ' · Inherits defaults'}
                  </option>
                ))}
              </select>
            </Field>
            <MatchRulesFields
              rules={rules}
              onChange={(next) => {
                setRules(next);
                setDirty(true);
              }}
            />
            <div className="flex flex-wrap gap-3">
              <SaveButton busy={busy}>Save rule preset</SaveButton>
              {ruleStage && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await action({
                        type: 'match.rules.save',
                        stageId: ruleStage,
                        rules: null,
                        baseHash,
                      });
                      setDirty(false);
                      setRuleEditor(false);
                      await reload();
                    }, 'Stage now inherits tournament rules.')
                  }
                >
                  <RefreshCw size={17} />
                  Use tournament defaults
                </Button>
              )}
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
