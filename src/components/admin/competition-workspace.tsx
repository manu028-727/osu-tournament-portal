'use client';
import { humanizeCode } from '@/lib/i18n';
import { Feedback, useT } from '@/components/locale';

import { useState } from 'react';
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
} from 'lucide-react';
import Link, { scopedHref, useTournamentScope } from '@/components/tournament-scope';
import { CompetitionBracket } from '@/components/competition-bracket';
import { Button } from '@/components/ui/button';
import { can, type Actor } from '@/lib/permissions';
import type { CompetitionAction, CompetitionCreate } from '@/lib/competition-validation';
import type { CompetitionPlan } from '@/lib/competition-engine';
import type {
  CompetitionBracketData,
  CompetitionData,
  CompetitionNode,
  CompetitionOptions,
} from '@/lib/competition-types';
import { action, Field, LoadingState, Modal, usePolling, useResource, useTask } from './shared';
import { BracketRoundTools } from './bracket-rounds';

export function CompetitionWorkspace({ actor }: { actor: Actor }) {
  const tr = useT();
  const scope = useTournamentScope();
  const { data, error, reload } = useResource<CompetitionData>('competition', true);
  const [selected, setSelected] = useState(''),
    [creating, setCreating] = useState(false),
    [editing, setEditing] = useState<string | null>(null);
  const [approve, setApprove] = useState(false);
  const [editPositions, setEditPositions] = useState(false);
  const [reviewingTies, setReviewingTies] = useState(false);
  const { run, busy } = useTask();
  usePolling(reload, 10000, !creating && !editing && !reviewingTies);
  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  const bracket = data.brackets.find((b) => b.id === selected) || data.brackets[0];
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
            setSelected(e.target.value);
            setApprove(false);
          }}
        >
          {!data.brackets.length && <option value="">{tr('No brackets')}</option>}
          {data.brackets.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap items-center gap-2">
          {editable && bracket && (
            <>
              {data.options && (
                <BracketRoundTools
                  key={bracket.id}
                  bracket={bracket}
                  options={data.options}
                  save={save}
                />
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
                variant="ghost"
                size="icon"
                title={bracket.published ? tr('Unpublish bracket') : tr('Publish bracket')}
                aria-label={bracket.published ? tr('Unpublish bracket') : tr('Publish bracket')}
                disabled={busy}
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
                disabled={busy}
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
            <Button size="sm" onClick={() => setCreating(true)}>
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
        <CompetitionBracket
          bracket={bracket}
          onSelectNode={
            editable
              ? (id) => {
                  const node = bracket.nodes.find((n) => n.id === id);
                  if (node?.matchId && !editPositions)
                    window.location.href = scopedHref(
                      `/admin/referee/${encodeURIComponent(node.matchId)}`,
                      scope,
                    );
                  else setEditing(id);
                }
              : undefined
          }
          onOpenMatch={(id) => {
            window.location.href = scopedHref(`/admin/referee/${encodeURIComponent(id)}`, scope);
          }}
        />
      ) : (
        <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-muted">
          <GitBranch size={20} />
          {tr('No competition brackets')}
        </div>
      )}
      {creating && data.options && (
        <CreateCompetition
          options={data.options}
          close={() => setCreating(false)}
          save={async (input) => {
            const result = await save(input);
            setSelected(result.id);
            setCreating(false);
          }}
        />
      )}
      {editing && bracket && (
        <EditCompetitionNode
          node={bracket.nodes.find((n) => n.id === editing)!}
          bracket={bracket}
          brackets={data.brackets}
          options={data.options}
          close={() => setEditing(null)}
          save={save}
        />
      )}
      {reviewingTies && bracket && (
        <ReviewGroupTies bracket={bracket} close={() => setReviewingTies(false)} save={save} />
      )}
    </div>
  );
}
// Alias retained for consumers that adopted the initial worker contract.
export const CompetitionManager = CompetitionWorkspace;

function CreateCompetition({
  options,
  close,
  save,
}: {
  options: CompetitionOptions;
  close: () => void;
  save: (action: CompetitionCreate) => Promise<void>;
}) {
  const tr = useT();
  const [form, setForm] = useState<CompetitionCreate>(() => ({
    type: 'competition.create',
    name: 'Main bracket',
    format: 'SINGLE_ELIMINATION',
    generationKey: crypto.randomUUID(),
    stageId: options.stages[0]?.id || '',
    teamIds: options.teams.map((t) => t.id),
    thirdPlace: false,
    grandFinalReset: true,
    groupCount: 1,
    advancePerGroup: 2,
    roundStages: {},
    manualMatches: false,
  }));
  const [plan, setPlan] = useState<CompetitionPlan | null>(null),
    [cutoff, setCutoff] = useState(16);
  const { run, busy } = useTask();
  const change = (value: Partial<CompetitionCreate>) => {
    setForm((f) => ({ ...f, ...value }));
    setPlan(null);
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
    <Modal
      title={tr('Create bracket')}
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      wide
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            if (!plan)
              setPlan(await action<CompetitionPlan>({ ...form, type: 'competition.preview' }));
            else await save(form);
          });
        }}
      >
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
              onChange={(e) => change({ format: e.target.value as CompetitionCreate['format'] })}
            >
              <option value="SINGLE_ELIMINATION">{tr('Single elimination')}</option>
              <option value="DOUBLE_ELIMINATION">{tr('Double elimination')}</option>
              <option value="GROUPS">{tr('Round-robin groups')}</option>
            </select>
          </Field>
          <Field label={tr('Gameplay stage')}>
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
        <fieldset>
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
                  ...form.teamIds.map((id) => options.teams.find((t) => t.id === id)!),
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
            <div className="grid gap-3 sm:grid-cols-2">
              {plan.rounds.map((round) => (
                <Field key={round.key} label={round.name}>
                  <select
                    value={form.roundStages[round.key] || form.stageId}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        roundStages: { ...f.roundStages, [round.key]: e.target.value },
                      }))
                    }
                  >
                    {options.stages.map((stage) => (
                      <option key={stage.id} value={stage.id}>
                        {stage.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            {tr('Cancel')}
          </Button>
          <Button type="submit" disabled={busy || form.teamIds.length < 2 || !form.stageId}>
            {plan ? tr('Generate bracket') : tr('Preview bracket')}
          </Button>
        </div>
      </form>
    </Modal>
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
    <Modal
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
    </Modal>
  );
}
function EditCompetitionNode({
  node,
  bracket,
  brackets,
  options,
  close,
  save,
}: {
  node: CompetitionNode;
  bracket: CompetitionBracketData;
  brackets: CompetitionBracketData[];
  options: CompetitionOptions | null;
  close: () => void;
  save: (action: CompetitionAction) => Promise<unknown>;
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
  const { run, busy } = useTask();
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
    <Modal
      title={
        node.match
          ? tr('Match {0}', node.match.matchNumber)
          : node.matchNumber
            ? tr('Match {0}', node.matchNumber)
            : node.key
      }
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <div className="space-y-4">
        {node.matchId && (
          <Button asChild variant="outline">
            <Link href={`/admin/referee/${node.matchId}`}>
              <ExternalLink size={16} />
              {tr('Open match')}
            </Link>
          </Button>
        )}
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
                    {tr('Match')} {match.matchNumber} · {match.teamAName} {tr('vs')}{' '}
                    {match.teamBName} · {tr(humanizeCode(match.status))} · {match.scoreA}-
                    {match.scoreB}
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
              <summary className="cursor-pointer text-sm font-semibold">
                {tr('Progression')}
              </summary>
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
    </Modal>
  );
}
