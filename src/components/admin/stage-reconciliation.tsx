'use client';

import { useState } from 'react';
import { Check, RefreshCw, Wrench } from 'lucide-react';
import type { StageReconciliationAction } from '@/lib/stage-reconciliation';
import type { StageReconciliationPreview } from '@/lib/stage-reconciliation-service';
import { Button } from '../ui/button';
import { action, api, Field, Modal, useTask } from './shared';

type Change = StageReconciliationAction['changes'][number];
export function StageReconciliation({
  preview: supplied,
  onApply,
  onChanged,
}: {
  preview?: StageReconciliationPreview;
  onApply?: (value: StageReconciliationAction) => Promise<unknown>;
  onChanged?: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(supplied);
  const [changes, setChanges] = useState<Record<string, Change>>({});
  const [reason, setReason] = useState('');
  const { run, busy } = useTask();
  const refresh = async () => {
    const value = await api<StageReconciliationPreview>(
      '/api/admin/data?section=stage-reconciliation',
    );
    setPreview(value);
    setChanges({});
  };
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setOpen(true);
          setChanges({});
          if (supplied) setPreview(supplied);
          else void run(refresh, 'Stage review ready.');
        }}
      >
        <Wrench size={16} />
        Repair stage associations
      </Button>
      <Modal
        title="Review stage associations"
        wide
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold">{preview?.tournament.name}</p>
            <Button
              size="icon"
              variant="outline"
              title="Refresh stage review"
              aria-label="Refresh stage review"
              disabled={busy}
              onClick={() => void run(refresh, 'Stage review refreshed.')}
            >
              <RefreshCw size={16} />
            </Button>
          </div>
          {preview && !preview.matches.length && (
            <p className="text-sm text-muted">No suspect stage associations.</p>
          )}
          <div className="max-h-[55dvh] overflow-auto">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Review</th>
                  <th>Match / source</th>
                  <th>Existing target stage</th>
                  <th>Snapshot changes</th>
                </tr>
              </thead>
              <tbody>
                {preview?.matches.map((match) => {
                  const selected = changes[match.matchId];
                  const stageId = selected?.stageId || match.suggestedStageId || '';
                  const stage = preview.stages.find((stage) => stage.id === stageId);
                  const update = (next: Partial<Change>) =>
                    setChanges((current) => ({
                      ...current,
                      [match.matchId]: {
                        ...(current[match.matchId] || {
                          matchId: match.matchId,
                          baseVersion: match.baseVersion,
                          stageId,
                          rebindPool: false,
                        }),
                        ...next,
                      },
                    }));
                  return (
                    <tr key={match.matchId}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Review match ${match.code}`}
                          checked={!!selected}
                          disabled={busy || !stageId}
                          onChange={(event) => {
                            if (event.target.checked) update({});
                            else
                              setChanges((current) => {
                                const next = { ...current };
                                delete next[match.matchId];
                                return next;
                              });
                          }}
                        />
                      </td>
                      <td className="min-w-48 whitespace-normal break-words">
                        <a href={match.refereeUrl} className="text-primary">
                          #{match.code}
                        </a>
                        <p className="text-xs">
                          {match.currentStage.name} / {match.status}
                        </p>
                        <p className="text-xs text-muted">
                          Source: {match.sourceLabel}
                          {match.bracket ? ` / ${match.bracket}` : ''}
                        </p>
                        {match.reasons.map((reason) => (
                          <p key={reason} className="text-xs text-muted">
                            {reason}
                          </p>
                        ))}
                      </td>
                      <td className="min-w-48">
                        <select
                          aria-label={`Target stage for match ${match.code}`}
                          value={stageId}
                          disabled={busy}
                          onChange={(event) =>
                            update({
                              stageId: event.target.value,
                              rebindPool: false,
                              targetSnapshotKey: undefined,
                            })
                          }
                        >
                          <option value="">Choose manually</option>
                          {preview.stages.map((stage) => (
                            <option key={stage.id} value={stage.id}>
                              {stage.name}
                            </option>
                          ))}
                        </select>
                        <p className="mt-2 text-xs text-muted">
                          {match.currentStage.name} to {stage?.name || 'unresolved'}
                        </p>
                      </td>
                      <td className="min-w-56 whitespace-normal text-xs">
                        {match.canRebindPool ? (
                          <label className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              checked={selected?.rebindPool || false}
                              disabled={busy || !stage?.canRebindPool}
                              onChange={(event) =>
                                update({
                                  rebindPool: event.target.checked,
                                  targetSnapshotKey: event.target.checked
                                    ? stage?.snapshotKey || undefined
                                    : undefined,
                                })
                              }
                            />
                            Bind published target pool and inherited rules
                          </label>
                        ) : (
                          <p>Historical pool and rules preserved.</p>
                        )}
                        {selected?.rebindPool && (
                          <p className="mt-2 break-all">
                            Pool: {match.poolRevisionId || 'none'} to {stage?.poolRevisionId}
                          </p>
                        )}
                        {selected?.rebindPool && (
                          <p className="mt-2">
                            Best-of: {match.rules?.bestOf || 'invalid'} to {stage?.rules?.bestOf}
                            {' / '}Scoring: {match.rules?.gameplayScoring || 'unknown'} to{' '}
                            {stage?.rules?.gameplayScoring}
                          </p>
                        )}
                        {stage?.rulesError && (
                          <p className="mt-2 text-red-300">{stage.rulesError}</p>
                        )}
                        {!!match.snapshotProblems.length && !selected?.rebindPool && (
                          <p className="mt-2 text-red-300">
                            Snapshot needs review before this repair can be applied.
                          </p>
                        )}
                        <p className="mt-2 text-muted">
                          Actions, results, participants and schedules unchanged.
                        </p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Field label="Repair reason">
            <input
              value={reason}
              maxLength={2000}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <Button
            disabled={
              busy ||
              reason.trim().length < 3 ||
              !Object.keys(changes).length ||
              Object.values(changes).some(
                (change) =>
                  !change.stageId ||
                  (preview?.matches.find((match) => match.matchId === change.matchId)
                    ?.snapshotProblems.length &&
                    !change.rebindPool),
              )
            }
            onClick={() => {
              if (
                !window.confirm(
                  `Apply ${Object.keys(changes).length} reviewed stage repairs to ${preview?.tournament.name}?`,
                )
              )
                return;
              void run(async () => {
                await (onApply || action)({
                  type: 'stage.reconcile',
                  reason,
                  changes: Object.values(changes),
                });
                await refresh();
                await onChanged?.();
              }, 'Reviewed stage repairs applied.');
            }}
          >
            <Check size={16} />
            Apply reviewed repairs ({Object.keys(changes).length})
          </Button>
        </div>
      </Modal>
    </>
  );
}
