'use client';
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
    requiresReplacement: boolean;
    alreadyImported: boolean;
    createSuggestion: { stageId: string; teamAId: string; teamBId: string } | null;
    websiteActions: { kind: string; side: string; slotName: string; winner: string | null }[];
  }[];
  stages: { id: string; name: string }[];
  teams: { id: string; name: string }[];
};
export function RefereeSheetImporter({ onChanged }: { onChanged: () => Promise<unknown> }) {
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
        Import Match History
      </Button>
      <Modal
        title="Import match history"
        wide
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <div className="space-y-4">
          <Field label="Destination tournament">
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
                <option value={destination}>{scope.slug || 'Select tournament'}</option>
              )}
              {destinations.map((d) => (
                <option key={d.id} value={d.slug}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Referee XLSX workbook">
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
                }, 'Workbook preview ready. No match records have been changed.');
              }}
            />
          </Field>
          {preview && (
            <>
              <div className="flex flex-wrap justify-between gap-3">
                <p className="text-sm">
                  {preview.filename} · {preview.records.length} match worksheets
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      async () => setPreview(await api<Preview>(endpoint(`?id=${preview.id}`))),
                      'Preview refreshed.',
                    )
                  }
                >
                  <RefreshCw size={14} />
                  Refresh preview
                </Button>
              </div>
              <p className="font-semibold">{preview.tournament.name}</p>
              <div className="max-h-64 overflow-auto border-y">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Select</th>
                      <th>Match / stage</th>
                      <th>Actions</th>
                      <th>Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.records.map((r) => (
                      <tr key={r.record.sheet}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select match ${r.record.sheet}`}
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
                            {r.record.red} vs {r.record.blue}
                          </p>
                        </td>
                        <td>
                          {r.record.actions.length} /{' '}
                          {r.record.actions.filter((a) => a.winner).length} results
                        </td>
                        <td className="text-xs">
                          {(r.alreadyImported ? 'Already imported' : '') ||
                            r.errors.join(' ') ||
                            r.conflicts.join(' ') ||
                            (r.target
                              ? 'Ready: add missing history'
                              : 'Ready: create historical match')}
                          {r.record.forfeitSide ? ' · Forfeit' : ''}
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
                  Confirm completed historical results
                </label>
              )}
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={replaceBatch}
                  disabled={busy}
                  onChange={(e) => setReplaceBatch(e.target.checked)}
                />
                Replace conflicting data in selected matches; retain previous history in the audit
                trail
              </label>
              <Field label="Batch import reason">
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
                      `Import ${included.length} selected histories into ${preview.tournament.name}${confirmResults ? ' and confirm their finished results' : ''}?${replaceBatch ? ' Conflicting selected records will be replaced; previous history remains audited.' : ''}`,
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
                  }, 'Match history import finished. Review the report.');
                }}
              >
                <Upload size={16} />
                Import selected histories ({included.length})
              </Button>
              {report && (
                <section aria-label="Match history import report" className="border-y py-3 text-sm">
                  <p>
                    {report.importedMatches} matches imported · {report.actionsImported} actions ·{' '}
                    {report.resultsImported} map results · {report.alreadyImported} already imported
                    · {report.skipped.length} skipped · {report.failedMatches} failed
                  </p>
                  <ul className="mt-2 space-y-1">
                    {report.results.map((r) => (
                      <li key={r.sheet}>
                        #{r.sheet}: {r.status}
                        {r.error ? ` - ${r.error}` : ''}
                        {r.id && (
                          <a
                            className="ml-2 text-primary"
                            href={`/t/${report.tournament.slug}/admin/referee/${r.id}`}
                          >
                            Open history
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                  {report.skipped.map((r) => (
                    <p key={r.sheet}>
                      #{r.sheet}: skipped - {r.reason}
                    </p>
                  ))}
                </section>
              )}
              <Field label="Worksheet">
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
                      {r.target ? 'Existing match' : 'Not found'}
                      {r.record.issues.length ? ' - Review required' : ''}
                    </option>
                  ))}
                </select>
              </Field>
              {item && (
                <>
                  <p className="font-semibold">
                    {item.record.red} vs {item.record.blue} · {item.record.scoreA} :{' '}
                    {item.record.scoreB}
                  </p>
                  <p className="break-all text-sm">{item.record.mp || 'No multiplayer link'}</p>
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
                          <th>Source row</th>
                          <th>Team</th>
                          <th>Action</th>
                          <th>Map</th>
                          <th>Winner</th>
                          <th>Website action / resolution</th>
                        </tr>
                      </thead>
                      <tbody>
                        {item.record.actions.map((a, index) => (
                          <tr key={a.row}>
                            <td>{a.row}</td>
                            <td>{a.side === 'A' ? 'Red' : 'Blue'}</td>
                            <td>{a.kind}</td>
                            <td>{a.slotName}</td>
                            <td>{a.winner ? (a.winner === 'A' ? 'Red' : 'Blue') : '-'}</td>
                            <td>
                              {item.websiteActions[index] && (
                                <>
                                  <p className="text-xs text-muted">
                                    {item.websiteActions[index].side === 'A' ? 'Red' : 'Blue'}{' '}
                                    {item.websiteActions[index].kind}{' '}
                                    {item.websiteActions[index].slotName} · Winner{' '}
                                    {item.websiteActions[index].winner || '-'}
                                  </p>
                                  <select
                                    aria-label={`Resolve source row ${a.row}`}
                                    value={resolutions[a.row] || 'SOURCE'}
                                    onChange={(e) =>
                                      setResolutions({
                                        ...resolutions,
                                        [a.row]: e.target.value as 'SOURCE' | 'WEBSITE',
                                      })
                                    }
                                  >
                                    <option value="SOURCE">Use source action</option>
                                    <option value="WEBSITE">Keep website action</option>
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
                    <summary className="cursor-pointer text-sm">Source Discord output</summary>
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
                        Create historical match
                      </Button>
                      {create && (
                        <div className="grid-fields">
                          <Field label="Historical stage">
                            <select value={stage} onChange={(e) => setStage(e.target.value)}>
                              <option value="">Select existing stage</option>
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
                            <Field key={label} label={`Historical Team ${label}`}>
                              <select value={value} onChange={(e) => set(e.target.value)}>
                                <option value="">Select approved team</option>
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
                      Accept source rules and replace the match history. Existing actions/results
                      are retained as voided records; an updated result needs organizer
                      confirmation.
                    </label>
                  )}
                  <Field label="Import reason">
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
                            `Accept worksheet ${item.record.sheet} into this tournament? Existing records will not be silently merged.`,
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
                        }, 'Referee record accepted. Review and confirm the result in its match.');
                      }}
                    >
                      <Check size={16} />
                      Import selected match
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
                      Skip
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
