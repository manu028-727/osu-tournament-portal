'use client';

import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Download,
  Eye,
  EyeOff,
  RefreshCw,
  Save,
  Undo2,
} from 'lucide-react';
import type { Actor } from '@/lib/permissions';
import type {
  QualifierStandingsAction,
  QualifierStandingsData,
  QualifierCorrectionImpact,
} from '@/lib/qualifier-standings-service';
import { QUALIFIER_METHOD_LABELS } from '@/lib/qualifier-policy';
import { QualifierStandingsTable } from '@/components/qualifier-standings';
import { Button } from '@/components/ui/button';
import { action, Field, LoadingState, Modal, usePolling, useResource, useTask } from './shared';

export function QualifierStandings({ stageId }: { stageId: string; actor?: Actor }) {
  const { data, error, reload } = useResource<QualifierStandingsData>(
    `qualifier-standings&stageId=${encodeURIComponent(stageId)}`,
  );
  const { busy, run } = useTask();
  const [versionId, setVersionId] = useState('latest');
  const [tieOrder, setTieOrder] = useState<string[]>([]);
  const [tieReason, setTieReason] = useState('');
  const [approvedTies, setApprovedTies] = useState(false);
  const [reviewedHash, setReviewedHash] = useState('');
  const [cutoff, setCutoff] = useState('');
  const [correction, setCorrection] = useState<{
    baseVersion: number;
    sourceHash: string;
    impact: QualifierCorrectionImpact;
  } | null>(null);
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionApproved, setCorrectionApproved] = useState(false);
  usePolling(reload, 15000, !busy);
  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  const version =
    versionId === 'latest'
      ? data.latest
      : data.versions.find((v) => v.id === versionId) || data.latest;
  const calculation = version?.snapshot.calculation || data.preview;
  const reviewToken = `${version?.version || 0}:${calculation.sourceHash}`;
  const current = !version || version.id === data.latest?.id;
  const sourceCurrent = !version || version.sourceHash === data.preview.sourceHash;
  const provisional = version?.snapshot.state !== 'FINALIZED';
  const reopened = version?.snapshot.state === 'REOPENED';
  const ties = calculation.rows.filter((r) => r.tied);
  const order =
    tieOrder.length &&
    ties.every((r) => tieOrder.includes(r.participantId)) &&
    ties.length === tieOrder.length
      ? tieOrder
      : ties.map((r) => r.participantId);
  const tiedRows = [...ties].sort(
    (a, b) => a.rank! - b.rank! || order.indexOf(a.participantId) - order.indexOf(b.participantId),
  );
  const errors = calculation.issues.filter((i) => i.severity === 'ERROR');
  const approvedTieResolution = !ties.length || (approvedTies && tieReason.trim().length >= 3);
  const post = (body: QualifierStandingsAction, message: string) =>
    run(async () => {
      await action(body);
      setVersionId('latest');
      setReviewedHash('');
      await reload();
    }, message);
  const base = {
    stageId,
    baseVersion: data.latest?.version || 0,
    sourceHash: data.preview.sourceHash,
  };
  const move = (id: string, direction: number) => {
    const entrant = ties.find((r) => r.participantId === id)!;
    const group = order.filter(
      (item) => ties.find((r) => r.participantId === item)?.rank === entrant.rank,
    );
    const index = group.indexOf(id),
      swap = group[index + direction];
    if (!swap) return;
    const next = [...order],
      a = next.indexOf(id),
      b = next.indexOf(swap);
    [next[a], next[b]] = [next[b], next[a]];
    setTieOrder(next);
    setApprovedTies(false);
    setReviewedHash('');
  };
  const exportSnapshot = () => {
    const blob = new Blob(
      [JSON.stringify(version?.snapshot || { state: 'PROVISIONAL', calculation }, null, 2)],
      { type: 'application/json' },
    );
    const href = URL.createObjectURL(blob),
      link = document.createElement('a');
    link.href = href;
    link.download = `qualifier-${stageId}-v${version?.version || 0}.json`;
    link.click();
    URL.revokeObjectURL(href);
  };
  return (
    <section className="min-w-0 space-y-5" aria-label="Qualifier standings review">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold break-words">{data.stage.name} standings</h2>
          <p className="mt-1 text-sm text-muted">
            {QUALIFIER_METHOD_LABELS[calculation.policy.method]} · {calculation.gameplayScoring} ·{' '}
            {calculation.policy.runs} run{calculation.policy.runs > 1 ? 's' : ''} ·{' '}
            {calculation.policy.runSelection.replaceAll('_', ' ').toLowerCase()}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            title="Refresh standings"
            aria-label="Refresh standings"
            disabled={busy}
            onClick={() => void run(reload)}
          >
            <RefreshCw size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Download calculation snapshot"
            aria-label="Download calculation snapshot"
            onClick={exportSnapshot}
          >
            <Download size={16} />
          </Button>
          {data.canManage && !data.locked && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void post(
                  { type: 'qualifier.standings.calculate', ...base },
                  'Provisional standings saved.',
                )
              }
            >
              <RefreshCw size={16} />
              Calculate standings
            </Button>
          )}
        </div>
      </header>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-4">
        {data.versions.length > 0 && (
          <Field label="Calculation version">
            <select
              value={versionId}
              onChange={(e) => {
                setVersionId(e.target.value);
                setReviewedHash('');
              }}
            >
              <option value="latest">Latest version ({data.latest?.version})</option>
              {data.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  Version {v.version} · {v.snapshot.state.toLowerCase()}
                  {v.published ? ' · published' : ''}
                  {v.stale ? ' · stale' : ''}
                </option>
              ))}
            </select>
          </Field>
        )}
        <p role="status" className="py-2 text-sm text-muted">
          {version?.snapshot.state === 'FINALIZED'
            ? 'Finalized'
            : reopened
              ? 'Reopened for correction'
              : 'Provisional'}
          {version?.published ? ' · Published' : ' · Private'}
          {version?.stale ? ' · Source changed' : ''}
        </p>
      </div>
      {!sourceCurrent && (
        <p role="alert" className="border-l-2 border-amber-400 py-2 pl-3 text-sm">
          This snapshot no longer matches qualifier sources.{' '}
          {data.locked
            ? 'A controlled historical and downstream-bracket review is required.'
            : 'Calculate a new version before finalizing.'}
        </p>
      )}
      {calculation.issues.length > 0 && (
        <details open={errors.length > 0} className="border-b pb-4">
          <summary className="cursor-pointer text-sm font-medium">
            {errors.length} blocking issue{errors.length === 1 ? '' : 's'} ·{' '}
            {calculation.issues.length - errors.length} notice
            {calculation.issues.length - errors.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-3 space-y-2 text-sm">
            {calculation.issues.map((issue, index) => (
              <li
                key={`${issue.code}-${index}`}
                className={issue.severity === 'ERROR' ? 'text-red-400' : 'text-muted'}
              >
                {issue.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      <QualifierStandingsTable
        rows={calculation.rows}
        method={calculation.policy.method}
        cutoff={version?.snapshot.cutoff ?? null}
      />
      <details className="border-b pb-4 text-sm">
        <summary className="cursor-pointer text-muted">Run and source records</summary>
        <div className="mt-3 space-y-4">
          {calculation.rows.map((row) => (
            <div key={row.participantId}>
              <h3 className="font-semibold">{row.name}</h3>
              {row.runs.map((entry) => (
                <p key={entry.run} className="mt-1 text-xs text-muted">
                  Run {entry.run}: {entry.complete ? 'complete' : 'incomplete'} ·{' '}
                  {entry.maps.map((m) => `${m.slotName}: ${m.score}`).join(', ')}
                  {entry.comparisonValue !== null ? ` · Comparison: ${entry.comparisonValue}` : ''}
                </p>
              ))}
            </div>
          ))}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr>
                  <th className="pr-3">Player</th>
                  <th className="pr-3">Map / run</th>
                  <th className="pr-3">Raw / adjusted</th>
                  <th className="pr-3">Provenance</th>
                </tr>
              </thead>
              <tbody>
                {calculation.source.scores.map((s) => (
                  <tr key={s.id} className="border-b">
                    <td className="py-2 pr-3">{s.osuId}</td>
                    <td className="pr-3">
                      {s.slotName} / {s.run}
                    </td>
                    <td className="pr-3 tabular-nums">
                      {s.raw} / {s.adjusted}
                    </td>
                    <td className="max-w-80 break-words">
                      {s.source} · {s.actualScoring || 'Unknown'} · {s.representation} ·{' '}
                      {s.verified ? 'Verified' : 'Unverified'}
                      {s.gameId ? ` · Game ${s.gameId}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>
      {data.canManage &&
        current &&
        sourceCurrent &&
        provisional &&
        !reopened &&
        !data.locked &&
        version && (
          <div className="space-y-4 border-t pt-4">
            {ties.length > 0 && (
              <fieldset className="space-y-3">
                <legend className="font-semibold">Tiebreak review</legend>
                <ol className="space-y-2">
                  {tiedRows.map((row) => {
                    const group = tiedRows.filter((r) => r.rank === row.rank),
                      index = group.indexOf(row);
                    return (
                      <li
                        key={row.participantId}
                        className="flex min-h-11 flex-wrap items-center gap-2 border-b pb-2"
                      >
                        <span className="min-w-0 flex-1 break-words">
                          {row.name}{' '}
                          <span className="text-xs text-muted">
                            Proposed seed {row.rank! + index}
                          </span>
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Move ${row.name} up`}
                          title="Move up"
                          disabled={busy || index === 0}
                          onClick={() => move(row.participantId, -1)}
                        >
                          <ArrowUp size={16} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Move ${row.name} down`}
                          title="Move down"
                          disabled={busy || index === group.length - 1}
                          onClick={() => move(row.participantId, 1)}
                        >
                          <ArrowDown size={16} />
                        </Button>
                      </li>
                    );
                  })}
                </ol>
                <Field label="Tiebreak decision">
                  <textarea
                    value={tieReason}
                    maxLength={2000}
                    onChange={(e) => {
                      setTieReason(e.target.value);
                      setApprovedTies(false);
                    }}
                  />
                </Field>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={approvedTies}
                    onChange={(e) => setApprovedTies(e.target.checked)}
                  />
                  Approved seed order
                </label>
                <Button
                  variant="outline"
                  disabled={busy || !approvedTieResolution}
                  onClick={() =>
                    void post(
                      {
                        type: 'qualifier.standings.resolve',
                        ...base,
                        tieOrder: order,
                        reason: tieReason,
                      },
                      'Tiebreak decision saved.',
                    )
                  }
                >
                  <Save size={16} />
                  Save tiebreak decision
                </Button>
              </fieldset>
            )}
            <div className="max-w-72">
              <Field label="Advancement cutoff">
                <input
                  type="number"
                  min={1}
                  max={calculation.rows.filter((r) => r.eligible).length}
                  placeholder="All seeded participants"
                  value={cutoff}
                  onChange={(e) => setCutoff(e.target.value)}
                />
              </Field>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={reviewedHash === reviewToken}
                disabled={errors.length > 0}
                onChange={(e) => setReviewedHash(e.target.checked ? reviewToken : '')}
              />
              Reviewed source scores, run selection and final seed order
            </label>
            <Button
              disabled={
                busy || errors.length > 0 || !approvedTieResolution || reviewedHash !== reviewToken
              }
              onClick={() =>
                void post(
                  {
                    type: 'qualifier.standings.finalize',
                    ...base,
                    tieOrder: ties.length ? order : [],
                    reason: tieReason,
                    cutoff: cutoff ? Number(cutoff) : null,
                  },
                  'Qualifier seedings finalized.',
                )
              }
            >
              <Check size={16} />
              Finalize seedings
            </Button>
          </div>
        )}
      {data.canManage && current && !provisional && version && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-sm text-muted">
            Finalized version {version.version}
            {version.snapshot.cutoff !== null ? ` · Top ${version.snapshot.cutoff} advance` : ''}
          </p>
          {data.correctionImpact && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setCorrection({
                  baseVersion: data.latest!.version,
                  sourceHash: data.preview.sourceHash,
                  impact: structuredClone(data.correctionImpact!),
                });
                setCorrectionReason('');
                setCorrectionApproved(false);
              }}
            >
              <Undo2 size={16} />
              Review correction
            </Button>
          )}
          <Button
            variant="outline"
            disabled={busy || (!sourceCurrent && !version.published)}
            onClick={() =>
              void post(
                { type: 'qualifier.standings.publish', ...base, published: !version.published },
                version.published ? 'Standings hidden.' : 'Standings published.',
              )
            }
          >
            {version.published ? <EyeOff size={16} /> : <Eye size={16} />}
            {version.published ? 'Unpublish standings' : 'Publish standings'}
          </Button>
        </div>
      )}
      <Modal
        open={correction !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setCorrection(null);
        }}
        title="Reopen qualifier results"
      >
        {correction && (
          <div className="mt-4 space-y-4">
            <p className="text-sm">
              Finalized version {correction.baseVersion} will be superseded and hidden. Existing
              brackets will keep their participants and seed order, but their seed witnesses will no
              longer be valid.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-2">Affected bracket</th>
                    <th className="py-2">Version</th>
                    <th className="py-2">Matches</th>
                  </tr>
                </thead>
                <tbody>
                  {correction.impact.brackets.map((bracket) => (
                    <tr key={bracket.id} className="border-b">
                      <td className="max-w-72 py-2 break-words">{bracket.name}</td>
                      <td>{bracket.version}</td>
                      <td>{bracket.nodes.filter((n) => n.match).length}</td>
                    </tr>
                  ))}
                  {!correction.impact.brackets.length && (
                    <tr>
                      <td colSpan={3} className="py-3 text-muted">
                        No brackets use these qualifier seeds.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {correction.impact.blockingMatches.length > 0 && (
              <div role="alert" className="text-sm text-red-400">
                <p>Started or scored matches require manual historical reconciliation.</p>
                <ul className="mt-2 space-y-1">
                  {correction.impact.blockingMatches.map((match) => (
                    <li key={match.id}>
                      {match.code}: {match.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Field label="Correction reason">
              <textarea
                maxLength={2000}
                value={correctionReason}
                onChange={(e) => setCorrectionReason(e.target.value)}
              />
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={correctionApproved}
                onChange={(e) => setCorrectionApproved(e.target.checked)}
              />
              Reviewed every affected bracket and approved invalidating its existing qualifier seed
              witness
            </label>
            {(correction.baseVersion !== data.latest?.version ||
              correction.sourceHash !== data.preview.sourceHash ||
              correction.impact.impactHash !== data.correctionImpact?.impactHash) && (
              <p role="alert" className="text-sm text-amber-500">
                The review changed. Close this dialog and review the current state.
              </p>
            )}
            <Button
              disabled={
                busy ||
                !correctionApproved ||
                correctionReason.trim().length < 3 ||
                !correction.impact.canReopen ||
                correction.baseVersion !== data.latest?.version ||
                correction.sourceHash !== data.preview.sourceHash ||
                correction.impact.impactHash !== data.correctionImpact?.impactHash
              }
              onClick={() =>
                void run(async () => {
                  await action({
                    type: 'qualifier.standings.reopen',
                    stageId,
                    baseVersion: correction.baseVersion,
                    sourceHash: correction.sourceHash,
                    reason: correctionReason,
                    affectedBracketIds: correction.impact.brackets.map((b) => b.id),
                    impactHash: correction.impact.impactHash,
                    acknowledgeImpact: true,
                  } satisfies QualifierStandingsAction);
                  setCorrection(null);
                  setVersionId('latest');
                  setReviewedHash('');
                  await reload();
                }, 'Qualifier results reopened for correction.')
              }
            >
              <Undo2 size={16} />
              Reopen for correction
            </Button>
          </div>
        )}
      </Modal>
    </section>
  );
}
