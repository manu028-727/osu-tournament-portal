'use client';
import { useMemo, useState } from 'react';
import { useT, Feedback } from '../locale';
import { Button } from '../ui/button';
import { Field, api, useTask, useUnsaved } from './shared';
import type { QualifierView, QualifierData } from '@/lib/qualifiers-types';
import type {
  QualifierCorrectionInput,
  QualifierCorrectionReview,
} from '@/lib/qualifier-corrections-contract';
import { MODS } from '@/lib/match-rules';
import { QualifierPolicyFields } from './qualifier-policy-fields';
import { qualifierCompletion, qualifierScoreExceptions } from '@/lib/qualifier-progress';

type Score = QualifierView['scores'][number];
export function QualifierScoreManager({
  lobbies,
  stageId,
  onChanged,
}: {
  lobbies: QualifierView[];
  stageId: string;
  onChanged: () => Promise<unknown>;
}) {
  const tr = useT();
  const { run, busy } = useTask();
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState('exceptions'),
    [selected, setSelected] = useState<string[]>([]);
  const [witness, setWitness] = useState<Record<string, number>>({});
  const [page, setPage] = useState(0);
  const [policyWitness, setPolicyWitness] = useState<Record<string, number>>({});
  const [stageSources, setStageSources] = useState<QualifierView[] | null>(null);
  const captureWitness = () =>
    setWitness(Object.fromEntries(lobbies.map((l) => [l.id, l.version])));
  const [edit, setEdit] = useState<{
    id: string;
    raw: number;
    mods: string;
    passed: boolean | null;
    lobbyId: string;
    baseVersion: number;
  } | null>(null);
  const [reason, setReason] = useState('Organizer qualifier score correction');
  const [operation, setOperation] = useState<QualifierCorrectionInput['operation']>('REVALIDATE');
  const [destination, setDestination] = useState({ slotName: '', run: 0, osuId: 0 });
  const [reprocess, setReprocess] = useState(false),
    [policy, setPolicy] = useState(lobbies[0]?.policy);
  const [useStageRules, setUseStageRules] = useState(false);
  const [review, setReview] = useState<{
    input: QualifierCorrectionInput;
    result: QualifierCorrectionReview;
  } | null>(null);
  const rows = useMemo(
    () =>
      lobbies.flatMap((lobby) => {
        const exceptions = qualifierScoreExceptions(lobby);
        return lobby.scores.map((original) => {
          const exception = exceptions.find((s) => s.id === original.id);
          const score = exception
            ? { ...original, eligible: false, eligibilityReason: exception.eligibilityReason }
            : original;
          return {
            lobby,
            score,
            team: lobby.participants.find((t) => t.members.some((p) => p.osuId === score.osuId)),
          };
        });
      }),
    [lobbies],
  );
  const visible = rows.filter(
    ({ score, lobby, team }) =>
      (filter !== 'exceptions' || score.eligible === false || !score.verified) &&
      (!query ||
        `${lobby.code} ${team?.name} ${team?.members.find((p) => p.osuId === score.osuId)?.username} ${score.osuId} ${score.slotName} ${score.gameId || ''}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  useUnsaved(!!edit || !!review || reprocess);
  const preview = async (
    operation: QualifierCorrectionInput['operation'],
    ids: string[],
    patch?: QualifierCorrectionInput['patch'],
  ) => {
    const choices = (operation === 'REPROCESS' ? stageSources || lobbies : lobbies).flatMap((l) => {
      const scoreIds = l.scores.filter((s) => ids.includes(s.id)).map((s) => s.id);
      return scoreIds.length || operation === 'REPROCESS'
        ? [
            {
              id: l.id,
              baseVersion:
                operation === 'EDIT' && edit?.lobbyId === l.id
                  ? edit.baseVersion
                  : operation === 'REPROCESS'
                    ? (policyWitness[l.id] ?? l.version)
                    : (witness[l.id] ?? l.version),
              scoreIds,
            },
          ]
        : [];
    });
    const input: QualifierCorrectionInput = {
      stageId,
      operation,
      lobbies: choices,
      reason,
      apply: false,
      useStageRules: operation === 'REPROCESS' && useStageRules,
      ...(patch ? { patch } : {}),
      ...(operation === 'REPROCESS' && policy ? { policy } : {}),
      ...(operation === 'REMAP'
        ? {
            destination: {
              ...(destination.slotName ? { slotName: destination.slotName } : {}),
              ...(destination.run ? { run: destination.run } : {}),
              ...(destination.osuId ? { osuId: destination.osuId } : {}),
            },
          }
        : {}),
    };
    const result = await api<QualifierCorrectionReview>('/api/admin/qualifier-score-review', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    setReview({ input, result });
  };
  const evidence = (lobby: QualifierView, score: Score) =>
    lobby.games.find((g) => `${g.multiplayerId}:${g.gameId}` === score.gameId);
  const notices = lobbies.flatMap((lobby) =>
    lobby.games.flatMap((game) =>
      (
        (game.evidence as { proposal?: { issues?: { osuId: number | null; reason: string }[] } })
          .proposal?.issues || []
      ).map((issue) => ({ ...issue, gameId: game.gameId })),
    ),
  );
  const blockers = lobbies.flatMap((lobby) =>
    qualifierCompletion(lobby).blockers.map((blocker) => ({ ...blocker, code: lobby.code })),
  );
  return (
    <section className="min-w-0 space-y-3" aria-label={tr('Score management')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{tr('Score management')}</h2>
        <span className="text-xs text-muted">
          {tr(
            '{0} performances · {1} excluded',
            rows.length,
            rows.filter((r) => r.score.eligible === false).length,
          )}
        </span>
      </div>
      {lobbies.some((l) => l.games.some((g) => g.status === 'PENDING')) && (
        <p className="text-sm text-warning">
          {tr(
            'Games requiring review: {0}',
            lobbies.reduce((n, l) => n + l.games.filter((g) => g.status === 'PENDING').length, 0),
          )}
        </p>
      )}
      {!!notices.length && (
        <details>
          <summary className="cursor-pointer text-xs">
            {tr('Other player evidence ({0})', notices.length)}
          </summary>
          {notices.map((issue, i) => (
            <p key={i} className="text-xs text-muted">
              {tr('Game {0}', issue.gameId)} / {issue.osuId || '?'}:{' '}
              <Feedback message={issue.reason} />
            </p>
          ))}
        </details>
      )}
      {!!blockers.length && (
        <details>
          <summary className="cursor-pointer text-xs">
            {tr('Waiting for {0} entrant/map results.', blockers.length)}
          </summary>
          {blockers.map((b, i) => (
            <p key={i} className="text-xs text-muted">
              {b.code} / {b.team} / {b.slotName} / {tr('Run {0}', b.run)}: {b.recorded}/{b.required}
            </p>
          ))}
        </details>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field label={tr('Search scores')}>
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected([]);
              setPage(0);
            }}
            placeholder={tr('Team, player, map or game')}
          />
        </Field>
        <Field label={tr('Show scores')}>
          <select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setSelected([]);
              setPage(0);
            }}
          >
            <option value="exceptions">{tr('Exceptions first')}</option>
            <option value="all">{tr('All performances')}</option>
          </select>
        </Field>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !lobbies.length}
          onClick={() =>
            void run(async () => {
              if (reprocess) {
                setReprocess(false);
                return;
              }
              const data = await api<QualifierData>(
                '/api/admin/data?section=qualifiers&deleted=true',
              );
              const sources = data.lobbies.filter(
                (l) => l.stage.id === stageId && l.status !== 'CANCELLED',
              );
              setStageSources(sources);
              setPolicyWitness(Object.fromEntries(sources.map((l) => [l.id, l.version])));
              setReprocess(true);
            })
          }
        >
          {tr('Reprocess scoring')}
        </Button>
      </div>
      {reprocess && policy && (
        <div className="rounded-xl border p-3 space-y-3">
          <p className="text-sm">
            {tr(
              'Review scoring settings for every session in this stage. Raw evidence remains unchanged. Finalized seedings must be reopened first.',
            )}
          </p>
          <QualifierPolicyFields
            value={policy}
            onChange={setPolicy}
            gameMode={lobbies[0]?.rules.gameMode}
            gameplayScoring={lobbies[0]?.gameplayScoring}
          />
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={useStageRules}
              onChange={(e) => setUseStageRules(e.target.checked)}
            />
            {tr('Revalidate using current stage gameplay rules')}
          </label>
          <Button disabled={busy} onClick={() => void run(() => preview('REPROCESS', []))}>
            {tr('Preview stage impact')}
          </Button>
        </div>
      )}
      {!!selected.length && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-surface-alt p-3">
          <span className="text-sm">{tr('{0} selected', selected.length)}</span>
          <Field label={tr('Bulk score action')}>
            <select
              value={operation}
              onChange={(e) => setOperation(e.target.value as typeof operation)}
            >
              {(['REVALIDATE', 'INCLUDE', 'EXCLUDE', 'RESTORE', 'REMAP'] as const).map((key, i) => (
                <option key={key} value={key}>
                  {tr(
                    [
                      'Revalidate',
                      'Include with override',
                      'Exclude',
                      'Restore automatic eligibility',
                      'Remap map, run or player',
                    ][i],
                  )}
                </option>
              ))}
            </select>
          </Field>
          {operation === 'REMAP' && (
            <>
              <Field label={tr('Map slot')}>
                <input
                  value={destination.slotName}
                  onChange={(e) => setDestination({ ...destination, slotName: e.target.value })}
                />
              </Field>
              <Field label={tr('Run')}>
                <select
                  value={destination.run}
                  onChange={(e) => setDestination({ ...destination, run: Number(e.target.value) })}
                >
                  <option value={0}>{tr('Keep current')}</option>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                </select>
              </Field>
              <Field label={tr('osu! ID')}>
                <input
                  type="number"
                  min={1}
                  value={destination.osuId || ''}
                  onChange={(e) =>
                    setDestination({ ...destination, osuId: Number(e.target.value) })
                  }
                />
              </Field>
            </>
          )}
          <Field label={tr('Correction reason')}>
            <input
              value={reason}
              minLength={3}
              maxLength={2000}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <Button
            disabled={busy || reason.trim().length < 3}
            onClick={() => void run(() => preview(operation, selected))}
          >
            {tr('Preview impact')}
          </Button>
          <Button variant="ghost" onClick={() => setSelected([])}>
            {tr('Clear selection')}
          </Button>
        </div>
      )}
      {review && (
        <div
          className="space-y-3 rounded-xl border border-primary p-3"
          role="region"
          aria-label={tr('Correction impact preview')}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{tr('Correction impact preview')}</h3>
            <Button size="sm" variant="ghost" onClick={() => setReview(null)}>
              {tr('Cancel')}
            </Button>
          </div>
          <p className="text-sm">
            {tr(
              '{0} performances change. Standings below are provisional; official seedings and brackets remain protected.',
              review.result.changed,
            )}
          </p>
          <div className="max-h-64 overflow-auto">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{tr('Team')}</th>
                  <th>{tr('Total: before to after')}</th>
                  <th>{tr('Seed: before to after')}</th>
                </tr>
              </thead>
              <tbody>
                {review.result.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>
                      {row.before?.toFixed(6) ?? 'N/A'} to {row.after?.toFixed(6) ?? 'N/A'}
                    </td>
                    <td>
                      {row.beforeSeed ?? 'N/A'} to {row.afterSeed ?? 'N/A'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary>{tr('Calculation diagnostics ({0})', review.result.issues.length)}</summary>
            {review.result.issues.map((issue, i) => (
              <p key={i} className="text-xs">
                <Feedback message={issue.message} />
              </p>
            ))}
          </details>
          {review.result.locked && (
            <p className="text-sm text-danger">
              {tr(
                'Official seedings are finalized. Reopen them through the standings review before applying corrections.',
              )}
            </p>
          )}
          <Button
            disabled={busy || review.result.locked}
            onClick={() =>
              void run(async () => {
                await api('/api/admin/qualifier-score-review', {
                  method: 'POST',
                  body: JSON.stringify({
                    ...review.input,
                    apply: true,
                    reviewHash: review.result.reviewHash,
                  }),
                });
                setReview(null);
                setEdit(null);
                setSelected([]);
                setReprocess(false);
                await onChanged();
              }, tr('Score corrections saved.'))
            }
          >
            {tr('Apply reviewed corrections')}
          </Button>
        </div>
      )}
      {!visible.length ? (
        <p className="text-sm text-muted">
          {tr(
            filter === 'exceptions'
              ? 'No score exceptions. Switch to all performances to inspect or correct results.'
              : 'No performances match these filters.',
          )}
        </p>
      ) : (
        <div className="overflow-auto">
          <table className="admin-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label={tr('Select filtered scores')}
                    checked={visible.every((r) => selected.includes(r.score.id))}
                    onChange={(e) => {
                      captureWitness();
                      setSelected(e.target.checked ? visible.map((r) => r.score.id) : []);
                    }}
                  />
                </th>
                <th>{tr('Team / player')}</th>
                <th>{tr('Session / map / run')}</th>
                <th>{tr('Raw / effective')}</th>
                <th>{tr('Eligibility')}</th>
                <th>{tr('Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(page * 100, (page + 1) * 100).map(({ score, lobby, team }) => (
                <tr key={score.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={tr('Select score {0}', score.osuId)}
                      checked={selected.includes(score.id)}
                      onChange={(e) => {
                        if (!selected.length) captureWitness();
                        setSelected(
                          e.target.checked
                            ? [...selected, score.id]
                            : selected.filter((id) => id !== score.id),
                        );
                      }}
                    />
                  </td>
                  <td>
                    <span className="block font-medium">{team?.name || tr('Unknown team')}</span>
                    <span className="text-xs text-muted">
                      {team?.members.find((p) => p.osuId === score.osuId)?.username || score.osuId}
                    </span>
                  </td>
                  <td>
                    {lobby.code}
                    <span className="block text-xs text-muted">
                      {score.slotName} / {score.run}
                    </span>
                  </td>
                  <td>
                    {edit?.id === score.id ? (
                      <form
                        className="min-w-48 space-y-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void run(() =>
                            preview('EDIT', [score.id], {
                              raw: edit.raw,
                              mods: edit.mods
                                .toUpperCase()
                                .split(/[ ,]+/)
                                .filter(Boolean) as (typeof MODS)[number][],
                              passed: edit.passed,
                            }),
                          );
                        }}
                      >
                        <Field label={tr('Raw score')}>
                          <input
                            type="number"
                            min={0}
                            max={Number.MAX_SAFE_INTEGER}
                            required
                            value={edit.raw}
                            onChange={(e) => setEdit({ ...edit, raw: Number(e.target.value) })}
                          />
                        </Field>
                        <Field label={tr('Mods')}>
                          <input
                            value={edit.mods}
                            onChange={(e) => setEdit({ ...edit, mods: e.target.value })}
                          />
                        </Field>
                        <Field label={tr('Passed')}>
                          <select
                            value={edit.passed === null ? 'unknown' : String(edit.passed)}
                            onChange={(e) =>
                              setEdit({
                                ...edit,
                                passed:
                                  e.target.value === 'unknown' ? null : e.target.value === 'true',
                              })
                            }
                          >
                            <option value="unknown">{tr('Unverified')}</option>
                            <option value="true">{tr('Passed')}</option>
                            <option value="false">{tr('Failed')}</option>
                          </select>
                        </Field>
                        <div className="flex gap-2">
                          <Button size="sm" disabled={busy}>
                            {tr('Preview')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setEdit(null)}
                          >
                            {tr('Cancel')}
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <span className="block tabular-nums">
                          {score.raw.toLocaleString()} /{' '}
                          {score.adjusted.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                        </span>
                        <span className="text-xs text-muted">{score.mods.join(' ') || 'NM'}</span>
                      </>
                    )}
                  </td>
                  <td>
                    <span className={score.eligible === false ? 'text-danger' : 'text-muted'}>
                      {tr(score.eligible === false ? 'Excluded' : 'Eligible')}
                    </span>
                    {score.eligibilityReason && (
                      <p className="max-w-64 text-xs">
                        <Feedback message={score.eligibilityReason} />
                      </p>
                    )}
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={
                        busy ||
                        !!lobby.scoringLocked ||
                        !!lobby.deletedAt ||
                        (lobby.status === 'COMPLETED' && !lobby.autoCompleted)
                      }
                      onClick={() => {
                        setEdit({
                          id: score.id,
                          lobbyId: lobby.id,
                          baseVersion: lobby.version,
                          raw: score.raw,
                          mods: score.mods.join(' '),
                          passed: score.passed ?? null,
                        });
                      }}
                    >
                      {tr('Edit')}
                    </Button>
                    <details>
                      <summary className="cursor-pointer text-xs">{tr('Source evidence')}</summary>
                      <p className="text-xs">
                        {score.source} · {score.gameId || tr('Manual')} ·{' '}
                        {score.actualScoring || tr('Unverified')}
                      </p>
                      <pre className="max-h-48 max-w-80 overflow-auto text-xs">
                        {JSON.stringify(
                          evidence(lobby, score)?.evidence || { raw: score.raw, mods: score.mods },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length > 100 && (
            <div className="flex items-center gap-2 p-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                {tr('Previous')}
              </Button>
              <span className="text-xs">
                {page + 1} / {Math.ceil(visible.length / 100)}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={(page + 1) * 100 >= visible.length}
                onClick={() => setPage((p) => p + 1)}
              >
                {tr('Next')}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
