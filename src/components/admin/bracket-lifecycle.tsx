'use client';
import { useEffect, useState } from 'react';
import { Feedback, useT } from '@/components/locale';
import type { CompetitionBracketData, CompetitionLifecyclePreview } from '@/lib/competition-types';
import { action, Field, LoadingState, Modal, SaveButton, useTask } from './shared';

export function BracketLifecycle({
  bracket,
  operation,
  nodeId,
  close,
  saved,
}: {
  bracket: CompetitionBracketData;
  operation: 'delete' | 'regenerate' | 'missing';
  nodeId?: string;
  close: () => void;
  saved: () => Promise<unknown>;
}) {
  const tr = useT();
  const [preview, setPreview] = useState<CompetitionLifecyclePreview | null>(null);
  const [error, setError] = useState(''),
    [confirmation, setConfirmation] = useState('');
  const [history, setHistory] = useState(false),
    [approve, setApprove] = useState(false);
  const { run, busy } = useTask();
  useEffect(() => {
    let current = true;
    void action<CompetitionLifecyclePreview>({
      type: 'competition.lifecycle.preview',
      id: bracket.id,
      baseVersion: bracket.version,
      operation,
      nodeId,
    })
      .then((value) => {
        if (current) setPreview(value);
      })
      .catch((e: Error) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [bracket.id, bracket.version, nodeId, operation]);
  const title =
    operation === 'delete'
      ? tr('Delete bracket')
      : operation === 'missing'
        ? tr('Generate missing matches')
        : tr('Regenerate Match');
  return (
    <Modal
      title={title}
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      {!preview ? (
        <LoadingState error={error} />
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const base = {
                id: bracket.id,
                baseVersion: bracket.version,
                reviewHash: preview.hash,
                approveCorrections: approve,
              };
              await action(
                operation === 'delete'
                  ? {
                      type: 'competition.delete',
                      ...base,
                      confirmation,
                      acknowledgeHistory: history,
                    }
                  : operation === 'missing'
                    ? { type: 'competition.regenerate-missing', ...base }
                    : { type: 'competition.regenerate', ...base, nodeId },
              );
              await saved();
              close();
            }, tr('Bracket updated.'));
          }}
        >
          <p className="text-sm text-muted">
            {tr(
              operation === 'delete'
                ? 'Permanently delete this bracket and all its matches, scores, multiplayer evidence and referee histories. This cannot be undone.'
                : operation === 'missing'
                  ? 'Create ready positions that have no match. Intentionally deleted fixtures stay deleted; unresolved positions wait for confirmed results.'
                  : 'Restore this fixture with its reserved number, configuration and recorded history. Participants follow the current bracket routes; played rosters remain protected.',
            )}
          </p>
          {!!preview.matches.length && (
            <div className="max-h-40 overflow-y-auto rounded-xl border p-3 text-sm">
              {preview.matches.map((match) => (
                <div key={match.matchNumber}>{tr('Match {0}', match.matchNumber)}</div>
              ))}
            </div>
          )}
          {preview.reasons.map((reason) => (
            <p key={reason} role="alert" className="text-sm text-red-300">
              <Feedback message={reason} />
            </p>
          ))}
          {operation === 'delete' && (
            <>
              <p className="text-sm font-semibold">
                {tr(
                  preview.numberingRestarts
                    ? 'Recreation will start again at match 1.'
                    : 'Other matches or reserved numbers remain. Their IDs stay unchanged; recreation will use the next available numbers.',
                )}
              </p>
              <Field label={tr('Type the bracket name to confirm')}>
                <input
                  required
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="off"
                />
              </Field>
              {!!preview.historical && (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={history}
                    onChange={(event) => setHistory(event.target.checked)}
                  />
                  {tr(
                    'I understand that completed matches and all referee histories will be permanently erased.',
                  )}
                </label>
              )}
            </>
          )}
          {!!preview.affected.length && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={approve}
                onChange={(event) => setApprove(event.target.checked)}
              />
              <span>
                {tr(
                  'Approve changes to downstream matches: {0}',
                  preview.affected.map((match) => match.matchNumber).join(', '),
                )}
              </span>
            </label>
          )}
          <SaveButton
            busy={busy}
            variant={operation === 'delete' ? 'destructive' : 'default'}
            disabled={
              busy ||
              preview.blocked ||
              (!!preview.affected.length && !approve) ||
              (operation === 'delete' &&
                (confirmation !== bracket.name || (!!preview.historical && !history)))
            }
          >
            {title}
          </SaveButton>
        </form>
      )}
    </Modal>
  );
}
