'use client';
import { useLocale, useT } from '@/components/locale';
import { formatNumber } from '@/lib/i18n';
import { useState } from 'react';
import { useDialogClose } from '@/components/unsaved-navigation';
import { ArrowUpRight, Check, FlaskConical, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { can, type Actor } from '@/lib/permissions';
import type { PoolingData } from '@/lib/pooling-types';
import { Field, Modal, SaveButton } from './shared';
import {
  type Candidate,
  type Warning,
  type Mutate,
  reviewSummary,
  warningFor,
  CandidateStatus,
} from './pooling-display';
import { duration } from '@/lib/utils';

function MapHeading({ candidate }: { candidate: Candidate }) {
  const tr = useT();
  const language = useLocale();
  const map = candidate.metadata;
  return (
    <div className="flex min-w-0 gap-3 border-b pb-4">
      {map.cover && (
        <img src={map.cover} alt="" className="size-14 shrink-0 rounded-lg object-cover" />
      )}
      <div className="min-w-0">
        <a
          href={`https://osu.ppy.sh/beatmaps/${candidate.beatmapId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="break-words text-sm font-semibold hover:text-primary"
        >
          {map.artist} - {map.title}
          <ArrowUpRight size={13} className="ml-1 inline" />
        </a>
        <p className="break-words text-xs text-muted">
          [{map.difficulty}
          {tr('] · mapped by')} {map.mapper}
        </p>
        <p className="mt-1 text-xs text-muted">
          {formatNumber(map.stars, language, 2)} {tr('stars ·')} {map.bpm} {tr('BPM ·')}{' '}
          {duration(map.length)} · #{candidate.beatmapId}
        </p>
      </div>
    </div>
  );
}

export function CandidateDialog({
  candidate,
  data,
  actor,
  busy,
  mutate,
  onClose,
  onReview,
  onSelect,
}: {
  candidate: Candidate;
  data: PoolingData;
  actor: Actor;
  busy: boolean;
  mutate: Mutate;
  onClose: () => void;
  onReview: () => void;
  onSelect: () => void;
}) {
  const tr = useT();
  const language = useLocale();
  const [notes, setNotes] = useState(candidate.notes);
  const close = useDialogClose(notes !== candidate.notes, busy, onClose);
  const manage = can(actor, 'mappools.edit'),
    summary = reviewSummary(candidate, language),
    warning = warningFor(data, candidate);
  return (
    <Modal open title={tr('Suggestion details')} wide onOpenChange={() => close()}>
      <div className="space-y-4">
        <MapHeading candidate={candidate} />
        <div className="flex flex-wrap gap-3 text-xs">
          <CandidateStatus status={candidate.status} />
          <span>
            {data.stages.find((stage) => stage.id === candidate.stageId)?.name || tr('No stage')} ·{' '}
            {candidate.category}
            {candidate.selectedSlot && ` · ${candidate.selectedSlot}`}
          </span>
          <span className="text-muted">
            {tr('Suggested by')} {candidate.submitter?.username || tr('Removed user')}
          </span>
        </div>
        {warning && <ArtistWarning warning={warning} />}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutate(
              {
                type: 'pooling.bulk',
                candidates: [{ id: candidate.id, baseVersion: candidate.version }],
                patch: { notes },
              },
              'Pooler notes saved.',
              onClose,
            );
          }}
          className="space-y-2"
        >
          <Field label={tr('Pooler notes')}>
            <textarea
              rows={3}
              readOnly={!manage}
              maxLength={4000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
          {manage && (
            <SaveButton busy={busy} disabled={busy || notes === candidate.notes}>
              {tr('Save notes')}
            </SaveButton>
          )}
        </form>
        <section className="border-t pt-4">
          <h3 className="text-sm font-semibold">{tr('Playtesting feedback')}</h3>
          <p className="mt-1 text-xs text-muted">
            {summary.completed.length}/{candidate.reviews.length} {tr('complete')}
            {summary.completed.length > 0 &&
              tr(' · Pool fit {0}/5 · Difficulty {1}/5', summary.fit, summary.difficulty)}
          </p>
          <div className="mt-3 divide-y">
            {candidate.reviews.length ? (
              candidate.reviews.map((entry) => (
                <div key={entry.id} className="space-y-1 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-medium">{entry.reviewer.username}</span>
                    <span className="text-xs text-muted">
                      {entry.completed
                        ? tr(
                            'Fit {0}/5 · Difficulty {1}/5',
                            entry.fit ?? '-',
                            entry.difficulty ?? '-',
                          )
                        : tr('Awaiting feedback')}
                    </span>
                  </div>
                  {entry.completed && entry.flags && (
                    <p className="whitespace-pre-wrap break-words text-xs text-amber-400">
                      {entry.flags}
                    </p>
                  )}
                  {entry.completed && entry.notes && (
                    <p className="whitespace-pre-wrap break-words text-sm text-muted">
                      {entry.notes}
                    </p>
                  )}
                </div>
              ))
            ) : (
              <p className="py-3 text-xs text-muted">{tr('No playtesters assigned.')}</p>
            )}
          </div>
        </section>
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button variant="ghost" onClick={() => close()}>
            {tr('Close')}
          </Button>
          {(manage || candidate.reviews.some((entry) => entry.reviewerId === actor.id)) && (
            <Button variant="outline" disabled={busy} onClick={() => close(onReview)}>
              <FlaskConical size={14} />
              {tr('Your review')}
            </Button>
          )}
          {manage && ['ACCEPTED', 'SELECTED'].includes(candidate.status) && (
            <Button disabled={busy} onClick={() => close(onSelect)}>
              <Check size={14} />
              {tr('Select into draft')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function ReviewDialog({
  candidate,
  actor,
  busy,
  mutate,
  onClose,
}: {
  candidate: Candidate;
  actor: Actor;
  busy: boolean;
  mutate: Mutate;
  onClose: () => void;
}) {
  const tr = useT();
  const existing = candidate.reviews.find((entry) => entry.reviewerId === actor.id);
  const [fit, setFit] = useState(existing?.fit?.toString() || ''),
    [difficulty, setDifficulty] = useState(existing?.difficulty?.toString() || '');
  const [flags, setFlags] = useState(existing?.flags || ''),
    [notes, setNotes] = useState(existing?.notes || '');
  const [initial] = useState(() => JSON.stringify({ fit, difficulty, flags, notes }));
  const close = useDialogClose(
    JSON.stringify({ fit, difficulty, flags, notes }) !== initial,
    busy,
    onClose,
  );
  return (
    <Modal
      open
      title={existing?.completed ? tr('Edit your playtest feedback') : tr('Playtest feedback')}
      onOpenChange={() => close()}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutate(
            {
              type: 'pooling.review.save',
              candidateId: candidate.id,
              baseVersion: existing?.version ?? null,
              fit: Number(fit),
              difficulty: Number(difficulty),
              flags,
              notes,
            },
            'Your playtest feedback saved.',
            onClose,
          );
        }}
      >
        <MapHeading candidate={candidate} />
        <p className="text-xs text-muted">
          {tr('Review by')} {actor.username}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={tr('Pool fit')}>
            <select required value={fit} onChange={(event) => setFit(event.target.value)}>
              <option value="" disabled>
                {tr('Choose rating')}
              </option>
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value} / 5
                  {value === 1 ? tr(' - Poor fit') : value === 5 ? tr(' - Excellent fit') : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tr('Difficulty')}>
            <select
              required
              value={difficulty}
              onChange={(event) => setDifficulty(event.target.value)}
            >
              <option value="" disabled>
                {tr('Choose rating')}
              </option>
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value} / 5
                  {value === 1
                    ? tr(' - Too easy')
                    : value === 3
                      ? tr(' - On target')
                      : value === 5
                        ? tr(' - Too hard')
                        : ''}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label={tr('Problem flags')}>
          <input
            maxLength={1000}
            placeholder={tr('Timing, exploit, difficulty spike...')}
            value={flags}
            onChange={(event) => setFlags(event.target.value)}
          />
        </Field>
        <Field label={tr('Feedback / suggested replacements')}>
          <textarea
            rows={5}
            maxLength={4000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => close()}>
            {tr('Cancel')}
          </Button>
          <SaveButton busy={busy}>{tr('Save completed review')}</SaveButton>
        </div>
      </form>
    </Modal>
  );
}

function ArtistWarning({ warning }: { warning: Warning }) {
  const tr = useT();
  return (
    <div
      className={`rounded-lg border p-3 ${warning.severity === 'BANNED' ? 'border-red-400/40' : 'border-amber-400/40'}`}
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        <ShieldAlert size={16} />
        {warning.severity === 'BANNED' ? tr('Tournament artist ban') : tr('Artist warning')}:{' '}
        {warning.artist}
      </p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted">{warning.reason}</p>
      {warning.source && (
        <a
          href={warning.source}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs text-primary"
        >
          {tr('Warning source')}
          <ArrowUpRight size={12} />
        </a>
      )}
    </div>
  );
}

export function SelectDialog({
  candidate,
  data,
  busy,
  mutate,
  onClose,
}: {
  candidate: Candidate;
  data: PoolingData;
  busy: boolean;
  mutate: Mutate;
  onClose: () => void;
}) {
  const tr = useT();
  const initialStage =
    data.stages.find((stage) => stage.id === candidate.stageId && stage.pool) ||
    data.stages.find((stage) => stage.pool);
  const [stageId, setStageId] = useState(initialStage?.id || '');
  const [baseRevisionId, setBaseRevisionId] = useState(initialStage?.pool?.draftRevisionId ?? null);
  const defaultSlot = (stage: typeof initialStage) =>
    (stage?.id === candidate.stageId ? candidate.selectedSlot : null) ||
    stage?.plan?.slots.find((slot) => slot.category === candidate.category)?.name ||
    `${candidate.category}1`;
  const [slotName, setSlotName] = useState(defaultSlot(initialStage)),
    [replace, setReplace] = useState(false),
    [resolution, setResolution] = useState('');
  const stage = data.stages.find((entry) => entry.id === stageId),
    warning = warningFor(data, candidate);
  const [initial] = useState(() => JSON.stringify({ stageId, slotName, replace, resolution }));
  const close = useDialogClose(
    JSON.stringify({ stageId, slotName, replace, resolution }) !== initial,
    busy,
    onClose,
  );
  return (
    <Modal open title={tr('Select into stage draft')} onOpenChange={() => close()}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutate(
            {
              type: 'pooling.select',
              candidateId: candidate.id,
              baseVersion: candidate.version,
              stageId,
              slotName,
              baseRevisionId,
              replace,
              warningResolution: resolution,
            },
            'Beatmap selected into stage draft.',
            onClose,
          );
        }}
      >
        <MapHeading candidate={candidate} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tr('Destination stage')}>
            <select
              required
              value={stageId}
              onChange={(event) => {
                const next = data.stages.find((entry) => entry.id === event.target.value);
                setStageId(event.target.value);
                setBaseRevisionId(next?.pool?.draftRevisionId ?? null);
                setSlotName(defaultSlot(next));
                setReplace(false);
              }}
            >
              <option value="" disabled>
                {tr('Choose stage')}
              </option>
              {data.stages.map((entry) => (
                <option key={entry.id} value={entry.id} disabled={!entry.pool}>
                  {entry.name}
                  {!entry.pool ? tr(' (no pool)') : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tr('Destination slot ({0})', candidate.category)}>
            <input
              required
              pattern="[A-Za-z0-9_-]{1,20}"
              maxLength={20}
              list="pooling-destination-slots"
              value={slotName}
              onChange={(event) => setSlotName(event.target.value)}
            />
            <datalist id="pooling-destination-slots">
              {stage?.plan?.slots
                .filter((slot) => slot.category === candidate.category)
                .map((slot) => (
                  <option key={slot.name} value={slot.name} />
                ))}
            </datalist>
          </Field>
        </div>
        {stage && (
          <p className="text-xs text-muted">
            {stage.pool?.draftRevisionId
              ? tr('Updates the existing draft.')
              : stage.pool?.publishedRevisionId
                ? tr('Creates a new draft from the published pool.')
                : tr('Creates the first pool draft.')}{' '}
            {tr('Public maps change only after publishing.')}
          </p>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={replace}
            onChange={(event) => setReplace(event.target.checked)}
          />
          <span>{tr('Replace the beatmap if this destination slot is already filled.')}</span>
        </label>
        {warning && <ArtistWarning warning={warning} />}
        {warning?.severity === 'BANNED' && (
          <Field
            label={tr('Artist ban resolution')}
            hint={tr('Required for this selection and recorded for publishing checks.')}
          >
            <textarea
              required
              minLength={3}
              maxLength={2000}
              rows={3}
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
            />
          </Field>
        )}
        {!data.stages.some((entry) => entry.pool) && (
          <p role="alert" className="text-sm text-amber-400">
            {tr('Create a stage mappool before selecting a suggestion.')}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => close()}>
            {tr('Cancel')}
          </Button>
          <SaveButton busy={busy} disabled={busy || !stage?.pool}>
            {tr('Select into draft')}
          </SaveButton>
        </div>
      </form>
    </Modal>
  );
}
