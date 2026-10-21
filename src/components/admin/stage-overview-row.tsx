'use client';

import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Pencil, Save, X } from 'lucide-react';
import Link from '@/components/tournament-scope';
import { matchRulesSchema, type MatchRules } from '@/lib/match-rules';
import { qualifierPolicySchema, type QualifierPolicy } from '@/lib/qualifier-policy';
import { Button } from '@/components/ui/button';
import {
  moveStageActionSequence,
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
};

type PoolState = { exists: boolean; state: string | null };

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
}: {
  stage: StageOverviewRecord;
  defaults: MatchRules;
  pool: PoolState | undefined;
  canEdit: boolean;
  canManageRules: boolean;
  canDuplicate: boolean;
  busy: boolean;
  onSave: (stage: StageOverviewRecord) => void;
  onAdvanced: () => void;
  onDuplicate: () => void;
}) {
  const [draft, setDraft] = useState(stage);
  const [sequenceOpen, setSequenceOpen] = useState(false);
  useEffect(() => {
    setDraft(stage);
  }, [stage]);

  const isQualifier = draft.kind === 'QUALIFIERS';
  const activeRules = draft.matchRules || defaults;
  const changed = JSON.stringify(draft) !== JSON.stringify(stage);
  const rulesChanged = JSON.stringify(draft.matchRules) !== JSON.stringify(stage.matchRules);
  const updateRules = (matchRules: MatchRules) =>
    setDraft((current) => ({ ...current, matchRules }));
  const changeKind = (kind: string) => {
    setDraft((current) => ({
      ...current,
      kind,
      matchRules:
        kind === 'QUALIFIERS'
          ? null
          : current.matchRules || (current.kind === 'QUALIFIERS' ? defaults : null),
      qualifierPolicy:
        kind === 'QUALIFIERS' ? qualifierPolicySchema.parse(current.qualifierPolicy || {}) : null,
    }));
  };
  const sequence = activeRules.draftSequence;
  const sequenceError =
    rulesChanged && !isQualifier && sequence.length
      ? matchRulesSchema.safeParse(activeRules).success
        ? ''
        : 'Action counts must match Best-of, bans, and protects. Check the sequence before saving.'
      : '';

  return (
    <>
      <tr>
        <td className="w-16 tabular-nums">{stage.position + 1}</td>
        <td className="min-w-48">
          <input
            aria-label={`Stage name: ${stage.name}`}
            className="w-full min-w-40"
            maxLength={120}
            value={draft.name}
            disabled={!canEdit || busy}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          />
          {draft.archivedAt && <span className="ml-2 text-xs text-muted">Archived</span>}
        </td>
        <td className="min-w-36">
          <select
            aria-label={`Stage type: ${stage.name}`}
            value={draft.kind}
            disabled={!canEdit || !canManageRules || busy}
            onChange={(event) => changeKind(event.target.value)}
          >
            <option value="QUALIFIERS">Qualifiers</option>
            <option value="ELIMINATION">Elimination</option>
            <option value="GROUPS">Groups</option>
            <option value="CUSTOM">Custom</option>
          </select>
        </td>
        <td className="min-w-28">
          {isQualifier ? (
            <span className="text-sm text-muted">Qualifier policy</span>
          ) : (
            <select
              aria-label={`Best of: ${stage.name}`}
              value={activeRules.bestOf}
              disabled={!canEdit || !canManageRules || busy}
              onChange={(event) =>
                updateRules(withStageBestOf(activeRules, Number(event.target.value)))
              }
            >
              {Array.from({ length: 16 }, (_, index) => 1 + index * 2).map((bestOf) => (
                <option key={bestOf} value={bestOf}>
                  BO{bestOf}
                </option>
              ))}
            </select>
          )}
        </td>
        <td className="min-w-56">
          {isQualifier ? (
            <span className="text-sm text-muted">
              {draft.qualifierPolicy?.method?.replaceAll('_', ' ') || 'Raw score'} ·{' '}
              {draft.qualifierPolicy?.runs || 1}{' '}
              {(draft.qualifierPolicy?.runs || 1) === 1 ? 'run' : 'runs'}
            </span>
          ) : (
            <details
              open={sequenceOpen}
              onToggle={(event) => setSequenceOpen(event.currentTarget.open)}
              className="min-w-52"
            >
              <summary className="max-w-72 cursor-pointer truncate text-sm text-muted hover:text-foreground">
                {stageActionSequenceLabel(activeRules)}
              </summary>
              <div className="mt-2 min-w-64 space-y-3 rounded-lg border bg-card p-3">
                <div className="flex flex-wrap gap-1.5">
                  {(['PROTECT', 'BAN', 'PICK', 'TB_BAN'] as const).map((action) => (
                    <Button
                      key={action}
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={
                        !canEdit ||
                        !canManageRules ||
                        busy ||
                        sequence.length >= 30 ||
                        (action === 'TB_BAN' && sequence.includes('TB_BAN'))
                      }
                      onClick={() =>
                        updateRules(withStageActionSequence(activeRules, [...sequence, action]))
                      }
                    >
                      + {action.replace('_', ' ')}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={!canEdit || !canManageRules || busy || !sequence.length}
                    onClick={() => updateRules(withStageActionSequence(activeRules, []))}
                  >
                    Count-based
                  </Button>
                </div>
                {sequence.length > 0 && (
                  <ol className="space-y-1">
                    {sequence.map((action, index) => (
                      <li key={`${action}-${index}`} className="flex items-center gap-2 text-sm">
                        <span className="min-w-0 flex-1">
                          {index + 1}. {action.replace('_', ' ')} pair
                        </span>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          title="Move action up"
                          aria-label={`Move action ${index + 1} up`}
                          disabled={
                            !canEdit ||
                            !canManageRules ||
                            busy ||
                            action === 'TB_BAN' ||
                            index === 0 ||
                            sequence[index - 1] === 'TB_BAN'
                          }
                          onClick={() =>
                            updateRules(
                              withStageActionSequence(
                                activeRules,
                                moveStageActionSequence(sequence, index, -1),
                              ),
                            )
                          }
                        >
                          <ArrowUp size={15} />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          title="Move action down"
                          aria-label={`Move action ${index + 1} down`}
                          disabled={
                            !canEdit ||
                            !canManageRules ||
                            busy ||
                            action === 'TB_BAN' ||
                            index === sequence.length - 1 ||
                            sequence[index + 1] === 'TB_BAN'
                          }
                          onClick={() =>
                            updateRules(
                              withStageActionSequence(
                                activeRules,
                                moveStageActionSequence(sequence, index, 1),
                              ),
                            )
                          }
                        >
                          <ArrowDown size={15} />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          title="Remove action pair"
                          aria-label={`Remove action ${index + 1}`}
                          disabled={!canEdit || !canManageRules || busy}
                          onClick={() =>
                            updateRules(
                              withStageActionSequence(
                                activeRules,
                                sequence.filter((_, itemIndex) => itemIndex !== index),
                              ),
                            )
                          }
                        >
                          <X size={15} />
                        </Button>
                      </li>
                    ))}
                  </ol>
                )}
                {sequenceError && (
                  <p role="alert" className="text-xs text-red-300">
                    {sequenceError}
                  </p>
                )}
                {!canManageRules && (
                  <p className="text-xs text-muted">
                    Match management permission is required to edit rules.
                  </p>
                )}
              </div>
            </details>
          )}
        </td>
        <td className="min-w-36">
          <div className="space-y-1">
            <span className="block text-sm">
              {pool === undefined
                ? 'Pool status unavailable'
                : !pool.exists
                  ? 'No pool record'
                  : pool.state === 'PUBLISHED'
                    ? 'Published'
                    : 'Draft'}
            </span>
            {canEdit && (
              <Link
                className="text-xs text-primary hover:underline"
                href={`/admin/mappools?stage=${encodeURIComponent(stage.id)}`}
              >
                Edit stage pool
              </Link>
            )}
          </div>
        </td>
        <td className="whitespace-nowrap">
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
                  Save
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  title="Discard inline changes"
                  aria-label={`Discard changes to ${stage.name}`}
                  disabled={busy}
                  onClick={() => setDraft(stage)}
                >
                  <X size={16} />
                </Button>
              </>
            )}
            {canDuplicate && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                title="Duplicate settings and rules into a new stage with an empty mappool"
                aria-label={`Duplicate ${stage.name}; maps and publication will not be copied`}
                disabled={busy || changed}
                onClick={onDuplicate}
              >
                <Copy size={16} />
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              title="Edit advanced stage settings"
              aria-label={`Edit advanced settings for ${stage.name}`}
              disabled={!canEdit || busy || changed}
              onClick={onAdvanced}
            >
              <Pencil size={17} />
            </Button>
          </div>
        </td>
      </tr>
      {isQualifier && changed && !canManageRules && (
        <tr>
          <td colSpan={7}>
            <p className="text-xs text-muted">
              You can edit stage details, but match management permission is needed to change its
              type or qualifier policy.
            </p>
          </td>
        </tr>
      )}
    </>
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
