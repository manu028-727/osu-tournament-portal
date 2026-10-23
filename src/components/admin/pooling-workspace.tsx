'use client';

import { useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  ClipboardList,
  FlaskConical,
  Info,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Tags,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { can, type Actor } from '@/lib/permissions';
import type { BeatmapMetadata } from '@/lib/osu';
import type { PoolCandidateView, PoolingData } from '@/lib/pooling-types';
import type { PoolingAction } from '@/lib/pooling-validation';
import { parseImport } from '@/lib/validation';
import {
  action,
  api,
  ConfirmButton,
  Field,
  LoadingState,
  Modal,
  SaveButton,
  useResource,
  useTask,
} from './shared';

type Candidate = PoolCandidateView;
type Skillset = PoolingData['skillsets'][number];
type Warning = PoolingData['warnings'][number];
type BulkPatch = Extract<PoolingAction, { type: 'pooling.bulk' }>['patch'];
type Mutate = (payload: PoolingAction, message: string, after?: () => void) => void;
const statuses = ['SUGGESTED', 'REVIEW', 'PLAYTESTING', 'ACCEPTED', 'SELECTED', 'REJECTED'];
const editableStatuses = statuses.filter((status) => status !== 'SELECTED');
const label = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();
const keyOfArtist = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en');
const duration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
const reviewSummary = (candidate: Candidate) => {
  const completed = candidate.reviews.filter((review) => review.completed);
  const mean = (field: 'fit' | 'difficulty') => {
    const ratings = completed
      .map((review) => review[field])
      .filter((rating): rating is number => rating !== null);
    return ratings.length
      ? (ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(1)
      : '-';
  };
  return { completed, fit: mean('fit'), difficulty: mean('difficulty') };
};
const warningFor = (data: PoolingData, candidate: Candidate) =>
  data.warnings.find((warning) => warning.artistKey === keyOfArtist(candidate.metadata.artist));

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
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-2 text-sm font-medium">Skillsets</legend>
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
                <option value="">Not tagged</option>
                <option value="primary">Primary</option>
                <option value="secondary">Secondary</option>
              </select>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted">No skillsets configured.</p>
      )}
    </fieldset>
  );
}

function CandidateStatus({ status }: { status: string }) {
  const color =
    status === 'ACCEPTED' || status === 'SELECTED'
      ? 'text-emerald-400'
      : status === 'REJECTED'
        ? 'text-red-400'
        : status === 'PLAYTESTING'
          ? 'text-amber-400'
          : 'text-muted';
  return <span className={`text-xs font-medium ${color}`}>{label(status)}</span>;
}

