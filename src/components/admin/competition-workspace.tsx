'use client';
import { humanizeCode } from '@/lib/i18n';
import { Feedback, useT } from '@/components/locale';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Eye,
  EyeOff,
  GitBranch,
  ListOrdered,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import Link, { scopedHref, useTournamentScope } from '@/components/tournament-scope';
import { CompetitionBracket } from '@/components/competition-bracket';
import { Button } from '@/components/ui/button';
import { can, type Actor } from '@/lib/permissions';
import type { CompetitionAction, CompetitionCreate } from '@/lib/competition-validation';
import type {
  CompetitionBracketData,
  CompetitionData,
  CompetitionNode,
  CompetitionOptions,
  CompetitionGenerationPreview,
} from '@/lib/competition-types';
import {
  action,
  Field,
  LoadingState,
  EditorPanel,
  usePolling,
  useResource,
  useTask,
} from './shared';
import { BracketRoundTools } from './bracket-rounds';
import { OrganizerMatchResult } from './organizer-match-result';
import { bracketRoundDetails, bracketSlotLabel } from '@/lib/bracket-presentation';
import { BracketLifecycle } from './bracket-lifecycle';
import { DeleteMatchDialog } from './delete-match-dialog';
import { MatchInlineSchedule, type InlineMatchEdit } from './match-inline-schedule';
import { localDateTimeInput } from '@/lib/utils';
import type { MatchView, RefereeProfile } from '@/lib/matches-types';
import { useUnsaved } from './shared';

