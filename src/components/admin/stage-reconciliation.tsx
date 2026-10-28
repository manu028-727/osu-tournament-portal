'use client';
import { Feedback, useT } from '@/components/locale';

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
  const tr = useT();
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
          else void run(refresh, tr('Stage review ready.'));
        }}
      >
        <Wrench size={16} />
        {tr('Repair stage associations')}
      </Button>
      <Modal
        title={tr('Review stage associations')}
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
              title={tr('Refresh stage review')}
              aria-label={tr('Refresh stage review')}
              disabled={busy}
              onClick={() => void run(refresh, tr('Stage review refreshed.'))}
            >
              <RefreshCw size={16} />
            </Button>
          </div>
          {preview && !preview.matches.length && (
            <p className="text-sm text-muted">{tr('No suspect stage associations.')}</p>
          )}
          <div className="max-h-[55dvh] overflow-auto">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{tr('Review')}</th>
                  <th>{tr('Match / source')}</th>
                  <th>{tr('Existing target stage')}</th>
                  <th>{tr('Snapshot changes')}</th>
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
                          aria-label={tr('Review match {0}', match.matchNumber)}
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
                          #{match.matchNumber}
                        </a>
                        <p className="text-xs">
                          {match.currentStage.name} / {match.status}
                        </p>
                        <p className="text-xs text-muted">
                          {tr('Source:')} {match.sourceLabel}
                          {match.bracket ? ` / ${match.bracket}` : ''}
                        </p>
                        {match.reasons.map((reason) => (
                          <p key={reason} className="text-xs text-muted">
                            <Feedback message={reason} />
                          </p>
                        ))}
                      </td>
                      <td className="min-w-48">
                        <select
                          aria-label={tr('Target stage for match {0}', match.matchNumber)}
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
                          <option value="">{tr('Choose manually')}</option>
                          {preview.stages.map((stage) => (
                            <option key={stage.id} value={stage.id}>
                              {stage.name}
                            </option>
                          ))}
                        </select>
                        <p className="mt-2 text-xs text-muted">
                          {match.currentStage.name} {tr('to')} {stage?.name || tr('unresolved')}
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
                            {tr('Bind published target pool and inherited rules')}
                          </label>
                        ) : (
                          <p>{tr('Historical pool and rules preserved.')}</p>
                        )}
                        {selected?.rebindPool && (
                          <p className="mt-2 break-all">
                            {tr('Pool:')} {match.poolRevisionId || tr('none')} {tr('to')}{' '}
                            {stage?.poolRevisionId}
                          </p>
                        )}
                        {selected?.rebindPool && (
                          <p className="mt-2">
                            {tr('Best-of:')} {match.rules?.bestOf || tr('invalid')} {tr('to')}{' '}
                            {stage?.rules?.bestOf}
                            {' / '}
                            {tr('Scoring:')} {match.rules?.gameplayScoring || tr('unknown')}{' '}
                            {tr('to')} {stage?.rules?.gameplayScoring}
                          </p>
                        )}
                        {stage?.rulesError && (
                          <p className="mt-2 text-red-300">{stage.rulesError}</p>
                        )}
                        {!!match.snapshotProblems.length && !selected?.rebindPool && (
                          <p className="mt-2 text-red-300">
                            {tr('Snapshot needs review before this repair can be applied.')}
                          </p>
                        )}
                        <p className="mt-2 text-muted">
                          {tr('Actions, results, participants and schedules unchanged.')}
                        </p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Field label={tr('Repair reason')}>
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
                  tr(
                    'Apply {0} reviewed stage repairs to {1}?',
                    Object.keys(changes).length,
                    preview?.tournament.name,
                  ),
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
              }, tr('Reviewed stage repairs applied.'));
            }}
          >
            <Check size={16} />
            {tr('Apply reviewed repairs (')}
            {Object.keys(changes).length})
          </Button>
        </div>
      </Modal>
    </>
  );
}
