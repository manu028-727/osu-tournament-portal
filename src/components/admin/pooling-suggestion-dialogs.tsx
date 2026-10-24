'use client';
import { humanizeCode } from '@/lib/i18n';
import { Feedback, useT } from '@/components/locale';
import { useRef, useState } from 'react';
import { useDialogClose } from '@/components/unsaved-navigation';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BeatmapMetadata } from '@/lib/osu';
import type { PoolingData } from '@/lib/pooling-types';
import { parseImport } from '@/lib/validation';
import { api, Field, Modal, SaveButton } from './shared';
import {
  type Candidate,
  type Skillset,
  type BulkPatch,
  type Mutate,
  editableStatuses,
} from './pooling-display';

function SkillsetFields({
  skillsets,
  primary,
  secondary,
  onChange,
  disabled = false,
}: {
  skillsets: Skillset[];
  primary: string[];
  secondary: string[];
  onChange: (primary: string[], secondary: string[]) => void;
  disabled?: boolean;
}) {
  const tr = useT();
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-2 text-sm font-medium">{tr('Skillsets')}</legend>
      {skillsets.length ? (
        <div className="max-h-52 overflow-y-auto rounded-lg border divide-y">
          {skillsets.map((skillset) => (
            <div key={skillset.id} className="flex items-center gap-3 px-3 py-1.5">
              <label htmlFor={`skillset-${skillset.id}`} className="min-w-0 flex-1 text-sm">
                {skillset.name}
                {skillset.group && (
                  <span className="ml-2 text-xs text-muted">{skillset.group}</span>
                )}
              </label>
              <select
                id={`skillset-${skillset.id}`}
                className="!w-32 !min-h-9 !py-1 text-xs"
                value={
                  primary.includes(skillset.id)
                    ? 'primary'
                    : secondary.includes(skillset.id)
                      ? 'secondary'
                      : ''
                }
                onChange={(event) =>
                  onChange(
                    [
                      ...primary.filter((id) => id !== skillset.id),
                      ...(event.target.value === 'primary' ? [skillset.id] : []),
                    ],
                    [
                      ...secondary.filter((id) => id !== skillset.id),
                      ...(event.target.value === 'secondary' ? [skillset.id] : []),
                    ],
                  )
                }
              >
                <option value="">{tr('Not tagged')}</option>
                <option value="primary">{tr('Primary')}</option>
                <option value="secondary">{tr('Secondary')}</option>
              </select>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted">{tr('No skillsets configured.')}</p>
      )}
    </fieldset>
  );
}

export function SuggestDialog({
  data,
  busy,
  lookupAllowed,
  mutate,
  notify,
  onClose,
}: {
  data: PoolingData;
  busy: boolean;
  lookupAllowed: boolean;
  mutate: Mutate;
  notify: (message: string, error?: boolean) => void;
  onClose: () => void;
}) {
  const tr = useT();
  const [input, setInput] = useState('');
  const [stageId, setStageId] = useState('');
  const [category, setCategory] = useState(data.categories[0]?.acronym || '');
  const [notes, setNotes] = useState('');
  const [primary, setPrimary] = useState<string[]>([]),
    [secondary, setSecondary] = useState<string[]>([]);
  const [preview, setPreview] = useState<
    { id: number; map?: BeatmapMetadata; error?: string; existing: boolean }[] | null
  >(null);
  const [looking, setLooking] = useState(false),
    [previewError, setPreviewError] = useState('');
  const generation = useRef(0);
  const resetPreview = () => {
    generation.current++;
    setPreview(null);
    setPreviewError('');
    setLooking(false);
  };
  const previewMaps = async () => {
    const request = ++generation.current;
    setPreview(null);
    setPreviewError('');
    setLooking(true);
    try {
      const parsed = parseImport(input, category);
      const ids = [...new Set(parsed.map((row) => row.beatmapId))];
      if (!ids.length) throw new Error('Enter at least one beatmap ID or URL.');
      let fetched: { maps: BeatmapMetadata[]; errors: { id: number; error: string }[] } = {
        maps: [],
        errors: [],
      };
      if (lookupAllowed)
        fetched = await api('/api/admin/beatmaps', {
          method: 'POST',
          body: JSON.stringify({ ids }),
        });
      if (request !== generation.current) return;
      setPreview(
        ids.map((id) => ({
          id,
          map:
            fetched.maps.find((map) => map.id === id) ||
            data.candidates.find((candidate) => candidate.beatmapId === id)?.metadata,
          error: fetched.errors.find((error) => error.id === id)?.error,
          existing: data.candidates.some((candidate) => candidate.beatmapId === id),
        })),
      );
      if (parsed.length > ids.length)
        notify(tr('{0} repeated IDs removed from the preview.', parsed.length - ids.length));
    } catch (error) {
      if (request === generation.current) setPreviewError((error as Error).message);
    } finally {
      if (request === generation.current) setLooking(false);
    }
  };
  const newMaps = preview?.filter((row) => !row.existing && !row.error) || [];
  const [initialCategory] = useState(category);
  const close = useDialogClose(
    !!(
      input ||
      stageId ||
      notes ||
      primary.length ||
      secondary.length ||
      category !== initialCategory
    ),
    busy,
    onClose,
  );
  return (
    <Modal open title={tr('Suggest maps')} wide onOpenChange={() => close()}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!preview || !newMaps.length) return;
          mutate(
            {
              type: 'pooling.suggest',
              beatmapIds: newMaps.map((row) => row.id),
              stageId: stageId || null,
              category,
              notes,
              primaryTagIds: primary,
              secondaryTagIds: secondary,
            },
            'Map suggestions saved.',
            onClose,
          );
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-4">
            <Field label={tr('Beatmap IDs or URLs')} hint={tr('One per line')}>
              <textarea
                required
                rows={6}
                maxLength={30000}
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                  resetPreview();
                }}
                placeholder={tr('123456\nhttps://osu.ppy.sh/beatmaps/234567')}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={tr('Suggested stage')}>
                <select value={stageId} onChange={(event) => setStageId(event.target.value)}>
                  <option value="">{tr('No stage yet')}</option>
                  {data.stages.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={tr('Mod category')}>
                <select
                  required
                  value={category}
                  onChange={(event) => {
                    setCategory(event.target.value);
                    resetPreview();
                  }}
                >
                  <option value="" disabled>
                    {tr('Choose a category')}
                  </option>
                  {data.categories.map((mod) => (
                    <option key={mod.acronym} value={mod.acronym}>
                      {mod.acronym} - {mod.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label={tr('Pooler notes')}>
              <textarea
                maxLength={4000}
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </Field>
          </div>
          <SkillsetFields
            skillsets={data.skillsets}
            primary={primary}
            secondary={secondary}
            onChange={(p, s) => {
              setPrimary(p);
              setSecondary(s);
            }}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={looking || busy || !input.trim() || !category}
          onClick={() => void previewMaps()}
        >
          <Search size={14} />
          {looking ? tr('Looking up maps...') : tr('Preview suggestions')}
        </Button>
        {previewError && (
          <p role="alert" className="text-sm text-red-400">
            <Feedback message={previewError} />
          </p>
        )}
        {preview && (
          <div className="space-y-2">
            <p className="text-sm">
              {newMaps.length} {tr('new ·')} {preview.filter((row) => row.existing).length}{' '}
              {tr('already suggested ·')} {preview.filter((row) => row.error).length}{' '}
              {tr('unavailable')}
            </p>
            <div className="max-h-64 divide-y overflow-y-auto rounded-lg border">
              {preview.map((row) => (
                <div key={row.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-xs">
                  <span className="font-mono">{row.id}</span>
                  <span className="min-w-0 flex-1 break-words">
                    {row.map
                      ? `${row.map.artist} - ${row.map.title} [${row.map.difficulty}]`
                      : tr('Metadata retrieved when submitted')}
                  </span>
                  <span className={row.error ? 'text-red-400' : 'text-muted'}>
                    {row.existing
                      ? tr('Already suggested - skipped')
                      : row.error ||
                        (row.map ? tr('{0} stars', row.map.stars.toFixed(2)) : tr('Ready'))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => close()}>
            {tr('Cancel')}
          </Button>
          <SaveButton busy={busy} disabled={busy || !preview || !newMaps.length || looking}>
            {tr('Submit')} {newMaps.length || ''} {tr('suggestions')}
          </SaveButton>
        </div>
      </form>
    </Modal>
  );
}

export function BulkDialog({
  candidates,
  data,
  busy,
  mutate,
  onClose,
  onSaved,
}: {
  candidates: Candidate[];
  data: PoolingData;
  busy: boolean;
  mutate: Mutate;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tr = useT();
  const common = (field: 'stageId' | 'category' | 'status' | 'notes') =>
    candidates.every((row) => row[field] === candidates[0][field])
      ? candidates[0][field] || ''
      : '';
  const mixed = (field: 'stageId' | 'category' | 'status' | 'notes') =>
    candidates.some((row) => row[field] !== candidates[0][field]);
  const [enabled, setEnabled] = useState({
    stage: false,
    category: false,
    status: false,
    tags: false,
    notes: false,
    reviewers: false,
  });
  const [stageId, setStageId] = useState(common('stageId')),
    [category, setCategory] = useState(common('category')),
    [status, setStatus] = useState(common('status') === 'SELECTED' ? '' : common('status'));
  const [notes, setNotes] = useState(common('notes'));
  const commonTags = (primary: boolean) =>
    candidates[0].tags
      .filter(
        (tag) =>
          tag.primary === primary &&
          candidates.every((candidate) =>
            candidate.tags.some(
              (other) => other.skillsetId === tag.skillsetId && other.primary === primary,
            ),
          ),
      )
      .map((tag) => tag.skillsetId);
  const [primary, setPrimary] = useState<string[]>(commonTags(true)),
    [secondary, setSecondary] = useState<string[]>(commonTags(false)),
    [reviewers, setReviewers] = useState<string[]>([]);
  const toggle = (field: keyof typeof enabled) => (
    <input
      type="checkbox"
      aria-label={tr('Change {0}', field)}
      checked={enabled[field]}
      onChange={(event) => setEnabled({ ...enabled, [field]: event.target.checked })}
    />
  );
  const changes = Object.values(enabled).filter(Boolean).length;
  const [initial] = useState(() =>
    JSON.stringify({ enabled, stageId, category, status, notes, primary, secondary, reviewers }),
  );
  const close = useDialogClose(
    JSON.stringify({ enabled, stageId, category, status, notes, primary, secondary, reviewers }) !==
      initial,
    busy,
    onClose,
  );
  return (
    <Modal
      open
      title={tr('Edit {0} suggestions', candidates.length)}
      wide
      onOpenChange={() => close()}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const patch: BulkPatch = {
            ...(enabled.stage ? { stageId: stageId || null } : {}),
            ...(enabled.category ? { category } : {}),
            ...(enabled.status ? { status: status as BulkPatch['status'] } : {}),
            ...(enabled.notes ? { notes } : {}),
            ...(enabled.tags ? { primaryTagIds: primary, secondaryTagIds: secondary } : {}),
            ...(enabled.reviewers ? { reviewerIds: reviewers } : {}),
          };
          mutate(
            {
              type: 'pooling.bulk',
              candidates: candidates.map((candidate) => ({
                id: candidate.id,
                baseVersion: candidate.version,
              })),
              patch,
            },
            `${candidates.length} suggestions updated.`,
            onSaved,
          );
        }}
      >
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              {toggle('stage')}
              {tr('Change stage')}
              {mixed('stageId') && <span className="text-xs text-muted">{tr('Mixed')}</span>}
            </label>
            <select
              aria-label={tr('Destination stage')}
              disabled={!enabled.stage}
              value={stageId}
              onChange={(event) => setStageId(event.target.value)}
            >
              <option value="">{tr('No stage')}</option>
              {data.stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              {toggle('category')}
              {tr('Change category')}
              {mixed('category') && <span className="text-xs text-muted">{tr('Mixed')}</span>}
            </label>
            <select
              aria-label={tr('New mod category')}
              required={enabled.category}
              disabled={!enabled.category}
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="" disabled>
                {tr('Choose category')}
              </option>
              {data.categories.map((mod) => (
                <option key={mod.acronym} value={mod.acronym}>
                  {mod.acronym}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              {toggle('status')}
              {tr('Change status')}
              {mixed('status') && <span className="text-xs text-muted">{tr('Mixed')}</span>}
            </label>
            <select
              aria-label={tr('New suggestion status')}
              required={enabled.status}
              disabled={!enabled.status}
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="" disabled>
                {tr('Choose status')}
              </option>
              {editableStatuses.map((value) => (
                <option key={value} value={value}>
                  {tr(humanizeCode(value))}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              {toggle('tags')}
              {tr('Replace skillset tags')}
            </label>
            <SkillsetFields
              disabled={!enabled.tags}
              skillsets={data.skillsets}
              primary={primary}
              secondary={secondary}
              onChange={(p, s) => {
                setPrimary(p);
                setSecondary(s);
              }}
            />
          </div>
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              {toggle('reviewers')}
              {tr('Assign additional playtesters')}
            </label>
            <fieldset
              disabled={!enabled.reviewers}
              className="max-h-52 space-y-2 overflow-y-auto rounded-lg border p-3"
            >
              <legend className="sr-only">{tr('Playtesters')}</legend>
              {data.reviewers.length ? (
                data.reviewers.map((reviewer) => (
                  <label key={reviewer.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={reviewers.includes(reviewer.id)}
                      onChange={(event) =>
                        setReviewers((current) =>
                          event.target.checked
                            ? [...current, reviewer.id]
                            : current.filter((id) => id !== reviewer.id),
                        )
                      }
                    />
                    {reviewer.username}
                  </label>
                ))
              ) : (
                <p className="text-xs text-muted">{tr('No eligible playtesters.')}</p>
              )}
            </fieldset>
          </div>
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            {toggle('notes')}
            {tr('Replace pooler notes')}
            {mixed('notes') && <span className="text-xs text-muted">{tr('Mixed')}</span>}
          </label>
          <textarea
            aria-label={tr('New pooler notes')}
            disabled={!enabled.notes}
            maxLength={4000}
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
        <details>
          <summary className="cursor-pointer text-sm text-muted">
            {tr('Review')} {candidates.length} {tr('selected maps')}
          </summary>
          <ul className="mt-2 max-h-36 space-y-1 overflow-auto text-xs text-muted">
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                {candidate.beatmapId} · {candidate.metadata.artist} - {candidate.metadata.title}
              </li>
            ))}
          </ul>
        </details>
        <p className="text-xs text-muted">
          {changes} {tr('fields selected for update')}
          {enabled.tags ? tr(' · Existing skillset tags will be replaced') : ''}
          {enabled.notes ? tr(' · Existing pooler notes will be replaced') : ''}
          {enabled.reviewers ? tr(' · Existing reviews and assignments will be kept') : ''}.
        </p>
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => close()}>
            {tr('Cancel')}
          </Button>
          <SaveButton
            busy={busy}
            disabled={busy || !changes || (enabled.reviewers && !reviewers.length)}
          >
            {tr('Apply to')} {candidates.length} {tr('suggestions')}
          </SaveButton>
        </div>
      </form>
    </Modal>
  );
}
