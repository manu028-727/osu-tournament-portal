'use client';
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
} from 'lucide-react';
import { Button } from '../ui/button';
import { StateBadge, Badge } from '../ui/badge';
import { EmptyState, PoolDisplay } from '../content';
import { can, type Actor } from '@/lib/permissions';
import type { PoolContent } from '@/lib/types';
import type { BeatmapMetadata } from '@/lib/osu';
import { parseImport } from '@/lib/validation';
import { slugify } from '@/lib/utils';
import { MediaField } from './media';
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
type Category = { id: string; name: string; acronym: string; color: string; position: number };
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
};
type Data = { stages: Stage[]; categories: Category[] };
type Slot = EditorSlot;
export function PoolEditor({ actor }: { actor: Actor }) {
  const { data, error, reload } = useResource<Data>('mappools');
  const { busy, run, notify } = useTask();
  const [active, setActive] = useState(''),
    [slots, setSlots] = useState<Slot[]>([]),
    [notes, setNotes] = useState(''),
    [base, setBase] = useState<string | null>(null),
    [metadata, setMetadata] = useState<Record<number, BeatmapMetadata>>({}),
    [errors, setErrors] = useState<Record<number, string>>({}),
    [dirty, setDirty] = useState(false),
    [importing, setImporting] = useState(false),
    [bulk, setBulk] = useState(''),
    [defaultMod, setDefaultMod] = useState('NM'),
    [preview, setPreview] = useState(false),
    [stageModal, setStageModal] = useState(false),
    [stageDraft, setStageDraft] = useState<Partial<Stage>>({}),
    [categoriesOpen, setCategoriesOpen] = useState(false),
    [categoryDraft, setCategoryDraft] = useState<Partial<Category>>({});
  const stage = data?.stages.find((s) => s.id === active),
    pool = stage?.mappool;
  const editable = can(actor, 'mappools.edit'),
    publisher = can(actor, 'mappools.publish');
  useEffect(() => {
    if (data && !active && data.stages[0]) setActive(data.stages[0].id);
  }, [data, active]);
  useEffect(() => {
    const revision = pool?.draftRevision || pool?.publishedRevision;
    setSlots(
      revision?.slots.map((s) => ({
        name: s.name,
        category: s.category,
        beatmapId: s.beatmapId,
        editorId: s.id || crypto.randomUUID(),
      })) || [],
    );
    setNotes(revision?.notes || '');
    setBase(pool?.draftRevisionId || null);
    setMetadata(Object.fromEntries((revision?.slots || []).map((s) => [s.beatmapId, s.metadata])));
    setErrors({});
    setDirty(false);
  }, [pool]);
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
  const save = () =>
    run(async () => {
      const problems = poolSlotErrors(slots, data!.categories);
      if (problems.length) throw new Error(problems.join(' '));
      const ordered = sortPoolSlots(slots, data!.categories);
      await action({
        type: 'pool.save',
        id: pool!.id,
        baseRevisionId: base,
        notes,
        slots: ordered.map(({ editorId, ...slot }) => {
          void editorId;
          return slot;
        }),
      });
      await reload();
    }, 'Mappool draft saved.');
  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Mappool manager</h1>
        <div className="flex gap-2">
          {editable && (
            <Button
              variant="outline"
              size="sm"
              disabled={dirty}
              onClick={() => setCategoriesOpen(true)}
            >
              <SlidersHorizontal size={13} />
              Mod categories
            </Button>
          )}
          {can(actor, 'mappools.create') && (
            <Button
              size="sm"
              onClick={() => {
                setStageDraft({
                  name: '',
                  slug: '',
                  description: '',
                  position: data.stages.length,
                  startsAt: null,
                });
                setStageModal(true);
              }}
            >
              <Plus size={14} />
              New stage
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
              if (dirty && !window.confirm('Discard unsaved changes and switch stages?')) return;
              setActive(s.id);
            }}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${active === s.id ? 'border-primary/30 bg-primary/10 text-primary' : 'border-white/10 bg-card text-muted hover:text-white'}`}
          >
            {s.name}
            <span
              className={`size-1 rounded-full ${s.mappool?.state === 'PUBLISHED' ? 'bg-emerald-300' : 'bg-white/20'}`}
            />
          </button>
        ))}
      </div>
      {stage && pool ? (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-semibold tracking-tight">{stage.name}</h2>
              <StateBadge state={pool.state} />
              {dirty && <span className="text-[10px] text-amber-200">Unsaved changes</span>}
              {pool.draftRevisionId !== pool.publishedRevisionId && pool.draftRevisionId && (
                <Badge>Draft changes</Badge>
              )}
            </div>
            <div className="flex gap-2">
              {editable && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={dirty}
                  onClick={() => {
                    setStageDraft(stage);
                    setStageModal(true);
                  }}
                >
                  Stage settings
                </Button>
              )}
              {pool.state === 'PUBLISHED' && (
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/mappools/${stage.slug}`} target="_blank" rel="noopener noreferrer">
                    Public page
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
                    Bulk import
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
                    Add beatmap
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !slots.length}
                    onClick={() => void run(() => lookup(slots), 'Metadata refreshed.')}
                  >
                    <RefreshCw size={13} />
                    Fetch metadata
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
                Preview draft
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
                  Sort by Slot
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
                  Save draft
                </SaveButton>
              )}
              {publisher && (
                <ConfirmButton
                  variant="default"
                  title={`Publish ${stage.name}?`}
                  description="The saved draft will become publicly visible. Review every slot before releasing."
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
                    }, 'Mappool published.')
                  }
                >
                  <Send size={13} />
                  Publish
                </ConfirmButton>
              )}
              {publisher && pool.state === 'PUBLISHED' && (
                <ConfirmButton
                  title="Unpublish this mappool?"
                  description="This pool will immediately become unavailable on public pages and direct URLs."
                  disabled={busy}
                  onConfirm={() =>
                    void run(async () => {
                      await action({ type: 'pool.unpublish', id: pool.id });
                      await reload();
                    }, 'Mappool unpublished.')
                  }
                >
                  Unpublish
                </ConfirmButton>
              )}
            </div>
          </div>
          <div className="space-y-3">
            {poolSlotErrors(slots, data.categories).map((problem, index) => (
              <p key={problem + index} role="alert" className="text-sm text-red-300">
                {problem}
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
                  if (poolSlotErrors(slots, data.categories).length) {
                    notify('Resolve invalid or duplicate slots before moving maps.', true);
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
                  }, 'Beatmap ID copied.');
                }}
              />
            ) : (
              <EmptyState title="No beatmaps" description="This stage has no draft slots." />
            )}
            <details className="border-b py-3">
              <summary className="cursor-pointer text-sm font-medium">Mappool notes</summary>
              <div className="pt-3">
                <Field label="Mappool notes">
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
            <span className="text-[11px] text-muted">
              {slots.length} slots · Saving creates an independent draft revision
            </span>
            {can(actor, 'mappools.delete') && (
              <ConfirmButton
                title={`Delete ${stage.name}?`}
                description="This deletes the stage, every mappool revision, and its public URL. This cannot be undone."
                disabled={busy}
                onConfirm={() =>
                  void run(async () => {
                    await action({ type: 'stage.delete', id: stage.id });
                    setActive('');
                    await reload();
                  }, 'Stage deleted.')
                }
              >
                <Trash2 size={13} />
                Delete stage
              </ConfirmButton>
            )}
          </div>
        </>
      ) : (
        <EmptyState
          title="Make room for the next round"
          description="Create a tournament stage to start preparing its mappool."
        />
      )}
      <Modal
        open={importing}
        onOpenChange={setImporting}
        title="Bulk-import beatmaps"
        description="Enter one beatmap ID per line, or map slots with NM1: 123456."
      >
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const imported = parseImport(bulk, defaultMod);
              const lines = bulk.split(/\r?\n/).filter((s) => s.trim());
              const next = [...slots];
              imported.forEach((slot, i) =>
                next.push({
                  ...slot,
                  name: /^\d+$/.test(lines[i].trim()) ? nextSlotName(next, defaultMod) : slot.name,
                  editorId: crypto.randomUUID(),
                }),
              );
              const named = next.slice(slots.length);
              if (next.length > 100) throw new Error('A mappool can contain at most 100 maps.');
              if (named.some((s) => !data.categories.some((c) => c.acronym === s.category)))
                throw new Error(
                  'A slot uses an unknown mod category. Create it first or adjust the slot name.',
                );
              const problems = poolSlotErrors(next, data.categories);
              if (problems.length) throw new Error(problems.join(' '));
              await lookup(next);
              setSlots(next);
              setDirty(true);
              setBulk('');
              setImporting(false);
            }, 'Beatmaps imported. Review metadata before saving.');
          }}
        >
          <Field label="Default category for plain IDs">
            <select value={defaultMod} onChange={(e) => setDefaultMod(e.target.value)}>
              {data.categories.map((c) => (
                <option key={c.id}>{c.acronym}</option>
              ))}
            </select>
          </Field>
          <Field label="Beatmap IDs or slot mappings">
            <textarea
              className="min-h-56 font-mono"
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              required
              placeholder={'NM1: 123456\nNM2: 234567\nHD1: 345678'}
            />
          </Field>
          <SaveButton busy={busy}>Import & fetch metadata</SaveButton>
        </form>
      </Modal>
      <Modal
        open={stageModal}
        onOpenChange={setStageModal}
        title={stageDraft.id ? 'Stage settings' : 'Create tournament stage'}
      >
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const result = await action<{ id: string }>({
                type: 'stage.save',
                ...stageDraft,
                startsAt: stageDraft.startsAt ? new Date(stageDraft.startsAt).toISOString() : null,
              });
              await reload();
              setActive(result.id);
              setStageModal(false);
            }, 'Stage saved.');
          }}
        >
          <Field label="Stage name">
            <input
              required
              value={stageDraft.name || ''}
              onChange={(e) =>
                setStageDraft({
                  ...stageDraft,
                  name: e.target.value,
                  ...(!stageDraft.id ? { slug: slugify(e.target.value) } : {}),
                })
              }
            />
          </Field>
          <Field label="URL slug">
            <input
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              value={stageDraft.slug || ''}
              onChange={(e) => setStageDraft({ ...stageDraft, slug: e.target.value })}
            />
          </Field>
          <Field label="Description">
            <textarea
              value={stageDraft.description || ''}
              onChange={(e) => setStageDraft({ ...stageDraft, description: e.target.value })}
            />
          </Field>
          <div className="grid-fields">
            <Field label="Display order">
              <input
                type="number"
                min={0}
                value={stageDraft.position ?? 0}
                onChange={(e) => setStageDraft({ ...stageDraft, position: Number(e.target.value) })}
              />
            </Field>
            <Field label="Starts at (UTC)">
              <input
                type="datetime-local"
                value={stageDraft.startsAt?.slice(0, 16) || ''}
                onChange={(e) =>
                  setStageDraft({
                    ...stageDraft,
                    startsAt: e.target.value ? `${e.target.value}:00Z` : null,
                  })
                }
              />
            </Field>
          </div>
          <MediaField
            label="Stage banner"
            value={stageDraft.bannerImageId ? `/api/media/${stageDraft.bannerImageId}` : ''}
            canUpload={can(actor, 'media.upload')}
            onChange={(url) => {
              const match = /^\/api\/media\/([a-zA-Z0-9_-]+)$/.exec(url);
              if (url && !match) {
                notify('Select an image from the media library.', true);
                return;
              }
              setStageDraft({ ...stageDraft, bannerImageId: match?.[1] || null });
            }}
          />
          {stageDraft.bannerImageId && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setStageDraft({ ...stageDraft, bannerImageId: null })}
            >
              <Trash2 size={16} />
              Remove banner
            </Button>
          )}
          <SaveButton busy={busy}>Save stage</SaveButton>
        </form>
      </Modal>
      <Modal
        open={categoriesOpen}
        onOpenChange={setCategoriesOpen}
        title="Mod categories"
        description="Categories are customizable. Published revisions retain their original category names and colors."
      >
        <div className="mb-7 space-y-2">
          {data.categories.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-lg border p-3">
              <span className="w-8 text-xs font-semibold" style={{ color: c.color }}>
                {c.acronym}
              </span>
              <span className="flex-1 text-xs">{c.name}</span>
              <Button size="sm" variant="ghost" onClick={() => setCategoryDraft(c)}>
                Edit
              </Button>
              <ConfirmButton
                title={`Delete ${c.name}?`}
                description="Saved revisions are preserved. New drafts must use existing categories."
                onConfirm={() =>
                  void run(async () => {
                    await action({ type: 'category.delete', id: c.id });
                    await reload();
                  }, 'Category deleted.')
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
              });
              setCategoryDraft({});
              await reload();
            }, 'Category saved.');
          }}
        >
          <h3 className="text-sm font-semibold">
            {categoryDraft.id ? 'Edit category' : 'Add category'}
          </h3>
          <div className="grid-fields">
            <Field label="Name">
              <input
                required
                value={categoryDraft.name || ''}
                onChange={(e) => setCategoryDraft({ ...categoryDraft, name: e.target.value })}
              />
            </Field>
            <Field label="Acronym">
              <input
                required
                value={categoryDraft.acronym || ''}
                onChange={(e) =>
                  setCategoryDraft({ ...categoryDraft, acronym: e.target.value.toUpperCase() })
                }
              />
            </Field>
            <Field label="Color">
              <input
                type="color"
                value={categoryDraft.color || '#b6a0e5'}
                onChange={(e) => setCategoryDraft({ ...categoryDraft, color: e.target.value })}
              />
            </Field>
            <Field label="Order">
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
            <SaveButton busy={busy}>Save category</SaveButton>
            {categoryDraft.id && (
              <Button type="button" variant="ghost" onClick={() => setCategoryDraft({})}>
                Cancel edit
              </Button>
            )}
          </div>
        </form>
      </Modal>
      <Modal
        open={preview}
        onOpenChange={setPreview}
        title={`${stage?.name || ''} — draft preview`}
        description="This saved draft is visible only to authorized staff."
        wide
      >
        {pool?.draftRevision && <PoolDisplay pool={pool.draftRevision} />}
      </Modal>
    </>
  );
}
