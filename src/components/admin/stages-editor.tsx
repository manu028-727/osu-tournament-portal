'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTournamentScope } from '@/components/tournament-scope';
import Link from '@/components/tournament-scope';
import { Plus, Disc3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { can, type Actor } from '@/lib/permissions';
import { DEFAULT_MATCH_RULES, type MatchRules } from '@/lib/match-rules';
import { MatchRulesFields } from './match-rules-fields';
import { MediaField } from './media';
import { slugify } from '@/lib/utils';
import {
  qualifierPolicySchema,
  QUALIFIER_METHOD_LABELS,
  type QualifierPolicy,
} from '@/lib/qualifier-policy';
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
import { StageOverviewRow, stageSavePayload, type StageOverviewRecord } from './stage-overview-row';
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
  qualifierPolicy?: QualifierPolicy | null;
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
  const pools = useResource<{
    stages: { id: string; mappool: { state: string } | null }[];
    categories: unknown[];
  }>('mappools');
  const [draft, setDraft] = useState<Stage | null>(null),
    [dirty, setDirty] = useState(false),
    [duplicating, setDuplicating] = useState(false);
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
    qualifierPolicy: qualifierPolicySchema.parse({}),
  });
  useEffect(() => {
    if (!data || opened.current) return;
    opened.current = true;
    if (newStage && can(actor, 'mappools.create')) {
      setDraft(emptyStage(data.stages.length));
      setDuplicating(false);
    } else if (initialStageId && can(actor, 'mappools.edit'))
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
      setDuplicating(false);
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
              setDuplicating(false);
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
              <th>Action sequence / policy</th>
              <th>Mappool</th>
              <th>Save / advanced</th>
            </tr>
          </thead>
          <tbody>
            {data.stages.map((stage) => {
              const poolData = pools.data?.stages.find((item) => item.id === stage.id);
              return (
                <StageOverviewRow
                  key={stage.id}
                  stage={stage as StageOverviewRecord}
                  defaults={data.defaults}
                  pool={
                    poolData
                      ? { exists: !!poolData.mappool, state: poolData.mappool?.state || null }
                      : pools.data
                        ? { exists: false, state: null }
                        : undefined
                  }
                  canEdit={can(actor, 'mappools.edit')}
                  canManageRules={can(actor, 'matches.manage')}
                  canDuplicate={can(actor, 'mappools.create') && can(actor, 'matches.manage')}
                  busy={busy}
                  onSave={(changedStage) =>
                    void run(async () => {
                      await action(stageSavePayload(changedStage, can(actor, 'matches.manage')));
                      await reload();
                      await pools.reload().catch(() => {});
                    }, 'Stage changes saved.')
                  }
                  onAdvanced={() => {
                    setDraft(stage);
                    setDirty(false);
                    setDuplicating(false);
                  }}
                  onDuplicate={() => {
                    const name = `${stage.name} copy`.slice(0, 120);
                    const usedSlugs = new Set(data.stages.map((item) => item.slug));
                    const baseSlug = slugify(name).slice(0, 80) || 'stage-copy';
                    let slug = baseSlug;
                    let suffix = 2;
                    while (usedSlugs.has(slug)) {
                      const ending = `-${suffix++}`;
                      slug = `${baseSlug.slice(0, 80 - ending.length)}${ending}`;
                    }
                    setDraft({
                      ...stage,
                      id: undefined,
                      name,
                      slug,
                      position: data.stages.length,
                      nextStageId: null,
                      archivedAt: null,
                      startsAt: null,
                    });
                    setDirty(false);
                    setDuplicating(true);
                  }}
                />
              );
            })}
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
        {duplicating && (
          <p className="mb-5 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-muted">
            Stage settings and rules are copied. The new stage gets an empty mappool; beatmaps and
            published pool content are not copied.
          </p>
        )}
        {draft && (
          <form
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const { matchRules, qualifierPolicy, ...fields } = draft;
                const result = await action<{ id: string }>({
                  type: 'stage.save',
                  ...fields,
                  ...(can(actor, 'matches.manage')
                    ? {
                        matchRules: draft.kind === 'QUALIFIERS' ? null : matchRules,
                        qualifierPolicy:
                          draft.kind === 'QUALIFIERS'
                            ? qualifierPolicySchema.parse(qualifierPolicy || {})
                            : null,
                      }
                    : {}),
                });
                setDraft(null);
                setDirty(false);
                setDuplicating(false);
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
              {can(actor, 'matches.manage') && draft.kind !== 'QUALIFIERS' && (
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
              {can(actor, 'matches.manage') && draft.kind === 'QUALIFIERS' && (
                <section className="space-y-4 border-t pt-5">
                  <h2 className="font-semibold">Qualifier policy</h2>
                  <div className="grid-fields">
                    <Field label="Seeding method">
                      <select
                        value={draft.qualifierPolicy?.method || 'RAW_SCORE'}
                        onChange={(e) =>
                          update({
                            qualifierPolicy: qualifierPolicySchema.parse({
                              ...draft.qualifierPolicy,
                              method: e.target.value,
                            }),
                          })
                        }
                      >
                        {Object.entries(QUALIFIER_METHOD_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Playthroughs">
                      <select
                        value={draft.qualifierPolicy?.runs || 1}
                        onChange={(e) =>
                          update({
                            qualifierPolicy: qualifierPolicySchema.parse({
                              ...draft.qualifierPolicy,
                              runs: Number(e.target.value),
                              runSelection: 'BEST_PER_MAP',
                            }),
                          })
                        }
                      >
                        <option value={1}>Once</option>
                        <option value={2}>Twice</option>
                      </select>
                    </Field>
                    {draft.qualifierPolicy?.runs === 2 && (
                      <Field label="Run selection">
                        <select
                          value={draft.qualifierPolicy.runSelection}
                          onChange={(e) =>
                            update({
                              qualifierPolicy: qualifierPolicySchema.parse({
                                ...draft.qualifierPolicy,
                                runSelection: e.target.value,
                              }),
                            })
                          }
                        >
                          <option value="BEST_PER_MAP">Best per map</option>
                          <option value="BEST_COMPLETE_RUN">Best complete run</option>
                          <option value="FIRST_RUN">First run only</option>
                          <option value="SECOND_RUN">Second run only</option>
                        </select>
                      </Field>
                    )}
                    <Field label="Players counted per map">
                      <input
                        type="number"
                        min={1}
                        max={16}
                        value={draft.qualifierPolicy?.requiredPlayers || 1}
                        onChange={(e) =>
                          update({
                            qualifierPolicy: {
                              ...qualifierPolicySchema.parse(draft.qualifierPolicy || {}),
                              requiredPlayers: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="Team aggregation">
                      <select
                        value={draft.qualifierPolicy?.teamAggregation || 'SUM'}
                        onChange={(e) =>
                          update({
                            qualifierPolicy: qualifierPolicySchema.parse({
                              ...draft.qualifierPolicy,
                              teamAggregation: e.target.value,
                            }),
                          })
                        }
                      >
                        <option value="SUM">Sum</option>
                        <option value="AVERAGE">Average</option>
                        <option value="TOP_N">Top N players</option>
                      </select>
                    </Field>
                    {(!draft.qualifierPolicy || draft.qualifierPolicy.method === 'RAW_SCORE') && (
                      <Field label="Pool aggregation">
                        <select
                          value={draft.qualifierPolicy?.rawAggregation || 'TOTAL'}
                          onChange={(e) =>
                            update({
                              qualifierPolicy: qualifierPolicySchema.parse({
                                ...draft.qualifierPolicy,
                                rawAggregation: e.target.value,
                              }),
                            })
                          }
                        >
                          <option value="TOTAL">Total</option>
                          <option value="AVERAGE">Average</option>
                        </select>
                      </Field>
                    )}
                  </div>
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
