'use client';
import { formatNumber, humanizeCode, localeTag } from '@/lib/i18n';
import { Feedback, useLocale, useT } from '@/components/locale';

import { useEffect, useState } from 'react';
import { Upload, ArchiveRestore, ExternalLink } from 'lucide-react';
import { Button } from '../ui/button';
import { Field, Modal, api, useTask, ConfirmButton } from './shared';
import type { ArchivePreview } from '@/lib/tournament-import';

type Job = {
  id: string;
  tournamentId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  report: Record<string, unknown>;
};
export function TournamentImporter({ onImported }: { onImported: () => Promise<unknown> }) {
  const language = useLocale();
  const tr = useT();
  const [open, setOpen] = useState(false),
    [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ArchivePreview | null>(null),
    [slug, setSlug] = useState('');
  const [confirmed, setConfirmed] = useState(false),
    [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]),
    [error, setError] = useState('');
  const { busy, run } = useTask();
  const loadJobs = async () => {
    try {
      setJobs((await api<{ jobs: Job[] }>('/api/tournament-transfer/import')).jobs);
      setError('');
    } catch (error) {
      setError((error as Error).message);
    }
  };
  useEffect(() => {
    if (open) void loadJobs();
  }, [open]);
  async function upload(operation: 'preview' | 'import') {
    if (!file) throw new Error('Choose an archive.');
    const body = new FormData();
    body.set('file', file);
    body.set('operation', operation);
    if (operation === 'import') {
      body.set('fingerprint', preview!.fingerprint);
      body.set('slug', slug);
      body.set('acknowledgement', 'NEW_UNPUBLISHED');
    }
    const response = await fetch('/api/tournament-transfer/import', { method: 'POST', body });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Archive transfer failed.');
    return data;
  }
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload size={17} />
        {tr('Import Tournament')}
      </Button>
      <Modal
        title={tr('Import Tournament')}
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
        wide
      >
        <div className="space-y-5">
          <Field label={tr('Tournament archive (.zip)')}>
            <input
              type="file"
              accept=".zip,application/zip"
              disabled={busy}
              onChange={(event) => {
                setFile(event.target.files?.[0] || null);
                setPreview(null);
                setResult(null);
                setConfirmed(false);
              }}
            />
          </Field>
          <Button
            disabled={!file || busy}
            variant="outline"
            onClick={() =>
              void run(async () => {
                const data: ArchivePreview = await upload('preview');
                setPreview(data);
                setSlug(data.slugConflict ? data.slug + '-copy' : data.slug);
                setConfirmed(false);
              }, tr('Archive validated.'))
            }
          >
            <ArchiveRestore size={17} />
            {tr('Preview archive')}
          </Button>
          {preview && !result && (
            <section className="space-y-4 border-t pt-4">
              <h3 className="text-lg font-semibold">{String(preview.name)}</h3>
              <p className="text-sm text-muted">
                {preview.source} {tr('· Format v')}
                {preview.version} · {formatNumber(preview.mediaBytes / 1048576, language, 1)}{' '}
                {tr('MB media')}
              </p>
              <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                {Object.entries(preview.counts)
                  .filter(([, count]) => count)
                  .map(([name, count]) => (
                    <div key={name}>
                      <dt className="text-muted">
                        {tr(humanizeCode(name.replace(/([A-Z])/g, ' $1')))}
                      </dt>
                      <dd>{count}</dd>
                    </div>
                  ))}
              </dl>
              <ul className="list-inside list-disc space-y-1 text-sm text-muted">
                {preview.warnings.map((warning, index) => (
                  <li key={index}>
                    <Feedback message={warning} />
                  </li>
                ))}
              </ul>
              <details>
                <summary className="min-h-11 cursor-pointer py-2">
                  {tr('Review source roles and assignments')}
                </summary>
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-lg border bg-background p-3 text-xs">
                  {JSON.stringify(preview.review, null, 2)}
                </pre>
              </details>
              <Field label={tr('New tournament URL slug')}>
                <input
                  value={slug}
                  maxLength={80}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  onChange={(event) => setSlug(event.target.value)}
                  disabled={busy}
                />
              </Field>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                {tr(
                  'Create a separate unpublished tournament. Review access roles and assignments manually.',
                )}
              </label>
              <Button
                disabled={busy || !confirmed || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)}
                onClick={() =>
                  void run(async () => {
                    setResult(await upload('import'));
                    await onImported();
                    await loadJobs();
                  }, tr('Tournament imported privately.'))
                }
              >
                <Upload size={17} />
                {busy ? tr('Importing...') : tr('Import as unpublished')}
              </Button>
            </section>
          )}
          {result && (
            <section role="status" className="space-y-3 border-t pt-4">
              <h3 className="text-lg font-semibold">{tr('Import complete')}</h3>
              <a
                className="inline-flex min-h-11 items-center gap-2 text-primary"
                href={`/t/${result.slug}/admin`}
              >
                {tr('Review unpublished tournament')} <ExternalLink size={16} />
              </a>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg border bg-background p-3 text-xs">
                {JSON.stringify(result, null, 2)}
              </pre>
            </section>
          )}
          <section className="space-y-3 border-t pt-4">
            <h3 className="font-semibold">{tr('Recent imports')}</h3>
            {error && (
              <p role="alert" className="text-sm text-red-300">
                <Feedback message={error} />
              </p>
            )}
            {jobs.length === 0 && !error && (
              <p className="text-sm text-muted">{tr('No imports yet.')}</p>
            )}
            {jobs.map((job) => (
              <details key={job.id} className="border-b pb-3">
                <summary className="min-h-11 cursor-pointer py-2 text-sm">
                  {tr(humanizeCode(job.status))} ·{' '}
                  {new Date(job.createdAt).toLocaleString(localeTag(language))}
                </summary>
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-lg border bg-background p-3 text-xs">
                  {JSON.stringify(job.report, null, 2)}
                </pre>
                {(job.status === 'CLEANUP_REQUIRED' ||
                  (['PREPARING', 'CLEANING'].includes(job.status) &&
                    Date.now() - new Date(job.updatedAt).getTime() > 30 * 60000)) && (
                  <ConfirmButton
                    title={tr('Clean up this stopped import?')}
                    description={tr(
                      'Only uncommitted import objects are removed. Ensure the old importing worker is stopped before recovering an interrupted transfer.',
                    )}
                    onConfirm={() =>
                      void run(async () => {
                        await api('/api/tournament-transfer/import', {
                          method: 'DELETE',
                          body: JSON.stringify({ id: job.id }),
                        });
                        await loadJobs();
                      }, tr('Recovery checked.'))
                    }
                  >
                    <ArchiveRestore size={17} />
                    {tr('Clean up failed import')}
                  </ConfirmButton>
                )}
              </details>
            ))}
          </section>
        </div>
      </Modal>
    </>
  );
}
