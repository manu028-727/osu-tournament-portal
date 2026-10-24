'use client';
import { humanizeCode } from '@/lib/i18n';
import { Feedback, useT } from '@/components/locale';

import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Pencil, Save, X, Layers } from 'lucide-react';
import Link from '@/components/tournament-scope';
import { matchRulesSchema, type MatchRules } from '@/lib/match-rules';
import {
  QUALIFIER_METHOD_LABELS,
  qualifierPolicySchema,
  type QualifierPolicy,
} from '@/lib/qualifier-policy';
import { stagePoolIssues } from '@/lib/stage-workflows-validation';
import { Button } from '@/components/ui/button';
import { Field, useUnsaved } from './shared';
import {
  explicitStageSequence,
  moveStageActionSequence,
  previewStageActions,
  stageActionPreset,
  stageActionSequenceLabel,
  withStageActionSequence,
  withStageBestOf,
} from './stage-editor-model';

export type StageOverviewRecord = {
  id: string;
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
export type StagePoolState = {
  exists: boolean;
  state: string | null;
  slots?: { name: string; category: string; beatmapId: number }[];
};

export function StageActionEditor({
  rules,
  disabled = false,
  onChange,
}: {
  rules: MatchRules;
  disabled?: boolean;
  onChange: (rules: MatchRules) => void;
}) {
  const tr = useT();
  const [first, setFirst] = useState<'A' | 'B'>('A');
  const sequence = rules.draftSequence;
  const parsed = matchRulesSchema.safeParse(rules);
  return (
    <div className="space-y-3">
      <label className="block text-sm">
        {tr('Action preset')}
        <select
          disabled={disabled}
          value=""
          onChange={(event) => {
            if (event.target.value)
              onChange(
                stageActionPreset(
                  rules,
                  event.target.value as 'ONE_BAN' | 'TWO_BANS' | 'PROTECT_BANS' | 'ALTERNATING',
                ),
              );
          }}
        >
          <option value="">{tr('Custom / current configuration')}</option>
          <option value="ONE_BAN">{tr('One ban each')}</option>
          <option value="TWO_BANS">{tr('Two bans each')}</option>
          <option value="PROTECT_BANS">{tr('Protect then two bans each')}</option>
          <option value="ALTERNATING">{tr('Alternating picks')}</option>
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        {(['banOrder', 'pickOrder', 'protectOrder'] as const).map((key) => (
          <Field
            key={key}
            label={
              key === 'banOrder'
                ? tr('Ban order')
                : key === 'pickOrder'
                  ? tr('Pick order')
                  : tr('Protect order')
            }
          >
            <select
              disabled={disabled}
              value={rules[key]}
              onChange={(event) => onChange({ ...rules, [key]: event.target.value })}
            >
              {key === 'banOrder' && <option value="AB">{tr('AB (one ban each)')}</option>}
              <option value="ABAB">{tr('ABAB')}</option>
              <option value="ABBA">{tr('ABBA')}</option>
            </select>
          </Field>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {(['firstBanRule', 'firstPickRule', 'firstProtectRule'] as const).map((key) => (
          <Field
            key={key}
            label={
              key === 'firstBanRule'
                ? tr('First ban')
                : key === 'firstPickRule'
                  ? tr('First pick')
                  : tr('First protect')
            }
          >
            <select
              disabled={disabled}
              value={rules[key]}
              onChange={(event) => onChange({ ...rules, [key]: event.target.value })}
            >
              <option value="CHOICE">{tr('Referee records choice')}</option>
              <option value="ROLL_WINNER">{tr('Roll winner')}</option>
              <option value="ROLL_LOSER">{tr('Roll loser')}</option>
              <option value="RED">{tr('Red')}</option>
              <option value="BLUE">{tr('Blue')}</option>
            </select>
          </Field>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={rules.rollRequired}
          disabled={disabled}
          onChange={(event) => onChange({ ...rules, rollRequired: event.target.checked })}
        />
        {tr('Roll required')}
      </label>
      <div className="flex flex-wrap gap-1.5">
        {(['PROTECT', 'BAN', 'PICK', 'TB_BAN'] as const).map((kind) => (
          <Button
            key={kind}
            type="button"
            size="sm"
            variant="outline"
            disabled={
              disabled ||
              explicitStageSequence(rules).length >= 30 ||
              (kind === 'TB_BAN' && sequence.includes(kind))
            }
            onClick={() => {
              const next = [...explicitStageSequence(rules)];
              const before = next.indexOf('TB_BAN');
              next.splice(before < 0 ? next.length : before, 0, kind);
              onChange(withStageActionSequence(rules, next));
            }}
          >
            + {kind === 'TB_BAN' ? tr('TB ban pair') : tr('{0} pair', tr(humanizeCode(kind)))}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled || !sequence.length}
          onClick={() => onChange(withStageActionSequence(rules, []))}
        >
          {tr('Count-based')}
        </Button>
      </div>
      <ol className="max-h-64 space-y-1 overflow-y-auto">
        {(sequence.length ? sequence : explicitStageSequence(rules)).map(
          (kind, index, displayed) => (
            <li key={`${kind}-${index}`} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1">
                {index + 1}. {tr(kind.replace('_', ' '))} {tr('pair')}
              </span>
              {([-1, 1] as const).map((offset) => (
                <Button
                  key={offset}
                  type="button"
                  size="icon"
                  variant="ghost"
                  title={tr('Move action {0}', tr(offset < 0 ? 'up' : 'down'))}
                  aria-label={tr('Move action {0} {1}', index + 1, tr(offset < 0 ? 'up' : 'down'))}
                  disabled={
                    disabled ||
                    kind === 'TB_BAN' ||
                    index + offset < 0 ||
                    index + offset >= displayed.length ||
                    displayed[index + offset] === 'TB_BAN'
                  }
                  onClick={() =>
                    onChange(
                      withStageActionSequence(
                        rules,
                        moveStageActionSequence(displayed, index, offset),
                      ),
                    )
                  }
                >
                  {offset < 0 ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
                </Button>
              ))}
              <Button
                type="button"
                size="icon"
                variant="ghost"
                title={tr('Remove action pair')}
                aria-label={tr('Remove action {0}', index + 1)}
                disabled={disabled}
                onClick={() =>
                  onChange(
                    withStageActionSequence(
                      rules,
                      displayed.filter((_, at) => at !== index),
                    ),
                  )
                }
              >
                <X size={15} />
              </Button>
            </li>
          ),
        )}
      </ol>
      <details>
        <summary className="cursor-pointer text-sm">{tr('Effective team order')}</summary>
        <label className="mt-2 block text-sm">
          {tr('Preview roll winner and choice')}
          <select value={first} onChange={(event) => setFirst(event.target.value as 'A' | 'B')}>
            <option value="A">{tr('Red')}</option>
            <option value="B">{tr('Blue')}</option>
          </select>
        </label>
        <p className="my-2 text-xs text-muted">
          {tr(
            'This team wins the preview roll and starts choice-based actions. Fixed and roll-based rules determine the other starters. Preview assumes a tied match through the deciding map.',
          )}
        </p>
        <ol className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto text-xs">
          {previewStageActions(rules, first).map((step, index) => (
            <li key={index} className="rounded border px-2 py-1">
              {index + 1}. {step.side === 'A' ? tr('Red') : tr('Blue')}{' '}
              {step.tiebreaker
                ? tr('TB {0}', tr(humanizeCode(step.kind)).toLowerCase())
                : tr(humanizeCode(step.kind)).toLowerCase()}
            </li>
          ))}
        </ol>
      </details>
      {!parsed.success && (
        <p role="alert" className="text-sm text-red-300">
          {parsed.error.issues.map((issue) => issue.message).join(' ')}
        </p>
      )}
    </div>
  );
}

export function StageOverviewRow({
  stage,
  defaults,
  pool,
  canEdit,
  canManageRules,
  canDuplicate,
  busy,
  onSave,
  onAdvanced,
  onDuplicate,
  selected = false,
  onSelect,
  onMove,
  moveUpDisabled,
  moveDownDisabled,
  onApply,
  onDirtyChange,
}: {
  stage: StageOverviewRecord;
  defaults: MatchRules;
  pool: StagePoolState | undefined;
  canEdit: boolean;
  canManageRules: boolean;
  canDuplicate: boolean;
  busy: boolean;
  onSave: (stage: StageOverviewRecord) => void;
  onAdvanced: () => void;
  onDuplicate: () => void;
  selected?: boolean;
  onSelect?: (checked: boolean, shift: boolean) => void;
  onMove?: (offset: -1 | 1) => void;
  moveUpDisabled?: boolean;
  moveDownDisabled?: boolean;
  onApply?: () => void;
  onDirtyChange?: (id: string, dirty: boolean) => void;
}) {
  const tr = useT();
  const [draft, setDraft] = useState(stage);
  useEffect(() => {
    setDraft(stage);
  }, [stage]);
  const isQualifier = draft.kind === 'QUALIFIERS';
  const activeRules = draft.matchRules || defaults;
  const changed = JSON.stringify(draft) !== JSON.stringify(stage);
  useUnsaved(changed);
  useEffect(() => {
    onDirtyChange?.(stage.id, changed);
    return () => onDirtyChange?.(stage.id, false);
  }, [onDirtyChange, stage.id, changed]);
  const validation = isQualifier ? null : matchRulesSchema.safeParse(activeRules);
  const sequenceError =
    validation && !validation.success
      ? validation.error.issues.map((issue) => issue.message).join(' ')
      : '';
  const issues = !isQualifier && pool?.slots ? stagePoolIssues(activeRules, pool.slots) : [];
  return (
    <tr>
      <td className="w-12">
        <input
          type="checkbox"
          aria-label={tr('Select {0}', stage.name)}
          checked={selected}
          disabled={busy || !canEdit || !onSelect}
          onChange={(event) =>
            onSelect?.(event.target.checked, (event.nativeEvent as MouseEvent).shiftKey || false)
          }
        />
      </td>
      <td className="w-24">
        <div className="flex items-center gap-1">
          <span className="tabular-nums">{stage.position + 1}</span>
          {onMove && (
            <div className="flex flex-col">
              {([-1, 1] as const).map((offset) => (
                <Button
                  key={offset}
                  type="button"
                  size="icon"
                  variant="ghost"
                  title={tr('Move {0} {1}', stage.name, tr(offset < 0 ? 'up' : 'down'))}
                  aria-label={tr('Move {0} {1}', stage.name, tr(offset < 0 ? 'up' : 'down'))}
                  disabled={
                    busy || !canEdit || changed || (offset < 0 ? moveUpDisabled : moveDownDisabled)
                  }
                  onClick={() => onMove(offset)}
                >
                  {offset < 0 ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                </Button>
              ))}
            </div>
          )}
        </div>
      </td>
      <td className="min-w-48">
        <input
          aria-label={tr('Stage name: {0}', stage.name)}
          className="w-full min-w-40"
          maxLength={120}
          value={draft.name}
          disabled={!canEdit || busy}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
        />
        <span className="mt-1 block text-xs text-muted">
          {draft.archivedAt ? tr('Archived · ') : ''}
          {isQualifier
            ? tr('Qualifier policy')
            : draft.matchRules
              ? tr('Customized · overrides tournament defaults')
              : tr('Inherited · tournament defaults')}
        </span>
      </td>
      <td className="min-w-36">
        <select
          aria-label={tr('Stage type: {0}', stage.name)}
          value={draft.kind}
          disabled={!canEdit || !canManageRules || busy}
          onChange={(event) => {
            const kind = event.target.value;
            setDraft((current) => ({
              ...current,
              kind,
              matchRules:
                kind === 'QUALIFIERS'
                  ? null
                  : current.matchRules || (current.kind === 'QUALIFIERS' ? defaults : null),
              qualifierPolicy:
                kind === 'QUALIFIERS'
                  ? qualifierPolicySchema.parse(current.qualifierPolicy || {})
                  : null,
            }));
          }}
        >
          <option value="QUALIFIERS">{tr('Qualifiers')}</option>
          <option value="ELIMINATION">{tr('Elimination')}</option>
          <option value="GROUPS">{tr('Groups')}</option>
          <option value="CUSTOM">{tr('Custom')}</option>
        </select>
      </td>
      <td className="min-w-28">
        {isQualifier ? (
          <span className="text-sm text-muted">{tr('Full pool')}</span>
        ) : (
          <select
            aria-label={tr('Best of: {0}', stage.name)}
            value={activeRules.bestOf}
            disabled={!canEdit || !canManageRules || busy}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                matchRules: withStageBestOf(activeRules, Number(event.target.value)),
              }))
            }
          >
            {Array.from({ length: 16 }, (_, index) => 1 + index * 2).map((bestOf) => (
              <option key={bestOf} value={bestOf}>
                {tr('BO')}
                {bestOf}
              </option>
            ))}
          </select>
        )}
      </td>
      <td className="min-w-64">
        {isQualifier ? (
          <span className="text-sm text-muted">
            {tr(QUALIFIER_METHOD_LABELS[draft.qualifierPolicy?.method || 'RAW_SCORE'])} ·{' '}
            {draft.qualifierPolicy?.runs || 1} {tr('run(s)')}
          </span>
        ) : (
          <details>
            <summary className="max-w-72 cursor-pointer truncate text-sm text-muted">
              {stageActionSequenceLabel(activeRules, tr)}
            </summary>
            <div className="mt-3 min-w-72 space-y-3">
              <StageActionEditor
                rules={activeRules}
                disabled={!canEdit || !canManageRules || busy}
                onChange={(matchRules) => setDraft((current) => ({ ...current, matchRules }))}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!canEdit || !canManageRules || busy || !draft.matchRules}
                onClick={() => setDraft((current) => ({ ...current, matchRules: null }))}
              >
                {tr('Use tournament defaults')}
              </Button>
            </div>
          </details>
        )}
        {sequenceError && (
          <p role="alert" className="text-xs text-red-300">
            {sequenceError}
          </p>
        )}
      </td>
      <td className="min-w-40">
        <span className="block text-sm">
          {pool === undefined
            ? tr('Pool status unavailable')
            : !pool.exists
              ? tr('No pool record')
              : pool.state === 'PUBLISHED'
                ? tr('Published')
                : tr('Draft')}
        </span>
        {canEdit && (
          <Link
            className="text-xs text-primary hover:underline"
            href={`/admin/mappools?stage=${encodeURIComponent(stage.id)}`}
          >
            {tr('Edit stage pool')}
          </Link>
        )}
        {!!issues.length && (
          <details className="mt-1 text-xs text-muted">
            <summary className="cursor-pointer">
              {issues.length} {tr('readiness issue(s)')}
            </summary>
            <ul className="mt-1 space-y-1">
              {issues.map((issue) => (
                <li key={issue.code}>
                  <Feedback message={issue.message} />
                </li>
              ))}
            </ul>
          </details>
        )}
      </td>
      <td>
        <div className="flex items-center gap-1">
          {changed && (
            <>
              <Button
                type="button"
                size="sm"
                disabled={busy || !canEdit || !!sequenceError || !draft.name.trim()}
                onClick={() => onSave(draft)}
              >
                <Save size={15} />
                {tr('Save')}
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                title={tr('Discard inline changes')}
                aria-label={tr('Discard changes to {0}', stage.name)}
                disabled={busy}
                onClick={() => setDraft(stage)}
              >
                <X size={16} />
              </Button>
            </>
          )}
          {onApply && !isQualifier && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              title={tr('Apply these rules to other stages')}
              aria-label={tr('Apply {0} rules to other stages', stage.name)}
              disabled={busy || changed || !canEdit || !canManageRules || !!stage.archivedAt}
              onClick={onApply}
            >
              <Layers size={16} />
            </Button>
          )}
          {canDuplicate && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              title={tr('Duplicate stage')}
              aria-label={tr('Duplicate {0}', stage.name)}
              disabled={busy || changed}
              onClick={onDuplicate}
            >
              <Copy size={16} />
            </Button>
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            title={tr('Advanced stage settings')}
            aria-label={tr('Edit advanced settings for {0}', stage.name)}
            disabled={!canEdit || busy || changed}
            onClick={onAdvanced}
          >
            <Pencil size={17} />
          </Button>
        </div>
      </td>
    </tr>
  );
}

export function stageSavePayload(stage: StageOverviewRecord, canManageRules: boolean) {
  return {
    type: 'stage.save' as const,
    id: stage.id,
    name: stage.name,
    slug: stage.slug,
    description: stage.description,
    position: stage.position,
    startsAt: stage.startsAt,
    bannerImageId: stage.bannerImageId,
    kind: stage.kind as 'QUALIFIERS' | 'ELIMINATION' | 'GROUPS' | 'CUSTOM',
    nextStageId: stage.nextStageId,
    archivedAt: stage.archivedAt,
    ...(stage.configurationToken ? { baseConfigurationToken: stage.configurationToken } : {}),
    ...(canManageRules
      ? {
          matchRules: stage.kind === 'QUALIFIERS' ? null : stage.matchRules,
          qualifierPolicy:
            stage.kind === 'QUALIFIERS'
              ? qualifierPolicySchema.parse(stage.qualifierPolicy || {})
              : null,
        }
      : {}),
  };
}
