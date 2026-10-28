'use client';
import { Feedback, useT } from '@/components/locale';
import { humanizeCode } from '@/lib/i18n';

import { useState } from 'react';
import { Upload, Check, RefreshCw, Plus } from 'lucide-react';
import type { RefereeRecord } from '@/lib/referee-workbook';
import { Button } from '../ui/button';
import { api, Field, Modal, useTask } from './shared';
import { useTournamentScope } from '@/components/tournament-scope';
import type { applyWorkbookBatch } from '@/lib/referee-import';
type Report = Awaited<ReturnType<typeof applyWorkbookBatch>>;
type Destination = { id: string; slug: string; name: string; canConfirm: boolean };
type Preview = {
  id: string;
  filename: string;
  tournament: { id: string; slug: string; name: string };
  canConfirm: boolean;
  records: {
    record: RefereeRecord;
    target: { id: string; code: string; version: number; status: string } | null;
    conflicts: string[];
    errors: string[];
    warnings: string[];
    scoring: { source: string | null; target: string };
    stageMapping: {
      stageId: string | null;
      stageName: string | null;
      bracket: string | null;
      roundLabel: string;
    };
    requiresReplacement: boolean;
    alreadyImported: boolean;
    createSuggestion: { stageId: string; teamAId: string; teamBId: string } | null;
    websiteActions: { kind: string; side: string; slotName: string; winner: string | null }[];
  }[];
  stages: { id: string; name: string }[];
  teams: { id: string; name: string }[];
};
export function RefereeSheetImporter({ onChanged }: { onChanged: () => Promise<unknown> }) {
  const tr = useT();
  const scope = useTournamentScope();
  const [destinations, setDestinations] = useState<Destination[]>([]),
    [destination, setDestination] = useState(scope.slug),
    [included, setIncluded] = useState<string[]>([]),
    [confirmResults, setConfirmResults] = useState(false),
    [replaceBatch, setReplaceBatch] = useState(false),
    [report, setReport] = useState<Report | null>(null);
  const [open, setOpen] = useState(false),
    [preview, setPreview] = useState<Preview | null>(null),
    [selected, setSelected] = useState(''),
    [reason, setReason] = useState(''),
    [replace, setReplace] = useState(false),
    [create, setCreate] = useState(false),
    [stage, setStage] = useState(''),
    [red, setRed] = useState(''),
    [blue, setBlue] = useState('');
  const [resolutions, setResolutions] = useState<Record<number, 'SOURCE' | 'WEBSITE'>>({});
  const { run, busy } = useTask(),
    item = preview?.records.find((r) => r.record.sheet === selected);
  const endpoint = (query = '') => {
    const url = new URL(`/api/admin/referee-import${query}`, window.location.origin);
    url.searchParams.set('tournament', destination || scope.slug);
    return url.href;
  };
  const setWorkbook = (p: Preview) => {
    setPreview(p);
    setSelected(p.records[0]?.record.sheet || '');
    setIncluded(
      p.records
        .filter((r) => !r.errors.length && !r.requiresReplacement)
        .map((r) => r.record.sheet),
    );
    setReplace(false);
    setCreate(false);
    setReport(null);
    setReplaceBatch(false);
    setConfirmResults(false);
  };
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setOpen(true);
          void run(async () => {
            const values = await api<Destination[]>('/api/admin/referee-import?destinations=1');
            setDestinations(values);
            if (!destination)
              setDestination(
                values.find((v) => v.id === scope.tournamentId)?.slug || values[0]?.slug || '',
              );
          });
        }}
      >
        <Upload size={16} />
        {tr('Import Match History')}
      </Button>
      <Modal
        title={tr('Import match history')}
        wide
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <div className="space-y-4">
          <Field label={tr('Destination tournament')}>
            <select
              value={destination}
              disabled={busy}
              onChange={(e) => {
                setDestination(e.target.value);
                setPreview(null);
                setReport(null);
                setIncluded([]);
                setReason('');
              }}
            >
              {!destinations.length && (
                <option value={destination}>{scope.slug || tr('Select tournament')}</option>
              )}
              {destinations.map((d) => (
                <option key={d.id} value={d.slug}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tr('Referee XLSX workbook')}>
            <input
              key={destination}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const body = new FormData();
                body.set('file', f);
                void run(async () => {
                  const p = await api<Preview>(endpoint(), {
                    method: 'POST',
                    body,
                  });
                  setWorkbook(p);
                }, tr('Workbook preview ready. No match records have been changed.'));
              }}
            />
          </Field>
          {preview && (
            <>
              <div className="flex flex-wrap justify-between gap-3">
                <p className="text-sm">
                  {preview.filename} · {preview.records.length} {tr('match worksheets')}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      async () => setPreview(await api<Preview>(endpoint(`?id=${preview.id}`))),
                      tr('Preview refreshed.'),
                    )
                  }
                >
                  <RefreshCw size={14} />
                  {tr('Refresh preview')}
                </Button>
              </div>
              <p className="font-semibold">{preview.tournament.name}</p>
              <div className="max-h-64 overflow-auto border-y">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>{tr('Select')}</th>
                      <th>{tr('Match / stage')}</th>
                      <th>{tr('Actions')}</th>
                      <th>{tr('Review')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.records.map((r) => (
                      <tr key={r.record.sheet}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={tr('Select match {0}', r.record.sheet)}
                            disabled={busy || !!r.errors.length}
                            checked={included.includes(r.record.sheet)}
                            onChange={(e) =>
                              setIncluded(
                                e.target.checked
                                  ? [...included, r.record.sheet]
                                  : included.filter((s) => s !== r.record.sheet),
                              )
                            }
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="text-primary"
                            onClick={() => {
                              setSelected(r.record.sheet);
                              setResolutions({});
                              setReplace(false);
                              setCreate(false);
                            }}
                          >
                            #{r.record.code} · {r.record.stage}
                          </button>
                          <p className="text-xs text-muted">
                            {r.record.red} {tr('vs')} {r.record.blue}
                          </p>
                          <p className="text-xs text-muted">
                            {r.stageMapping.stageName || tr('Unresolved stage')}
                            {r.stageMapping.bracket ? ` / ${r.stageMapping.bracket}` : ''}
                          </p>
                        </td>
                        <td>
                          {r.record.actions.length} /{' '}
                          {r.record.actions.filter((a) => a.winner).length} {tr('results')}
                        </td>
                        <td className="text-xs">
                          {(r.alreadyImported ? tr('Already imported') : '') ||
                            r.errors.join(' ') ||
                            r.conflicts.join(' ') ||
                            (r.target
                              ? tr('Ready: add missing history')
                              : tr('Ready: create historical match'))}
                          {r.record.forfeitSide ? tr(' · Forfeit') : ''}
                          {r.warnings.map((warning) => (
                            <p key={warning} className="mt-1 text-muted">
                              <Feedback message={warning} />
                            </p>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.canConfirm && (
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={confirmResults}
                    disabled={busy}
                    onChange={(e) => setConfirmResults(e.target.checked)}
                  />
                  {tr('Confirm completed historical results')}
                </label>
              )}
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={replaceBatch}
                  disabled={busy}
                  onChange={(e) => setReplaceBatch(e.target.checked)}
                />
                {tr(
                  'Replace conflicting data in selected matches; retain previous history in the audit trail',
                )}
              </label>
              <Field label={tr('Batch import reason')}>
                <input
                  value={reason}
                  disabled={busy}
                  minLength={3}
                  maxLength={2000}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <Button
                disabled={
                  busy ||
                  !included.length ||
                  reason.trim().length < 3 ||
                  included.some(
                    (s) =>
                      preview.records.find((r) => r.record.sheet === s)?.requiresReplacement &&
                      !replaceBatch,
                  )
                }
                onClick={() => {
                  if (
                    !window.confirm(
                      tr(
                        'Import {0} selected histories into {1}{2}?{3}',
                        included.length,
                        preview.tournament.name,
                        confirmResults ? tr(' and confirm their finished results') : '',
                        replaceBatch
                          ? tr(
                              ' Conflicting selected records will be replaced; previous history remains audited.',
                            )
                          : '',
                      ),
                    )
                  )
                    return;
                  void run(async () => {
                    const result = await api<Report>(endpoint(), {
                      method: 'POST',
                      body: JSON.stringify({
                        type: 'batch',
                        importId: preview.id,
                        reason,
                        confirmResults,
                        matches: preview.records
                          .filter((r) => included.includes(r.record.sheet))
                          .map((r) => ({
                            sheet: r.record.sheet,
                            ...(r.target
                              ? {
                                  matchId: r.target.id,
                                  baseVersion: r.target.version,
                                  replace: replaceBatch && r.requiresReplacement,
                                }
                              : { create: r.createSuggestion }),
                          })),
                      }),
                    });
                    setReport(result);
                    setPreview(await api<Preview>(endpoint(`?id=${preview.id}`)));
                    await onChanged();
                  }, tr('Match history import finished. Review the report.'));
                }}
              >
                <Upload size={16} />
                {tr('Import selected histories (')}
                {included.length})
              </Button>
              {report && (
                <section
                  aria-label={tr('Match history import report')}
                  className="border-y py-3 text-sm"
                >
                  <p>
                    {report.importedMatches} {tr('matches imported ·')} {report.actionsImported}{' '}
                    {tr('actions ·')} {report.resultsImported} {tr('map results ·')}{' '}
                    {report.alreadyImported} {tr('already imported ·')} {report.skipped.length}{' '}
                    {tr('skipped ·')} {report.failedMatches} {tr('failed')}
                  </p>
                  <ul className="mt-2 space-y-1">
                    {report.results.map((r) => (
                      <li key={r.sheet}>
                        #{r.sheet}: {r.status}
                        {r.error ? ` - ${r.error}` : ''}
                        {r.matchNumber && (
                          <a
                            className="ml-2 text-primary"
                            href={`/t/${report.tournament.slug}/admin/referee/${r.matchNumber}`}
                          >
                            {tr('Open history')}
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                  {report.skipped.map((r) => (
                    <p key={r.sheet}>
                      #{r.sheet}
                      {tr(': skipped -')} {r.reason}
                    </p>
                  ))}
                </section>
              )}
              <Field label={tr('Worksheet')}>
                <select
                  value={selected}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setResolutions({});
                    setReplace(false);
                    setReason('');
                    setCreate(false);
                  }}
                >
                  {preview.records.map((r) => (
                    <option key={r.record.sheet} value={r.record.sheet}>
                      {r.record.sheet} - {r.record.stage} -{' '}
                      {r.target ? tr('Existing match') : tr('Not found')}
                      {r.record.issues.length ? tr(' - Review required') : ''}
                    </option>
                  ))}
                </select>
              </Field>
              {item && (
                <>
                  <p className="font-semibold">
                    {item.record.red} {tr('vs')} {item.record.blue} · {item.record.scoreA} :{' '}
                    {item.record.scoreB}
                  </p>
                  <p className="break-all text-sm">{item.record.mp || tr('No multiplayer link')}</p>
                  <p className="text-sm text-muted">
                    {tr('Stage:')} {item.record.stage} {tr('to')}{' '}
                    {item.stageMapping.stageName || tr('manual review')}
                    {item.stageMapping.bracket ? ` / ${item.stageMapping.bracket}` : ''}
                    {' · '}
                    {tr('Scoring:')} {item.scoring.source || tr('Not supplied')} /{' '}
                    {tr('Tournament:')} {item.scoring.target}
                  </p>
                  {!!item.warnings.length && (
                    <ul className="list-inside list-disc text-sm text-muted">
                      {item.warnings.map((warning) => (
                        <li key={warning}>
                          <Feedback message={warning} />
                        </li>
                      ))}
                    </ul>
                  )}
                  {!!item.errors.length && (
                    <ul role="alert" className="list-inside list-disc text-sm text-red-200">
                      {item.errors.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  )}
                  {!!item.conflicts.length && (
                    <ul className="list-inside list-disc text-sm text-amber-200">
                      {item.conflicts.map((conflict) => (
                        <li key={conflict}>{conflict}</li>
                      ))}
                    </ul>
                  )}
                  <div className="max-h-72 overflow-auto">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>{tr('Source row')}</th>
                          <th>{tr('Team')}</th>
                          <th>{tr('Action')}</th>
                          <th>{tr('Map')}</th>
                          <th>{tr('Winner')}</th>
                          <th>{tr('Website action / resolution')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {item.record.actions.map((a, index) => (
                          <tr key={a.row}>
                            <td>{a.row}</td>
                            <td>{a.side === 'A' ? tr('Red') : tr('Blue')}</td>
                            <td>{tr(humanizeCode(a.kind))}</td>
                            <td>{a.slotName}</td>
                            <td>{a.winner ? (a.winner === 'A' ? tr('Red') : tr('Blue')) : '-'}</td>
                            <td>
                              {item.websiteActions[index] && (
                                <>
                                  <p className="text-xs text-muted">
                                    {item.websiteActions[index].side === 'A'
                                      ? tr('Red')
                                      : tr('Blue')}{' '}
                                    {item.websiteActions[index].kind}{' '}
                                    {item.websiteActions[index].slotName} {tr('· Winner')}{' '}
                                    {item.websiteActions[index].winner || '-'}
                                  </p>
                                  <select
                                    aria-label={tr('Resolve source row {0}', a.row)}
                                    value={resolutions[a.row] || 'SOURCE'}
                                    onChange={(e) =>
                                      setResolutions({
                                        ...resolutions,
                                        [a.row]: e.target.value as 'SOURCE' | 'WEBSITE',
                                      })
                                    }
                                  >
                                    <option value="SOURCE">{tr('Use source action')}</option>
                                    <option value="WEBSITE">{tr('Keep website action')}</option>
                                  </select>
                                </>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <details>
                    <summary className="cursor-pointer text-sm">
                      {tr('Source Discord output')}
                    </summary>
                    <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words text-xs">
                      {item.record.discord}
                    </pre>
                  </details>
                  {!item.target && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setCreate(!create)}
                      >
                        <Plus size={14} />
                        {tr('Create historical match')}
                      </Button>
                      {create && (
                        <div className="grid-fields">
                          <Field label={tr('Historical stage')}>
                            <select value={stage} onChange={(e) => setStage(e.target.value)}>
                              <option value="">{tr('Select existing stage')}</option>
                              {preview.stages.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          </Field>
                          {(
                            [
                              ['Red', red, setRed],
                              ['Blue', blue, setBlue],
                            ] as const
                          ).map(([label, value, set]) => (
                            <Field key={label} label={tr('Historical Team {0}', label)}>
                              <select value={value} onChange={(e) => set(e.target.value)}>
                                <option value="">{tr('Select approved team')}</option>
                                {preview.teams.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.name}
                                  </option>
                                ))}
                              </select>
                            </Field>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  {item.target && (
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={replace}
                        onChange={(e) => setReplace(e.target.checked)}
                      />
                      {tr(
                        'Replace the reviewed match history while preserving frozen rules. Existing actions/results are retained as voided records; an updated result needs organizer confirmation.',
                      )}
                    </label>
                  )}
                  <Field label={tr('Import reason')}>
                    <input
                      required
                      minLength={3}
                      maxLength={2000}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </Field>
                  <div className="flex gap-2">
                    <Button
                      disabled={
                        busy ||
                        !!item.record.issues.length ||
                        reason.trim().length < 3 ||
                        (item.target
                          ? item.requiresReplacement && !replace
                          : !create || !stage || !red || !blue)
                      }
                      onClick={() => {
                        if (
                          !window.confirm(
                            tr(
                              'Accept worksheet {0} into this tournament? Existing records will not be silently merged.',
                              item.record.sheet,
                            ),
                          )
                        )
                          return;
                        void run(async () => {
                          await api(endpoint(), {
                            method: 'POST',
                            body: JSON.stringify({
                              importId: preview.id,
                              sheet: selected,
                              ...(item.target
                                ? {
                                    matchId: item.target.id,
                                    baseVersion: item.target.version,
                                    replace,
                                  }
                                : { create: { stageId: stage, teamAId: red, teamBId: blue } }),
                              reason,
                              confirmResults,
                              choices: Object.entries(resolutions).map(([row, use]) => ({
                                row: Number(row),
                                use,
                              })),
                            }),
                          });
                          setPreview(await api<Preview>(endpoint(`?id=${preview.id}`)));
                          setReplace(false);
                          await onChanged();
                        }, tr('Referee record accepted. Review and confirm the result in its match.'));
                      }}
                    >
                      <Check size={16} />
                      {tr('Import selected match')}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const i = preview.records.indexOf(item);
                        setSelected(preview.records[(i + 1) % preview.records.length].record.sheet);
                        setResolutions({});
                        setReplace(false);
                        setCreate(false);
                      }}
                    >
                      {tr('Skip')}
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
