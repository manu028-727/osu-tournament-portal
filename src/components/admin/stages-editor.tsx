'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTournamentScope } from '@/components/tournament-scope';
import Link from '@/components/tournament-scope';
import { Plus, Pencil, Disc3, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { can, type Actor } from '@/lib/permissions';
import { DEFAULT_MATCH_RULES, type MatchRules } from '@/lib/match-rules';
import { MatchRulesFields } from './match-rules-fields';
import { MediaField } from './media';
import { slugify } from '@/lib/utils';
import {
  action,
  Field,
  SectionTitle,
  Modal,
  useResource,
  useTask,
  LoadingState,
  SaveButton,
  useUnsaved,
} from './shared';
type Stage = {
  id?: string;
  name: string;
  slug: string;
  description: string;
  position: number;
  kind: string;
  nextStageId: string | null;
  archivedAt: string | null;
  startsAt: string | null;
  bannerImageId: string | null;
  matchRules: MatchRules | null;
};
const stageKinds: Record<string, string> = {
  QUALIFIERS: 'Qualifiers',
  ELIMINATION: 'Elimination',
  GROUPS: 'Groups',
  CUSTOM: 'Custom',
};
export function StagesEditor({
  actor,
  initialStageId,
  newStage = false,
  returnToPool = false,
}: {
  actor: Actor;
  initialStageId?: string;
  newStage?: boolean;
  returnToPool?: boolean;
}) {
  const { data, error, reload } = useResource<{ stages: Stage[]; defaults: MatchRules }>('stages');
  const [draft, setDraft] = useState<Stage | null>(null),
    [dirty, setDirty] = useState(false);
  const { busy, run } = useTask();
  const router = useRouter(),
    scope = useTournamentScope(),
    opened = useRef(false);
  const emptyStage = (position: number): Stage => ({
    name: '',
    slug: '',
    description: '',
    position,
    kind: 'ELIMINATION',
    nextStageId: null,
    archivedAt: null,
    startsAt: null,
    bannerImageId: null,
    matchRules: null,
  });
  useEffect(() => {
    if (!data || opened.current) return;
    opened.current = true;
    if (newStage && can(actor, 'mappools.create')) setDraft(emptyStage(data.stages.length));
    else if (initialStageId && can(actor, 'mappools.edit'))
      setDraft(data.stages.find((stage) => stage.id === initialStageId) || null);
  }, [data, newStage, initialStageId, actor]);
  useUnsaved(dirty);
  const update = (fields: Partial<Stage>) => {
    setDraft((d) => (d ? { ...d, ...fields } : d));
    setDirty(true);
  };
  const close = () => {
    if (!dirty || window.confirm('Discard unsaved stage settings?')) {
      setDraft(null);
      setDirty(false);
      if (returnToPool)
        router.push(
          `${scope.adminBase}/mappools${initialStageId ? '?stage=' + encodeURIComponent(initialStageId) : ''}`,
        );
    }
  };
  if (!data) return <LoadingState error={error} retry={() => void reload()} />;
  return (
    <>
      <SectionTitle title="Tournament stages" description={`${data.stages.length} stages`}>
        <Button asChild variant="outline">
          <Link href="/admin/mappools">
            <Disc3 size={17} />
            Mappools
          </Link>
        </Button>
        {can(actor, 'mappools.create') && (
          <Button
            onClick={() => {
              setDraft(emptyStage(data.stages.length));
              setDirty(false);
            }}
          >
            <Plus size={17} />
            New stage
          </Button>
        )}
      </SectionTitle>
      <div className="overflow-x-auto">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Stage</th>
              <th>Type</th>
              <th>Best of</th>
              <th>Next stage</th>
              <th>Edit</th>
            </tr>
          </thead>
          <tbody>
            {data.stages.map((s) => (
              <tr key={s.id}>
                <td>{s.position + 1}</td>
                <td>
                  {s.name}
                  {s.archivedAt && <Archive className="ml-2 inline" size={15} />}
                  {can(actor, 'mappools.edit') && (
                    <Link
                      className="mt-1 block text-sm text-primary"
                      href={`/admin/mappools?stage=${s.id}`}
                    >
                      Edit mappool
                    </Link>
                  )}
                </td>
                <td>{stageKinds[s.kind] || s.kind}</td>
                <td>{s.matchRules?.bestOf || data.defaults.bestOf}</td>
                <td>{data.stages.find((n) => n.id === s.nextStageId)?.name || '-'}</td>
                <td>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Edit stage"
                    aria-label={`Edit ${s.name}`}
                    disabled={!can(actor, 'mappools.edit')}
                    onClick={() => {
                      setDraft(s);
                      setDirty(false);
                    }}
                  >
                    <Pencil size={17} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal
        title={draft?.id ? 'Stage settings' : 'New stage'}
        wide
        open={!!draft}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        {draft && (
          <form
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const { matchRules, ...fields } = draft;
                const result = await action<{ id: string }>({
                  type: 'stage.save',
                  ...fields,
                  ...(can(actor, 'matches.manage') ? { matchRules } : {}),
                });
                setDraft(null);
                setDirty(false);
                await reload();
                if (returnToPool)
                  router.push(`${scope.adminBase}/mappools?stage=${encodeURIComponent(result.id)}`);
              }, 'Stage settings saved. Existing matches retain their snapshots.');
            }}
          >
            <div className="grid-fields">
              <Field label="Stage name">
                <input
                  required
                  maxLength={120}
                  value={draft.name}
                  onChange={(e) =>
                    update({
                      name: e.target.value,
                      ...(!draft.id && (draft.slug === slugify(draft.name) || !draft.slug)
                        ? { slug: slugify(e.target.value) }
                        : {}),
                    })
                  }
                />
              </Field>
              <Field label="URL slug">
                <input
                  required
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  value={draft.slug}
                  onChange={(e) => update({ slug: e.target.value })}
                />
              </Field>
              <Field label="Stage type">
                <select value={draft.kind} onChange={(e) => update({ kind: e.target.value })}>
                  {['QUALIFIERS', 'ELIMINATION', 'GROUPS', 'CUSTOM'].map((k) => (
                    <option key={k} value={k}>
                      {stageKinds[k] || k}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Description">
              <textarea
                value={draft.description}
                onChange={(e) => update({ description: e.target.value })}
              />
            </Field>
            <MediaField
              label="Stage banner"
              canUpload={can(actor, 'media.upload')}
              value={draft.bannerImageId ? `/api/media/${draft.bannerImageId}` : ''}
              onChange={(url) =>
                update({ bannerImageId: /\/api\/media\/([a-zA-Z0-9_-]+)/.exec(url)?.[1] || null })
              }
            />
            <details className="border-t pt-4">
              <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                Advanced stage settings
              </summary>
              <div className="grid-fields mt-4">
                <Field label="Order">
                  <input
                    type="number"
                    min={0}
                    value={draft.position}
                    onChange={(e) => update({ position: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Next stage">
                  <select
                    value={draft.nextStageId || ''}
                    onChange={(e) => update({ nextStageId: e.target.value || null })}
                  >
                    <option value="">None</option>
                    {data.stages
                      .filter((s) => s.id !== draft.id)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Start date (your timezone)">
                  <input
                    type="datetime-local"
                    value={
                      draft.startsAt
                        ? new Date(
                            new Date(draft.startsAt).getTime() -
                              new Date(draft.startsAt).getTimezoneOffset() * 60000,
                          )
                            .toISOString()
                            .slice(0, 16)
                        : ''
                    }
                    onChange={(e) =>
                      update({
                        startsAt: e.target.value ? new Date(e.target.value).toISOString() : null,
                      })
                    }
                  />
                </Field>
              </div>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={!!draft.archivedAt}
                  onChange={(e) =>
                    update({ archivedAt: e.target.checked ? new Date().toISOString() : null })
                  }
                />
                Archived
              </label>
              {can(actor, 'matches.manage') && (
                <section className="space-y-5 border-t pt-5">
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={!draft.matchRules}
                      onChange={(e) =>
                        update({
                          matchRules: e.target.checked
                            ? null
                            : data.defaults || DEFAULT_MATCH_RULES,
                        })
                      }
                    />
                    Inherit tournament match rules
                  </label>
                  {draft.matchRules && (
                    <MatchRulesFields
                      rules={draft.matchRules}
                      onChange={(rules) => update({ matchRules: rules })}
                    />
                  )}
                </section>
              )}
            </details>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" disabled={busy} onClick={close}>
                Cancel
              </Button>
              <SaveButton busy={busy}>Save stage</SaveButton>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
