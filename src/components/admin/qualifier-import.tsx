'use client';
import { useState } from 'react';
import { useT, Feedback, useLocale } from '@/components/locale';
import { localeTag } from '@/lib/i18n';
import type { QualifierImportInput, QualifierImportPreview } from '@/lib/qualifier-import-contract';
import type { QualifierData } from '@/lib/qualifiers-types';
import { QUALIFIER_METHOD_LABELS } from '@/lib/qualifier-policy';
import { Button } from '../ui/button';
import Link from '@/components/tournament-scope';
import { api, Field, Modal, useResource, useTask } from './shared';
import styles from './qualifier-workflow.module.css';

export function QualifierImport({
  stageId,
  onChanged,
}: {
  stageId: string;
  onChanged: () => void;
}) {
  const tr = useT();
  const language = useLocale();
  const [open, setOpen] = useState(false),
    [links, setLinks] = useState('');
  const [warmups, setWarmups] = useState(0);
  const [preview, setPreview] = useState<QualifierImportPreview | null>(null);
  const [decisions, setDecisions] = useState<QualifierImportInput['decisions']>([]);
  const [dirty, setDirty] = useState(false),
    [reason, setReason] = useState('');
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
    errors: string[];
    sessions: string[];
  } | null>(null);
  const { data, reload } = useResource<QualifierData>('qualifiers');
  const { run, busy } = useTask();
  const review = async () => {
    setResult(null);
    const choices = preview
      ? decisions
      : [...new Set(links.split(/\s+/).filter(Boolean))].map((link) => ({
          multiplayerId: Number(link.match(/\/(\d+)\/?$/)?.[1]),
          warmups,
          lobbyId: null,
          excludePlayers: [],
          games: [],
        }));
    const next = await api<QualifierImportPreview>('/api/admin/qualifier-import', {
      method: 'POST',
      body: JSON.stringify({
        stageId,
        links: links.split(/\s+/).filter(Boolean),
        jobId: preview?.jobId,
        decisions: choices,
      }),
    });
    setPreview(next);
    setDecisions(choices);
    setDirty(false);
    return { next, choices };
  };
  const applyPreview = async (
    next: QualifierImportPreview,
    choices: QualifierImportInput['decisions'],
  ) => {
    const result = await api<{
      imported: number;
      skipped: number;
      errors: string[];
      sessions: string[];
    }>('/api/admin/qualifier-import', {
      method: 'POST',
      body: JSON.stringify({
        stageId,
        jobId: next.jobId,
        fingerprint: next.fingerprint,
        apply: true,
        decisions: choices,
        reason: reason || 'External qualifier multiplayer import',
      }),
    });
    setResult(result);
    setDirty(true);
    onChanged();
    await reload();
  };
  const decision = (multiplayerId: number): QualifierImportInput['decisions'][number] =>
    decisions.find((row) => row.multiplayerId === multiplayerId) || {
      multiplayerId,
      warmups: 0,
      lobbyId: null,
      excludePlayers: [],
      games: [],
    };
  const change = (
    multiplayerId: number,
    patch: Partial<QualifierImportInput['decisions'][number]>,
  ) => {
    setDecisions((rows) => [
      ...rows.filter((row) => row.multiplayerId !== multiplayerId),
      { ...decision(multiplayerId), ...patch },
    ]);
    setDirty(true);
  };
  const gameChange = (
    multiplayerId: number,
    gameId: string,
    patch: Partial<QualifierImportInput['decisions'][number]['games'][number]>,
  ) => {
    const row = decision(multiplayerId);
    change(multiplayerId, {
      games: [
        ...row.games.filter((game) => game.gameId !== gameId),
        {
          gameId,
          ignore: false,
          replace: false,
          corrections: [],
          ...row.games.find((game) => game.gameId === gameId),
          ...patch,
        },
      ],
    });
  };
  const blocked =
    !preview?.complete || dirty || preview.sources.some((source) => source.issues.length);
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
          void reload();
        }}
      >
        {tr('Import qualifier multiplayer links')}
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={tr('Import qualifier multiplayer links')}
        wide
      >
        <div className={`${styles.workspace} space-y-3`}>
          <p className="text-sm text-muted">
            {tr(
              "External refereeing fallback. Website sessions synchronize automatically. Imports use this stage's pool, rosters, scoring and run policy.",
            )}
          </p>
          <p className="text-xs text-muted">
            {tr(
              'Accepted games keep saved corrections unless you explicitly replace their scores.',
            )}
          </p>
          <Field label={tr('Multiplayer links (one per line)')}>
            <textarea
              rows={4}
              disabled={!!preview || busy}
              value={links}
              onChange={(event) => setLinks(event.target.value)}
              placeholder="https://osu.ppy.sh/community/matches/123456"
            />
          </Field>
          {!preview && (
            <Field label={tr('Warmup games per link')}>
              <input
                type="number"
                min={0}
                max={100}
                value={warmups}
                onChange={(event) => setWarmups(Number(event.target.value))}
              />
            </Field>
          )}
          <div className="flex flex-wrap gap-2">
            {!preview && (
              <Button
                disabled={busy || !links.trim()}
                onClick={() =>
                  void run(async () => {
                    const { next, choices } = await review();
                    if (!next.complete)
                      throw new Error(
                        'Complete multiplayer history must finish loading before capture.',
                      );
                    if (next.sources.some((source) => source.issues.length))
                      throw new Error(
                        'Resolve the import warnings or explicitly exclude those games before importing.',
                      );
                    await applyPreview(next, choices);
                  }, 'Qualifier import processed. Valid runs complete automatically; review remaining exceptions.')
                }
              >
                {tr('Import available scores')}
              </Button>
            )}
            <Button
              variant="outline"
              disabled={busy || (!preview && !links.trim())}
              onClick={() => void run(review, 'Qualifier import preview ready.')}
            >
              {tr(
                !preview
                  ? 'Preview multiplayer histories'
                  : !preview.complete
                    ? 'Load remaining history'
                    : 'Refresh import preview',
              )}
            </Button>
            {preview && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setPreview(null);
                  setDecisions([]);
                  setResult(null);
                }}
              >
                {tr('Start a new import')}
              </Button>
            )}
          </div>
          {preview && (
            <>
              <div className="rounded-2xl bg-accent/10 p-4">
                <p className="font-semibold">
                  {preview.stageName} · {tr('Runs')}: {preview.policy.runs}
                </p>
                <p className="text-xs text-muted">
                  {tr(QUALIFIER_METHOD_LABELS[preview.policy.method])} ·{' '}
                  {tr(
                    { SUM: 'Sum', AVERAGE: 'Average', TOP_N: 'Top N players' }[
                      preview.policy.teamAggregation
                    ],
                  )}{' '}
                  ·{' '}
                  {tr(
                    {
                      BEST_PER_MAP: 'Best per map',
                      BEST_COMPLETE_RUN: 'Best complete run',
                      FIRST_RUN: 'First run only',
                      SECOND_RUN: 'Second run only',
                    }[preview.policy.runSelection],
                  )}
                </p>
              </div>
              {!preview.complete && (
                <p role="status">
                  {tr(
                    'More history is available. Continue loading before importing; partial history is never applied.',
                  )}
                </p>
              )}
              <p role="status" className="text-sm">
                {tr(
                  'Valid scores import automatically. Ambiguous games remain available for review; invalid player scores are preserved and excluded individually.',
                )}
              </p>
              {preview.sources.map((source) => {
                const config = decision(source.multiplayerId);
                return (
                  <section key={source.multiplayerId} className="min-w-0 space-y-2 border-t py-3">
                    <h3 className="break-words font-semibold">{source.name}</h3>
                    <p className="text-sm text-muted">
                      {source.teams.map((team) => team.name).join(', ') ||
                        tr('No identified entrants')}
                    </p>
                    {!!source.unknownPlayers.length && (
                      <p className="text-xs text-amber-200">
                        {tr(
                          'Unregistered players retained as evidence: {0}',
                          source.unknownPlayers.join(', '),
                        )}
                      </p>
                    )}
                    <div className="grid-fields">
                      <Field label={tr('Warmup games to exclude')}>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={config.warmups}
                          onChange={(event) =>
                            change(source.multiplayerId, { warmups: Number(event.target.value) })
                          }
                        />
                      </Field>
                      <Field label={tr('Target qualifier session')}>
                        <select
                          value={config.lobbyId || ''}
                          onChange={(event) =>
                            change(source.multiplayerId, { lobbyId: event.target.value || null })
                          }
                        >
                          <option value="">
                            {source.lobbyCode
                              ? tr('Automatic: {0}', source.lobbyCode)
                              : tr('Automatic: existing session or create external session')}
                          </option>
                          {data?.lobbies
                            .filter(
                              (lobby) =>
                                lobby.stage.id === stageId &&
                                ['SCHEDULED', 'IN_PROGRESS'].includes(lobby.status),
                            )
                            .map((lobby) => (
                              <option key={lobby.id} value={lobby.id}>
                                {lobby.code}
                              </option>
                            ))}
                        </select>
                      </Field>
                    </div>
                    <details>
                      <summary className="cursor-pointer text-sm">
                        {tr('Player attribution and exclusions')}
                      </summary>
                      <fieldset className="mt-2 min-w-0 space-y-2">
                        <legend className="text-sm font-medium">
                          {tr('Exclude non-counting players explicitly')}
                        </legend>
                        {source.players.map((player) => (
                          <label key={player.osuId} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={config.excludePlayers.includes(player.osuId)}
                              onChange={(event) =>
                                change(source.multiplayerId, {
                                  excludePlayers: event.target.checked
                                    ? [...config.excludePlayers, player.osuId]
                                    : config.excludePlayers.filter((id) => id !== player.osuId),
                                })
                              }
                            />
                            <span>
                              {player.username || `#${player.osuId}`} ·{' '}
                              {player.teamName || tr('Unknown player')}
                            </span>
                          </label>
                        ))}
                      </fieldset>
                    </details>
                    {source.issues.map((issue) => (
                      <p key={issue} role="alert" className="text-sm text-red-300">
                        <Feedback message={issue} />
                      </p>
                    ))}
                    {source.games.map((game) => {
                      const choice = config.games.find((row) => row.gameId === game.gameId);
                      return (
                        <details key={game.gameId} className="rounded-xl border p-3">
                          <summary className="cursor-pointer text-sm">
                            {game.proposal?.slotName || tr('Unmapped game')} · {tr('Game')}{' '}
                            {game.gameId} ·{' '}
                            {game.accepted
                              ? tr('Already imported')
                              : game.ignored
                                ? tr('Excluded')
                                : game.issue
                                  ? tr('Needs review')
                                  : tr('Run {0}', game.run || '?')}
                          </summary>
                          <div className="mt-3 space-y-3">
                            {game.issue && (
                              <p className="text-sm text-red-300">
                                <Feedback message={game.issue} />
                              </p>
                            )}
                            {game.teams.map((team) => (
                              <p key={team.name} className="text-sm">
                                {team.name}:{' '}
                                {team.value === null
                                  ? tr('Missing scores')
                                  : team.value.toLocaleString(localeTag(language))}{' '}
                                · {team.players}/{preview.policy.requiredPlayers} {tr('players')}
                              </p>
                            ))}
                            <div className="flex flex-wrap gap-4">
                              <label className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={choice?.ignore ?? game.ignored}
                                  onChange={(event) =>
                                    gameChange(source.multiplayerId, game.gameId, {
                                      ignore: event.target.checked,
                                    })
                                  }
                                />
                                {tr('Exclude this game')}
                              </label>
                              {game.proposal && (
                                <Field label={tr('Reviewed run')}>
                                  <select
                                    value={choice?.run || game.run || ''}
                                    onChange={(event) =>
                                      gameChange(source.multiplayerId, game.gameId, {
                                        run: Number(event.target.value) as 1 | 2,
                                      })
                                    }
                                  >
                                    <option value="">{tr('Review required')}</option>
                                    {Array.from(
                                      { length: preview.policy.runs },
                                      (_, index) => index + 1,
                                    ).map((run) => (
                                      <option key={run} value={run}>
                                        {tr('Run {0}', run)}
                                      </option>
                                    ))}
                                  </select>
                                </Field>
                              )}
                            </div>
                            {game.proposal?.players.map((player) => {
                              const correction = choice?.corrections.find(
                                (row) => row.osuId === player.osuId,
                              );
                              return (
                                <Field
                                  key={player.osuId}
                                  label={tr('Score for osu! ID {0}', player.osuId)}
                                  hint={player.violation ? tr(player.violation) : undefined}
                                >
                                  <input
                                    type="number"
                                    min={0}
                                    max={1e12}
                                    value={correction?.raw ?? player.raw}
                                    onChange={(event) => {
                                      if (event.target.value === '') return;
                                      gameChange(source.multiplayerId, game.gameId, {
                                        corrections: [
                                          ...(choice?.corrections || []).filter(
                                            (row) => row.osuId !== player.osuId,
                                          ),
                                          {
                                            osuId: player.osuId,
                                            raw: Number(event.target.value),
                                            mods: correction?.mods || player.mods,
                                          },
                                        ],
                                      });
                                    }}
                                  />
                                </Field>
                              );
                            })}
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={choice?.replace || false}
                                onChange={(event) =>
                                  gameChange(source.multiplayerId, game.gameId, {
                                    replace: event.target.checked,
                                  })
                                }
                              />
                              {tr('Replace existing scores with this reviewed performance')}
                            </label>
                          </div>
                        </details>
                      );
                    })}
                  </section>
                );
              })}
              <Field label={tr('Import or correction reason')}>
                <input
                  minLength={3}
                  maxLength={2000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>
              {dirty && (
                <p role="status" className="text-sm">
                  {tr('Refresh the preview to review your changes before importing.')}
                </p>
              )}
              <Button
                disabled={busy || blocked}
                onClick={() =>
                  void run(
                    () => applyPreview(preview, decisions),
                    'Qualifier import processed. Valid runs complete automatically; review remaining exceptions.',
                  )
                }
              >
                {tr('Import reviewed histories')}
              </Button>
            </>
          )}
          {result && (
            <div role="status" className="rounded-2xl border p-4">
              <p>{tr('{0} scores imported; {1} unchanged.', result.imported, result.skipped)}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {result.sessions.map((id, index) => (
                  <Button asChild key={id} size="sm" variant="outline">
                    <Link href={`/admin/referee/qualifiers/${id}`}>
                      {tr('Review imported session {0}', index + 1)}
                    </Link>
                  </Button>
                ))}
              </div>
              {result.errors.map((error) => (
                <p key={error} className="break-words text-sm text-danger">
                  {error}
                </p>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
