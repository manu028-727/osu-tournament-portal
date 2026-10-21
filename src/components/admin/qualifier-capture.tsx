'use client';
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { QualifierView } from '@/lib/qualifiers-types';
import type { QualifierCapture } from '@/lib/qualifier-multiplayer';
import { Button } from '../ui/button';
import { api, Field, Modal, SaveButton, useTask } from './shared';
type Preview = {
  proposals: QualifierCapture[];
  rejected: { gameId: string; issue: string }[];
  complete: boolean;
  version: number;
};
export function QualifierCaptureDialog({
  lobby,
  onChanged,
}: {
  lobby: QualifierView;
  onChanged: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false),
    [preview, setPreview] = useState<Preview | null>(null),
    [gameId, setGameId] = useState(''),
    [run, setRun] = useState(1),
    [replace, setReplace] = useState(false),
    [reason, setReason] = useState('');
  const { busy, run: task } = useTask();
  const post = <T,>(data: object) =>
    api<T>('/api/admin/qualifier-multiplayer', {
      method: 'POST',
      body: JSON.stringify({ id: lobby.id, run, ...data }),
    });
  return (
    <>
      <Button
        variant="outline"
        disabled={busy || lobby.rules.gameplayScoring === 'LAZER'}
        onClick={() => {
          setOpen(true);
          setPreview(null);
          setGameId('');
          void task(
            async () => setPreview(await post<Preview>({})),
            'Multiplayer capture preview ready.',
          );
        }}
      >
        <RefreshCw size={16} />
        Capture from osu!
      </Button>
      <Modal open={open} onOpenChange={setOpen} title="Review qualifier capture" wide>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!preview) return;
            void task(async () => {
              await post({ gameId, baseVersion: preview.version, replace, reason });
              setOpen(false);
              setReplace(false);
              setReason('');
              await onChanged();
            }, 'Qualifier scores captured.');
          }}
        >
          {preview ? (
            <>
              {!preview.complete && (
                <p role="alert">
                  History exceeds the capture window. Import is disabled; use reviewed manual entry.
                </p>
              )}
              <Field label="Multiplayer game">
                <select required value={gameId} onChange={(e) => setGameId(e.target.value)}>
                  <option value="">Select played game</option>
                  {preview.proposals.map((g) => (
                    <option key={g.gameId} value={g.gameId}>
                      {g.slotName} · game {g.gameId} · {new Date(g.startedAt).toLocaleString()} ·{' '}
                      {g.players.length} scores
                    </option>
                  ))}
                </select>
              </Field>
              {lobby.policy.runs === 2 && (
                <Field label="Run">
                  <select value={run} onChange={(e) => setRun(Number(e.target.value))}>
                    <option value={1}>Run 1</option>
                    <option value={2}>Run 2</option>
                  </select>
                </Field>
              )}
              {preview.proposals
                .find((g) => g.gameId === gameId)
                ?.players.map((p) => (
                  <p key={p.osuId} className="text-sm">
                    {lobby.participants.flatMap((t) => t.members).find((m) => m.osuId === p.osuId)
                      ?.username || p.osuId}
                    : {p.raw.toLocaleString()} · {p.mods.join(' ') || 'NM'}
                  </p>
                ))}
              {preview.rejected.length > 0 && (
                <details>
                  <summary>{preview.rejected.length} games need manual review</summary>
                  <ul className="mt-2 max-h-48 overflow-auto space-y-2 text-sm text-muted">
                    {preview.rejected.map((issue, i) => (
                      <li key={i}>
                        Game {issue.gameId}: {issue.issue}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={replace}
                  onChange={(e) => setReplace(e.target.checked)}
                />
                Approve replacing existing scores for this map and run
              </label>
              <Field label="Capture reason">
                <textarea
                  required
                  minLength={3}
                  maxLength={2000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <SaveButton
                busy={busy}
                disabled={!gameId || !preview.complete || preview.version !== lobby.version}
              >
                Import selected game
              </SaveButton>
            </>
          ) : (
            <p className="text-sm text-muted">
              {busy ? 'Loading multiplayer history...' : 'No preview available. Close and retry.'}
            </p>
          )}
        </form>
      </Modal>
    </>
  );
}
