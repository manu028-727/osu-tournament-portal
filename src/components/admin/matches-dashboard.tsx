'use client';
import { localDateTimeInput } from '@/lib/utils';
import { Feedback, useT } from '@/components/locale';

import Link from '@/components/tournament-scope';
import { Fragment, useState, useEffect, useRef } from 'react';
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
  ClipboardPaste,
} from 'lucide-react';
import { DeleteMatchDialog, type DeleteMatchSelection } from './delete-match-dialog';
import { Button } from '../ui/button';
import { MatchStatusBadge } from '../ui/badge';
import { can, type Actor } from '@/lib/permissions';
import { matchAccess } from '@/lib/match-access';
import type { MatchListData, MatchSummary } from '@/lib/matches-types';
import { type MatchRules } from '@/lib/match-rules';
import { matchCredits, MATCH_STATUS_LABELS, organizerRefereeCredit } from '@/lib/match-display';
import { useTournamentTime, useTournamentScope } from '@/components/tournament-scope';
import { MatchRulesFields } from './match-rules-fields';
import { RefereeSheetImporter } from './referee-sheet-importer';
import { StageReconciliation } from './stage-reconciliation';
import { OrganizerMatchResult } from './organizer-match-result';
import { MatchInlineResult } from './match-inline-result';
import { MatchInlineSchedule, type InlineMatchEdit } from './match-inline-schedule';
import { ListPagination } from '../list-pagination';
import {
  matchesBulkScheduleSchema,
  matchesBatchScheduleSchema,
} from '@/lib/matches-bulk-validation';
import { parseMatchSchedulePaste } from '@/lib/matches-schedule-paste';
import {
  action,
  Field,
  LoadingState,
  EditorPanel,
  SaveButton,
  SectionTitle,
  useResource,
  useTask,
  useUnsaved,
  usePolling,
} from './shared';
type BulkField =
  'referees' | 'time' | 'stage' | 'streamer' | 'commentators' | 'notes' | 'published';