export function CompetitionWorkspace({ actor }: { actor: Actor }) {
  const tr = useT();
  const scope = useTournamentScope();
  const { data, error, reload } = useResource<CompetitionData>('competition', true);
  const [selected, setSelected] = useState(''),
    [creating, setCreating] = useState(false),
    [editing, setEditing] = useState<string | null>(null);
  const [approve, setApprove] = useState(false);
  const [inspectorState, setInspectorState] = useState({ dirty: false, busy: false });
  const [initial, setInitial] = useState<CompetitionCreate | undefined>();
  const [lifecycle, setLifecycle] = useState<{
    operation: 'delete' | 'regenerate' | 'missing';
    nodeId?: string;
    rebuild?: boolean;
  } | null>(null);
  const [editPositions, setEditPositions] = useState(false);
  const [reviewingTies, setReviewingTies] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const { run, busy } = useTask();
  usePolling(reload, 10000, !creating && !editing && !reviewingTies && !lifecycle);
  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  const brackets = data.brackets;
  const bracket = brackets.find((b) => b.id === selected) || brackets[0];
  const guard = () =>
    !inspectorState.busy &&
    (!inspectorState.dirty || window.confirm(tr('Discard unsaved changes?')));
  const closeInspector = () => {
    if (guard()) {
      setEditing(null);
      setInspectorState({ dirty: false, busy: false });
      opener.current?.focus({ preventScroll: true });
    }
  };
  const editable = can(actor, 'matches.manage');
  const save = async (input: CompetitionAction) => {
    const result = await action<{ id: string }>(input);
    await reload();
    return result;
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <select
          aria-label={tr('Competition bracket')}
          className="min-w-0 max-w-full md:max-w-80"
          value={bracket?.id || ''}
          onChange={(e) => {
            if (!guard()) return;
            setSelected(e.target.value);
            setEditing(null);
            setApprove(false);
          }}
        >
          {!brackets.length && <option value="">{tr('No brackets')}</option>}
          {brackets.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap items-center gap-2">
          {editable && bracket && (
            <>
              {data.options && (
                <fieldset disabled={!!editing || !!lifecycle}>
                  <BracketRoundTools
                    key={bracket.id}
                    bracket={bracket}
                    options={data.options}
                    save={save}
                  />
                </fieldset>
              )}
              {bracket.format === 'GROUPS' && bracket.standings?.some((row) => row.tied) && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    !bracket.nodes.every(
                      (node) =>
                        node.state === 'BYE' ||
                        node.state === 'SKIPPED' ||
                        (node.match?.status === 'COMPLETED' && node.match.winnerSide),
                    )
                  }
                  onClick={() => setReviewingTies(true)}
                >
                  <ListOrdered size={16} />
                  {tr('Review ties')}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                title={tr('Edit bracket positions')}
                aria-label={tr('Edit bracket positions')}
                aria-pressed={editPositions}
                onClick={() => setEditPositions((value) => !value)}
              >
                <Pencil size={18} />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !!editing || !!lifecycle}
                onClick={() => setLifecycle({ operation: 'missing' })}
              >
                <RotateCcw size={16} />
                {tr('Generate missing matches')}
              </Button>
              {bracket.configuration?.phaseKey && (
                <span className="text-sm text-muted">{tr('Managed by the tournament format')}</span>
              )}
              {can(actor, 'matches.delete') && !bracket.configuration?.phaseKey && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !!editing || !!lifecycle}
                    onClick={() => setLifecycle({ operation: 'delete', rebuild: true })}
                  >
                    <RefreshCw size={16} />
                    {tr('Rebuild bracket')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={tr('Delete bracket')}
                    aria-label={tr('Delete bracket')}
                    disabled={busy || !!editing || !!lifecycle}
                    onClick={() => setLifecycle({ operation: 'delete' })}
                  >
                    <Trash2 size={18} />
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="icon"
                title={bracket.published ? tr('Unpublish bracket') : tr('Publish bracket')}
                aria-label={bracket.published ? tr('Unpublish bracket') : tr('Publish bracket')}
                disabled={busy || !!editing || !!lifecycle}
                onClick={() =>
                  void run(() =>
                    save({
                      type: 'competition.publish',
                      id: bracket.id,
                      baseVersion: bracket.version,
                      published: !bracket.published,
                    }),
                  )
                }
              >
                {bracket.published ? <Eye size={18} /> : <EyeOff size={18} />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title={tr('Recalculate progression')}
                aria-label={tr('Recalculate progression')}
                disabled={busy || !!editing || !!lifecycle}
                onClick={() =>
                  void run(() =>
                    save({
                      type: 'competition.sync',
                      id: bracket.id,
                      baseVersion: bracket.version,
                      approveCorrections: approve,
                    }),
                  )
                }
              >
                <RefreshCw size={18} />
              </Button>
            </>
          )}
          {editable && data.options && (
            <Button
              size="sm"
              disabled={!!editing}
              onClick={() => {
                setInitial(undefined);
                setCreating(true);
              }}
            >
              <Plus size={16} />
              {tr('Create bracket')}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          <Feedback message={error} />
        </p>
      )}
      {editable && bracket && (
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} />
          {tr('Approve corrections to unstarted downstream fixtures')}
        </label>
      )}
      {bracket ? (
        <div
          className={
            editing
              ? 'grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]'
              : 'min-w-0'
          }
        >
          <CompetitionBracket
            bracket={bracket}
            selectedNodeId={editing || undefined}
            onRegenerateNode={
              editable && !editing
                ? (nodeId) => setLifecycle({ operation: 'regenerate', nodeId })
                : undefined
            }
            onSelectNode={
              editable
                ? (id) => {
                    if (id !== editing && guard()) {
                      opener.current =
                        document.activeElement instanceof HTMLElement
                          ? document.activeElement
                          : null;
                      setEditing(id);
                      setInspectorState({ dirty: false, busy: false });
                    }
                  }
                : undefined
            }
            onOpenMatch={
              editing
                ? undefined
                : (id) => {
                    const number = bracket.nodes.find((node) => node.matchId === id)?.matchNumber;
                    if (!number) return;
                    window.location.href = scopedHref(`/admin/referee/${number}`, scope);
                  }
            }
          />
          {editing && bracket.nodes.some((node) => node.id === editing) && (
            <BracketMatchPanel
              key={editing}
              actor={actor}
              node={bracket.nodes.find((node) => node.id === editing)!}
              bracket={bracket}
              brackets={data.brackets}
              options={data.options}
              positionFirst={editPositions}
              close={closeInspector}
              save={save}
              reload={reload}
              stateChanged={setInspectorState}
              regenerate={() => {
                if (guard()) setLifecycle({ operation: 'regenerate', nodeId: editing });
              }}
            />
          )}
        </div>
      ) : (
        <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-muted">
          <GitBranch size={20} />
          {tr('No competition brackets')}
        </div>
      )}
      {creating && data.options && (
        <CreateCompetition
          initial={initial}
          options={data.options}
          close={() => setCreating(false)}
          save={async (input) => {
            const result = await save(input);
            setSelected(result.id);
            setCreating(false);
          }}
        />
      )}
      {lifecycle && bracket && (
        <BracketLifecycle
          key={`${bracket.id}-${lifecycle.nodeId || lifecycle.operation}`}
          bracket={bracket}
          operation={lifecycle.operation}
          nodeId={lifecycle.nodeId}
          close={() => setLifecycle(null)}
          saved={async () => {
            setEditing(null);
            setInspectorState({ dirty: false, busy: false });
            await reload();
            if (lifecycle.operation === 'delete') {
              if (lifecycle.rebuild && bracket.configuration) {
                setInitial({
                  ...bracket.configuration,
                  reviewHash: undefined,
                  roundStages: Object.fromEntries(
                    bracket.rounds.map((round) => [round.key, round.stageId]),
                  ),
                  generationKey: crypto.randomUUID(),
                });
                setCreating(true);
              }
            }
          }}
        />
      )}
      {reviewingTies && bracket && (
        <ReviewGroupTies bracket={bracket} close={() => setReviewingTies(false)} save={save} />
      )}
    </div>
  );
}
function BracketMatchPanel({
  actor,
  node,
  bracket,
  brackets,
  options,
  positionFirst,
  close,
  save,
  reload,
  stateChanged,
  regenerate,
}: {
  actor: Actor;
  node: CompetitionNode;
  bracket: CompetitionBracketData;
  brackets: CompetitionBracketData[];
  options: CompetitionOptions | null;
  positionFirst: boolean;
  close: () => void;
  save: (input: CompetitionAction) => Promise<unknown>;
  reload: () => Promise<unknown>;
  stateChanged: (state: { dirty: boolean; busy: boolean }) => void;
  regenerate: () => void;
}) {
  const tr = useT();
  const root = useRef<HTMLElement>(null);
  const [tab, setTab] = useState(positionFirst || !node.matchId ? 'positions' : 'match');
  const [dirty, setDirty] = useState(false);
  const [child, setChild] = useState({ dirty: false, busy: false });
  const [deleting, setDeleting] = useState(false);
  useUnsaved(dirty || child.dirty);
  useEffect(() => {
    stateChanged({ dirty: dirty || child.dirty, busy: child.busy });
    return () => stateChanged({ dirty: false, busy: false });
  }, [dirty, child.dirty, child.busy, stateChanged]);
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
    if (window.innerWidth < 1280) root.current?.scrollIntoView({ block: 'start' });
  }, []);
  const deleted = !!node.match?.deletedAt;
  const round = bracket.rounds.find((round) => round.id === node.roundId);
  const title =
    node.matchNumber || node.match?.matchNumber
      ? tr('Match {0}', node.match?.matchNumber || node.matchNumber)
      : tr('Bracket position {0}', node.position);
  return (
    <aside
      ref={root}
      tabIndex={-1}
      aria-label={tr('Bracket match editor')}
      className="min-w-0 space-y-4 rounded-2xl border border-[var(--accent-border)] bg-card p-4 xl:sticky xl:top-4 [overflow-wrap:anywhere]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted">
            {round && bracketRoundDetails(bracket, round, tr).stage} ·{' '}
            {round && bracketRoundDetails(bracket, round, tr).role}
          </p>
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
        <Button size="icon" variant="ghost" aria-label={tr('Close bracket editor')} onClick={close}>
          <X size={18} />
        </Button>
      </div>
      <div className="space-y-1 border-y py-2">
        {(['A', 'B'] as const).map((side) => (
          <div key={side} className="flex gap-2 text-sm">
            <span className="text-muted">{side}</span>
            <span>{bracketSlotLabel(bracket, node, side, tr)}</span>
          </div>
        ))}
      </div>
      <div role="tablist" aria-label={tr('Match controls')} className="flex flex-wrap gap-1">
        {['match', 'positions'].map((value) => (
          <Button
            role="tab"
            key={value}
            size="sm"
            variant={tab === value ? 'default' : 'ghost'}
            aria-selected={tab === value}
            disabled={child.busy}
            onClick={() => {
              if (tab === value) return;
              if ((dirty || child.dirty) && !window.confirm(tr('Discard unsaved changes?'))) return;
              setDirty(false);
              setChild({ dirty: false, busy: false });
              setTab(value);
            }}
          >
            {tr(value === 'match' ? 'Match' : 'Positions')}
          </Button>
        ))}
      </div>
      {tab === 'positions' ? (
        <EditCompetitionNode
          key={`${node.id}-${bracket.version}`}
          node={node}
          bracket={bracket}
          brackets={brackets}
          options={options}
          close={() => {
            setDirty(false);
            setChild({ dirty: false, busy: false });
            setTab('match');
          }}
          save={save}
          stateChanged={setChild}
        />
      ) : node.matchId ? (
        <BracketMatchTools
          key={node.matchId}
          actor={actor}
          id={node.matchId}
          deleted={deleted}
          stateChanged={setChild}
          reload={reload}
          deleteMatch={() => setDeleting(true)}
        />
      ) : (
        <p className="text-sm text-muted">
          {tr(
            'This position waits for confirmed participants. Assign participants or edit progression in Positions.',
          )}
        </p>
      )}
      {deleted && (
        <Button className="w-full" disabled={child.busy} onClick={regenerate}>
          <RotateCcw size={16} />
          {tr('Regenerate Match')}
        </Button>
      )}
      {!node.matchId && node.state === 'READY' && (
        <Button className="w-full" onClick={regenerate}>
          <Plus size={16} />
          {tr('Generate match')}
        </Button>
      )}
      <DeleteMatchDialog
        match={
          deleting && node.match
            ? {
                id: node.match.id,
                code: String(node.match.matchNumber || node.matchNumber),
                version: node.match.version,
              }
            : null
        }
        onClose={() => setDeleting(false)}
        onDeleted={async () => {
          await reload();
          close();
        }}
      />
    </aside>
  );
}
function BracketMatchTools({
  actor,
  id,
  deleted,
  stateChanged,
  reload,
  deleteMatch,
}: {
  actor: Actor;
  id: string;
  deleted: boolean;
  stateChanged: (state: { dirty: boolean; busy: boolean }) => void;
  reload: () => Promise<unknown>;
  deleteMatch: () => void;
}) {
  const tr = useT();
  const {
    data,
    error,
    reload: reloadMatch,
  } = useResource<{ match: MatchView }>(`match&id=${encodeURIComponent(id)}`);
  const { data: referees } = useResource<RefereeProfile[]>('referees');
  const [inline, setInline] = useState<InlineMatchEdit | null>(null),
    [result, setResult] = useState(false);
  const { busy, run } = useTask();
  useUnsaved(!!inline);
  useEffect(() => {
    if (!result) stateChanged({ dirty: !!inline, busy });
    return () => {
      if (!result) stateChanged({ dirty: false, busy: false });
    };
  }, [inline, busy, result, stateChanged]);
  if (!data) return <LoadingState error={error} retry={() => void reloadMatch()} />;
  const m = data.match;
  const saved = async () => {
    await reloadMatch();
    await reload();
  };
  return (
    <div className="space-y-3">
      <Button asChild size="sm" variant="outline">
        <Link href={`/admin/referee/${m.matchNumber}`}>
          <ExternalLink size={16} />
          {tr(deleted ? 'View history' : 'Referee')}
        </Link>
      </Button>
      {deleted ? (
        <p className="text-sm text-muted">
          {tr(
            'This match is retained as history. Regenerate it to return it to active competition.',
          )}
        </p>
      ) : (
        <>
          {result ? (
            <OrganizerMatchResult
              embedded
              id={id}
              onSaved={saved}
              onClose={() => setResult(false)}
              onStateChange={stateChanged}
            />
          ) : (
            <>
              <button
                type="button"
                className="flex min-h-14 w-full items-center justify-between rounded-xl border border-[var(--accent-border)] bg-primary/5 px-4"
                disabled={
                  !!inline ||
                  busy ||
                  !m.participants.A.id ||
                  !m.participants.B.id ||
                  m.status === 'CANCELLED'
                }
                aria-label={tr('Edit result for match {0}', m.matchNumber)}
                onClick={() => setResult(true)}
              >
                <span className="text-sm">{tr('Result')}</span>
                <strong className="text-xl tabular-nums">
                  {m.forfeitSide === 'A' ? tr('FF') : m.scoreA} :{' '}
                  {m.forfeitSide === 'B' ? tr('FF') : m.scoreB}
                </strong>
                <Pencil size={15} />
              </button>
              {(['time', 'referees'] as const).map((kind) => (
                <div key={kind}>
                  <MatchInlineSchedule
                    match={m}
                    kind={kind}
                    edit={inline}
                    referees={referees || []}
                    busy={busy}
                    onStart={() =>
                      setInline({
                        id,
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
                          id,
                          baseVersion: inline.version,
                          scheduledAt:
                            kind === 'time'
                              ? inline.time
                                ? new Date(inline.time).toISOString()
                                : null
                              : m.scheduledAt,
                          refereeIds:
                            kind === 'referees'
                              ? inline.referees
                              : m.assignments.map((row) => row.userId),
                          notes: m.notes,
                        });
                        setInline(null);
                        await saved();
                      }, tr('Schedule updated.'))
                    }
                  />
                </div>
              ))}
              {!!m.assignments.length && (
                <p className="text-xs text-muted">
                  {m.assignments.map((row) => row.user.username).join(', ')}
                </p>
              )}
              {can(actor, 'matches.delete') && (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={!!inline || busy}
                  onClick={deleteMatch}
                >
                  <Trash2 size={15} />
                  {tr('Delete match')}
                </Button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function CreateCompetition({
  options,
  close,
  save,
  initial,
}: {
  options: CompetitionOptions;
  close: () => void;
  save: (action: CompetitionCreate) => Promise<void>;
  initial?: CompetitionCreate;
}) {
  const tr = useT();
  const [form, setForm] = useState<CompetitionCreate>(() => {
    if (initial) {
      const teamIds =
        initial.sourceStandingId || initial.sourceBracketId
          ? initial.teamIds.filter((id) => options.teams.some((team) => team.id === id))
          : options.teams
              .filter((team) => initial.teamIds.includes(team.id))
              .map((team) => team.id);
      const stageIds = new Set(options.stages.map((stage) => stage.id));
      return {
        ...initial,
        teamIds,
        reviewHash: undefined,
        stageId: stageIds.has(initial.stageId) ? initial.stageId : options.stages[0]?.id || '',
        roundStages:
          teamIds.length !== initial.teamIds.length
            ? {}
            : Object.fromEntries(
                Object.entries(initial.roundStages).filter(([, stageId]) => stageIds.has(stageId)),
              ),
      };
    }
    return {
      type: 'competition.create',
      name: 'Main bracket',
      format: 'SINGLE_ELIMINATION',
      generationKey: crypto.randomUUID(),
      stageId: options.stages[0]?.id || '',
      teamIds: options.teams.map((t) => t.id),
      thirdPlace: false,
      grandFinalReset: true,
      byePlacement: 'TOP_SEEDS',
      groupCount: 1,
      advancePerGroup: 2,
      roundStages: {},
      manualMatches: false,
    };
  });
  const [plan, setPlan] = useState<CompetitionGenerationPreview | null>(null),
    [cutoff, setCutoff] = useState(16);
  const [previewRequest, setPreviewRequest] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');
  useEffect(() => {
    if (!previewRequest) return;
    let current = true;
    setPreviewing(true);
    setPreviewError('');
    const timer = setTimeout(() => {
      void action<CompetitionGenerationPreview>({ ...form, type: 'competition.preview' })
        .then((value) => {
          if (current) setPlan(value);
        })
        .catch((error: Error) => {
          if (current) setPreviewError(error.message);
        })
        .finally(() => {
          if (current) setPreviewing(false);
        });
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [form, previewRequest]);
  const { run, busy } = useTask();
  const change = (value: Partial<CompetitionCreate>) => {
    setForm((f) => ({
      ...f,
      ...value,
      ...((value.format && value.format !== f.format) ||
      (value.teamIds && value.teamIds.length !== f.teamIds.length) ||
      (value.groupCount !== undefined && value.groupCount !== f.groupCount)
        ? { roundStages: {} }
        : {}),
    }));
    if (previewRequest) setPreviewing(true);
  };
  const finalized = options.standings.filter(
    (s) => (s.snapshot as { state?: string })?.state === 'FINALIZED',
  );
  const chooseStanding = (id: string, limit = cutoff) => {
    const record = finalized.find((s) => s.id === id),
      seeds =
        (record?.snapshot as { seeds?: { teamId: string; seed: number; qualified: boolean }[] })
          ?.seeds || [];
    change({
      sourceStandingId: id || undefined,
      sourceBracketId: undefined,
      teamIds: record
        ? seeds
            .filter((s) => s.qualified)
            .sort((a, b) => a.seed - b.seed)
            .slice(0, limit)
            .map((s) => s.teamId)
        : options.teams.map((t) => t.id),
    });
  };
  const chooseGroups = (id: string, limit = cutoff) => {
    const source = options.groupSources?.find((group) => group.id === id);
    change({
      sourceStandingId: undefined,
      sourceBracketId: id || undefined,
      teamIds: source?.seeds.slice(0, limit).map((seed) => seed.teamId) || [],
    });
  };
  const seededSource = !!form.sourceStandingId || !!form.sourceBracketId;
  const move = (index: number, delta: number) => {
    const ids = [...form.teamIds];
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    change({ teamIds: ids });
  };
  return (
    <EditorPanel
      title={tr(initial ? 'Rebuild bracket' : 'Create bracket')}
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
      wide
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy || previewing) return;
          if (!plan || previewError) {
            setPreviewing(true);
            setPreviewRequest((value) => value + 1);
          } else
            void run(async () => {
              try {
                await save({ ...form, reviewHash: plan.reviewHash });
              } catch (error) {
                setPlan(null);
                setPreviewRequest(0);
                throw error;
              }
            });
        }}
      >
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tr('Name')}>
              <input
                value={form.name}
                required
                maxLength={100}
                onChange={(e) => change({ name: e.target.value })}
              />
            </Field>
            <Field label={tr('Format')}>
              <select
                value={form.format}
                onChange={(e) =>
                  // Options the new format has no use for go back to their defaults, so nothing
                  // is saved that the bracket silently ignores.
                  change({
                    format: e.target.value as CompetitionCreate['format'],
                    thirdPlace: false,
                    grandFinalReset: true,
                    groupCount: 1,
                  })
                }
              >
                <option value="SINGLE_ELIMINATION">{tr('Single elimination')}</option>
                <option value="DOUBLE_ELIMINATION">{tr('Double elimination')}</option>
                <option value="GROUPS">{tr('Round-robin groups')}</option>
              </select>
            </Field>
            <Field
              label={tr('Gameplay stage')}
              hint={tr(
                'Starting stage. Later rounds follow the configured stage order; you can override each suggestion below.',
              )}
            >
              <select
                required
                value={form.stageId}
                onChange={(e) => change({ stageId: e.target.value })}
              >
                {!options.stages.length && <option value="">{tr('No configured stages')}</option>}
                {options.stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.ready ? '' : tr(' (pool pending)')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={tr('Seed source')}>
              <select
                value={
                  form.sourceBracketId
                    ? `groups:${form.sourceBracketId}`
                    : form.sourceStandingId || ''
                }
                onChange={(e) =>
                  e.target.value.startsWith('groups:')
                    ? chooseGroups(e.target.value.slice(7))
                    : chooseStanding(e.target.value)
                }
              >
                <option value="">{tr('Participant seeds')}</option>
                {finalized.map((s) => (
                  <option key={s.id} value={s.id}>
                    {tr('Qualifier')} {s.stageId} / {tr('Version')} {s.version}
                  </option>
                ))}
                {options.groupSources?.map((group) => (
                  <option key={group.id} value={`groups:${group.id}`}>
                    {group.name} / {tr('Qualified groups')}
                  </option>
                ))}
              </select>
            </Field>
            {seededSource && (
              <Field label={tr('Advancing participants')}>
                <input
                  type="number"
                  min={2}
                  max={128}
                  value={cutoff}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setCutoff(value);
                    if (form.sourceBracketId) chooseGroups(form.sourceBracketId, value);
                    else chooseStanding(form.sourceStandingId!, value);
                  }}
                />
              </Field>
            )}
            {form.format === 'GROUPS' && (
              <>
                <Field label={tr('Groups')}>
                  <input
                    type="number"
                    min={1}
                    max={32}
                    value={form.groupCount}
                    onChange={(e) => change({ groupCount: Number(e.target.value) })}
                  />
                </Field>
                <Field label={tr('Advance per group')}>
                  <input
                    type="number"
                    min={1}
                    max={32}
                    value={form.advancePerGroup}
                    onChange={(e) => change({ advancePerGroup: Number(e.target.value) })}
                  />
                </Field>
              </>
            )}
          </div>
          {form.format === 'SINGLE_ELIMINATION' && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.thirdPlace}
                onChange={(e) => change({ thirdPlace: e.target.checked })}
              />
              {tr('Third-place match')}
            </label>
          )}
          {form.format === 'DOUBLE_ELIMINATION' && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.grandFinalReset}
                onChange={(e) => change({ grandFinalReset: e.target.checked })}
              />
              {tr('Grand Finals reset')}
            </label>
          )}
          <label className="flex items-start gap-2 rounded-lg border p-3 text-sm">
            <input
              type="checkbox"
              checked={form.manualMatches}
              onChange={(event) => change({ manualMatches: event.target.checked })}
              className="mt-1"
            />
            <span>
              <span className="block font-medium">{tr('Link existing matches')}</span>
              <span className="text-xs text-muted">
                {tr(
                  'Build the bracket without creating replacement matches. Attach existing records to resolved positions while preserving their scores, referee actions, and match IDs.',
                )}
              </span>
            </span>
          </label>
          <fieldset className="min-w-0">
            <legend className="mb-2 text-sm font-semibold">
              {tr('Participants (')}
              {form.teamIds.length})
            </legend>
            <div className="max-h-64 overflow-auto divide-y divide-border border-y border-border">
              {(seededSource
                ? form.teamIds
                    .map((id) => options.teams.find((t) => t.id === id))
                    .filter((t): t is CompetitionOptions['teams'][number] => !!t)
                : [
                    ...form.teamIds
                      .map((id) => options.teams.find((t) => t.id === id))
                      .filter((team): team is CompetitionOptions['teams'][number] => !!team),
                    ...options.teams.filter((t) => !form.teamIds.includes(t.id)),
                  ]
              ).map((team) => {
                const index = form.teamIds.indexOf(team.id);
                return (
                  <div key={team.id} className="flex min-h-11 items-center gap-2 py-1">
                    <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={index >= 0}
                        onChange={(e) =>
                          change({
                            teamIds: e.target.checked
                              ? [...form.teamIds, team.id]
                              : form.teamIds.filter((id) => id !== team.id),
                          })
                        }
                      />
                      <span className="w-6 shrink-0 text-xs tabular-nums text-muted">
                        {index >= 0 ? index + 1 : ''}
                      </span>
                      <span className="truncate">{team.name}</span>
                    </label>
                    {!seededSource && index >= 0 && (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title={tr('Move seed up')}
                          aria-label={tr('Move {0} up', team.name)}
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                        >
                          <ArrowUp size={14} />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title={tr('Move seed down')}
                          aria-label={tr('Move {0} down', team.name)}
                          disabled={index === form.teamIds.length - 1}
                          onClick={() => move(index, 1)}
                        >
                          <ArrowDown size={14} />
                        </Button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>
          {plan && (
            <div className="space-y-3 border-t border-border pt-3">
              <p className="text-sm text-muted">
                {form.teamIds.length} {tr('participants /')} {plan.rounds.length} {tr('rounds /')}{' '}
                {plan.nodes.length} {tr('positions')}
              </p>
              <p className="text-xs text-muted">
                {tr(
                  form.manualMatches
                    ? 'Existing matches keep their own numbers when linked.'
                    : 'Numbers are reserved by stage, Winners then Losers, and round position. Conditional resets reserve a number too.',
                )}
              </p>
              <div className="grid gap-3 sm:grid-cols-2" aria-busy={previewing}>
                {plan.assignments.map((assignment) => {
                  const round = plan.rounds.find((round) => round.key === assignment.roundKey)!;
                  const details = bracketRoundDetails(
                    { format: form.format, rounds: plan.rounds },
                    { ...round, stageName: assignment.stageName },
                    tr,
                  );
                  return (
                    <div
                      key={round.key}
                      data-round-preview={round.key}
                      className="space-y-2 rounded-xl border border-[var(--separator)] bg-card p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
                        <span className="font-semibold">
                          {[details.group, details.role].filter(Boolean).join(' / ')}
                        </span>
                        <span className="rounded-lg bg-[var(--accent-subtle)] px-2 py-1 font-semibold tabular-nums">
                          {assignment.firstMatchNumber == null
                            ? tr(form.manualMatches ? 'Link existing matches' : 'Byes only')
                            : assignment.firstMatchNumber === assignment.lastMatchNumber
                              ? tr('Match #{0}', assignment.firstMatchNumber)
                              : tr(
                                  'Matches #{0}-{1}',
                                  assignment.firstMatchNumber,
                                  assignment.lastMatchNumber!,
                                )}
                        </span>
                      </div>
                      <Field
                        label={tr(
                          'Stage for {0}',
                          [details.group, details.role].filter(Boolean).join(' / '),
                        )}
                      >
                        <select
                          value={form.roundStages[round.key] || ''}
                          onChange={(e) => {
                            const roundStages = { ...form.roundStages };
                            if (e.target.value) roundStages[round.key] = e.target.value;
                            else delete roundStages[round.key];
                            change({ roundStages });
                          }}
                        >
                          <option value="">
                            {tr('Automatic: {0}', assignment.suggestedStageName)}
                          </option>
                          {options.stages.map((stage) => (
                            <option key={stage.id} value={stage.id}>
                              {stage.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {previewing && (
            <p role="status" className="text-sm text-muted">
              {tr('Updating stage and match-number preview...')}
            </p>
          )}
          {previewError && (
            <p role="alert" className="text-sm text-red-300">
              <Feedback message={previewError} />
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              {tr('Cancel')}
            </Button>
            <Button
              type="submit"
              disabled={busy || previewing || form.teamIds.length < 2 || !form.stageId}
            >
              {plan && !previewError ? tr('Generate bracket') : tr('Preview bracket')}
            </Button>
          </div>
        </fieldset>
      </form>
    </EditorPanel>
  );
}
function ReviewGroupTies({
  bracket,
  close,
  save,
}: {
  bracket: CompetitionBracketData;
  close: () => void;
  save: (input: CompetitionAction) => Promise<unknown>;
}) {
  const tr = useT();
  const [order, setOrder] = useState(() =>
    bracket.entries
      .map((entry) => entry.teamId)
      .sort((a, b) => {
        const left = bracket.standings?.find((row) => row.teamId === a),
          right = bracket.standings?.find((row) => row.teamId === b);
        return (
          (left?.group || '').localeCompare(right?.group || '', 'en', { numeric: true }) ||
          (left?.rank || 0) - (right?.rank || 0)
        );
      }),
  );
  const [reason, setReason] = useState('');
  const { run, busy } = useTask();
  const move = (index: number, delta: number) =>
    setOrder((previous) => {
      const next = [...previous];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });
  return (
    <EditorPanel
      title={tr('Review group ties')}
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await save({
              type: 'competition.group.resolve',
              id: bracket.id,
              baseVersion: bracket.version,
              tieOrder: order,
              reason,
            });
            close();
          });
        }}
      >
        <ol className="max-h-80 divide-y divide-border overflow-auto">
          {order.map((id, index) => (
            <li key={id} className="flex items-center gap-2 py-1">
              <span className="w-6 shrink-0 text-xs text-muted">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {bracket.entries.find((entry) => entry.teamId === id)?.team.name}
              </span>
              <span className="text-xs text-muted">
                {bracket.standings?.find((row) => row.teamId === id)?.group.replace('_', ' ')}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title={tr('Move participant up')}
                aria-label={tr('Move seed {0} up', index + 1)}
                disabled={!index}
                onClick={() => move(index, -1)}
              >
                <ArrowUp size={14} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title={tr('Move participant down')}
                aria-label={tr('Move seed {0} down', index + 1)}
                disabled={index === order.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={14} />
              </Button>
            </li>
          ))}
        </ol>
        <Field label={tr('Tiebreak decision')}>
          <textarea
            required
            minLength={3}
            maxLength={1000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            {tr('Cancel')}
          </Button>
          <Button disabled={busy || reason.trim().length < 3}>{tr('Approve order')}</Button>
        </div>
      </form>
    </EditorPanel>
  );
}
function EditCompetitionNode({
  node,
  bracket,
  brackets,
  options,
  close,
  save,
  stateChanged,
}: {
  node: CompetitionNode;
  bracket: CompetitionBracketData;
  brackets: CompetitionBracketData[];
  options: CompetitionOptions | null;
  close: () => void;
  save: (action: CompetitionAction) => Promise<unknown>;
  stateChanged: (state: { dirty: boolean; busy: boolean }) => void;
}) {
  const tr = useT();
  const [side, setSide] = useState<'A' | 'B'>('A'),
    [teamId, setTeam] = useState(node.slots[0]?.teamId || ''),
    [mode, setMode] = useState<'AUTO' | 'MANUAL' | 'LOCKED'>(
      (node.slots[0]?.mode as 'AUTO' | 'MANUAL' | 'LOCKED') || 'AUTO',
    );
  const [sourceNodeId, setSource] = useState(node.slots[0]?.sourceNodeId || ''),
    [outcome, setOutcome] = useState<'WINNER' | 'LOSER'>(
      node.slots[0]?.outcome === 'LOSER' ? 'LOSER' : 'WINNER',
    ),
    [allow, setAllow] = useState(false),
    [reason, setReason] = useState('');
  const [existingMatchId, setExistingMatchId] = useState('');
  const [dirty, setDirty] = useState(false);
  const { run, busy } = useTask();
  useUnsaved(dirty);
  useEffect(() => {
    stateChanged({ dirty, busy });
    return () => stateChanged({ dirty: false, busy: false });
  }, [dirty, busy, stateChanged]);
  const protectedMatch =
    !!node.match && (node.match.status !== 'SCHEDULED' || !!node.match.startedAt);
  const base = { id: bracket.id, baseVersion: bracket.version, nodeId: node.id, side };
  const stageId = bracket.rounds.find((round) => round.id === node.roundId)?.stageId;
  const slotA = node.slots.find((slot) => slot.side === 'A');
  const slotB = node.slots.find((slot) => slot.side === 'B');
  const linkableMatches = (options?.linkableMatches || []).filter(
    (match) =>
      match.stageId === stageId &&
      ((match.teamAId === slotA?.teamId && match.teamBId === slotB?.teamId) ||
        (match.teamAId === slotB?.teamId && match.teamBId === slotA?.teamId)),
  );
  const selectedMatch = linkableMatches.find((match) => match.id === existingMatchId);
  return (
    <div className="space-y-4" onChangeCapture={() => setDirty(true)}>
      {bracket.manualMatches && !node.matchId && node.state === 'READY' && (
        <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <Field label={tr('Existing match')}>
            <select
              value={existingMatchId}
              onChange={(event) => setExistingMatchId(event.target.value)}
            >
              <option value="">{tr('Choose an unlinked match')}</option>
              {linkableMatches.map((match) => (
                <option key={match.id} value={match.id}>
                  {tr('Match')} {match.matchNumber} · {match.teamAName} {tr('vs')} {match.teamBName}{' '}
                  · {tr(humanizeCode(match.status))} · {match.scoreA}-{match.scoreB}
                  {match.teamAId !== slotA?.teamId ? tr(' · reversed sides') : ''}
                </option>
              ))}
            </select>
          </Field>
          {selectedMatch && selectedMatch.teamAId !== slotA?.teamId && (
            <p className="text-xs text-muted">
              {tr('Bracket sides will be swapped to match the original red and blue teams.')}
            </p>
          )}
          {linkableMatches.length ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !selectedMatch}
              onClick={() =>
                void run(async () => {
                  await save({
                    type: 'competition.link-match',
                    id: bracket.id,
                    baseVersion: bracket.version,
                    nodeId: node.id,
                    matchId: existingMatchId,
                    matchVersion: selectedMatch!.version,
                    reverseSides: selectedMatch!.teamAId !== slotA?.teamId,
                  });
                  close();
                })
              }
            >
              {tr('Link existing match')}
            </Button>
          ) : (
            <p className="text-xs text-muted">
              {tr('No unlinked matches have this stage and these participants.')}
            </p>
          )}
        </div>
      )}
      {protectedMatch ? (
        <p className="text-sm text-muted">
          {tr('Participants are protected after a match starts.')}
        </p>
      ) : (
        <>
          <Field label={tr('Position')}>
            <select
              value={side}
              onChange={(e) => {
                const value = e.target.value as 'A' | 'B';
                setSide(value);
                const slot = node.slots.find((s) => s.side === value)!;
                setTeam(slot.teamId || '');
                setSource(slot.sourceNodeId || '');
                setMode(slot.mode as 'AUTO' | 'MANUAL' | 'LOCKED');
                setOutcome(slot.outcome === 'LOSER' ? 'LOSER' : 'WINNER');
              }}
            >
              <option value="A">{tr('Side A')}</option>
              <option value="B">{tr('Side B')}</option>
            </select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tr('Assignment')}>
              <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="AUTO">{tr('Automatic')}</option>
                <option value="MANUAL">{tr('Manual')}</option>
                <option value="LOCKED">{tr('Locked')}</option>
              </select>
            </Field>
            <Field label={tr('Participant')}>
              <select
                disabled={mode === 'AUTO'}
                value={teamId}
                onChange={(e) => setTeam(e.target.value)}
              >
                <option value="">{tr('Bye')}</option>
                {(
                  options?.teams ||
                  bracket.entries.map((e) => ({ id: e.teamId, name: e.team.name }))
                ).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allow} onChange={(e) => setAllow(e.target.checked)} />
            {tr('Allow ineligible participant')}
          </label>
          {allow && (
            <Field label={tr('Override reason')}>
              <input
                value={reason}
                minLength={3}
                maxLength={1000}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          )}
          <Button
            disabled={busy || (allow && reason.trim().length < 3)}
            onClick={() =>
              void run(async () => {
                await save({
                  type: 'competition.slot',
                  ...base,
                  teamId: teamId || null,
                  mode,
                  allowIneligible: allow,
                  reason,
                });
                close();
              })
            }
          >
            {tr('Save position')}
          </Button>
          <details className="border-t border-border pt-3">
            <summary className="cursor-pointer text-sm font-semibold">{tr('Progression')}</summary>
            <div className="mt-3 space-y-3">
              <Field label={tr('Source match')}>
                <select value={sourceNodeId} onChange={(e) => setSource(e.target.value)}>
                  <option value="">{tr('No source')}</option>
                  {brackets.flatMap((b) =>
                    b.nodes
                      .filter((n) => n.id !== node.id)
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          {b.name} /{' '}
                          {n.match
                            ? tr('Match {0}', n.match.matchNumber)
                            : n.matchNumber
                              ? tr('Match {0}', n.matchNumber)
                              : n.key}
                        </option>
                      )),
                  )}
                </select>
              </Field>
              <Field label={tr('Advancing result')}>
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value as typeof outcome)}
                >
                  <option value="WINNER">{tr('Winner')}</option>
                  <option value="LOSER">{tr('Loser')}</option>
                </select>
              </Field>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await save({
                      type: 'competition.route',
                      ...base,
                      sourceNodeId: sourceNodeId || null,
                      outcome: sourceNodeId ? outcome : null,
                    });
                    close();
                  })
                }
              >
                {tr('Save progression')}
              </Button>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
