'use client';
import { useState } from 'react';
import { useT } from '@/components/locale';
import { api, Field, Modal, SaveButton, useTask } from './shared';
import { ExportTournamentButton } from './tournament-export-button';

export function DeleteTournamentDialog({
  tournament,
  close,
  deleted,
}: {
  tournament: {
    id: string;
    name: string;
    acronym: string;
    slug: string;
    version: number;
    matchCount: number;
    _count: { stages: number; teams: number };
  };
  close: () => void;
  deleted: () => Promise<unknown>;
}) {
  const tr = useT();
  const [confirmation, setConfirmation] = useState('');
  const { run, busy } = useTask();
  const title = tr('Delete tournament');
  return (
    <Modal
      title={title}
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            async () => {
              const result = await api<{ filesPendingCleanup: number }>('/api/tournaments', {
                method: 'POST',
                body: JSON.stringify({
                  type: 'delete',
                  id: tournament.id,
                  baseVersion: tournament.version,
                  confirmation,
                }),
              });
              await deleted();
              close();
              return result;
            },
            ({ filesPendingCleanup }) =>
              filesPendingCleanup
                ? tr(
                    'Tournament deleted. {0} uploaded files are waiting to be removed from storage.',
                    filesPendingCleanup,
                  )
                : tr('Tournament deleted.'),
          );
        }}
      >
        <div className="space-y-1 break-words text-sm">
          <p className="font-semibold">
            {tr('Permanently delete {0}. This cannot be undone.', tournament.name)}
          </p>
          <p>
            {tr(
              'Stages: {0}. Entrants: {1}. Matches: {2}.',
              tournament._count.stages,
              tournament._count.teams,
              tournament.matchCount,
            )}
          </p>
          <p className="text-muted">
            {tr(
              'Its pages, mappools, staff, match histories and uploaded images go with it. Player and staff accounts stay.',
            )}
          </p>
        </div>
        <div className="space-y-2 rounded-xl border p-3">
          <p className="text-sm text-muted">
            {tr(
              'Download a copy first if you might want it back. It can be imported later as a new tournament.',
            )}
          </p>
          <ExportTournamentButton tournament={tournament.slug} />
        </div>
        <Field label={tr('Type {0} to confirm', tournament.acronym)}>
          <input
            required
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </Field>
        <SaveButton
          busy={busy}
          variant="destructive"
          disabled={busy || confirmation.trim() !== tournament.acronym}
        >
          {title}
        </SaveButton>
      </form>
    </Modal>
  );
}
