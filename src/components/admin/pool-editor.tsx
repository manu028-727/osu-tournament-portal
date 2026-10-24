'use client';
import { formatNumber, humanizeCode } from '@/lib/i18n';
import { Feedback, useLocale, useT } from '@/components/locale';

import Link from '@/components/tournament-scope';
import { useEffect, useState } from 'react';
import {
  Plus,
  Eye,
  Save,
  Send,
  Trash2,
  Download,
  RefreshCw,
  SlidersHorizontal,
  ArrowUpRight,
  ListFilter,
  Check,
} from 'lucide-react';
import { Button } from '../ui/button';
import { StateBadge, Badge } from '../ui/badge';
import { EmptyState, PoolDisplay } from '../content';
import { can, type Actor } from '@/lib/permissions';
import type { PoolContent } from '@/lib/types';
import type { BeatmapMetadata } from '@/lib/osu';
import { parseImport } from '@/lib/validation';
import {
  action,
  api,
  ConfirmButton,
  Field,
  LoadingState,
  Modal,
  SaveButton,
  useResource,
  useTask,
  useUnsaved,
} from './shared';
import { PoolSlotTable, type EditorSlot } from './pool-slot-table';
import { movePoolSlot, nextSlotName, poolSlotErrors, sortPoolSlots } from '@/lib/mappool-order';
import type { PoolPlanView } from '@/lib/pooling-types';
import { PoolReleaseManager } from './pool-release-manager';
type Category = {
  id: string;
  version: number;
  name: string;
  acronym: string;
  color: string;
  position: number;
};
type Pool = {
  id: string;
  state: string;
  draftRevisionId: string | null;
  publishedRevisionId: string | null;
  draftRevision: PoolContent | null;
  publishedRevision: PoolContent | null;
};
type Stage = {
  id: string;
  name: string;
  slug: string;
  description: string;
  position: number;
  startsAt: string | null;
  bannerImageId?: string | null;
  mappool: Pool | null;
  poolPlan: PoolPlanView | null;
};
type Data = { stages: Stage[]; categories: Category[] };
const hasPoolSource = (stage: Stage) =>
  !!(
    stage.poolPlan?.slots.length ||
    stage.mappool?.draftRevision?.slots.length ||
    stage.mappool?.publishedRevision?.slots.length
  );
type Slot = EditorSlot;
const slotErrors = (slots: Slot[], categories: Category[]) =>
  poolSlotErrors(
    slots.map((slot) => ({ ...slot, beatmapId: slot.beatmapId === 0 ? 1 : slot.beatmapId })),
    categories,
  );
