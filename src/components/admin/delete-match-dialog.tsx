'use client';
import { useT } from '@/components/locale';

import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { action, api, Field, Modal, SaveButton, useTask } from './shared';
import type { MatchResultImpact } from '@/lib/match-results-contract';
export type DeleteMatchSelection = { id: string; code: string; version: number };
export function DeleteMatchDialog({
  match,
  onClose,
  onDeleted,
}: {
  match: DeleteMatchSelection | null;
  onClose: () => void;
  onDeleted: () => Promise<unknown>;
}) {
  const tr = useT();
  const [code, setCode] = useState(''),
    [reason, setReason] = useState('');
  const { busy, run } = useTask();
  const [impact, setImpact] = useState<(MatchResultImpact & { retainedHistory: boolean }) | null>(
    null,
  );
  const [approve, setApprove] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    setCode('');
    setReason('');
    setImpact(null);
    setApprove(false);
    setError('');
    if (!match) return;
    let active = true;
    void api<MatchResultImpact & { retainedHistory: boolean }>('/api/admin/match-results', {
      method: 'POST',
      body: JSON.stringify({ type: 'deletion', id: match.id, baseVersion: match.version }),
    })
      .then((value) => {
        if (active) setImpact(value);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [match?.id, match?.version]);
  return (
    <Modal
      title={tr(impact?.retainedHistory ? 'Delete generated match' : 'Permanently delete match')}
      open={!!match}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      {match && (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              async () => {
                await action({
                  type: 'match.delete',
                  id: match.id,
                  baseVersion: match.version,
                  confirmCode: code,
                  reason,
                  approveProgression: approve,
                  correctionHash: impact?.hash || undefined,
                });
                onClose();
                await onDeleted();
              },
              tr(
                impact?.retainedHistory
                  ? 'Generated match removed; history retained.'
                  : 'Match permanently deleted.',
              ),
            );
          }}
        >
          <p className="text-red-200">
            {tr('Match')} {match.code}
            {impact?.retainedHistory
              ? tr(
                  ' will be removed from active scheduling. Its history and bracket number are retained. Unstarted downstream positions are cleared; started matches remain protected.',
                )
              : tr(
                  ', its picks, scores, lobby imports and referee history will be permanently removed. This cannot be undone. Teams and mappools are kept; an audit entry records the deletion.',
                )}
          </p>
          {error && (
            <p role="alert" className="text-sm text-red-200">
              {error}
            </p>
          )}
          {impact?.blocked && (
            <p role="alert" className="text-sm text-red-200">
              {tr(
                'Downstream matches or frozen standings protect this result. Reconcile them before changing the winner.',
              )}
            </p>
          )}
          {impact?.requiresApproval && (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={approve}
                onChange={(e) => setApprove(e.target.checked)}
              />
              {tr('Approve corrections to unstarted downstream fixtures')}{' '}
              {impact.affected.map((row) => row.matchNumber).join(', ')}
            </label>
          )}
          <Field label={tr('Match number confirmation')}>
            <input
              autoComplete="off"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <Field label={tr('Deletion reason')}>
            <input
              required
              minLength={3}
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <SaveButton
            busy={busy}
            disabled={
              code !== match.code ||
              reason.trim().length < 3 ||
              !impact ||
              impact.blocked ||
              (!!impact.requiresApproval && !approve)
            }
          >
            <Trash2 size={17} />
            {tr(impact?.retainedHistory ? 'Delete generated match' : 'Permanently delete match')}
          </SaveButton>
        </form>
      )}
    </Modal>
  );
}
