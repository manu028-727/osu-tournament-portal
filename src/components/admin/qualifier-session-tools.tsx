'use client';
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useT } from '@/components/locale';
import type { QualifierView } from '@/lib/qualifiers-types';
import { Button } from '../ui/button';
import { action, Field, Modal, SaveButton, useTask, useUnsaved } from './shared';

export function DeleteQualifierSessions({
  lobbies,
  onChanged,
  compact = false,
}: {
  lobbies: QualifierView[];
  onChanged: () => Promise<unknown>;
  compact?: boolean;
}) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  const { run, busy } = useTask();
  const pendingHistory = lobbies.some(
    (lobby) =>
      lobby.status === 'COMPLETED' &&
      (lobby.games.some((game) => game.status === 'PENDING') ||
        (lobby.multiplayerSync as { complete?: boolean } | null)?.complete === false),
  );
  const blocked = lobbies.some(
    (lobby) => lobby.deletedAt || !['SCHEDULED', 'COMPLETED', 'CANCELLED'].includes(lobby.status),
  );
  const [reason, setReason] = useState('');
  const [review, setReview] = useState<{ id: string; baseVersion: number }[]>([]);
  return (
    <>
      <Button
        variant="outline"
        size={compact ? 'icon' : 'sm'}
        aria-label={tr('Delete sessions')}
        title={tr(
          pendingHistory
            ? 'Review pending multiplayer games and complete history before deleting.'
            : 'Delete sessions',
        )}
        disabled={!lobbies.length || blocked || pendingHistory}
        onClick={() => {
          setReview(lobbies.map((lobby) => ({ id: lobby.id, baseVersion: lobby.version })));
          setOpen(true);
        }}
      >
        <Trash2 size={15} />
        {!compact && tr('Delete sessions')}
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={tr('Delete qualifier sessions')}>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await action({ type: 'qualifier.delete', lobbies: review, confirm: true, reason });
              setOpen(false);
              await onChanged();
            }, 'Qualifier sessions deleted. Histories preserved.');
          }}
        >
          <p>
            {tr(
              'Remove {0} sessions from scheduling and booking? Scores and referee histories remain available. This does not close IRC lobbies.',
              review.length,
            )}
          </p>
          <p className="text-sm text-muted">{lobbies.map((lobby) => lobby.code).join(', ')}</p>
          <Field label={tr('Reason')}>
            <input
              required
              minLength={3}
              maxLength={2000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <SaveButton busy={busy}>{tr('Delete sessions')}</SaveButton>
        </form>
      </Modal>
    </>
  );
}

export function QualifierSessionIdentity({
  lobby,
  onChanged,
  onDirty,
}: {
  lobby: QualifierView;
  onChanged: () => Promise<unknown>;
  onDirty?: (dirty: boolean) => void;
}) {
  const tr = useT();
  const [code, setCode] = useState(lobby.code),
    [notes, setNotes] = useState(lobby.notes);
  const [version, setVersion] = useState(lobby.version);
  const [original, setOriginal] = useState({ code: lobby.code, notes: lobby.notes });
  const { run, busy } = useTask();
  const dirty = code !== original.code || notes !== original.notes;
  useEffect(() => {
    onDirty?.(dirty);
    return () => onDirty?.(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    if (dirty || lobby.version < version) return;
    setCode(lobby.code);
    setNotes(lobby.notes);
    setVersion(lobby.version);
    setOriginal({ code: lobby.code, notes: lobby.notes });
  }, [dirty, lobby.code, lobby.notes, lobby.version, version]);
  useUnsaved(dirty);
  return (
    <form
      className="grid-fields"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const result = await action<{ version: number }>({
            type: 'qualifier.edit',
            id: lobby.id,
            baseVersion: version,
            code,
            notes,
          });
          setVersion(result.version);
          setOriginal({ code, notes });
          await onChanged();
        }, 'Qualifier session updated.');
      }}
    >
      <Field label={tr('Lobby code')}>
        <input
          required
          maxLength={80}
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </Field>
      <Field label={tr('Notes')}>
        <input maxLength={4000} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </Field>
      <SaveButton busy={busy} disabled={!dirty}>
        {tr('Save changes')}
      </SaveButton>
    </form>
  );
}