export function PoolEditor({
  actor,
  initialStageId = '',
}: {
  actor: Actor;
  initialStageId?: string;
}) {
  const tr = useT();
  const language = useLocale();
  const { data, error, reload } = useResource<Data>('mappools');
  const { busy, run, notify } = useTask();
  const [active, setActive] = useState(initialStageId),
    [slots, setSlots] = useState<Slot[]>([]),
    [notes, setNotes] = useState(''),
    [base, setBase] = useState<string | null>(null),
    [metadata, setMetadata] = useState<Record<number, BeatmapMetadata>>({}),
    [errors, setErrors] = useState<Record<number, string>>({}),
    [dirty, setDirty] = useState(false),
    [importing, setImporting] = useState(false),
    [bulk, setBulk] = useState(''),
    [defaultMod, setDefaultMod] = useState('NM'),
    [copyOpen, setCopyOpen] = useState(false),
    [copySource, setCopySource] = useState(''),
    [copyMode, setCopyMode] = useState<'structure' | 'contents'>('structure'),
    [distributionOpen, setDistributionOpen] = useState(false),
    [distribution, setDistribution] = useState<Record<string, number>>({}),
    [minStars, setMinStars] = useState(''),
    [maxStars, setMaxStars] = useState(''),
    [transferSlots, setTransferSlots] = useState<string[] | null>(null),
    [transferTarget, setTransferTarget] = useState(''),
    [transferMode, setTransferMode] = useState<'COPY' | 'MOVE'>('COPY'),
    [transferReplace, setTransferReplace] = useState(false),
    [preview, setPreview] = useState(false),
    [categoriesOpen, setCategoriesOpen] = useState(false),
    [categoryDraft, setCategoryDraft] = useState<Partial<Category>>({});
  const stage = data?.stages.find((s) => s.id === active),
    pool = stage?.mappool;
  const populatedMaps = slots
    .map((slot) => metadata[slot.beatmapId])
    .filter((map): map is BeatmapMetadata => !!map);
  const average = (key: 'stars' | 'bpm' | 'length') =>
    populatedMaps.length
      ? populatedMaps.reduce((sum, map) => sum + map[key], 0) / populatedMaps.length
      : null;
  const editable = can(actor, 'mappools.edit'),
    publisher = can(actor, 'mappools.publish');
  useEffect(() => {
    if (data && !active && data.stages[0]) setActive(data.stages[0].id);
  }, [data, active]);
  useEffect(() => {
    const revision = pool?.draftRevision || pool?.publishedRevision;
    const filled =
      revision?.slots.map((s) => ({
        name: s.name,
        category: s.category,
        beatmapId: s.beatmapId,
        editorId: s.id || crypto.randomUUID(),
      })) || [];
    const empty = (stage?.poolPlan?.slots || [])
      .filter((planned) => !filled.some((slot) => slot.name === planned.name))
      .map((planned) => ({ ...planned, beatmapId: 0, editorId: crypto.randomUUID() }));
    setSlots(sortPoolSlots([...filled, ...empty], data?.categories));
    setMinStars(stage?.poolPlan?.minStars?.toString() || '');
    setMaxStars(stage?.poolPlan?.maxStars?.toString() || '');
    setNotes(revision?.notes || '');
    setBase(pool?.draftRevisionId || null);
    setMetadata(Object.fromEntries((revision?.slots || []).map((s) => [s.beatmapId, s.metadata])));
    setErrors({});
    setDirty(false);
  }, [pool, stage?.poolPlan, data?.categories]);
  useUnsaved(dirty);
  const lookup = async (next: Slot[]) => {
    const ids = next.map((s) => s.beatmapId).filter((id) => id > 0);
    if (!ids.length) return;
    const result = await api<{ maps: BeatmapMetadata[]; errors: { id: number; error: string }[] }>(
      '/api/admin/beatmaps',
      { method: 'POST', body: JSON.stringify({ ids }) },
    );
    setMetadata((prev) => ({ ...prev, ...Object.fromEntries(result.maps.map((m) => [m.id, m])) }));
    setErrors(Object.fromEntries(result.errors.map((e) => [e.id, e.error])));
    return result;
  };
  const update = (editorId: string, change: Partial<Slot>) => {
    setSlots((s) => s.map((v) => (v.editorId === editorId ? { ...v, ...change } : v)));
    setDirty(true);
  };
  const applyDistribution = () => {
    const generated: Slot[] = [];
    for (const category of data!.categories) {
      const count = distribution[category.acronym] || 0;
      for (let index = 1; index <= count; index++)
        generated.push({
          name: `${category.acronym}${index}`,
          category: category.acronym,
          beatmapId: 0,
          editorId: crypto.randomUUID(),
        });
    }
    if (!generated.length) throw new Error('Enter at least one slot count.');
    if (generated.length > 100) throw new Error('A mappool can contain at most 100 maps.');
    setSlots(generated);
    setMetadata({});
    setErrors({});
    setDirty(true);
    setDistributionOpen(false);
  };
  const copyPool = () => {
    const source = data!.stages.find((candidate) => candidate.id === copySource);
    const revision = source?.mappool?.draftRevision || source?.mappool?.publishedRevision;
    if (!source || (!revision && !source.poolPlan))
      throw new Error('Choose a stage with a saved pool or plan.');
    if (copyMode === 'contents' && !revision)
      throw new Error('The source stage has no saved beatmaps.');
    const sourceSlots =
      copyMode === 'structure' && source.poolPlan?.slots.length
        ? source.poolPlan.slots.map((slot) => ({ ...slot, beatmapId: 0 }))
        : revision?.slots || [];
    const copied = sortPoolSlots(
      sourceSlots.map((slot) => ({
        name: slot.name,
        category: slot.category,
        beatmapId: copyMode === 'contents' ? slot.beatmapId : 0,
        editorId: crypto.randomUUID(),
      })),
      data!.categories,
    );
    if (copied.length > 100) throw new Error('A mappool can contain at most 100 maps.');
    setSlots(copied);
    setMetadata(
      copyMode === 'contents'
        ? Object.fromEntries(revision!.slots.map((slot) => [slot.beatmapId, slot.metadata]))
        : {},
    );
    setErrors({});
    setNotes(copyMode === 'contents' ? revision!.notes : '');
    setMinStars(source.poolPlan?.minStars?.toString() || '');
    setMaxStars(source.poolPlan?.maxStars?.toString() || '');
    setDirty(true);
    setCopyOpen(false);
  };
  const save = () =>
    run(async () => {
      const problems = slotErrors(slots, data!.categories);
      if (problems.length) throw new Error(problems.join(' '));
      const ordered = sortPoolSlots(slots, data!.categories);
      await action({
        type: 'pool.save',
        id: pool!.id,
        baseRevisionId: base,
        notes,
        plan: {
          baseVersion: stage?.poolPlan?.version ?? null,
          slots: ordered.map(({ name, category }) => ({ name, category })),
          minStars: minStars === '' ? null : Number(minStars),
          maxStars: maxStars === '' ? null : Number(maxStars),
        },
        slots: ordered
          .filter((slot) => slot.beatmapId > 0)
          .map(({ editorId, ...slot }) => {
            void editorId;
            return slot;
          }),
      });
      await reload();
    }, tr('Mappool draft saved.'));
  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{tr('Mappool manager')}</h1>
        <div className="flex gap-2">
          {editable && (
            <Button
              variant="outline"
              size="sm"
              disabled={dirty}
              onClick={() => setCategoriesOpen(true)}
            >
              <SlidersHorizontal size={13} />
              {tr('Mod categories')}
            </Button>
          )}
          {can(actor, 'mappools.create') && (
            <Button asChild size="sm">
              <Link href="/admin/mappools?view=stages&new=1&return=pool">
                <Plus size={14} />
                {tr('New stage')}
              </Link>
            </Button>
          )}
        </div>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {data.stages.map((s) => (
          <button
            key={s.id}
            disabled={busy}
            onClick={() => {
              if (dirty && !window.confirm(tr('Discard unsaved changes and switch stages?')))
                return;
              setActive(s.id);
            }}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${active === s.id ? 'border-primary/30 bg-primary/10 text-primary' : 'bg-card text-muted hover:text-foreground'}`}
          >
            {s.name}
            <span
              className={`size-1 rounded-full ${s.mappool?.state === 'PUBLISHED' ? 'bg-emerald-300' : 'bg-muted/50'}`}
            />
          </button>
        ))}
      </div>
      {stage && pool ? (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-semibold tracking-normal">{stage.name}</h2>
              <StateBadge state={pool.state} />
              {dirty && <span className="text-xs text-amber-200">{tr('Unsaved changes')}</span>}
              {pool.draftRevisionId !== pool.publishedRevisionId && pool.draftRevisionId && (
                <Badge>{tr('Draft changes')}</Badge>
              )}
            </div>
            <div className="flex gap-2">
              {publisher && (
                <PoolReleaseManager
                  stages={data.stages}
                  disabled={busy || dirty}
                  onSaved={reload}
                />
              )}
              {editable && (
                <Button asChild size="sm" variant="ghost" disabled={dirty}>
                  <Link href={`/admin/mappools?view=stages&stage=${stage.id}&return=pool`}>
                    {tr('Stage settings')}
                  </Link>
                </Button>
              )}
              {pool.state === 'PUBLISHED' && (
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/mappools/${stage.slug}`} target="_blank" rel="noopener noreferrer">
                    {tr('Public page')}
                    <ArrowUpRight size={12} />
                  </Link>
                </Button>
              )}
            </div>
          </div>
          <div className="mb-3 flex flex-wrap justify-between gap-3 border-y py-3">
            <div className="flex flex-wrap gap-2">
              {editable && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setImporting(true)}
                  >
                    <Download size={13} />
                    {tr('Bulk import')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      busy ||
                      dirty ||
                      !data.stages.some(
                        (candidate) => candidate.id !== stage.id && hasPoolSource(candidate),
                      )
                    }
                    onClick={() => {
                      setCopySource(
                        data.stages.find(
                          (candidate) => candidate.id !== stage.id && hasPoolSource(candidate),
                        )?.id || '',
                      );
                      setCopyMode('structure');
                      setCopyOpen(true);
                    }}
                  >
                    {tr('Copy from stage')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      if (dirty && !window.confirm(tr('Replace the current unsaved pool edits?')))
                        return;
                      setDistribution(
                        Object.fromEntries(
                          data.categories.map((category) => [category.acronym, 0]),
                        ),
                      );
                      setDistributionOpen(true);
                    }}
                  >
                    {tr('Build slot plan')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      const c = data.categories[0]?.acronym || 'NM';
                      setSlots([
                        ...slots,
                        {
                          name: nextSlotName(slots, c),
                          category: c,
                          beatmapId: 0,
                          editorId: crypto.randomUUID(),
                        },
                      ]);
                      setDirty(true);
                    }}
                  >
                    <Plus size={13} />
                    {tr('Add beatmap')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !slots.length}
                    onClick={() => void run(() => lookup(slots), tr('Metadata refreshed.'))}
                  >
                    <RefreshCw size={13} />
                    {tr('Fetch metadata')}
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={dirty || !pool.draftRevision}
                onClick={() => setPreview(true)}
              >
                <Eye size={13} />
                {tr('Preview draft')}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {editable && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !slots.length}
                  onClick={() => {
                    setSlots(sortPoolSlots(slots, data.categories));
                    setDirty(true);
                  }}
                >
                  <ListFilter size={15} />
                  {tr('Sort by Slot')}
                </Button>
              )}
              {editable && (
                <SaveButton
                  size="sm"
                  busy={busy}
                  disabled={busy || !dirty}
                  onClick={() => void save()}
                >
                  <Save size={13} />
                  {tr('Save draft')}
                </SaveButton>
              )}
              {publisher && (
                <ConfirmButton
                  variant="default"
                  title={tr('Publish {0}?', stage.name)}
                  description={tr(
                    'The saved draft will become publicly visible. Review every slot before releasing.',
                  )}
                  disabled={
                    busy ||
                    dirty ||
                    !pool.draftRevisionId ||
                    pool.publishedRevisionId === pool.draftRevisionId
                  }
                  onConfirm={() =>
                    void run(async () => {
                      await action({
                        type: 'pool.publish',
                        id: pool.id,
                        revisionId: pool.draftRevisionId,
                      });
                      await reload();
                    }, tr('Mappool published.'))
                  }
                >
                  <Send size={13} />
                  {tr('Publish')}
                </ConfirmButton>
              )}
              {publisher && pool.state === 'PUBLISHED' && (
                <ConfirmButton
                  title={tr('Unpublish this mappool?')}
                  description={tr(
                    'This pool will immediately become unavailable on public pages and direct URLs.',
                  )}
                  disabled={busy}
                  onConfirm={() =>
                    void run(async () => {
                      await action({ type: 'pool.unpublish', id: pool.id });
                      await reload();
                    }, tr('Mappool unpublished.'))
                  }
                >
                  {tr('Unpublish')}
                </ConfirmButton>
              )}
            </div>
          </div>
          <div className="mb-3 flex flex-wrap items-end gap-3 border-b pb-3">
            <p className="mr-auto self-center text-sm text-muted">
              {slots.filter((slot) => slot.beatmapId > 0).length}/{slots.length} {tr('filled')}
              {' · '}
              {tr(humanizeCode(stage.poolPlan?.reviewState || 'DRAFT'))}
            </p>
            <Field label={tr('SR target min')}>
              <input
                aria-label={tr('SR target minimum')}
                className="w-28"
                type="number"
                min={0}
                max={30}
                step={0.1}
                value={minStars}
                disabled={!editable || busy}
                onChange={(event) => {
                  setMinStars(event.target.value);
                  setDirty(true);
                }}
              />
            </Field>
            <Field label={tr('SR target max')}>
              <input
                aria-label={tr('SR target maximum')}
                className="w-28"
                type="number"
                min={0}
                max={30}
                step={0.1}
                value={maxStars}
                disabled={!editable || busy}
                onChange={(event) => {
                  setMaxStars(event.target.value);
                  setDirty(true);
                }}
              />
            </Field>
            {stage.poolPlan && editable && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || dirty || stage.poolPlan.reviewState === 'REVIEW'}
                onClick={() =>
                  void run(async () => {
                    await action({
                      type: 'pooling.plan.review',
                      stageId: stage.id,
                      baseVersion: stage.poolPlan!.version,
                      state: 'REVIEW',
                    });
                    await reload();
                  }, tr('Pool ready for review.'))
                }
              >
                <Send size={14} />
                {tr('Request review')}
              </Button>
            )}
            {stage.poolPlan && publisher && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || dirty || stage.poolPlan.reviewState === 'APPROVED'}
                onClick={() =>
                  void run(async () => {
                    await action({
                      type: 'pooling.plan.review',
                      stageId: stage.id,
                      baseVersion: stage.poolPlan!.version,
                      state: 'APPROVED',
                    });
                    await reload();
                  }, tr('Pool approved.'))
                }
              >
                <Check size={14} />
                {tr('Approve')}
              </Button>
            )}
          </div>
          <div className="space-y-3">
            {slotErrors(slots, data.categories).map((problem, index) => (
              <p key={problem + index} role="alert" className="text-sm text-red-300">
                <Feedback message={problem} />
              </p>
            ))}
            {slots.length ? (
              <PoolSlotTable
                slots={slots}
                categories={data.categories}
                metadata={metadata}
                errors={errors}
                disabled={!editable || busy}
                onUpdate={update}
                onMove={(id, direction) => {
                  if (slotErrors(slots, data.categories).length) {
                    notify(tr('Resolve invalid or duplicate slots before moving maps.'), true);
                    return;
                  }
                  setSlots(movePoolSlot(slots, id, direction, data.categories));
                  setDirty(true);
                }}
                onRemove={(id) => {
                  setSlots(slots.filter((s) => s.editorId !== id));
                  setDirty(true);
                }}
                onCopy={(text) => {
                  void run(async () => {
                    await navigator.clipboard.writeText(text);
                  }, tr('Beatmap ID copied.'));
                }}
                onBulkRemove={(ids) => {
                  const removed = new Set(ids);
                  setSlots((current) => current.filter((slot) => !removed.has(slot.editorId)));
                  setDirty(true);
                }}
                transferDisabled={dirty || !(pool.draftRevision || pool.publishedRevision)}
                onBulkTransfer={(names) => {
                  setTransferSlots(names);
                  setTransferTarget(
                    data.stages.find((candidate) => candidate.id !== stage.id && candidate.mappool)
                      ?.id || '',
                  );
                  setTransferMode('COPY');
                  setTransferReplace(false);
                }}
                onBulkCategory={(ids, category) => {
                  const selected = new Set(ids);
                  const working = slots.map((slot) => ({ ...slot }));
                  for (let index = 0; index < working.length; index++) {
                    if (!selected.has(working[index].editorId)) continue;
                    const current = working[index];
                    const name = nextSlotName(
                      working.filter((slot) => slot.editorId !== current.editorId),
                      category,
                    );
                    working[index] = { ...current, category, name };
                  }
                  const problems = slotErrors(working, data.categories);
                  if (problems.length) {
                    notify(problems[0], true);
                    return;
                  }
                  setSlots(sortPoolSlots(working, data.categories));
                  setDirty(true);
                }}
              />
            ) : (
              <EmptyState
                title={tr('No beatmaps')}
                description={tr('This stage has no draft slots.')}
              />
            )}
            <details className="border-b py-3">
              <summary className="cursor-pointer text-sm font-medium">
                {tr('Mappool notes')}
              </summary>
              <div className="pt-3">
                <Field label={tr('Mappool notes')}>
                  <textarea
                    disabled={!editable || busy}
                    value={notes}
                    onChange={(e) => {
                      setNotes(e.target.value);
                      setDirty(true);
                    }}
                  />
                </Field>
              </div>
            </details>
          </div>
          <div className="mt-8 flex items-center justify-between border-t pt-5">
            <span className="text-xs text-muted">
              {slots.length} {tr('slots ·')} {populatedMaps.length} {tr('filled')}
              {average('stars') !== null && (
                <>
                  {' · '}
                  {tr('Avg')} {formatNumber(average('stars')!, language, 2)}★{' · '}
                  {tr('Avg')} {formatNumber(average('bpm')!, language, 0)} {tr('BPM')}
                  {' · '}
                  {tr('Avg')} {Math.floor(average('length')! / 60)}:
                  {String(Math.round(average('length')!) % 60).padStart(2, '0')} {tr('drain')}
                  {' · '}
                  {tr('SR')}{' '}
                  {formatNumber(Math.min(...populatedMaps.map((map) => map.stars)), language, 2)}–
                  {formatNumber(Math.max(...populatedMaps.map((map) => map.stars)), language, 2)}
                  {((minStars !== '' && average('stars')! < Number(minStars)) ||
                    (maxStars !== '' && average('stars')! > Number(maxStars))) && (
                    <span className="ml-2 text-amber-400">
                      {tr('Average outside the suggested target')}
                    </span>
                  )}
                </>
              )}
              {' · '}
              {tr('Saving creates an independent draft revision')}
            </span>
            {can(actor, 'mappools.delete') && (
              <ConfirmButton
                title={tr('Delete {0}?', stage.name)}
                description={tr(
                  'This deletes the stage, every mappool revision, and its public URL. This cannot be undone.',
                )}
                disabled={busy}
                onConfirm={() =>
                  void run(async () => {
                    await action({ type: 'stage.delete', id: stage.id });
                    setActive('');
                    await reload();
                  }, tr('Stage deleted.'))
                }
              >
                <Trash2 size={13} />
                {tr('Delete stage')}
              </ConfirmButton>
            )}
          </div>
        </>
      ) : (
        <EmptyState
          title={tr('No tournament stages')}
          description={tr('Create a tournament stage to start preparing its mappool.')}
        />
      )}
      <Modal
        open={importing}
        onOpenChange={setImporting}
        title={tr('Bulk-import beatmaps')}
        description={tr('Enter one beatmap ID per line, or map slots with NM1: 123456.')}
      >
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const imported = parseImport(bulk, defaultMod);
              const lines = bulk.split(/\r?\n/).filter((s) => s.trim());
              const next = [...slots];
              imported.forEach((slot, index) => {
                const plain = /^(?:\d+|https?:\/\/)/i.test(lines[index].trim());
                const empty = next.findIndex(
                  (current) =>
                    !current.beatmapId &&
                    (plain ? current.category === defaultMod : current.name === slot.name),
                );
                if (empty >= 0) next[empty] = { ...next[empty], beatmapId: slot.beatmapId };
                else {
                  if (!plain && next.some((current) => current.name === slot.name))
                    throw new Error(
                      `${slot.name} is already filled. Replace it explicitly in the table.`,
                    );
                  next.push({
                    ...slot,
                    name: plain ? nextSlotName(next, defaultMod) : slot.name,
                    editorId: crypto.randomUUID(),
                  });
                }
              });
              if (next.length > 100) throw new Error('A mappool can contain at most 100 maps.');
              if (next.some((s) => !data.categories.some((c) => c.acronym === s.category)))
                throw new Error(
                  'A slot uses an unknown mod category. Create it first or adjust the slot name.',
                );
              const problems = slotErrors(next, data.categories);
              if (problems.length) throw new Error(problems.join(' '));
              await lookup(next);
              setSlots(next);
              setDirty(true);
              setBulk('');
              setImporting(false);
            }, tr('Beatmaps imported. Review metadata before saving.'));
          }}
        >
          <Field label={tr('Default category for plain IDs')}>
            <select value={defaultMod} onChange={(e) => setDefaultMod(e.target.value)}>
              {data.categories.map((c) => (
                <option key={c.id}>{c.acronym}</option>
              ))}
            </select>
          </Field>
          <Field label={tr('Beatmap IDs or slot mappings')}>
            <textarea
              className="min-h-56 font-mono"
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              required
              placeholder={tr('NM1: 123456\nNM2: 234567\nHD1: 345678')}
            />
          </Field>
          <SaveButton busy={busy}>{tr('Import & fetch metadata')}</SaveButton>
        </form>
      </Modal>
      <Modal
        open={copyOpen}
        onOpenChange={setCopyOpen}
        title={tr('Copy mappool from another stage')}
        description={tr(
          'This creates an independent draft. The source pool and its publication state are unchanged.',
        )}
      >
        <div className="space-y-4">
          <Field label={tr('Source stage')}>
            <select value={copySource} onChange={(event) => setCopySource(event.target.value)}>
              {data.stages
                .filter((candidate) => candidate.id !== stage?.id && hasPoolSource(candidate))
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
            </select>
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">{tr('What to copy')}</legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="pool-copy-mode"
                checked={copyMode === 'structure'}
                onChange={() => setCopyMode('structure')}
              />
              <span>
                <strong>{tr('Structure only')}</strong>
                <span className="block text-muted">
                  {tr('Copy slot names and mod categories, leaving every beatmap empty.')}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="pool-copy-mode"
                checked={copyMode === 'contents'}
                onChange={() => setCopyMode('contents')}
              />
              <span>
                <strong>{tr('Pool contents')}</strong>
                <span className="block text-muted">
                  {tr('Copy slots, beatmaps, and pool notes into a new independent draft.')}
                </span>
              </span>
            </label>
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCopyOpen(false)}>
              {tr('Cancel')}
            </Button>
            <Button
              disabled={!copySource || busy}
              onClick={() => void run(async () => copyPool(), tr('Pool copied to this draft.'))}
            >
              {tr('Copy to draft')}
            </Button>
          </div>
        </div>
      </Modal>
      <Modal
        open={!!transferSlots}
        onOpenChange={(open) => {
          if (!open) setTransferSlots(null);
        }}
        title={tr('Transfer selected maps')}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const destination = data.stages.find((candidate) => candidate.id === transferTarget);
              const revision = pool?.draftRevision || pool?.publishedRevision;
              if (!pool || !revision || !destination?.mappool)
                throw new Error('Choose a destination with a mappool.');
              await action({
                type: 'pooling.pool.transfer',
                sourcePoolId: pool.id,
                sourceRevisionId: revision.id,
                targetStageId: destination.id,
                targetBaseRevisionId: destination.mappool.draftRevisionId,
                slotNames: transferSlots || [],
                mode: transferMode,
                replace: transferReplace,
              });
              setTransferSlots(null);
              await reload();
            }, tr('Selected maps transferred into independent drafts.'));
          }}
        >
          <p className="text-sm text-muted">{transferSlots?.join(', ')}</p>
          <Field label={tr('Destination stage')}>
            <select
              required
              value={transferTarget}
              onChange={(event) => setTransferTarget(event.target.value)}
            >
              <option value="">{tr('Choose stage')}</option>
              {data.stages
                .filter((candidate) => candidate.id !== stage?.id && candidate.mappool)
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label={tr('Operation')}>
            <select
              value={transferMode}
              onChange={(event) => setTransferMode(event.target.value as 'COPY' | 'MOVE')}
            >
              <option value="COPY">{tr('Copy to destination draft')}</option>
              <option value="MOVE">{tr('Move between drafts')}</option>
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={transferReplace}
              onChange={(event) => setTransferReplace(event.target.checked)}
            />
            {tr('Replace matching destination slots')}
          </label>
          <p className="text-xs text-muted">
            {tr('Published versions remain visible until the revised drafts are published.')}
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setTransferSlots(null)}>
              {tr('Cancel')}
            </Button>
            <SaveButton busy={busy} disabled={!transferTarget}>
              {tr('Transfer')} {transferSlots?.length} {tr('maps')}
            </SaveButton>
          </div>
        </form>
      </Modal>
      <Modal
        open={distributionOpen}
        onOpenChange={setDistributionOpen}
        title={tr('Build mappool slot plan')}
        description={tr(
          'Choose how many slots to prepare for each mod. Generated slots start without a beatmap.',
        )}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {data.categories.map((category) => (
              <Field key={category.id} label={`${category.acronym} · ${category.name}`}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={distribution[category.acronym] || 0}
                  onChange={(event) =>
                    setDistribution((current) => ({
                      ...current,
                      [category.acronym]: Number(event.target.value),
                    }))
                  }
                />
              </Field>
            ))}
          </div>
          <p className="text-xs text-muted">
            {tr('Empty slots can be saved as a draft. Fill the plan before publishing.')}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDistributionOpen(false)}>
              {tr('Cancel')}
            </Button>
            <Button
              onClick={() => void run(async () => applyDistribution(), tr('Slot plan created.'))}
            >
              {tr('Create slots')}
            </Button>
          </div>
        </div>
      </Modal>
      <Modal
        open={categoriesOpen}
        onOpenChange={setCategoriesOpen}
        title={tr('Mod categories')}
        description={tr(
          'Categories are customizable. Published revisions retain their original category names and colors.',
        )}
      >
        <div className="mb-7 space-y-2">
          {data.categories.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-lg border p-3">
              <span className="w-8 text-xs font-semibold" style={{ color: c.color }}>
                {c.acronym}
              </span>
              <span className="flex-1 text-xs">{c.name}</span>
              <Button size="sm" variant="ghost" onClick={() => setCategoryDraft(c)}>
                {tr('Edit')}
              </Button>
              <ConfirmButton
                title={tr('Delete {0}?', c.name)}
                description={tr(
                  'Saved revisions are preserved. New drafts must use existing categories.',
                )}
                onConfirm={() =>
                  void run(async () => {
                    await action({ type: 'category.delete', id: c.id, baseVersion: c.version });
                    await reload();
                  }, tr('Category deleted.'))
                }
              >
                <Trash2 size={12} />
              </ConfirmButton>
            </div>
          ))}
        </div>
        <form
          className="space-y-4 border-t pt-5"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await action({
                type: 'category.save',
                name: '',
                acronym: '',
                color: '#b6a0e5',
                position: data.categories.length,
                ...categoryDraft,
                baseVersion: categoryDraft.version,
              });
              setCategoryDraft({});
              await reload();
            }, tr('Category saved.'));
          }}
        >
          <h3 className="text-sm font-semibold">
            {categoryDraft.id ? tr('Edit category') : tr('Add category')}
          </h3>
          <div className="grid-fields">
            <Field label={tr('Name')}>
              <input
                required
                value={categoryDraft.name || ''}
                onChange={(e) => setCategoryDraft({ ...categoryDraft, name: e.target.value })}
              />
            </Field>
            <Field label={tr('Acronym')}>
              <input
                required
                value={categoryDraft.acronym || ''}
                onChange={(e) =>
                  setCategoryDraft({ ...categoryDraft, acronym: e.target.value.toUpperCase() })
                }
              />
            </Field>
            <Field label={tr('Color')}>
              <input
                type="color"
                value={categoryDraft.color || '#b6a0e5'}
                onChange={(e) => setCategoryDraft({ ...categoryDraft, color: e.target.value })}
              />
            </Field>
            <Field label={tr('Order')}>
              <input
                type="number"
                min={0}
                value={categoryDraft.position ?? data.categories.length}
                onChange={(e) =>
                  setCategoryDraft({ ...categoryDraft, position: Number(e.target.value) })
                }
              />
            </Field>
          </div>
          <div className="flex gap-3">
            <SaveButton busy={busy}>{tr('Save category')}</SaveButton>
            {categoryDraft.id && (
              <Button type="button" variant="ghost" onClick={() => setCategoryDraft({})}>
                {tr('Cancel edit')}
              </Button>
            )}
          </div>
        </form>
      </Modal>
      <Modal
        open={preview}
        onOpenChange={setPreview}
        title={tr('{0} — draft preview', stage?.name || '')}
        description={tr('This saved draft is visible only to authorized staff.')}
        wide
      >
        {pool?.draftRevision && <PoolDisplay pool={pool.draftRevision} />}
      </Modal>
    </>
  );
}
