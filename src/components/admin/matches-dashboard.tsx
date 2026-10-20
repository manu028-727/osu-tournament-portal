'use client';
import Link from '@/components/tournament-scope';
import { useState } from 'react';
import { Plus, SlidersHorizontal, Play, Users, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { DeleteMatchDialog, type DeleteMatchSelection } from './delete-match-dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { can, type Actor } from '@/lib/permissions';
import { matchAccess } from '@/lib/match-access';
import type { MatchListData, MatchSummary } from '@/lib/matches-types';
import { type MatchRules } from '@/lib/match-rules';
import { matchCredits } from '@/lib/match-display';
import { useTournamentTime, useTournamentScope } from '@/components/tournament-scope';
export { matchTime } from '@/lib/match-display';
import { MatchRulesFields } from './match-rules-fields';
import { RefereeSheetImporter } from './referee-sheet-importer';
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
export function MatchesDashboard({
  actor,
  management = false,
}: {
  actor: Actor;
  management?: boolean;
}) {
  const [filters, setFilters] = useState({
    stage: '',
    status: '',
    assigned: '',
    date: '',
    time: '',
    q: '',
  });
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
  const { data, error, reload } = useResource<MatchListData>(
    `${management ? 'matches' : 'referee'}&${params}`,
    true,
  );
  const { run, busy } = useTask();
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
  const [ruleEditor, setRuleEditor] = useState(false),
    [ruleStage, setRuleStage] = useState(''),
    [rules, setRules] = useState<MatchRules | null>(null),
    [baseHash, setBaseHash] = useState(''),
    [dirty, setDirty] = useState(false);
  useUnsaved(dirty);
  usePolling(reload, 10000, !create && !ruleEditor && !edit);
  const options = data?.options;
  const chooseRules = (id: string) => {
    if (!options) return;
    const stage = options.stages.find((s) => s.id === id);
    setRuleStage(id);
    setRules(stage?.rules || options.defaults);
    setBaseHash(stage ? stage.rulesHash : options.defaultsHash);
    setDirty(false);
  };
  const begin = (match?: MatchSummary) => {
    setCode('');
    setStageId('');
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
    setBestOf(options?.defaults.bestOf || 11);
    setEdit(match || null);
    setCreate(true);
    setDirty(false);
  };
  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  const stats = [
    ['SCHEDULED', 'Upcoming'],
    ['IN_PROGRESS', 'Live'],
    ['AWAITING_CONFIRMATION', 'To confirm'],
    ['COMPLETED', 'Completed'],
  ] as const;
  return (
    <>
      <SectionTitle
        title={management ? 'Match management' : 'Referee workspace'}
        description={
          can(actor, 'matches.manage') || can(actor, 'matches.view_all')
            ? `Tournament matches · ${timezone || 'UTC'}`
            : `Your assigned matches · ${timezone || 'UTC'}`
        }
      >
        <div className="flex flex-wrap gap-2">
          {can(actor, 'matches.import') && <RefereeSheetImporter onChanged={reload} />}
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
              <Button size="sm" onClick={() => begin()}>
                <Plus size={17} />
                New match
              </Button>
            </>
          )}
        </div>
      </SectionTitle>
      <p className="mb-3 text-sm text-muted">
        {Object.values(data.counts).reduce((sum, n) => sum + (n || 0), 0)} matches ·{' '}
        {data.counts.IN_PROGRESS || 0} in progress · {data.matches.length} shown
      </p>
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(([key, label]) => (
          <div className="card p-5" key={key}>
            <p className="text-sm text-muted">{label}</p>
            <p className="mt-2 text-3xl font-semibold">{data.counts[key] || 0}</p>
          </div>
        ))}
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
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
        <div className="overflow-x-auto">
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
                    <Badge>{MATCH_STATUS_LABELS[m.status]}</Badge>
                    <p className="mt-1 text-xs text-muted">{m.published ? 'Public' : 'Private'}</p>
                  </td>
                  <td>
                    <div className="flex gap-1">
                      <Button asChild size="icon" variant="outline">
                        <Link
                          href={`/admin/referee/${m.id}`}
                          aria-label={`Open match ${m.code}`}
                          title="Open referee panel"
                        >
                          <Play size={17} />
                        </Link>
                      </Button>
                      {matchAccess(actor, m).schedule &&
                        !['COMPLETED', 'CANCELLED'].includes(m.status) && (
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
                          onClick={() =>
                            setDeleting({ id: m.id, code: m.code, version: m.version })
                          }
                        >
                          <Trash2 size={17} className="text-red-200" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
                        setBestOf((stage?.rules || options.defaults).bestOf);
                      }}
                    >
                      <option value="">Select stage</option>
                      {options.stages
                        .filter((s) => s.published)
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
                      {options.teams.map((t) => (
                        <option value={t.id} key={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Team B / blue">
                    <select required value={teamBId} onChange={(e) => setTeamB(e.target.value)}>
                      <option value="">Select approved entry</option>
                      {options.teams
                        .filter((t) => t.id !== teamAId)
                        .map((t) => (
                          <option value={t.id} key={t.id}>
                            {t.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Best of (stage rules)">
                    <input
                      type="number"
                      required
                      disabled
                      min={1}
                      max={31}
                      step={2}
                      value={bestOf}
                      onChange={(e) => setBestOf(Number(e.target.value))}
                    />
                  </Field>
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
            <SaveButton busy={busy}>Save match</SaveButton>
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
