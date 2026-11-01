'use client';
import { localeTag } from '@/lib/i18n';
import { useLocale, useT, Feedback } from '@/components/locale';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { QualifierView } from '@/lib/qualifiers-types';
import type { QualifierCapture } from '@/lib/qualifier-multiplayer';
import { Button } from '../ui/button';
import { api, Field, Modal, SaveButton, useTask } from './shared';
import styles from './qualifier-workflow.module.css';
type Preview = {
  proposals: QualifierCapture[];
  rejected: { gameId: string; issue: string }[];
  complete: boolean;
  version: number;
  games: {
    recordId: string;
    gameId: string;
    status: string;
    issue: string | null;
    unknownPlayers: number[];
  }[];
};
export function QualifierCaptureDialog({
  lobby,
  onChanged,
}: {
  lobby: QualifierView;
  onChanged: () => Promise<unknown>;
}) {
  const language = useLocale();
  const tr = useT();
  const [open, setOpen] = useState(false),
    [preview, setPreview] = useState<Preview | null>(null),
    [gameId, setGameId] = useState(''),
    [run, setRun] = useState(1),
    [replace, setReplace] = useState(false),
    [excludePlayers, setExcludePlayers] = useState<number[]>([]),
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
          void task(async () => {
            setPreview(await post<Preview>({}));
            await onChanged();
          }, 'Multiplayer capture preview ready.');
        }}
      >
        <RefreshCw size={16} />
        {tr('Capture from osu!')}
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={tr('Review qualifier capture')} wide>
        <form
          className={`${styles.workspace} space-y-3`}
          onSubmit={(e) => {
            e.preventDefault();
            if (!preview) return;
            void task(async () => {
              await post({ gameId, baseVersion: preview.version, replace, reason, excludePlayers });
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
                  {tr(
                    'More history is available. Continue loading before importing; partial history is never applied.',
                  )}
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void task(async () => {
                    setPreview(await post<Preview>({}));
                    await onChanged();
                  }, 'Multiplayer capture preview ready.')
                }
              >
                {tr(preview.complete ? 'Refresh import preview' : 'Load remaining history')}
              </Button>
              <Field label={tr('Multiplayer game')}>
                <select
                  required
                  value={gameId}
                  onChange={(e) => {
                    setGameId(e.target.value);
                    setExcludePlayers([]);
                  }}
                >
                  <option value="">{tr('Select played game')}</option>
                  {preview.games.map((g) => (
                    <option key={g.gameId} value={g.gameId}>
                      {tr('Game')} {g.gameId} ·{' '}
                      {tr(
                        g.status === 'ACCEPTED'
                          ? 'Already imported'
                          : g.status === 'IGNORED'
                            ? 'Excluded'
                            : g.issue
                              ? 'Needs review'
                              : 'Ready',
                      )}
                    </option>
                  ))}
                </select>
              </Field>
              {!!preview.games.find((game) => game.gameId === gameId)?.unknownPlayers.length && (
                <fieldset className="space-y-2">
                  <legend className="text-sm">
                    {tr('Unknown players (explicitly exclude non-entrants)')}
                  </legend>
                  {preview.games
                    .find((game) => game.gameId === gameId)!
                    .unknownPlayers.map((osuId) => (
                      <label key={osuId} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={excludePlayers.includes(osuId)}
                          onChange={(event) =>
                            setExcludePlayers((ids) =>
                              event.target.checked
                                ? [...ids, osuId]
                                : ids.filter((id) => id !== osuId),
                            )
                          }
                        />
                        #{osuId}
                      </label>
                    ))}
                </fieldset>
              )}
              {lobby.policy.runs === 2 && (
                <Field label={tr('Run')}>
                  <select value={run} onChange={(e) => setRun(Number(e.target.value))}>
                    <option value={1}>{tr('Run 1')}</option>
                    <option value={2}>{tr('Run 2')}</option>
                  </select>
                </Field>
              )}
              {preview.proposals
                .find((g) => g.gameId === gameId)
                ?.players.map((p) => (
                  <p key={p.osuId} className="text-sm">
                    {lobby.participants.flatMap((t) => t.members).find((m) => m.osuId === p.osuId)
                      ?.username || p.osuId}
                    : {p.raw.toLocaleString(localeTag(language))} · {p.mods.join(' ') || tr('NM')}
                    {p.violation && (
                      <span className="ml-2 text-amber-200">
                        <Feedback message={p.violation} />
                      </span>
                    )}
                  </p>
                ))}
              {preview.rejected.length > 0 && (
                <details>
                  <summary>
                    {preview.rejected.length} {tr('games need manual review')}
                  </summary>
                  <ul className="mt-2 max-h-48 overflow-auto space-y-2 text-sm text-muted">
                    {preview.rejected.map((issue, i) => (
                      <li key={i}>
                        {tr('Game')} {issue.gameId}: <Feedback message={issue.issue} />
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
                {tr('Approve replacing existing scores for this map and run')}
              </label>
              <Field label={tr('Capture reason')}>
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
                {tr('Import selected game')}
              </SaveButton>
              <Button
                type="button"
                variant="destructive"
                disabled={
                  busy || !gameId || reason.trim().length < 3 || preview.version !== lobby.version
                }
                onClick={() => {
                  const game = preview.games.find((game) => game.gameId === gameId);
                  if (
                    !game ||
                    !window.confirm(
                      tr(
                        'Exclude this game and remove its linked imported scores? Audited manual corrections are preserved.',
                      ),
                    )
                  )
                    return;
                  void task(async () => {
                    await post({
                      ignore: true,
                      recordId: game.recordId,
                      baseVersion: preview.version,
                      reason,
                      removeScores: true,
                    });
                    setPreview(await post<Preview>({}));
                    await onChanged();
                  }, 'Qualifier game excluded.');
                }}
              >
                {tr('Exclude selected game')}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted">
              {busy
                ? tr('Loading multiplayer history...')
                : tr('No preview available. Close and retry.')}
            </p>
          )}
        </form>
      </Modal>
    </>
  );
}
