'use client';
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { action, Field, Modal, SaveButton, useTask } from './shared';
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
  const [code, setCode] = useState(''),
    [reason, setReason] = useState('');
  const { busy, run } = useTask();
  useEffect(() => {
    setCode('');
    setReason('');
  }, [match?.id, match?.version]);
  return (
    <Modal
      title="Permanently delete match"
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
            void run(async () => {
              await action({
                type: 'match.delete',
                id: match.id,
                baseVersion: match.version,
                confirmCode: code,
                reason,
              });
              onClose();
              await onDeleted();
            }, 'Match permanently deleted.');
          }}
        >
          <p className="text-red-200">
            Match {match.code}, its picks, scores, lobby imports and referee history will be
            permanently removed. This cannot be undone. Teams and mappools are kept; an audit entry
            records the deletion.
          </p>
          <Field label="Match code confirmation">
            <input
              autoComplete="off"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <Field label="Deletion reason">
            <input
              required
              minLength={3}
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <SaveButton busy={busy} disabled={code !== match.code || reason.trim().length < 3}>
            <Trash2 size={17} />
            Permanently delete match
          </SaveButton>
        </form>
      )}
    </Modal>
  );
}