export function MatchesDashboard({ actor }: { actor: Actor }) {
  const tr = useT();
  const search = useSearchParams();
  const [filters, setFilterValues] = useState(() => ({
    stage: search.get('stage') || '',
    status: search.get('status') || '',
    assigned: search.get('assigned') || '',
    date: search.get('date') || '',
    time: search.get('time') || '',
    q: search.get('q') || '',
    sort: search.get('sort') || 'number',
    page: search.get('page') || '1',
  }));
  const storeFilters = (next: typeof filters) => {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(next)) {
      const defaultValue =
        (key === 'sort' && value === 'number') || (key === 'page' && value === '1');
      if (value && !defaultValue) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    const href = `${url.pathname}${url.search}`;
    if (href !== `${window.location.pathname}${window.location.search}`)
      window.history.replaceState(null, '', href);
    setFilterValues(next);
  };
  const setFilters = (next: Omit<typeof filters, 'page'> & { page?: string }) =>
    storeFilters({ ...next, page: '1' });
  const [searchText, setSearchText] = useState(filters.q);
  useEffect(() => {
    const timer = setTimeout(() => setSearchText(filters.q), 250);
    return () => clearTimeout(timer);
  }, [filters.q]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [resultId, setResultId] = useState<string | null>(null);
  const [resultImport, setResultImport] = useState(false);
  const [inline, setInline] = useState<InlineMatchEdit | null>(null);
  const activeFilters = [
    filters.stage,
    filters.status,
    filters.assigned,
    filters.date,
    filters.date ? filters.time : '',
  ].filter(Boolean).length;
  const [deleting, setDeleting] = useState<DeleteMatchSelection | null>(null);
  const [selectedMatches, setSelectedMatches] = useState<Set<string>>(() => new Set());
  const selectionAnchor = useRef<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkFields, setBulkFields] = useState<Set<BulkField>>(() => new Set(['referees']));
  const [bulkTimeMode, setBulkTimeMode] = useState<'set' | 'shift' | 'clear'>('set');
  const [bulkStage, setBulkStage] = useState('');
  const [bulkStreamer, setBulkStreamer] = useState('');
  const [bulkCommentators, setBulkCommentators] = useState('');
  const [bulkNotes, setBulkNotes] = useState('');
  const [bulkPublished, setBulkPublished] = useState(false);
  const [bulkVersions, setBulkVersions] = useState<Record<string, number>>({});
  const [bulkDirty, setBulkDirty] = useState(false);
  const [bulkReferees, setBulkReferees] = useState<string[]>([]);
  const [bulkTime, setBulkTime] = useState('');
  const [bulkShift, setBulkShift] = useState(60);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pastePreview, setPastePreview] = useState<ReturnType<
    typeof parseMatchSchedulePaste
  > | null>(null);
  const params = new URLSearchParams();
  for (const key of ['stage', 'status', 'assigned', 'q', 'sort', 'page'] as const)
    if (key === 'q' ? searchText : filters[key])
      params.set(key, key === 'q' ? searchText : filters[key]);
  if (filters.date) {
    const from = new Date(`${filters.date}T${filters.time || '00:00'}:00`),
      to = filters.time
        ? new Date(from.getTime() + 59999)
        : new Date(`${filters.date}T23:59:59.999`);
    params.set('from', from.toISOString());
    params.set('to', to.toISOString());
  }
  const filterKey = params.toString();
  const matchTime = useTournamentTime();
  const { timezone } = useTournamentScope();
  const { data, error, reload, loading } = useResource<MatchListData>(`matches&${filterKey}`, true);
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
  useUnsaved(dirty || !!inline || (bulkOpen && bulkDirty) || (pasteOpen && !!pasteText.trim()));
  usePolling(
    reload,
    10000,
    !create && !ruleEditor && !edit && !lobby && !bulkOpen && !pasteOpen && !resultId && !inline,
  );
  const options = data?.options;
  useEffect(() => {
    setSelectedMatches(new Set());
    selectionAnchor.current = null;
  }, [filterKey]);
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
    if (dirty && !window.confirm(tr('Discard unsaved changes?'))) return;
    setPathId('');
    setAllowIneligible(false);
    setOverrideReason('');
    setCode(data?.nextCode || '');
    const first = options?.stages.filter((stage) => stage.published && stage.kind !== 'QUALIFIERS');
    setStageId(first?.length === 1 ? first[0].id : '');
    setTeamA(match?.participants.A.id || '');
    setTeamB(match?.participants.B.id || '');
    setScheduled(localDateTimeInput(match?.scheduledAt));
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
  const bulkRows = data.matches.filter((match) => selectedMatches.has(match.id));
  const eligibleBulkRows = data.matches.filter((match) => match.status === 'SCHEDULED');
  const selectMatch = (id: string, checked: boolean, shift: boolean) => {
    let ids = [id];
    if (shift && selectionAnchor.current) {
      const start = data.matches.findIndex((match) => match.id === selectionAnchor.current),
        end = data.matches.findIndex((match) => match.id === id);
      if (start >= 0 && end >= 0)
        ids = data.matches
          .slice(Math.min(start, end), Math.max(start, end) + 1)
          .filter((match) => match.status === 'SCHEDULED')
          .map((match) => match.id);
    }
    setSelectedMatches((current) => {
      const next = new Set(current);
      for (const value of ids) {
        if (checked) next.add(value);
        else next.delete(value);
      }
      return next;
    });
    selectionAnchor.current = id;
  };
  const bulkStale =
    bulkOpen &&
    (bulkRows.length !== Object.keys(bulkVersions).length ||
      bulkRows.some((match) => bulkVersions[match.id] !== match.version));
  const bulkInvalid = bulkStale || bulkRows.some((match) => match.status !== 'SCHEDULED');
  const mixed = (value: (match: MatchSummary) => unknown) =>
    new Set(bulkRows.map((match) => JSON.stringify(value(match)))).size > 1;
  const plannedTime = (match: MatchSummary) =>
    !bulkFields.has('time')
      ? match.scheduledAt
      : bulkTimeMode === 'clear'
        ? null
        : bulkTimeMode === 'set'
          ? bulkTime
            ? new Date(bulkTime).toISOString()
            : null
          : match.scheduledAt && Number.isFinite(bulkShift)
            ? new Date(new Date(match.scheduledAt).getTime() + bulkShift * 60_000).toISOString()
            : null;
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
  const inlineSchedule = (m: MatchSummary, kind: InlineMatchEdit['kind']) => (
    <MatchInlineSchedule
      match={m}
      kind={kind}
      edit={inline}
      referees={options?.referees || []}
      busy={busy}
      onStart={() =>
        setInline({
          id: m.id,
          version: m.version,
          kind,
          time: localDateTimeInput(m.scheduledAt),
          referees: m.assignments.map((row) => row.userId),
        })
      }
      onChange={setInline}
      onCancel={() => setInline(null)}
      onSave={() =>
        void run(async () => {
          if (!inline) return;
          await action({
            type: 'match.schedule',
            id: m.id,
            baseVersion: inline.version,
            scheduledAt:
              inline.kind === 'time'
                ? inline.time
                  ? new Date(inline.time).toISOString()
                  : null
                : m.scheduledAt,
            refereeIds:
              inline.kind === 'referees' ? inline.referees : m.assignments.map((row) => row.userId),
            notes: m.notes,
          });
          setInline(null);
          await reload();
        }, tr('Schedule updated.'))
      }
    />
  );
  const scoreControl = (m: MatchSummary, large = false) => {
    const score = (
      <>
        {m.forfeitSide === 'A' ? tr('FF') : m.scoreA} :{' '}
        {m.forfeitSide === 'B' ? tr('FF') : m.scoreB}
      </>
    );
    return can(actor, 'matches.manage') && m.status !== 'CANCELLED' ? (
      <Button
        size="sm"
        variant="outline"
        className={`min-w-20 font-mono tabular-nums ${large ? 'text-xl' : 'text-sm'}`}
        aria-label={tr('Edit result for match {0}', m.matchNumber)}
        title={tr('Edit result for match {0}', m.matchNumber)}
        disabled={!!inline || !!resultId || !m.participants.A.id || !m.participants.B.id}
        onClick={() => {
          setResultImport(false);
          setResultId(m.id);
        }}
      >
        {score}
      </Button>
    ) : (
      score
    );
  };
  const matchActions = (m: MatchSummary) => (
    <div className="flex flex-wrap gap-1">
      <Button asChild size="sm" variant="outline">
        <Link
          href={`/admin/referee/${m.matchNumber}`}
          aria-label={tr('Open match {0}', m.matchNumber)}
          title={
            matchAccess(actor, m).editable
              ? tr('Referee this match')
              : tr('View match history and live state')
          }
        >
          <Play size={17} />
          {matchAccess(actor, m).editable ? tr('Referee') : tr('View')}
        </Link>
      </Button>
      {((can(actor, 'matches.manage') && m.status !== 'CANCELLED') ||
        (matchAccess(actor, m).operate && !['COMPLETED', 'CANCELLED'].includes(m.status))) && (
        <Button
          size="icon"
          variant="ghost"
          title={tr(can(actor, 'matches.manage') ? 'Import mp results' : 'Multiplayer link')}
          disabled={!!inline || !!resultId}
          aria-label={tr(
            can(actor, 'matches.manage')
              ? 'Import mp results for match {0}'
              : 'Multiplayer link for {0}',
            m.matchNumber,
          )}
          onClick={() =>
            can(actor, 'matches.manage')
              ? (setResultImport(true), setResultId(m.id))
              : setLobby({
                  id: m.id,
                  code: String(m.matchNumber),
                  version: m.version,
                  url: m.lobbyUrl || '',
                })
          }
        >
          <Link2 size={17} />
        </Button>
      )}
      {matchAccess(actor, m).schedule && !['COMPLETED', 'CANCELLED'].includes(m.status) && (
        <Button
          size="icon"
          variant="ghost"
          aria-label={tr('Assign {0}', m.matchNumber)}
          title={tr('Schedule and referee assignments')}
          onClick={() => begin(m)}
        >
          <Pencil size={17} />
        </Button>
      )}
      {can(actor, 'matches.delete') && !m.deletedAt && (
        <Button
          size="icon"
          variant="ghost"
          aria-label={tr('Delete match {0}', m.matchNumber)}
          title={tr('Permanently delete match')}
          onClick={() => setDeleting({ id: m.id, code: String(m.matchNumber), version: m.version })}
        >
          <Trash2 size={17} className="text-red-200" />
        </Button>
      )}
    </div>
  );
  return (
    <>
      <SectionTitle
        title={tr('Matches')}
        description={
          can(actor, 'matches.manage') || can(actor, 'matches.view_all')
            ? tr('Tournament matches · {0}', timezone || 'UTC')
            : tr('Your assigned matches · {0}', timezone || 'UTC')
        }
      >
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/referee/qualifiers">{tr('Qualifier lobbies')}</Link>
          </Button>
          <Button
            size="icon"
            variant="outline"
            aria-label={tr('Refresh matches')}
            title={tr('Refresh matches')}
            onClick={() => void reload().catch(() => {})}
          >
            <RefreshCw size={18} />
          </Button>
          {can(actor, 'matches.manage') && (
            <>
              <Button
                size="sm"
                disabled={options?.scoringNeedsReview || !!resultId || !!inline}
                onClick={() => begin()}
              >
                <Plus size={17} />
                {tr('New match')}
              </Button>
            </>
          )}
        </div>
      </SectionTitle>
      {resultId && resultImport && (
        <OrganizerMatchResult
          initialMode="multiplayer"
          key={resultId}
          id={resultId}
          onClose={() => setResultId(null)}
          onSaved={reload}
        />
      )}
      {resultId && !resultImport && (
        <MatchInlineResult
          inRow
          key={resultId}
          id={resultId}
          onClose={() => setResultId(null)}
          onSaved={reload}
        />
      )}
      {options?.scoringNeedsReview && (
        <p className="mb-4 text-sm text-muted">
          {tr('Historical matches remain accessible.')}{' '}
          <Link className="text-primary" href="/admin/settings">
            {tr('Review tournament gameplay scoring')}
          </Link>{' '}
          {tr('before creating new competition records.')}
        </p>
      )}
      {(can(actor, 'matches.import') || can(actor, 'matches.manage')) && (
        <details className="mb-4 border-b pb-2">
          <summary className="min-h-11 cursor-pointer py-2 text-sm text-muted">
            {tr('Import & rule presets')}
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
                {tr('Match rules')}
              </Button>
            )}
          </div>
        </details>
      )}
      <p className="mb-3 text-sm text-muted">
        {Object.values(data.counts).reduce((sum, n) => sum + (n || 0), 0)} {tr('matches ·')}{' '}
        {data.counts.IN_PROGRESS || 0} {tr('in progress ·')} {data.matches.length} {tr('shown')}
      </p>
      <fieldset disabled={!!inline || !!resultId} className="min-w-0 border-0 p-0">
        <div
          role="group"
          aria-label={tr('Match views')}
          className="mb-5 flex flex-wrap gap-2 border-b pb-4"
        >
          <Button
            variant="outline"
            size="sm"
            aria-pressed={!filters.status && !filters.assigned}
            className="aria-pressed:border-primary/40 aria-pressed:bg-primary/10 aria-pressed:text-primary"
            onClick={() => setFilters({ ...filters, status: '', assigned: '' })}
          >
            {tr('All Matches')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={filters.assigned === 'me'}
            className="aria-pressed:border-primary/40 aria-pressed:bg-primary/10 aria-pressed:text-primary"
            onClick={() => setFilters({ ...filters, status: '', assigned: 'me' })}
          >
            {tr('My Matches')}
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
              {tr(label)} · {data.counts[status] || 0}
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
          {filtersOpen ? tr('Hide filters') : tr('Filters')}
          {activeFilters ? ` (${activeFilters})` : ''}
        </Button>
        <div
          id="match-filters"
          className={`match-filters mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5 ${filtersOpen ? 'filters-open' : ''}`}
        >
          <Field label={tr('Search matches')}>
            <input
              type="search"
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            />
          </Field>
          <Field label={tr('Stage')}>
            <select
              value={filters.stage}
              onChange={(e) => setFilters({ ...filters, stage: e.target.value })}
            >
              <option value="">{tr('All stages')}</option>
              {data.stages.map((s) => (
                <option value={s.id} key={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tr('Match status')}>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">{tr('All statuses')}</option>
              {Object.entries(MATCH_STATUS_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {tr(label)}
                </option>
              ))}
              <option value="DELETED">{tr('Deleted matches')}</option>
            </select>
          </Field>
          <Field label={tr('Match date')}>
            <input
              type="date"
              value={filters.date}
              onChange={(e) => setFilters({ ...filters, date: e.target.value })}
            />
          </Field>
          <Field label={tr('Match time')}>
            <input
              type="time"
              disabled={!filters.date}
              value={filters.time}
              onChange={(e) => setFilters({ ...filters, time: e.target.value })}
            />
          </Field>
          <Field label={tr('Assigned referee')}>
            <select
              value={filters.assigned}
              onChange={(e) => setFilters({ ...filters, assigned: e.target.value })}
            >
              <option value="">{tr('All Matches')}</option>
              <option value="me">{tr('My Assigned Matches')}</option>
              <option value="unassigned">{tr('Unassigned Matches')}</option>
              {options?.referees
                .filter((r) => r.id !== actor.id)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.username}
                  </option>
                ))}
            </select>
          </Field>
          <Field label={tr('Sort matches')}>
            <select
              value={filters.sort}
              onChange={(e) => setFilters({ ...filters, sort: e.target.value })}
            >
              <option value="number">{tr('Match number')}</option>
              <option value="schedule">{tr('Schedule')}</option>
              <option value="stage">{tr('Stage')}</option>
              <option value="updated">{tr('Recently updated')}</option>
            </select>
          </Field>
          {(activeFilters > 0 || filters.q) && (
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                setFilters({
                  stage: '',
                  status: '',
                  assigned: '',
                  date: '',
                  time: '',
                  q: '',
                  sort: filters.sort,
                })
              }
            >
              {tr('Clear filters')}
            </Button>
          )}
        </div>
      </fieldset>
      {can(actor, 'matches.manage') && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border bg-card px-3 py-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setPasteOpen(true);
              setPastePreview(null);
            }}
          >
            <ClipboardPaste size={16} />
            {tr('Paste schedule')}
          </Button>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              aria-label={tr('Select all visible matches')}
              checked={
                eligibleBulkRows.length > 0 &&
                eligibleBulkRows.every((match) => selectedMatches.has(match.id))
              }
              disabled={!eligibleBulkRows.length || loading || !!inline || !!resultId}
              onChange={(event) =>
                setSelectedMatches(
                  event.target.checked
                    ? new Set(eligibleBulkRows.map((match) => match.id))
                    : new Set(),
                )
              }
            />
            {tr('Select scheduled')}
          </label>
          <span className="text-sm text-muted">
            {selectedMatches.size} {tr('selected')}
          </span>
          {selectedMatches.size > 0 && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  bulkRows.length !== selectedMatches.size ||
                  bulkRows.some((match) => match.status !== 'SCHEDULED')
                }
                onClick={() => {
                  setBulkFields(new Set(['referees']));
                  setBulkTimeMode('set');
                  setBulkStage(mixed((match) => match.stage.id) ? '' : bulkRows[0]?.stage.id || '');
                  setBulkStreamer(
                    mixed((match) => matchCredits(match.source).streamer)
                      ? ''
                      : matchCredits(bulkRows[0]?.source).streamer,
                  );
                  setBulkCommentators(
                    mixed((match) => matchCredits(match.source).commentators)
                      ? ''
                      : matchCredits(bulkRows[0]?.source).commentators.join('\n'),
                  );
                  setBulkNotes(mixed((match) => match.notes) ? '' : bulkRows[0]?.notes || '');
                  setBulkPublished(bulkRows.every((match) => match.published));
                  setBulkVersions(
                    Object.fromEntries(bulkRows.map((match) => [match.id, match.version])),
                  );
                  setBulkDirty(false);
                  setBulkReferees([]);
                  setBulkTime('');
                  setBulkShift(60);
                  setBulkOpen(true);
                }}
              >
                {tr('Bulk schedule / assign')}
              </Button>
              {(bulkRows.length !== selectedMatches.size ||
                bulkRows.some((match) => match.status !== 'SCHEDULED')) && (
                <span role="status" className="text-xs text-amber-200">
                  {tr('Bulk changes require only visible scheduled matches.')}
                </span>
              )}
              <Button size="sm" variant="ghost" onClick={() => setSelectedMatches(new Set())}>
                {tr('Clear selection')}
              </Button>
            </>
          )}
        </div>
      )}
      {data.pagination && (
        <ListPagination
          {...data.pagination}
          busy={loading || busy || !!inline || !!resultId}
          onPage={(page) => storeFilters({ ...filters, page: String(page) })}
        />
      )}
      {data.matches.length ? (
        <>
          <div className="border-t md:hidden">
            {data.matches.map((m) => (
              <article
                key={m.id}
                className="border-b py-4"
                aria-label={tr('Match {0}', m.matchNumber)}
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                  {can(actor, 'matches.manage') && (
                    <label className="flex min-h-11 items-center gap-2 pr-2">
                      <input
                        type="checkbox"
                        aria-label={tr('Select match {0}', m.matchNumber)}
                        disabled={m.status !== 'SCHEDULED' || loading || !!inline || !!resultId}
                        checked={selectedMatches.has(m.id)}
                        onChange={(event) =>
                          selectMatch(
                            m.id,
                            event.target.checked,
                            event.nativeEvent instanceof MouseEvent && event.nativeEvent.shiftKey,
                          )
                        }
                      />
                      {tr('Select')}
                    </label>
                  )}
                  <Link
                    href={`/admin/referee/${m.matchNumber}`}
                    className="min-w-0 max-w-full break-words font-mono text-primary"
                  >
                    {tr('Match')} {m.matchNumber} · {m.stage.name}
                  </Link>
                  <MatchStatusBadge status={m.status}>
                    {tr(m.deletedAt ? 'Deleted' : MATCH_STATUS_LABELS[m.status])}
                  </MatchStatusBadge>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <Link
                    href={`/admin/referee/${m.matchNumber}`}
                    className="min-w-0 space-y-1 font-semibold"
                  >
                    <p className="text-red-200">{m.participants.A.name}</p>
                    <p className="text-sky-200">{m.participants.B.name}</p>
                  </Link>
                  <p className="whitespace-nowrap font-mono text-xl tabular-nums">
                    {scoreControl(m, true)}
                  </p>
                </div>
                <div className="mt-2 text-xs text-muted">
                  {matchAccess(actor, m).schedule && m.status === 'SCHEDULED'
                    ? inlineSchedule(m, 'time')
                    : matchTime(m.scheduledAt)}
                  {m.bracket ? ' · ' + m.bracket : ''}
                </div>
                <div className="mt-3 flex flex-col items-start gap-3">
                  <p className="min-w-0 break-words text-xs text-muted">
                    {organizerRefereeCredit(m.source) ||
                      m.assignments.map((r) => r.user.username).join(', ') ||
                      matchCredits(m.source).referee ||
                      tr('Unassigned')}
                    <span className="mt-1 block">{m.published ? tr('Public') : tr('Private')}</span>
                  </p>
                  {matchActions(m)}
                  {matchAccess(actor, m).schedule &&
                    m.status === 'SCHEDULED' &&
                    inlineSchedule(m, 'referees')}
                </div>
                {resultId === m.id && !resultImport && (
                  <div className="mt-3 min-w-0" data-match-result-slot={m.id} />
                )}
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="admin-table">
              <thead>
                <tr>
                  {can(actor, 'matches.manage') && <th>{tr('Select')}</th>}
                  <th>{tr('Match')}</th>
                  <th>{tr('Stage / date')}</th>
                  <th>{tr('Teams')}</th>
                  <th>{tr('Score')}</th>
                  <th>{tr('Referees')}</th>
                  <th>{tr('Status')}</th>
                  <th>{tr('Open')}</th>
                </tr>
              </thead>
              <tbody>
                {data.matches.map((m) => (
                  <Fragment key={m.id}>
                    <tr>
                      {can(actor, 'matches.manage') && (
                        <td>
                          <input
                            type="checkbox"
                            aria-label={tr('Select match {0}', m.matchNumber)}
                            disabled={m.status !== 'SCHEDULED' || loading || !!inline || !!resultId}
                            checked={selectedMatches.has(m.id)}
                            onChange={(event) =>
                              selectMatch(
                                m.id,
                                event.target.checked,
                                event.nativeEvent instanceof MouseEvent &&
                                  event.nativeEvent.shiftKey,
                              )
                            }
                          />
                        </td>
                      )}
                      <td className="font-semibold">
                        {tr('Match')} {m.matchNumber}
                      </td>
                      <td>
                        <p>
                          {m.stage.name}
                          {m.bracket ? ` · ${m.bracket}` : ''}
                        </p>
                        {matchAccess(actor, m).schedule && m.status === 'SCHEDULED' ? (
                          inlineSchedule(m, 'time')
                        ) : (
                          <p className="whitespace-nowrap text-xs text-muted">
                            {matchTime(m.scheduledAt)}
                          </p>
                        )}
                        {m.lobbyUrl && (
                          <a
                            href={m.lobbyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary"
                          >
                            {tr('MP link')}
                          </a>
                        )}
                      </td>
                      <td className="min-w-40">
                        <p className="text-red-200">{m.participants.A.name}</p>
                        <p className="text-sky-200">{m.participants.B.name}</p>
                      </td>
                      <td className="whitespace-nowrap font-semibold">{scoreControl(m)}</td>
                      <td>
                        {matchAccess(actor, m).schedule &&
                          m.status === 'SCHEDULED' &&
                          inlineSchedule(m, 'referees')}
                        {matchCredits(m.source).referee && (
                          <p className="text-xs">
                            {matchCredits(m.source).referee}{' '}
                            {tr(organizerRefereeCredit(m.source) ? '· External' : '· Sheet')}
                          </p>
                        )}
                        {m.assignments.map((r) => (
                          <p key={r.userId} className="text-xs">
                            {r.user.username}
                            {r.primary ? tr(' · Lead') : ''}
                          </p>
                        ))}
                        {matchCredits(m.source).streamer && (
                          <p className="mt-1 text-xs text-muted">
                            {tr('Stream:')} {matchCredits(m.source).streamer}
                          </p>
                        )}
                        {!!matchCredits(m.source).commentators.length && (
                          <p className="text-xs text-muted">
                            {tr('Comms:')} {matchCredits(m.source).commentators.join(', ')}
                          </p>
                        )}
                      </td>
                      <td>
                        <MatchStatusBadge status={m.status}>
                          {tr(m.deletedAt ? 'Deleted' : MATCH_STATUS_LABELS[m.status])}
                        </MatchStatusBadge>
                        <p className="mt-1 text-xs text-muted">
                          {m.published ? tr('Public') : tr('Private')}
                        </p>
                      </td>
                      <td>{matchActions(m)}</td>
                    </tr>
                    {resultId === m.id && !resultImport && (
                      <tr>
                        <td colSpan={can(actor, 'matches.manage') ? 8 : 7}>
                          <div data-match-result-slot={m.id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="border-y py-16 text-center text-muted">
          <Users size={30} className="mx-auto mb-4" />
          {tr('No matches found.')}
        </div>
      )}
      <EditorPanel
        open={bulkOpen}
        onOpenChange={(open) => {
          if (open || !bulkDirty || window.confirm(tr('Discard unsaved bulk match changes?')))
            setBulkOpen(open);
        }}
        title={tr('Bulk edit {0} matches', bulkRows.length)}
        wide
      >
        <form
          className="space-y-4"
          onChange={() => setBulkDirty(true)}
          onSubmit={(event) => {
            event.preventDefault();
            if (bulkInvalid) return;
            void run(async () => {
              const patch = matchesBulkScheduleSchema.parse({
                type: 'matches.bulk.schedule',
                matches: bulkRows.map(({ id }) => ({ id, baseVersion: bulkVersions[id] })),
                ...(bulkFields.has('referees') ? { refereeIds: bulkReferees } : {}),
                ...(bulkFields.has('stage') ? { stageId: bulkStage } : {}),
                ...(bulkFields.has('streamer') ? { streamer: bulkStreamer } : {}),
                ...(bulkFields.has('commentators')
                  ? {
                      commentators: bulkCommentators
                        .split('\n')
                        .map((name) => name.trim())
                        .filter(Boolean),
                    }
                  : {}),
                ...(bulkFields.has('notes') ? { notes: bulkNotes } : {}),
                ...(bulkFields.has('published') ? { published: bulkPublished } : {}),
                ...(bulkFields.has('time')
                  ? bulkTimeMode === 'shift'
                    ? { shiftMinutes: bulkShift }
                    : {
                        scheduledAt:
                          bulkTimeMode === 'clear' ? null : new Date(bulkTime).toISOString(),
                      }
                  : {}),
              });
              await action(patch);
              setBulkOpen(false);
              setSelectedMatches(new Set());
              setBulkDirty(false);
              await reload();
            }, tr('Bulk match changes saved.'));
          }}
        >
          <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
            <legend className="mb-2 font-semibold">{tr('Change selected fields')}</legend>
            {(
              [
                ['referees', 'Referees'],
                ['time', 'Date and time'],
                ['stage', 'Stage'],
                ['streamer', 'Streamer'],
                ['commentators', 'Commentators'],
                ['notes', 'Notes'],
                ['published', 'Publication'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex min-h-10 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={bulkFields.has(key)}
                  onChange={(event) =>
                    setBulkFields((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(key);
                      else next.delete(key);
                      return next;
                    })
                  }
                />
                {tr(label)}
              </label>
            ))}
          </fieldset>
          {bulkInvalid && (
            <p role="alert">
              {tr(
                'A selected match changed or is no longer scheduled. Close and review the selection.',
              )}
            </p>
          )}
          {bulkFields.has('referees') && options && (
            <fieldset className="max-h-56 space-y-2 overflow-auto rounded-lg border p-3">
              <legend className="px-1 text-sm font-semibold">
                {tr('Replace referee assignments')}
                {mixed((match) => match.assignments.map((ref) => ref.userId).sort())
                  ? tr(' (Mixed)')
                  : ''}
              </legend>
              {options.referees.map((referee) => (
                <label key={referee.id} className="flex min-h-10 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={bulkReferees.includes(referee.id)}
                    onChange={(event) =>
                      setBulkReferees((current) =>
                        event.target.checked
                          ? [...current, referee.id]
                          : current.filter((id) => id !== referee.id),
                      )
                    }
                  />
                  {referee.username}
                </label>
              ))}
              <p className="text-xs text-muted">
                {tr('Leaving all unchecked clears assignments.')}
              </p>
            </fieldset>
          )}
          {bulkFields.has('time') && (
            <Field label={tr('Schedule change')}>
              <select
                value={bulkTimeMode}
                onChange={(event) => setBulkTimeMode(event.target.value as typeof bulkTimeMode)}
              >
                <option value="set">{tr('Set the same start time')}</option>
                <option value="shift">{tr('Shift existing times')}</option>
                <option value="clear">{tr('Clear start times')}</option>
              </select>
            </Field>
          )}
          {bulkFields.has('time') && bulkTimeMode === 'set' && (
            <Field label={tr('Scheduled time (your timezone)')}>
              <input
                required
                type="datetime-local"
                value={bulkTime}
                onChange={(event) => setBulkTime(event.target.value)}
              />
            </Field>
          )}
          {bulkFields.has('time') && bulkTimeMode === 'shift' && (
            <Field label={tr('Shift minutes (negative moves earlier)')}>
              <input
                type="number"
                min={-10080}
                max={10080}
                step={15}
                required
                value={Number.isFinite(bulkShift) ? bulkShift : ''}
                onChange={(event) => setBulkShift(event.target.valueAsNumber)}
              />
            </Field>
          )}
          {bulkFields.has('time') &&
            bulkTimeMode === 'shift' &&
            bulkRows.some((match) => !match.scheduledAt) && (
              <p role="alert" className="text-sm text-amber-200">
                {tr('Every selected match needs a scheduled time before it can be shifted.')}
              </p>
            )}
          <div className="grid-fields">
            {bulkFields.has('stage') && (
              <Field
                label={tr(
                  'Target stage{0}',
                  mixed((match) => match.stage.id) ? tr(' (Mixed)') : '',
                )}
              >
                <select
                  required
                  value={bulkStage}
                  onChange={(event) => setBulkStage(event.target.value)}
                >
                  <option value="">{tr('Select stage')}</option>
                  {options?.stages
                    .filter((stage) => stage.published && stage.kind !== 'QUALIFIERS')
                    .map((stage) => (
                      <option key={stage.id} value={stage.id}>
                        {stage.name}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            {bulkFields.has('streamer') && (
              <Field
                label={tr(
                  'Streamer{0}',
                  mixed((match) => matchCredits(match.source).streamer) ? tr(' (Mixed)') : '',
                )}
              >
                <input
                  maxLength={120}
                  value={bulkStreamer}
                  onChange={(event) => setBulkStreamer(event.target.value)}
                />
              </Field>
            )}
            {bulkFields.has('commentators') && (
              <Field
                label={tr(
                  'Commentators, one per line{0}',
                  mixed((match) => matchCredits(match.source).commentators) ? tr(' (Mixed)') : '',
                )}
              >
                <textarea
                  rows={3}
                  value={bulkCommentators}
                  onChange={(event) => setBulkCommentators(event.target.value)}
                />
              </Field>
            )}
            {bulkFields.has('notes') && (
              <Field
                label={tr('Match notes{0}', mixed((match) => match.notes) ? tr(' (Mixed)') : '')}
              >
                <textarea
                  maxLength={4000}
                  rows={3}
                  value={bulkNotes}
                  onChange={(event) => setBulkNotes(event.target.value)}
                />
              </Field>
            )}
            {bulkFields.has('published') && (
              <Field
                label={tr(
                  'Publication{0}',
                  mixed((match) => match.published) ? tr(' (Mixed)') : '',
                )}
              >
                <select
                  value={String(bulkPublished)}
                  onChange={(event) => setBulkPublished(event.target.value === 'true')}
                >
                  <option value="false">{tr('Private')}</option>
                  <option value="true">{tr('Public')}</option>
                </select>
              </Field>
            )}
          </div>
          <div className="max-h-56 overflow-auto border-y py-2 text-sm">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{tr('Match')}</th>
                  <th>{tr('Stage')}</th>
                  <th>{tr('Scheduled time')}</th>
                  <th>{tr('Referees')}</th>
                </tr>
              </thead>
              <tbody>
                {bulkRows.map((match) => (
                  <tr key={match.id}>
                    <td>
                      <span className="font-semibold">
                        {tr('Match')} {match.matchNumber}
                      </span>
                      <p className="text-xs text-muted">
                        {match.participants.A.name} {tr('vs')} {match.participants.B.name}
                      </p>
                    </td>
                    <td>
                      {bulkFields.has('stage')
                        ? options?.stages.find((stage) => stage.id === bulkStage)?.name ||
                          tr('Select stage')
                        : match.stage.name}
                    </td>
                    <td>{matchTime(plannedTime(match))}</td>
                    <td>
                      {bulkFields.has('referees')
                        ? bulkReferees
                            .map((id) => options?.referees.find((ref) => ref.id === id)?.username)
                            .join(', ') || tr('Unassigned')
                        : match.assignments.map((ref) => ref.user.username).join(', ') ||
                          tr('Unassigned')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                if (!bulkDirty || window.confirm(tr('Discard unsaved bulk match changes?')))
                  setBulkOpen(false);
              }}
            >
              {tr('Cancel')}
            </Button>
            <Button
              type="submit"
              disabled={
                busy ||
                !bulkRows.length ||
                !bulkFields.size ||
                bulkInvalid ||
                (bulkFields.has('time') &&
                  bulkTimeMode === 'shift' &&
                  (!Number.isInteger(bulkShift) ||
                    !bulkShift ||
                    bulkRows.some((match) => !match.scheduledAt)))
              }
            >
              {tr('Apply to')} {bulkRows.length} {tr('matches')}
            </Button>
          </div>
        </form>
      </EditorPanel>
      <EditorPanel
        open={pasteOpen}
        onOpenChange={(open) => {
          if (open || !pasteText.trim() || window.confirm(tr('Discard the pasted schedule?')))
            setPasteOpen(open);
        }}
        title={tr('Paste match schedule')}
        wide
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!pastePreview) {
              setPastePreview(
                parseMatchSchedulePaste(pasteText, data.matches, options?.referees || []),
              );
              return;
            }
            if (pastePreview.errors.length || !pastePreview.rows.length) return;
            void run(async () => {
              const body = matchesBatchScheduleSchema.parse({
                type: 'matches.batch.schedule',
                matches: pastePreview.rows,
              });
              await action(body);
              setPasteOpen(false);
              setPasteText('');
              setPastePreview(null);
              setSelectedMatches(new Set());
              await reload();
            }, tr('Pasted schedule saved.'));
          }}
        >
          <Field label={tr('Schedule TSV or CSV')}>
            <textarea
              rows={8}
              value={pasteText}
              onChange={(event) => {
                setPasteText(event.target.value);
                setPastePreview(null);
              }}
              placeholder={tr(
                'match_number\tscheduled_at\treferee\n1\t2026-10-24 18:00\tReferee username',
              )}
            />
          </Field>
          <p className="text-sm text-muted">
            {tr(
              'Blank cells keep existing values; - clears a time or assignment. Dates without a timezone use your browser timezone.',
            )}
          </p>
          {!!pastePreview?.errors.length && (
            <ul
              role="alert"
              className="max-h-40 list-inside list-disc overflow-auto text-sm text-red-200"
            >
              {pastePreview.errors.map((error, index) => (
                <li key={index}>
                  <Feedback message={error} />
                </li>
              ))}
            </ul>
          )}
          {!!pastePreview?.rows.length && (
            <div className="max-h-64 overflow-auto">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{tr('Match')}</th>
                    <th>{tr('Current time')}</th>
                    <th>{tr('New time')}</th>
                    <th>{tr('Referees')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pastePreview.rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {tr('Match')} {row.matchNumber}
                      </td>
                      <td>{matchTime(row.previousTime)}</td>
                      <td>
                        {row.scheduledAt === undefined
                          ? tr('Unchanged')
                          : matchTime(row.scheduledAt)}
                      </td>
                      <td>
                        {row.refereeIds === undefined
                          ? tr('Unchanged')
                          : row.refereeIds
                              .map((id) => options?.referees.find((ref) => ref.id === id)?.username)
                              .join(', ') || tr('Unassigned')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <SaveButton
            busy={busy}
            disabled={
              !pasteText.trim() ||
              (!!pastePreview && (!!pastePreview.errors.length || !pastePreview.rows.length))
            }
          >
            {pastePreview
              ? tr('Apply {0} schedule rows', pastePreview.rows.length)
              : tr('Preview schedule')}
          </SaveButton>
        </form>
      </EditorPanel>
      <DeleteMatchDialog match={deleting} onClose={() => setDeleting(null)} onDeleted={reload} />
      <EditorPanel
        open={create}
        onOpenChange={(open) => {
          if (!open && (!dirty || window.confirm(tr('Discard unsaved match changes?')))) {
            setCreate(false);
            setEdit(null);
            setDirty(false);
          }
        }}
        title={edit ? tr('Schedule & assignment') : tr('New match')}
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
                edit ? tr('Match assignment saved.') : tr('Match scheduled.'),
              );
            }}
          >
            <div className="grid-fields">
              {!edit && (
                <>
                  <Field label={tr('Match code')}>
                    <input
                      required
                      maxLength={80}
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </Field>
                  <Field label={tr('Tournament stage')}>
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
                      <option value="">{tr('Select stage')}</option>
                      {options.stages
                        .filter((s) => s.published && s.kind !== 'QUALIFIERS')
                        .map((s) => (
                          <option value={s.id} key={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label={tr('Team A / red')}>
                    <select required value={teamAId} onChange={(e) => setTeamA(e.target.value)}>
                      <option value="">{tr('Select approved entry')}</option>
                      {eligibleTeams.map((t) => (
                        <option value={t.id} key={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={tr('Team B / blue')}>
                    <select required value={teamBId} onChange={(e) => setTeamB(e.target.value)}>
                      <option value="">{tr('Select approved entry')}</option>
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
                    <Field label={tr('Competition path')}>
                      <select
                        value={path?.id || ''}
                        required={!allowIneligible}
                        onChange={(e) => {
                          setPathId(e.target.value);
                          setTeamA('');
                          setTeamB('');
                        }}
                      >
                        <option value="">{tr('Select competition path')}</option>
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
                      {tr('Allow ineligible participants (exhibition or custom match)')}
                    </label>
                  )}
                  {path && path.teams.some((team) => !team.eligible) && (
                    <details className="text-sm text-muted">
                      <summary>{tr('Unavailable participants')}</summary>
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
                    <Field label={tr('Eligibility override reason')}>
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
                    {tr('Best of')} {bestOf} {tr('· Inherited from stage rules')}
                  </p>
                </>
              )}
              <Field label={tr('Scheduled time (your timezone)')}>
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
                  <Field key={side} label={side === 'A' ? tr('Red opponent') : tr('Blue opponent')}>
                    <select
                      value={side === 'A' ? teamAId : teamBId}
                      onChange={(e) =>
                        side === 'A' ? setTeamA(e.target.value) : setTeamB(e.target.value)
                      }
                    >
                      <option value="">
                        {edit.participants[side].id ? tr('Keep current') : tr('Unresolved')} ·{' '}
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
                {tr('Public match')}
              </label>
            )}
            <fieldset className="border-t pt-5">
              <legend className="text-lg font-semibold">{tr('Referee assignments')}</legend>
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
                      {refereeIds[0] === r.id ? tr(' · Lead') : ''}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label={tr('Match notes')}>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            {!edit && !options.stages.some((s) => s.published) && (
              <p className="text-sm text-muted">
                {tr('A published mappool is required.')}{' '}
                <Link className="text-primary" href="/admin/mappools">
                  {tr('Stages & mappools')}
                </Link>
              </p>
            )}
            {!edit && options.teams.length < 2 && (
              <p className="text-sm text-muted">
                {tr('Two approved entries are required.')}{' '}
                <Link className="text-primary" href="/admin/teams">
                  {tr('Teams & players')}
                </Link>
              </p>
            )}
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (!dirty || window.confirm(tr('Discard unsaved match changes?'))) {
                    setCreate(false);
                    setEdit(null);
                    setDirty(false);
                  }
                }}
              >
                {tr('Cancel')}
              </Button>
              <SaveButton busy={busy}>{tr('Save match')}</SaveButton>
            </div>
          </form>
        )}
      </EditorPanel>
      <EditorPanel
        title={tr('Multiplayer link · {0}', lobby?.code || '')}
        open={!!lobby}
        onOpenChange={(open) => {
          if (
            !open &&
            !busy &&
            (!dirty || window.confirm(tr('Discard unsaved multiplayer link?')))
          ) {
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
              }, tr('Multiplayer link saved.'));
            }}
          >
            <Field label={tr('Multiplayer URL')}>
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
            <SaveButton busy={busy}>{tr('Save multiplayer link')}</SaveButton>
          </form>
        )}
      </EditorPanel>
      <EditorPanel
        open={ruleEditor}
        onOpenChange={(open) => {
          if (!open && (!dirty || window.confirm(tr('Discard rule changes?')))) {
            setRuleEditor(false);
            setDirty(false);
          }
        }}
        title={tr('Match rule presets')}
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
              }, tr('Rule preset saved. Existing matches unchanged.'));
            }}
          >
            <Field label={tr('Rule scope')}>
              <select
                value={ruleStage}
                onChange={(e) => {
                  if (!dirty || window.confirm(tr('Discard changes and switch rule scope?')))
                    chooseRules(e.target.value);
                }}
              >
                <option value="">{tr('Tournament defaults')}</option>
                {options.stages.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name}
                    {s.rules ? '' : tr(' · Inherits defaults')}
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
              <SaveButton busy={busy}>{tr('Save rule preset')}</SaveButton>
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
                    }, tr('Stage now inherits tournament rules.'))
                  }
                >
                  <RefreshCw size={17} />
                  {tr('Use tournament defaults')}
                </Button>
              )}
            </div>
          </form>
        )}
      </EditorPanel>
    </>
  );
}