export function PoolingWorkspace({ actor }: { actor: Actor }) {
  const { data, error, reload } = useResource<PoolingData>('pooling');
  const { busy, run, notify } = useTask();
  const manage = can(actor, 'mappools.edit');
  const [view, setView] = useState<'all' | 'mine'>('all');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({
    stage: '',
    category: '',
    status: '',
    skillset: '',
    author: '',
    mapper: '',
    review: '',
    minStars: '',
    maxStars: '',
    minBpm: '',
    maxBpm: '',
    minLength: '',
    maxLength: '',
  });
  const [selected, setSelected] = useState<string[]>([]);
  const lastSelected = useRef<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [bulkTargets, setBulkTargets] = useState<Candidate[] | null>(null);
  const [detail, setDetail] = useState<Candidate | null>(null);
  const [review, setReview] = useState<Candidate | null>(null);
  const [select, setSelect] = useState<Candidate | null>(null);
  const [configuration, setConfiguration] = useState<'skillsets' | 'warnings' | null>(null);
  const mutate: Mutate = (payload, message, after) => {
    void run(async () => {
      await action(payload);
      await reload();
      after?.();
    }, message);
  };
  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  const visible = data.candidates.filter((candidate) => {
    const map = candidate.metadata;
    const mine = candidate.reviews.find((entry) => entry.reviewerId === actor.id);
    const inRange = (value: number, min: string, max: string) =>
      (min === '' || value >= Number(min)) && (max === '' || value <= Number(max));
    return (
      (view !== 'mine' || !!mine) &&
      (!filters.stage ||
        (filters.stage === 'unassigned'
          ? !candidate.stageId
          : candidate.stageId === filters.stage)) &&
      (!filters.category || candidate.category === filters.category) &&
      (!filters.status || candidate.status === filters.status) &&
      (!filters.skillset || candidate.tags.some((tag) => tag.skillsetId === filters.skillset)) &&
      (!filters.author || candidate.submitter?.id === filters.author) &&
      (!filters.mapper || map.mapper.toLowerCase().includes(filters.mapper.toLowerCase())) &&
      (!filters.review ||
        (filters.review === 'pending'
          ? candidate.reviews.some((entry) => !entry.completed)
          : candidate.reviews.some((entry) => entry.completed))) &&
      inRange(map.stars, filters.minStars, filters.maxStars) &&
      inRange(map.bpm, filters.minBpm, filters.maxBpm) &&
      inRange(map.length, filters.minLength, filters.maxLength) &&
      (!search ||
        [
          map.title,
          map.artist,
          map.difficulty,
          map.mapper,
          candidate.beatmapId,
          candidate.notes,
          candidate.submitter?.username,
        ]
          .join(' ')
          .toLowerCase()
          .includes(search.toLowerCase().trim()))
    );
  });
  const selectedRows = visible.filter((candidate) => selected.includes(candidate.id));
  const allSelected =
    !!visible.length && visible.every((candidate) => selected.includes(candidate.id));
  const updateFilter = (field: keyof typeof filters, value: string) => {
    setFilters({ ...filters, [field]: value });
    setSelected([]);
    lastSelected.current = null;
  };
  const selectRow = (candidate: Candidate, checked: boolean, shift: boolean) => {
    const from = visible.findIndex((row) => row.id === lastSelected.current);
    const to = visible.findIndex((row) => row.id === candidate.id);
    const ids =
      shift && from !== -1
        ? visible.slice(Math.min(from, to), Math.max(from, to) + 1).map((row) => row.id)
        : [candidate.id];
    setSelected((current) =>
      checked ? [...new Set([...current, ...ids])] : current.filter((id) => !ids.includes(id)),
    );
    lastSelected.current = candidate.id;
  };
  const quickChange = (candidate: Candidate, patch: BulkPatch) =>
    mutate(
      {
        type: 'pooling.bulk',
        candidates: [{ id: candidate.id, baseVersion: candidate.version }],
        patch,
      },
      'Suggestion updated.',
    );
  const authors = [
    ...new Map(
      data.candidates.flatMap((candidate) =>
        candidate.submitter ? [[candidate.submitter.id, candidate.submitter] as const] : [],
      ),
    ).values(),
  ];
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Suggestions & playtesting</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            title="Refresh suggestions"
            aria-label="Refresh suggestions"
            disabled={busy}
            onClick={() => void run(reload, 'Suggestions refreshed.')}
          >
            <RefreshCw size={16} />
          </Button>
          {manage && (
            <Button variant="outline" size="sm" onClick={() => setConfiguration('skillsets')}>
              <Tags size={14} />
              Skillsets & warnings
            </Button>
          )}
          <Button size="sm" onClick={() => setSuggestOpen(true)}>
            <Plus size={14} />
            Suggest maps
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="rounded-lg border border-red-400/40 p-3 text-sm text-red-400">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border p-1" role="group" aria-label="Suggestion view">
          {(
            [
              { value: 'all', title: 'All suggestions', icon: ClipboardList },
              { value: 'mine', title: 'Assigned to me', icon: FlaskConical },
            ] as const
          ).map((item) => (
            <Button
              key={item.value}
              size="sm"
              variant={view === item.value ? 'default' : 'ghost'}
              aria-pressed={view === item.value}
              onClick={() => {
                setView(item.value);
                setSelected([]);
                lastSelected.current = null;
              }}
            >
              <item.icon size={14} />
              {item.title}
            </Button>
          ))}
        </div>
        <div className="relative min-w-40 flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            aria-label="Search suggestions"
            placeholder="Search maps, IDs or notes"
            className="!pl-9"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setSelected([]);
              lastSelected.current = null;
            }}
          />
        </div>
        <span className="text-xs tabular-nums text-muted">
          {visible.length} of {data.candidates.length} suggestions
        </span>
      </div>
      <details className="rounded-lg border px-3 py-2">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
          <SlidersHorizontal size={14} />
          Filters
          {Object.values(filters).filter(Boolean).length
            ? ` (${Object.values(filters).filter(Boolean).length})`
            : ''}
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Stage">
            <select
              value={filters.stage}
              onChange={(event) => updateFilter('stage', event.target.value)}
            >
              <option value="">All stages</option>
              <option value="unassigned">No stage</option>
              {data.stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Mod category">
            <select
              value={filters.category}
              onChange={(event) => updateFilter('category', event.target.value)}
            >
              <option value="">All categories</option>
              {data.categories.map((category) => (
                <option key={category.acronym} value={category.acronym}>
                  {category.acronym} - {category.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              value={filters.status}
              onChange={(event) => updateFilter('status', event.target.value)}
            >
              <option value="">All statuses</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {label(status)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Skillset">
            <select
              value={filters.skillset}
              onChange={(event) => updateFilter('skillset', event.target.value)}
            >
              <option value="">All skillsets</option>
              {data.skillsets.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Suggested by">
            <select
              value={filters.author}
              onChange={(event) => updateFilter('author', event.target.value)}
            >
              <option value="">Anyone</option>
              {authors.map((author) => (
                <option key={author.id} value={author.id}>
                  {author.username}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Mapper">
            <input
              value={filters.mapper}
              onChange={(event) => updateFilter('mapper', event.target.value)}
            />
          </Field>
          <Field label="Reviews">
            <select
              value={filters.review}
              onChange={(event) => updateFilter('review', event.target.value)}
            >
              <option value="">Any review state</option>
              <option value="pending">Has pending reviews</option>
              <option value="completed">Has completed reviews</option>
            </select>
          </Field>
          {(
            [
              { title: 'Stars', min: 'minStars', max: 'maxStars', step: '0.1' },
              { title: 'BPM', min: 'minBpm', max: 'maxBpm', step: '1' },
              { title: 'Length (seconds)', min: 'minLength', max: 'maxLength', step: '1' },
            ] as const
          ).map((range) => (
            <fieldset key={range.title}>
              <legend className="mb-2 text-xs text-muted">{range.title}</legend>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  step={range.step}
                  aria-label={`Minimum ${range.title}`}
                  placeholder="Min"
                  value={filters[range.min]}
                  onChange={(event) => updateFilter(range.min, event.target.value)}
                />
                <span className="text-muted">to</span>
                <input
                  type="number"
                  min="0"
                  step={range.step}
                  aria-label={`Maximum ${range.title}`}
                  placeholder="Max"
                  value={filters[range.max]}
                  onChange={(event) => updateFilter(range.max, event.target.value)}
                />
              </div>
            </fieldset>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2"
          onClick={() => {
            setFilters({
              stage: '',
              category: '',
              status: '',
              skillset: '',
              author: '',
              mapper: '',
              review: '',
              minStars: '',
              maxStars: '',
              minBpm: '',
              maxBpm: '',
              minLength: '',
              maxLength: '',
            });
            setSearch('');
            setSelected([]);
            lastSelected.current = null;
          }}
        >
          <X size={13} />
          Clear filters
        </Button>
      </details>
      {manage && selectedRows.length > 0 && (
        <div
          className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-card px-3 py-2"
          role="region"
          aria-label="Selected suggestions"
        >
          <span className="text-sm font-medium">{selectedRows.length} visible selected</span>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || selectedRows.length > 100}
            onClick={() => setBulkTargets([...selectedRows])}
          >
            <Pencil size={14} />
            Bulk edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSelected([]);
              lastSelected.current = null;
            }}
          >
            <X size={14} />
            Clear
          </Button>
          {selectedRows.length > 100 && (
            <span className="text-xs text-amber-400">Select up to 100 suggestions per update.</span>
          )}
        </div>
      )}
      {visible.length ? (
        <div className="max-h-[70dvh] overflow-auto rounded-lg border">
          <table className="w-full min-w-[900px] table-fixed text-left text-xs">
            <colgroup>
              {manage && <col className="w-10" />}
              <col className="w-[31%]" />
              <col className="w-[17%]" />
              <col className="w-[13%]" />
              <col className="w-[16%]" />
              <col className="w-[15%]" />
              <col className="w-24" />
            </colgroup>
            <thead className="sticky top-0 z-[1] bg-card text-muted">
              <tr>
                {manage && (
                  <th className="p-2">
                    <input
                      type="checkbox"
                      aria-label={`Select all ${visible.length} visible suggestions`}
                      checked={allSelected}
                      onChange={(event) => {
                        setSelected(
                          event.target.checked ? visible.map((candidate) => candidate.id) : [],
                        );
                        lastSelected.current = null;
                      }}
                    />
                  </th>
                )}
                <th className="px-3 py-3 font-medium">Beatmap</th>
                <th className="px-2 py-3 font-medium">Stage / mod</th>
                <th className="px-2 py-3 font-medium">Status</th>
                <th className="px-2 py-3 font-medium">Skillsets</th>
                <th className="px-2 py-3 font-medium">Completed reviews</th>
                <th className="px-2 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {visible.map((candidate) => {
                const map = candidate.metadata,
                  summary = reviewSummary(candidate),
                  warning = warningFor(data, candidate);
                const mine = candidate.reviews.find((entry) => entry.reviewerId === actor.id);
                return (
                  <tr
                    key={candidate.id}
                    className={
                      selectedRows.some((row) => row.id === candidate.id)
                        ? 'bg-primary/5'
                        : 'hover:bg-[var(--surface-hover)]'
                    }
                  >
                    {manage && (
                      <td className="p-2 align-middle">
                        <input
                          type="checkbox"
                          aria-label={`Select ${map.title}`}
                          checked={selectedRows.some((row) => row.id === candidate.id)}
                          onChange={(event) =>
                            selectRow(
                              candidate,
                              event.target.checked,
                              (event.nativeEvent as MouseEvent).shiftKey,
                            )
                          }
                        />
                      </td>
                    )}
                    <td className="min-w-0 px-3 py-2">
                      <button
                        className="block max-w-full truncate text-left text-sm font-medium hover:text-primary"
                        onClick={() => setDetail(candidate)}
                        title={`${map.artist} - ${map.title} [${map.difficulty}]`}
                      >
                        {map.artist} - {map.title}
                      </button>
                      <div className="truncate text-muted" title={map.difficulty}>
                        [{map.difficulty}]
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                        <span>{map.stars.toFixed(2)} stars</span>
                        <span>{map.bpm} BPM</span>
                        <span>{duration(map.length)}</span>
                        {warning && (
                          <span
                            title={warning.reason}
                            className={
                              warning.severity === 'BANNED'
                                ? 'inline-flex items-center gap-1 text-red-400'
                                : 'inline-flex items-center gap-1 text-amber-400'
                            }
                          >
                            <ShieldAlert size={12} />
                            {warning.severity === 'BANNED' ? 'Artist ban' : 'Warning'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      {manage ? (
                        <div className="space-y-1">
                          <select
                            aria-label={`Stage for ${map.title}`}
                            className="!min-h-8 !py-1 !text-xs"
                            value={candidate.stageId || ''}
                            disabled={busy}
                            onChange={(event) =>
                              quickChange(candidate, { stageId: event.target.value || null })
                            }
                          >
                            <option value="">No stage</option>
                            {data.stages.map((stage) => (
                              <option key={stage.id} value={stage.id}>
                                {stage.name}
                              </option>
                            ))}
                          </select>
                          <select
                            aria-label={`Category for ${map.title}`}
                            className="!min-h-8 !py-1 !text-xs"
                            value={candidate.category}
                            disabled={busy}
                            onChange={(event) =>
                              quickChange(candidate, { category: event.target.value })
                            }
                          >
                            {data.categories.map((category) => (
                              <option key={category.acronym} value={category.acronym}>
                                {category.acronym}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <p className="truncate">
                            {data.stages.find((stage) => stage.id === candidate.stageId)?.name ||
                              'No stage'}
                          </p>
                          <span>{candidate.category}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {manage && candidate.status !== 'SELECTED' ? (
                        <select
                          aria-label={`Status for ${map.title}`}
                          className="!min-h-9 !py-1 !text-xs"
                          disabled={busy}
                          value={candidate.status}
                          onChange={(event) =>
                            quickChange(candidate, {
                              status: event.target.value as BulkPatch['status'],
                            })
                          }
                        >
                          {editableStatuses.map((status) => (
                            <option key={status} value={status}>
                              {label(status)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <CandidateStatus status={candidate.status} />
                      )}
                      {candidate.selectedSlot && (
                        <p className="mt-1 text-muted">{candidate.selectedSlot}</p>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="line-clamp-3 leading-5">
                        {candidate.tags.map((tag) => (
                          <span
                            key={tag.skillsetId}
                            className={
                              tag.primary ? 'mr-2 font-medium text-primary' : 'mr-2 text-muted'
                            }
                          >
                            {data.skillsets.find((skillset) => skillset.id === tag.skillsetId)
                              ?.name || 'Unknown skillset'}
                            {!tag.primary && ' (secondary)'}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <button
                        className="text-left hover:text-primary"
                        onClick={() => setDetail(candidate)}
                      >
                        <span className="block">
                          {summary.completed.length}/{candidate.reviews.length} complete
                        </span>
                        {summary.completed.length > 0 && (
                          <span className="block text-muted">
                            Fit {summary.fit}/5 · Difficulty {summary.difficulty}/5
                          </span>
                        )}
                      </button>
                      {candidate.reviews.some((entry) => entry.completed && entry.flags) && (
                        <p
                          className="mt-1 truncate text-amber-400"
                          title={summary.completed
                            .filter((entry) => entry.flags)
                            .map((entry) => `${entry.reviewer.username}: ${entry.flags}`)
                            .join('; ')}
                        >
                          Flagged feedback
                        </p>
                      )}
                      {mine && (
                        <span className="block text-muted">
                          Yours: {mine.completed ? 'complete' : 'pending'}
                        </span>
                      )}
                    </td>
                    <td className="px-1 py-2">
                      <div className="flex flex-wrap">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Details for ${map.title}`}
                          title="Map details and reviews"
                          onClick={() => setDetail(candidate)}
                        >
                          <Info size={15} />
                        </Button>
                        {(manage || !!mine) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Review ${map.title}`}
                            title={mine?.completed ? 'Edit your review' : 'Add your review'}
                            onClick={() => setReview(candidate)}
                          >
                            <FlaskConical size={15} />
                          </Button>
                        )}
                        {manage && ['ACCEPTED', 'SELECTED'].includes(candidate.status) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Select ${map.title} into pool`}
                            title="Select into stage draft"
                            onClick={() => setSelect(candidate)}
                          >
                            <Check size={15} />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border px-5 py-12 text-center">
          <FlaskConical size={24} className="mx-auto mb-3 text-muted" />
          <p className="text-sm font-medium">
            {data.candidates.length ? 'No suggestions match this view.' : 'No suggestions yet.'}
          </p>
          {view === 'mine' && (
            <p className="mt-2 text-xs text-muted">
              No playtesting assignments match the current filters.
            </p>
          )}
        </div>
      )}
      {suggestOpen && (
        <SuggestDialog
          data={data}
          busy={busy}
          lookupAllowed={manage}
          mutate={mutate}
          notify={notify}
          onClose={() => setSuggestOpen(false)}
        />
      )}
      {bulkTargets && (
        <BulkDialog
          candidates={bulkTargets}
          data={data}
          busy={busy}
          mutate={mutate}
          onClose={() => setBulkTargets(null)}
          onSaved={() => {
            setBulkTargets(null);
            setSelected([]);
          }}
        />
      )}
      {detail && (
        <CandidateDialog
          candidate={detail}
          data={data}
          actor={actor}
          busy={busy}
          mutate={mutate}
          onClose={() => setDetail(null)}
          onReview={() => {
            setReview(detail);
            setDetail(null);
          }}
          onSelect={() => {
            setSelect(detail);
            setDetail(null);
          }}
        />
      )}
      {review && (
        <ReviewDialog
          key={review.id}
          candidate={review}
          actor={actor}
          busy={busy}
          mutate={mutate}
          onClose={() => setReview(null)}
        />
      )}
      {select && (
        <SelectDialog
          key={select.id}
          candidate={select}
          data={data}
          busy={busy}
          mutate={mutate}
          onClose={() => setSelect(null)}
        />
      )}
      {configuration && (
        <ConfigurationDialog
          data={data}
          section={configuration}
          setSection={setConfiguration}
          busy={busy}
          mutate={mutate}
          onClose={() => setConfiguration(null)}
        />
      )}
    </div>
  );
}

function SuggestDialog({
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
        notify(`${parsed.length - ids.length} repeated IDs removed from the preview.`);
    } catch (error) {
      if (request === generation.current) setPreviewError((error as Error).message);
    } finally {
      if (request === generation.current) setLooking(false);
    }
  };
  const newMaps = preview?.filter((row) => !row.existing && !row.error) || [];
  return (
    <Modal
      open
      title="Suggest maps"
      wide
      onOpenChange={() => {
        if (!busy) onClose();
      }}
    >
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
            <Field label="Beatmap IDs or URLs" hint="One per line">
              <textarea
                required
                rows={6}
                maxLength={30000}
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                  resetPreview();
                }}
                placeholder={'123456\nhttps://osu.ppy.sh/beatmaps/234567'}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Suggested stage">
                <select value={stageId} onChange={(event) => setStageId(event.target.value)}>
                  <option value="">No stage yet</option>
                  {data.stages.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Mod category">
                <select
                  required
                  value={category}
                  onChange={(event) => {
                    setCategory(event.target.value);
                    resetPreview();
                  }}
                >
                  <option value="" disabled>
                    Choose a category
                  </option>
                  {data.categories.map((mod) => (
                    <option key={mod.acronym} value={mod.acronym}>
                      {mod.acronym} - {mod.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Pooler notes">
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
          {looking ? 'Looking up maps...' : 'Preview suggestions'}
        </Button>
        {previewError && (
          <p role="alert" className="text-sm text-red-400">
            {previewError}
          </p>
        )}
        {preview && (
          <div className="space-y-2">
            <p className="text-sm">
              {newMaps.length} new · {preview.filter((row) => row.existing).length} already
              suggested · {preview.filter((row) => row.error).length} unavailable
            </p>
            <div className="max-h-64 divide-y overflow-y-auto rounded-lg border">
              {preview.map((row) => (
                <div key={row.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-xs">
                  <span className="font-mono">{row.id}</span>
                  <span className="min-w-0 flex-1 break-words">
                    {row.map
                      ? `${row.map.artist} - ${row.map.title} [${row.map.difficulty}]`
                      : 'Metadata retrieved when submitted'}
                  </span>
                  <span className={row.error ? 'text-red-400' : 'text-muted'}>
                    {row.existing
                      ? 'Already suggested - skipped'
                      : row.error || (row.map ? `${row.map.stars.toFixed(2)} stars` : 'Ready')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <SaveButton busy={busy} disabled={busy || !preview || !newMaps.length || looking}>
            Submit {newMaps.length || ''} suggestions
          </SaveButton>
        </div>
      </form>
    </Modal>
  );
}

function BulkDialog({
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
      aria-label={`Change ${field}`}
      checked={enabled[field]}
      onChange={(event) => setEnabled({ ...enabled, [field]: event.target.checked })}
    />
  );
  const changes = Object.values(enabled).filter(Boolean).length;
  return (
    <Modal
      open
      title={`Edit ${candidates.length} suggestions`}
      wide
      onOpenChange={() => {
        if (!busy) onClose();
      }}
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
              {toggle('stage')}Change stage
              {mixed('stageId') && <span className="text-xs text-muted">Mixed</span>}
            </label>
            <select
              aria-label="Destination stage"
              disabled={!enabled.stage}
              value={stageId}
              onChange={(event) => setStageId(event.target.value)}
            >
              <option value="">No stage</option>
              {data.stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              {toggle('category')}Change category
              {mixed('category') && <span className="text-xs text-muted">Mixed</span>}
            </label>
            <select
              aria-label="New mod category"
              required={enabled.category}
              disabled={!enabled.category}
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="" disabled>
                Choose category
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
              {toggle('status')}Change status
              {mixed('status') && <span className="text-xs text-muted">Mixed</span>}
            </label>
            <select
              aria-label="New suggestion status"
              required={enabled.status}
              disabled={!enabled.status}
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="" disabled>
                Choose status
              </option>
              {editableStatuses.map((value) => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              {toggle('tags')}Replace skillset tags
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
              {toggle('reviewers')}Assign additional playtesters
            </label>
            <fieldset
              disabled={!enabled.reviewers}
              className="max-h-52 space-y-2 overflow-y-auto rounded-lg border p-3"
            >
              <legend className="sr-only">Playtesters</legend>
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
                <p className="text-xs text-muted">No eligible playtesters.</p>
              )}
            </fieldset>
          </div>
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            {toggle('notes')}Replace pooler notes
            {mixed('notes') && <span className="text-xs text-muted">Mixed</span>}
          </label>
          <textarea
            aria-label="New pooler notes"
            disabled={!enabled.notes}
            maxLength={4000}
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
        <details>
          <summary className="cursor-pointer text-sm text-muted">
            Review {candidates.length} selected maps
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
          {changes} fields selected for update
          {enabled.tags ? ' · Existing skillset tags will be replaced' : ''}
          {enabled.notes ? ' · Existing pooler notes will be replaced' : ''}
          {enabled.reviewers ? ' · Existing reviews and assignments will be kept' : ''}.
        </p>
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <SaveButton
            busy={busy}
            disabled={busy || !changes || (enabled.reviewers && !reviewers.length)}
          >
            Apply to {candidates.length} suggestions
          </SaveButton>
        </div>
      </form>
    </Modal>
  );
}

function MapHeading({ candidate }: { candidate: Candidate }) {
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
          [{map.difficulty}] · mapped by {map.mapper}
        </p>
        <p className="mt-1 text-xs text-muted">
          {map.stars.toFixed(2)} stars · {map.bpm} BPM · {duration(map.length)} · #
          {candidate.beatmapId}
        </p>
      </div>
    </div>
  );
}

function CandidateDialog({
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
  const [notes, setNotes] = useState(candidate.notes);
  const manage = can(actor, 'mappools.edit'),
    summary = reviewSummary(candidate),
    warning = warningFor(data, candidate);
  return (
    <Modal
      open
      title="Suggestion details"
      wide
      onOpenChange={() => {
        if (!busy) onClose();
      }}
    >
      <div className="space-y-4">
        <MapHeading candidate={candidate} />
        <div className="flex flex-wrap gap-3 text-xs">
          <CandidateStatus status={candidate.status} />
          <span>
            {data.stages.find((stage) => stage.id === candidate.stageId)?.name || 'No stage'} ·{' '}
            {candidate.category}
            {candidate.selectedSlot && ` · ${candidate.selectedSlot}`}
          </span>
          <span className="text-muted">
            Suggested by {candidate.submitter?.username || 'Removed user'}
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
          <Field label="Pooler notes">
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
              Save notes
            </SaveButton>
          )}
        </form>
        <section className="border-t pt-4">
          <h3 className="text-sm font-semibold">Playtesting feedback</h3>
          <p className="mt-1 text-xs text-muted">
            {summary.completed.length}/{candidate.reviews.length} complete
            {summary.completed.length > 0 &&
              ` · Pool fit ${summary.fit}/5 · Difficulty ${summary.difficulty}/5`}
          </p>
          <div className="mt-3 divide-y">
            {candidate.reviews.length ? (
              candidate.reviews.map((entry) => (
                <div key={entry.id} className="space-y-1 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-medium">{entry.reviewer.username}</span>
                    <span className="text-xs text-muted">
                      {entry.completed
                        ? `Fit ${entry.fit ?? '-'}/5 · Difficulty ${entry.difficulty ?? '-'}/5`
                        : 'Awaiting feedback'}
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
              <p className="py-3 text-xs text-muted">No playtesters assigned.</p>
            )}
          </div>
        </section>
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {(manage || candidate.reviews.some((entry) => entry.reviewerId === actor.id)) && (
            <Button variant="outline" disabled={busy} onClick={onReview}>
              <FlaskConical size={14} />
              Your review
            </Button>
          )}
          {manage && ['ACCEPTED', 'SELECTED'].includes(candidate.status) && (
            <Button disabled={busy} onClick={onSelect}>
              <Check size={14} />
              Select into draft
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ReviewDialog({
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
  const existing = candidate.reviews.find((entry) => entry.reviewerId === actor.id);
  const [fit, setFit] = useState(existing?.fit?.toString() || ''),
    [difficulty, setDifficulty] = useState(existing?.difficulty?.toString() || '');
  const [flags, setFlags] = useState(existing?.flags || ''),
    [notes, setNotes] = useState(existing?.notes || '');
  return (
    <Modal
      open
      title={existing?.completed ? 'Edit your playtest feedback' : 'Playtest feedback'}
      onOpenChange={() => {
        if (!busy) onClose();
      }}
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
        <p className="text-xs text-muted">Review by {actor.username}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pool fit">
            <select required value={fit} onChange={(event) => setFit(event.target.value)}>
              <option value="" disabled>
                Choose rating
              </option>
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value} / 5{value === 1 ? ' - Poor fit' : value === 5 ? ' - Excellent fit' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Difficulty">
            <select
              required
              value={difficulty}
              onChange={(event) => setDifficulty(event.target.value)}
            >
              <option value="" disabled>
                Choose rating
              </option>
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value} / 5
                  {value === 1
                    ? ' - Too easy'
                    : value === 3
                      ? ' - On target'
                      : value === 5
                        ? ' - Too hard'
                        : ''}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Problem flags">
          <input
            maxLength={1000}
            placeholder="Timing, exploit, difficulty spike..."
            value={flags}
            onChange={(event) => setFlags(event.target.value)}
          />
        </Field>
        <Field label="Feedback / suggested replacements">
          <textarea
            rows={5}
            maxLength={4000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <SaveButton busy={busy}>Save completed review</SaveButton>
        </div>
      </form>
    </Modal>
  );
}

function ArtistWarning({ warning }: { warning: Warning }) {
  return (
    <div
      className={`rounded-lg border p-3 ${warning.severity === 'BANNED' ? 'border-red-400/40' : 'border-amber-400/40'}`}
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        <ShieldAlert size={16} />
        {warning.severity === 'BANNED' ? 'Tournament artist ban' : 'Artist warning'}:{' '}
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
          Warning source
          <ArrowUpRight size={12} />
        </a>
      )}
    </div>
  );
}

function SelectDialog({
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
  return (
    <Modal
      open
      title="Select into stage draft"
      onOpenChange={() => {
        if (!busy) onClose();
      }}
    >
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
          <Field label="Destination stage">
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
                Choose stage
              </option>
              {data.stages.map((entry) => (
                <option key={entry.id} value={entry.id} disabled={!entry.pool}>
                  {entry.name}
                  {!entry.pool ? ' (no pool)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Destination slot (${candidate.category})`}>
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
              ? 'Updates the existing draft.'
              : stage.pool?.publishedRevisionId
                ? 'Creates a new draft from the published pool.'
                : 'Creates the first pool draft.'}{' '}
            Public maps change only after publishing.
          </p>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={replace}
            onChange={(event) => setReplace(event.target.checked)}
          />
          <span>Replace the beatmap if this destination slot is already filled.</span>
        </label>
        {warning && <ArtistWarning warning={warning} />}
        {warning?.severity === 'BANNED' && (
          <Field
            label="Artist ban resolution"
            hint="Required for this selection and recorded for publishing checks."
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
            Create a stage mappool before selecting a suggestion.
          </p>
        )}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <SaveButton busy={busy} disabled={busy || !stage?.pool}>
            Select into draft
          </SaveButton>
        </div>
      </form>
    </Modal>
  );
}

function ConfigurationDialog({
  data,
  section,
  setSection,
  busy,
  mutate,
  onClose,
}: {
  data: PoolingData;
  section: 'skillsets' | 'warnings';
  setSection: (value: 'skillsets' | 'warnings') => void;
  busy: boolean;
  mutate: Mutate;
  onClose: () => void;
}) {
  const [skillset, setSkillset] = useState<{ id?: string; name: string; group: string }>({
    name: '',
    group: '',
  });
  const [warning, setWarning] = useState<{
    id?: string;
    artist: string;
    severity: 'WARN' | 'BANNED';
    reason: string;
    source: string;
  }>({ artist: '', severity: 'WARN', reason: '', source: '' });
  return (
    <Modal
      open
      title="Pooling configuration"
      wide
      onOpenChange={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="flex gap-2 border-b pb-3"
        role="group"
        aria-label="Pooling configuration section"
      >
        <Button
          variant={section === 'skillsets' ? 'default' : 'ghost'}
          size="sm"
          aria-pressed={section === 'skillsets'}
          onClick={() => setSection('skillsets')}
        >
          <Tags size={14} />
          Skillsets
        </Button>
        <Button
          variant={section === 'warnings' ? 'default' : 'ghost'}
          size="sm"
          aria-pressed={section === 'warnings'}
          onClick={() => setSection('warnings')}
        >
          <ShieldAlert size={14} />
          Artist warnings
        </Button>
      </div>
      {section === 'skillsets' ? (
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <div className="max-h-96 divide-y overflow-y-auto">
            {data.skillsets.length ? (
              data.skillsets.map((entry) => (
                <div key={entry.id} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm">{entry.name}</p>
                    <p className="text-xs text-muted">{entry.group || 'No group'}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={`Edit ${entry.name}`}
                    aria-label={`Edit ${entry.name}`}
                    disabled={busy}
                    onClick={() =>
                      setSkillset({ id: entry.id, name: entry.name, group: entry.group })
                    }
                  >
                    <Pencil size={14} />
                  </Button>
                  <ConfirmButton
                    title={`Delete skillset ${entry.name}?`}
                    description="Skillsets currently used on suggestions must be removed from those suggestions first."
                    disabled={busy}
                    onConfirm={() =>
                      mutate(
                        { type: 'pooling.skillset.delete', id: entry.id },
                        'Skillset deleted.',
                        () => {
                          if (skillset.id === entry.id) setSkillset({ name: '', group: '' });
                        },
                      )
                    }
                  >
                    <Trash2 size={14} />
                  </ConfirmButton>
                </div>
              ))
            ) : (
              <p className="py-3 text-sm text-muted">No custom skillsets yet.</p>
            )}
          </div>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              mutate({ type: 'pooling.skillset.save', ...skillset }, 'Skillset saved.', () =>
                setSkillset({ name: '', group: '' }),
              );
            }}
          >
            <h3 className="text-sm font-semibold">
              {skillset.id ? 'Edit skillset' : 'Add skillset'}
            </h3>
            <Field label="Name">
              <input
                required
                maxLength={80}
                value={skillset.name}
                onChange={(event) => setSkillset({ ...skillset, name: event.target.value })}
              />
            </Field>
            <Field label="Group">
              <input
                maxLength={80}
                value={skillset.group}
                onChange={(event) => setSkillset({ ...skillset, group: event.target.value })}
              />
            </Field>
            <div className="flex gap-2">
              <SaveButton busy={busy}>Save skillset</SaveButton>
              {skillset.id && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setSkillset({ name: '', group: '' })}
                >
                  Cancel edit
                </Button>
              )}
            </div>
          </form>
        </div>
      ) : (
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <div className="max-h-[32rem] divide-y overflow-y-auto">
            {data.warnings.length ? (
              data.warnings.map((entry) => (
                <div key={entry.id} className="py-3">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-medium">{entry.artist}</p>
                      <span
                        className={`text-xs ${entry.severity === 'BANNED' ? 'text-red-400' : 'text-amber-400'}`}
                      >
                        {entry.severity === 'BANNED' ? 'Banned' : 'Warning'}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={`Edit warning for ${entry.artist}`}
                      aria-label={`Edit warning for ${entry.artist}`}
                      disabled={busy}
                      onClick={() =>
                        setWarning({
                          id: entry.id,
                          artist: entry.artist,
                          severity: entry.severity as 'WARN' | 'BANNED',
                          reason: entry.reason,
                          source: entry.source,
                        })
                      }
                    >
                      <Pencil size={14} />
                    </Button>
                    <ConfirmButton
                      title={`Delete warning for ${entry.artist}?`}
                      description="This removes the tournament warning and its publication restriction."
                      disabled={busy}
                      onConfirm={() =>
                        mutate(
                          { type: 'pooling.warning.delete', id: entry.id },
                          'Artist warning deleted.',
                          () => {
                            if (warning.id === entry.id)
                              setWarning({ artist: '', severity: 'WARN', reason: '', source: '' });
                          },
                        )
                      }
                    >
                      <Trash2 size={14} />
                    </ConfirmButton>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted">
                    {entry.reason}
                  </p>
                </div>
              ))
            ) : (
              <p className="py-3 text-sm text-muted">No tournament artist warnings.</p>
            )}
          </div>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              mutate({ type: 'pooling.warning.save', ...warning }, 'Artist warning saved.', () =>
                setWarning({ artist: '', severity: 'WARN', reason: '', source: '' }),
              );
            }}
          >
            <h3 className="text-sm font-semibold">
              {warning.id ? 'Edit artist warning' : 'Add artist warning'}
            </h3>
            <Field label="Artist">
              <input
                required
                maxLength={200}
                value={warning.artist}
                onChange={(event) => setWarning({ ...warning, artist: event.target.value })}
              />
            </Field>
            <Field label="Severity">
              <select
                value={warning.severity}
                onChange={(event) =>
                  setWarning({ ...warning, severity: event.target.value as 'WARN' | 'BANNED' })
                }
              >
                <option value="WARN">Warning</option>
                <option value="BANNED">Banned - requires resolution</option>
              </select>
            </Field>
            <Field label="Reason">
              <textarea
                required
                maxLength={2000}
                rows={3}
                value={warning.reason}
                onChange={(event) => setWarning({ ...warning, reason: event.target.value })}
              />
            </Field>
            <Field label="Source URL (optional)">
              <input
                type="url"
                maxLength={2048}
                value={warning.source}
                onChange={(event) => setWarning({ ...warning, source: event.target.value })}
              />
            </Field>
            <div className="flex gap-2">
              <SaveButton busy={busy}>Save warning</SaveButton>
              {warning.id && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    setWarning({ artist: '', severity: 'WARN', reason: '', source: '' })
                  }
                >
                  Cancel edit
                </Button>
              )}
            </div>
          </form>
        </div>
      )}
    </Modal>
  );
}
