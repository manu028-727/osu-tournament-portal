'use client';
import { QualifierPolicyFields } from './qualifier-policy-fields';
import { localDateTimeInput } from '@/lib/utils';
import { Feedback, useT } from '@/components/locale';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useGuardedRouter } from '@/components/unsaved-navigation';
import { useTournamentScope } from '@/components/tournament-scope';
import Link from '@/components/tournament-scope';
import { Plus, Disc3, X, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { can, type Actor } from '@/lib/permissions';
import { DEFAULT_MATCH_RULES, matchRulesSchema, type MatchRules } from '@/lib/match-rules';
import { MatchRulesFields } from './match-rules-fields';
import { MediaField } from './media';
import { slugify } from '@/lib/utils';
import { patchStageRules, type StageRulePatch } from '@/lib/stage-workflows-validation';
import { mixedStageValue, STAGE_TEMPLATES, withStageBestOf } from './stage-editor-model';
import { qualifierPolicySchema, type QualifierPolicy } from '@/lib/qualifier-policy';
import {
  action,
  Field,
  SectionTitle,
  EditorPanel,
  useResource,
  useTask,
  LoadingState,
  SaveButton,
  useUnsaved,
  NumberInput,
} from './shared';
import {
  StageOverviewRow,
  StageActionEditor,
  stageSavePayload,
  type StageOverviewRecord,
} from './stage-overview-row';
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
  configurationToken?: string;
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
  const tr = useT();
  const { data, error, reload } = useResource<{
    stages: Stage[];
    defaults: MatchRules;
    defaultsToken?: string;
  }>('stages');
  const pools = useResource<{
    stages: {
      id: string;
      mappool: {
        state: string;
        draftRevision?: { slots: { name: string; category: string; beatmapId: number }[] } | null;
        publishedRevision?: {
          slots: { name: string; category: string; beatmapId: number }[];
        } | null;
      } | null;
    }[];
    categories: unknown[];
  }>('mappools');
  const [draft, setDraft] = useState<Stage | null>(null),
    [dirty, setDirty] = useState(false),
    [duplicating, setDuplicating] = useState(false);
  const [duplicateSource, setDuplicateSource] = useState<Stage | null>(null);
  const [duplicateName, setDuplicateName] = useState('');
  const [duplicateSlug, setDuplicateSlug] = useState('');
  const [copyRules, setCopyRules] = useState(false);
  const [copyAppearance, setCopyAppearance] = useState(true);
  const [poolMode, setPoolMode] = useState<'EMPTY' | 'STRUCTURE' | 'CONTENTS'>('EMPTY');
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState('ALL');
  const [bulkPatch, setBulkPatch] = useState<StageRulePatch>({});
  const [copySource, setCopySource] = useState('');
  const [showBulkActions, setShowBulkActions] = useState(false);
  const [warnings, setWarnings] = useState<{ id: string; name: string; messages: string[] }[]>([]);
  const [dirtyRows, setDirtyRows] = useState<Set<string>>(new Set());
  const [template, setTemplate] = useState('STANDARD');
  const [templateSource, setTemplateSource] = useState('');
  const anchor = useRef<string | null>(null);
  const rowDirty = useCallback(
    (id: string, isDirty: boolean) =>
      setDirtyRows((current) => {
        if (current.has(id) === isDirty) return current;
        const next = new Set(current);
        isDirty ? next.add(id) : next.delete(id);
        return next;
      }),
    [],
  );
  const { busy, run } = useTask();
  const router = useGuardedRouter(),
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
    qualifierPolicy: qualifierPolicySchema.parse({ requiredPlayers: data?.defaults.teamSize ?? 1 }),
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
  const acknowledgeDraft = useUnsaved(dirty);
  useUnsaved(dirtyRows.size > 0 || Object.keys(bulkPatch).length > 0);
  const update = (fields: Partial<Stage>) => {
    setDraft((d) => (d ? { ...d, ...fields } : d));
    setDirty(true);
  };
  const close = () => {
    if (!dirty || window.confirm(tr('Discard unsaved stage settings?'))) {
      acknowledgeDraft();
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
  const workflowReady =
    !!data.defaultsToken && data.stages.every((stage) => !!stage.configurationToken);
  const visible = data.stages.filter(
    (stage) =>
      (kindFilter === 'ALL' || stage.kind === kindFilter) &&
      `${stage.name} ${stage.slug}`.toLowerCase().includes(search.toLowerCase()),
  );
  const chosen = visible.filter((stage) => stage.id && selected.includes(stage.id));
  const canBulk = can(actor, 'mappools.edit') && can(actor, 'matches.manage') && workflowReady;
  const resetSelection = () => {
    setSelected([]);
    setBulkPatch({});
    setCopySource('');
    setShowBulkActions(false);
    anchor.current = null;
  };
  const toggleStage = (id: string, checked: boolean, shift: boolean) => {
    const start = visible.findIndex((stage) => stage.id === anchor.current);
    const end = visible.findIndex((stage) => stage.id === id);
    const ids =
      shift && start >= 0
        ? visible.slice(Math.min(start, end), Math.max(start, end) + 1).map((stage) => stage.id!)
        : [id];
    setSelected((current) =>
      checked ? [...new Set([...current, ...ids])] : current.filter((item) => !ids.includes(item)),
    );
    anchor.current = id;
  };
  const tokens = (stages: Stage[]) =>
    stages.map((stage) => ({ id: stage.id!, baseConfigurationToken: stage.configurationToken! }));
  let bulkError = '';
  const proposedRules = chosen.map((stage) => {
    if (stage.kind === 'QUALIFIERS' || stage.archivedAt) {
      bulkError = 'Select active head-to-head stages. Qualifiers use their own policy.';
      return null;
    }
    if (copySource)
      return copySource === 'TOURNAMENT'
        ? data.defaults
        : data.stages.find((source) => source.id === copySource)?.matchRules || data.defaults;
    try {
      return patchStageRules(stage.matchRules || data.defaults, bulkPatch);
    } catch (error) {
      bulkError = error instanceof Error ? error.message : 'Check the rule changes.';
      return null;
    }
  });
  const bulkRules =
    proposedRules.find((rules): rules is MatchRules => !!rules) ||
    chosen[0]?.matchRules ||
    data.defaults;
  const setActionPatch = (rules: MatchRules) => {
    const {
      bestOf,
      bansPerTeam,
      protectsPerTeam,
      draftSequence,
      banOrder,
      pickOrder,
      protectOrder,
      firstBanRule,
      firstPickRule,
      firstProtectRule,
      rollRequired,
      enableTiebreaker,
      allowTiebreakerBans,
      tiebreakerBanOrder,
      tiebreakerBanFirstSide,
    } = rules;
    setBulkPatch({
      bestOf,
      bansPerTeam,
      protectsPerTeam,
      draftSequence,
      banOrder,
      pickOrder,
      protectOrder,
      firstBanRule,
      firstPickRule,
      firstProtectRule,
      rollRequired,
      enableTiebreaker,
      allowTiebreakerBans,
      tiebreakerBanOrder,
      tiebreakerBanFirstSide,
    });
  };
  const reorder = (id: string, offset: -1 | 1) =>
    void run(async () => {
      if (dirtyRows.size || dirty)
        throw new Error('Save or discard stage changes before reordering.');
      const next = [...data.stages];
      const from = next.findIndex((stage) => stage.id === id),
        to = from + offset;
      if (from < 0 || to < 0 || to >= next.length) return;
      [next[from], next[to]] = [next[to], next[from]];
      await action({ type: 'stage.reorder', stages: tokens(next) });
      await reload();
    }, tr('Stage order saved.'));
  return (
    <>
      <SectionTitle
        title={tr('Tournament stages')}
        description={tr('{0} stages', data.stages.length)}
      >
        <Button asChild variant="outline">
          <Link href="/admin/mappools">
            <Disc3 size={17} />
            {tr('Mappools')}
          </Link>
        </Button>
        {can(actor, 'mappools.create') && (
          <Button
            onClick={() => {
              if (dirty && !window.confirm(tr('Discard unsaved stage settings?'))) return;
              setDraft(emptyStage(data.stages.length));
              setDirty(false);
              setDuplicating(false);
            }}
          >
            <Plus size={17} />
            {tr('New stage')}
          </Button>
        )}
      </SectionTitle>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label={tr('Find stage')}>
          <input
            type="search"
            value={search}
            onChange={(event) => {
              resetSelection();
              setSearch(event.target.value);
            }}
          />
        </Field>
        <Field label={tr('Stage type')}>
          <select
            value={kindFilter}
            onChange={(event) => {
              resetSelection();
              setKindFilter(event.target.value);
            }}
          >
            <option value="ALL">{tr('All types')}</option>
            {Object.entries(stageKinds).map(([key, label]) => (
              <option key={key} value={key}>
                {tr(label)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {(!!chosen.length || !!copySource) && (
        <section
          aria-label={tr('Bulk stage editing')}
          className="mb-4 space-y-4 rounded-lg border border-primary/30 bg-primary/5 p-3"
        >
          <div className="flex flex-wrap items-end gap-3">
            <strong className="self-center text-sm">
              {chosen.length} {tr('visible stages selected')}
            </strong>
            <Field label={tr('Rule source')}>
              <select
                value={copySource}
                disabled={!canBulk || busy}
                onChange={(event) => {
                  setCopySource(event.target.value);
                  setBulkPatch({});
                }}
              >
                <option value="">{tr('Patch selected fields')}</option>
                <option value="TOURNAMENT">{tr('Inherit tournament defaults')}</option>
                {data.stages
                  .filter((stage) => stage.kind !== 'QUALIFIERS' && !stage.archivedAt)
                  .map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {tr('Copy')} {stage.name} {tr('rules')}
                    </option>
                  ))}
              </select>
            </Field>
            {!copySource && (
              <Field label={tr('Best of')}>
                <select
                  aria-label={tr('Bulk best of')}
                  value={bulkPatch.bestOf ?? ''}
                  disabled={!canBulk || busy}
                  onChange={(event) => {
                    if (!event.target.value) {
                      setBulkPatch(({ bestOf, ...rest }) => {
                        void bestOf;
                        return rest;
                      });
                      return;
                    }
                    const bestOf = Number(event.target.value);
                    if (bulkPatch.draftSequence?.length)
                      setActionPatch(withStageBestOf(bulkRules, bestOf));
                    else setBulkPatch((current) => ({ ...current, bestOf }));
                  }}
                >
                  <option value="">
                    {mixedStageValue(
                      chosen.map((stage) => (stage.matchRules || data.defaults).bestOf),
                    ) === 'MIXED'
                      ? tr('Mixed · keep each value')
                      : tr('Keep BO{0}', (chosen[0]?.matchRules || data.defaults).bestOf)}
                  </option>
                  {Array.from({ length: 16 }, (_, index) => index * 2 + 1).map((bestOf) => (
                    <option key={bestOf} value={bestOf}>
                      {tr('BO')}
                      {bestOf}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {!copySource && (
              <Button
                type="button"
                variant="outline"
                disabled={!canBulk || busy}
                onClick={() => setShowBulkActions((current) => !current)}
              >
                <Layers size={16} />
                {tr('Actions')}
              </Button>
            )}
            <Button
              type="button"
              disabled={
                !chosen.length ||
                !canBulk ||
                busy ||
                !!bulkError ||
                (!copySource && !Object.keys(bulkPatch).length) ||
                dirtyRows.size > 0
              }
              onClick={() =>
                void run(async () => {
                  const source = data.stages.find((stage) => stage.id === copySource);
                  const result = await action<{ updated: number; warnings: typeof warnings }>({
                    type: copySource ? 'stage.rules.apply' : 'stage.rules.patch',
                    stages: tokens(chosen),
                    defaultsToken: data.defaultsToken,
                    ...(copySource
                      ? {
                          source: source
                            ? {
                                kind: 'STAGE',
                                id: source.id,
                                baseConfigurationToken: source.configurationToken,
                              }
                            : { kind: 'TOURNAMENT' },
                        }
                      : { patch: bulkPatch }),
                  });
                  setWarnings(result.warnings);
                  resetSelection();
                  await reload();
                }, tr('Stage rules saved. Existing matches retain their snapshots.'))
              }
            >
              {tr('Apply to')} {chosen.length} {tr('stages')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title={tr('Clear stage selection')}
              aria-label={tr('Clear stage selection')}
              disabled={busy}
              onClick={resetSelection}
            >
              <X size={17} />
            </Button>
          </div>
          {showBulkActions && !copySource && (
            <StageActionEditor
              rules={bulkRules}
              disabled={!canBulk || busy}
              onChange={setActionPatch}
            />
          )}
          <div className="text-sm text-muted">
            {copySource === 'TOURNAMENT'
              ? tr(
                  'Selected customized rules will be removed; stages will follow tournament defaults.',
                )
              : copySource
                ? tr('Selected stages will receive independent copies of the source rules.')
                : tr(
                    'Changed fields: {0}. Other stage settings remain as saved.',
                    Object.keys(bulkPatch).join(', ') || 'none',
                  )}
          </div>
          <ul className="flex flex-wrap gap-2 text-sm">
            {chosen.map((stage, index) => (
              <li key={stage.id} className="rounded border px-2 py-1">
                {stage.name}
                {proposedRules[index] ? tr(' · BO{0}', proposedRules[index]!.bestOf) : ''}
                {stage.matchRules ? tr(' · customized') : tr(' · inherited')}
              </li>
            ))}
          </ul>
          {!!bulkError && (Object.keys(bulkPatch).length > 0 || !!copySource) && (
            <p role="alert" className="text-sm text-red-300">
              <Feedback message={bulkError} />
            </p>
          )}
          {dirtyRows.size > 0 && (
            <p role="alert" className="text-sm text-muted">
              {tr('Save or discard inline changes before bulk editing.')}
            </p>
          )}
        </section>
      )}
      {!!warnings.length && (
        <div role="status" className="mb-4 rounded-lg border p-3 text-sm">
          <strong>{tr('Rules saved. Pool readiness')}</strong>
          <ul className="mt-2 space-y-1">
            {warnings.map((item) => (
              <li key={item.id}>
                {item.name}:{' '}
                {item.messages.map((message, index) => (
                  <span key={index}>
                    <Feedback message={message} />{' '}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="admin-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label={tr('Select all visible stages')}
                  checked={!!visible.length && chosen.length === visible.length}
                  disabled={busy || !canBulk}
                  ref={(node) => {
                    if (node)
                      node.indeterminate = chosen.length > 0 && chosen.length < visible.length;
                  }}
                  onChange={(event) => {
                    setSelected(event.target.checked ? visible.map((stage) => stage.id!) : []);
                    anchor.current = null;
                  }}
                />
              </th>
              <th>{tr('Order')}</th>
              <th>{tr('Stage')}</th>
              <th>{tr('Type')}</th>
              <th>{tr('Best of')}</th>
              <th>{tr('Action sequence / policy')}</th>
              <th>{tr('Mappool')}</th>
              <th>{tr('Save / advanced')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((stage) => {
              const poolData = pools.data?.stages.find((item) => item.id === stage.id);
              return (
                <StageOverviewRow
                  key={stage.id}
                  stage={stage as StageOverviewRecord}
                  defaults={data.defaults}
                  pool={
                    poolData
                      ? {
                          exists: !!poolData.mappool,
                          state: poolData.mappool?.state || null,
                          slots: (
                            poolData.mappool?.draftRevision || poolData.mappool?.publishedRevision
                          )?.slots,
                        }
                      : pools.data
                        ? { exists: false, state: null }
                        : undefined
                  }
                  canEdit={can(actor, 'mappools.edit')}
                  canManageRules={can(actor, 'matches.manage')}
                  canDuplicate={can(actor, 'mappools.create') && workflowReady}
                  busy={busy}
                  selected={selected.includes(stage.id!)}
                  onSelect={
                    canBulk ? (checked, shift) => toggleStage(stage.id!, checked, shift) : undefined
                  }
                  onDirtyChange={rowDirty}
                  onMove={
                    workflowReady && !search && kindFilter === 'ALL'
                      ? (offset) => reorder(stage.id!, offset)
                      : undefined
                  }
                  moveUpDisabled={data.stages[0]?.id === stage.id || dirtyRows.size > 0}
                  moveDownDisabled={data.stages.at(-1)?.id === stage.id || dirtyRows.size > 0}
                  onApply={
                    canBulk
                      ? () => {
                          resetSelection();
                          setCopySource(stage.id!);
                        }
                      : undefined
                  }
                  onSave={(changedStage) =>
                    void run(async () => {
                      await action(stageSavePayload(changedStage, can(actor, 'matches.manage')));
                      await reload();
                      await pools.reload().catch(() => {});
                    }, tr('Stage changes saved.'))
                  }
                  onAdvanced={() => {
                    if (dirty && !window.confirm(tr('Discard unsaved stage settings?'))) return;
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
                    setDraft(null);
                    setDuplicateSource(stage);
                    setDuplicateName(name);
                    setDuplicateSlug(slug);
                    setCopyRules(can(actor, 'matches.manage'));
                    setCopyAppearance(true);
                    setPoolMode('EMPTY');
                    setDirty(false);
                    setDuplicating(true);
                  }}
                />
              );
            })}
          </tbody>
        </table>
        {!visible.length && (
          <p className="py-8 text-center text-sm text-muted">{tr('No matching stages.')}</p>
        )}
      </div>
      <EditorPanel
        title={draft?.id ? tr('Stage settings') : tr('New stage')}
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
                const { matchRules, qualifierPolicy, configurationToken, ...fields } = draft;
                const result = await action<{ id: string }>({
                  type: 'stage.save',
                  ...fields,
                  ...(configurationToken ? { baseConfigurationToken: configurationToken } : {}),
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
                acknowledgeDraft();
                setDuplicating(false);
                await reload();
                if (returnToPool)
                  router.push(`${scope.adminBase}/mappools?stage=${encodeURIComponent(result.id)}`);
              }, tr('Stage settings saved. Existing matches retain their snapshots.'));
            }}
          >
            {!draft.id && !duplicating && (
              <div className="grid-fields">
                <Field label={tr('Stage template')}>
                  <select
                    value={template}
                    onChange={(event) => {
                      const preset = STAGE_TEMPLATES.find(
                        (item) => item.key === event.target.value,
                      )!;
                      setTemplate(preset.key);
                      setTemplateSource('');
                      update({
                        name: preset.name,
                        slug: slugify(preset.name),
                        kind: preset.kind,
                        matchRules: null,
                        qualifierPolicy:
                          preset.kind === 'QUALIFIERS'
                            ? qualifierPolicySchema.parse({
                                requiredPlayers: data.defaults.teamSize,
                              })
                            : null,
                      });
                    }}
                  >
                    {STAGE_TEMPLATES.map((preset) => (
                      <option key={preset.key} value={preset.key}>
                        {tr(preset.name)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={tr('Configuration source')}>
                  <select
                    value={templateSource}
                    disabled={!can(actor, 'matches.manage')}
                    onChange={(event) => {
                      const source = data.stages.find((stage) => stage.id === event.target.value);
                      setTemplateSource(event.target.value);
                      update({
                        matchRules:
                          draft.kind === 'QUALIFIERS'
                            ? null
                            : source
                              ? source.matchRules || data.defaults
                              : null,
                        qualifierPolicy:
                          draft.kind === 'QUALIFIERS'
                            ? source?.qualifierPolicy || qualifierPolicySchema.parse({})
                            : null,
                      });
                    }}
                  >
                    <option value="">
                      {draft.kind === 'QUALIFIERS'
                        ? tr('Default qualifier policy')
                        : tr('Inherit tournament defaults')}
                    </option>
                    {data.stages
                      .filter(
                        (stage) =>
                          !stage.archivedAt &&
                          (draft.kind === 'QUALIFIERS'
                            ? stage.kind === 'QUALIFIERS'
                            : stage.kind !== 'QUALIFIERS'),
                      )
                      .map((stage) => (
                        <option key={stage.id} value={stage.id}>
                          {tr('Copy')} {stage.name}
                        </option>
                      ))}
                  </select>
                </Field>
              </div>
            )}
            <div className="grid-fields">
              <Field label={tr('Stage name')}>
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
              <Field label={tr('URL slug')}>
                <input
                  required
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  value={draft.slug}
                  onChange={(e) => update({ slug: e.target.value })}
                />
              </Field>
              <Field label={tr('Stage type')}>
                <select
                  value={draft.kind}
                  onChange={(e) =>
                    update({
                      kind: e.target.value,
                      ...(!draft.id &&
                      e.target.value === 'QUALIFIERS' &&
                      data.defaults.gameMode === 'osu' &&
                      data.defaults.gameplayScoring !== 'LAZER'
                        ? {
                            qualifierPolicy: qualifierPolicySchema.parse({
                              normalization: 'BUILT_IN',
                              multiplierPolicy: 'NONE',
                              rounding: 'FLOOR',
                              countFailed: true,
                            }),
                          }
                        : {}),
                    })
                  }
                >
                  {['QUALIFIERS', 'ELIMINATION', 'GROUPS', 'CUSTOM'].map((k) => (
                    <option key={k} value={k}>
                      {tr(stageKinds[k] || k)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {can(actor, 'matches.manage') && draft.kind !== 'QUALIFIERS' && (
              <section className="space-y-3">
                <div className="grid-fields">
                  <Field label={tr('Stage Best-of')}>
                    <select
                      value={(draft.matchRules || data.defaults).bestOf}
                      onChange={(event) =>
                        update({
                          matchRules: withStageBestOf(
                            draft.matchRules || data.defaults,
                            Number(event.target.value),
                          ),
                        })
                      }
                    >
                      {Array.from({ length: 16 }, (_, index) => 1 + index * 2).map((bestOf) => (
                        <option key={bestOf} value={bestOf}>
                          {tr('BO')}
                          {bestOf}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <details>
                  <summary className="cursor-pointer text-sm font-semibold">
                    {tr('Action sequence and team order')}
                  </summary>
                  <div className="mt-3">
                    <StageActionEditor
                      rules={draft.matchRules || data.defaults}
                      onChange={(matchRules) => update({ matchRules })}
                    />
                  </div>
                </details>
              </section>
            )}
            <Field label={tr('Description')}>
              <textarea
                value={draft.description}
                onChange={(e) => update({ description: e.target.value })}
              />
            </Field>
            <MediaField
              label={tr('Stage banner')}
              canUpload={can(actor, 'media.upload')}
              value={draft.bannerImageId ? `/api/media/${draft.bannerImageId}` : ''}
              onChange={(url) =>
                update({ bannerImageId: /\/api\/media\/([a-zA-Z0-9_-]+)/.exec(url)?.[1] || null })
              }
            />
            <details className="border-t pt-4">
              <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                {tr('Advanced stage settings')}
              </summary>
              <div className="grid-fields mt-4">
                <Field label={tr('Order')}>
                  <NumberInput
                    min={0}
                    value={draft.position}
                    onChange={(position) => update({ position: position ?? 0 })}
                  />
                </Field>
                <Field label={tr('Next stage')}>
                  <select
                    value={draft.nextStageId || ''}
                    onChange={(e) => update({ nextStageId: e.target.value || null })}
                  >
                    <option value="">{tr('None')}</option>
                    {data.stages
                      .filter((s) => s.id !== draft.id)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label={tr('Start date (your timezone)')}>
                  <input
                    type="datetime-local"
                    value={localDateTimeInput(draft.startsAt)}
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
                {tr('Archived')}
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
                    {tr('Inherit tournament match rules')}
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
            {can(actor, 'matches.manage') && draft.kind === 'QUALIFIERS' && (
              <section className="space-y-3 border-t pt-3">
                <h2 className="font-semibold">{tr('Qualifier policy')}</h2>
                <p className="text-xs text-muted">
                  {tr(
                    'Gameplay scoring belongs to the tournament. These settings control qualifier aggregation, eligible runs and seedings.',
                  )}
                </p>
                <QualifierPolicyFields
                  value={qualifierPolicySchema.parse(draft.qualifierPolicy || {})}
                  gameMode={data.defaults.gameMode}
                  gameplayScoring={data.defaults.gameplayScoring}
                  onChange={(qualifierPolicy) => update({ qualifierPolicy })}
                />
                {draft.id && (
                  <p className="text-sm">
                    <Link className="text-primary" href="/admin/qualifier-results">
                      {tr('Qualifier results & seedings')}
                    </Link>
                    {' / '}
                    {tr('Reprocess scoring')}
                  </p>
                )}
              </section>
            )}
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" disabled={busy} onClick={close}>
                {tr('Cancel')}
              </Button>
              <SaveButton
                busy={busy}
                disabled={
                  draft.kind !== 'QUALIFIERS' &&
                  !!draft.matchRules &&
                  !matchRulesSchema.safeParse(draft.matchRules).success
                }
              >
                {tr('Save stage')}
              </SaveButton>
            </div>
          </form>
        )}
      </EditorPanel>
      <EditorPanel
        title={tr('Duplicate stage')}
        open={duplicating && !!duplicateSource}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        {duplicateSource && (
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                if (!duplicateSource.id || !duplicateSource.configurationToken)
                  throw new Error('Reload the source stage before duplicating.');
                const result = await action<{ id: string }>({
                  type: 'stage.duplicate',
                  sourceId: duplicateSource.id,
                  baseConfigurationToken: duplicateSource.configurationToken,
                  name: duplicateName,
                  slug: duplicateSlug,
                  copyRules,
                  copyAppearance,
                  poolMode,
                });
                setDuplicating(false);
                setDuplicateSource(null);
                setDirty(false);
                acknowledgeDraft();
                await reload();
                await pools.reload();
                if (returnToPool)
                  router.push(`${scope.adminBase}/mappools?stage=${encodeURIComponent(result.id)}`);
              }, tr('Stage duplicated as a new draft.'));
            }}
          >
            <p className="text-sm text-muted">
              {tr('Source:')} {duplicateSource.name} ·{' '}
              {tr(stageKinds[duplicateSource.kind] || duplicateSource.kind)}
            </p>
            <Field label={tr('New stage name')}>
              <input
                required
                maxLength={120}
                value={duplicateName}
                onChange={(event) => {
                  const name = event.target.value;
                  if (duplicateSlug === slugify(duplicateName)) setDuplicateSlug(slugify(name));
                  setDuplicateName(name);
                  setDirty(true);
                }}
              />
            </Field>
            <Field label={tr('New stage URL slug')}>
              <input
                required
                maxLength={80}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                value={duplicateSlug}
                onChange={(event) => {
                  setDuplicateSlug(event.target.value);
                  setDirty(true);
                }}
              />
            </Field>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={copyRules}
                disabled={!can(actor, 'matches.manage') || busy}
                onChange={(event) => {
                  setCopyRules(event.target.checked);
                  setDirty(true);
                }}
              />
              {duplicateSource.kind === 'QUALIFIERS'
                ? tr('Copy qualifier policy')
                : tr('Copy gameplay rules, Best-of and action sequence')}
            </label>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={copyAppearance}
                disabled={busy}
                onChange={(event) => {
                  setCopyAppearance(event.target.checked);
                  setDirty(true);
                }}
              />
              {tr('Copy stage banner')}
            </label>
            <Field label={tr('Mappool copy')}>
              <select
                value={poolMode}
                disabled={busy}
                onChange={(event) => {
                  setPoolMode(event.target.value as typeof poolMode);
                  setDirty(true);
                }}
              >
                <option value="EMPTY">{tr('Empty pool')}</option>
                <option
                  value="STRUCTURE"
                  disabled={
                    !(['mappools.view_drafts', 'mappools.edit', 'mappools.publish'] as const).some(
                      (key) => can(actor, key),
                    )
                  }
                >
                  {tr('Structure and difficulty targets only')}
                </option>
                <option
                  value="CONTENTS"
                  disabled={
                    !(['mappools.view_drafts', 'mappools.edit', 'mappools.publish'] as const).some(
                      (key) => can(actor, key),
                    )
                  }
                >
                  {tr('Structure, targets, beatmaps and saved notes')}
                </option>
              </select>
            </Field>
            <p className="text-xs text-muted">
              {tr(
                'The type and description are copied. Progression links, archive state, dates and pool publication start fresh. Pool contents use the latest saved draft, or the published version when no draft exists.',
              )}
            </p>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" disabled={busy} onClick={close}>
                {tr('Cancel')}
              </Button>
              <SaveButton busy={busy}>{tr('Duplicate stage')}</SaveButton>
            </div>
          </form>
        )}
      </EditorPanel>
    </>
  );
}
