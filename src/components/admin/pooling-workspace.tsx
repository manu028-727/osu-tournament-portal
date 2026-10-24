'use client';
import { formatNumber, humanizeCode } from '@/lib/i18n';
import { Feedback, useLocale, useT } from '@/components/locale';
import { useRef, useState } from 'react';
import {
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
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { can, type Actor } from '@/lib/permissions';
import type { PoolingData } from '@/lib/pooling-types';
import { action, Field, LoadingState, useResource, useTask } from './shared';
import {
  type Candidate,
  type BulkPatch,
  type Mutate,
  statuses,
  editableStatuses,
  reviewSummary,
  warningFor,
  CandidateStatus,
} from './pooling-display';
import { duration } from '@/lib/utils';
import { SuggestDialog, BulkDialog } from './pooling-suggestion-dialogs';
import { CandidateDialog, ReviewDialog, SelectDialog } from './pooling-review-dialogs';
import { ConfigurationDialog } from './pooling-configuration';

export function PoolingWorkspace({ actor }: { actor: Actor }) {
  const tr = useT();
  const language = useLocale();
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
        <h1 className="text-2xl font-semibold">{tr('Suggestions & playtesting')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            title={tr('Refresh suggestions')}
            aria-label={tr('Refresh suggestions')}
            disabled={busy}
            onClick={() => void run(reload, tr('Suggestions refreshed.'))}
          >
            <RefreshCw size={16} />
          </Button>
          {manage && (
            <Button variant="outline" size="sm" onClick={() => setConfiguration('skillsets')}>
              <Tags size={14} />
              {tr('Skillsets & warnings')}
            </Button>
          )}
          <Button size="sm" onClick={() => setSuggestOpen(true)}>
            <Plus size={14} />
            {tr('Suggest maps')}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="rounded-lg border border-red-400/40 p-3 text-sm text-red-400">
          <Feedback message={error} />
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border p-1" role="group" aria-label={tr('Suggestion view')}>
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
              {tr(item.title)}
            </Button>
          ))}
        </div>
        <div className="relative min-w-40 flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            aria-label={tr('Search suggestions')}
            placeholder={tr('Search maps, IDs or notes')}
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
          {tr(
            data.candidates.length === 1 ? '{0} of {1} suggestion' : '{0} of {1} suggestions',
            visible.length,
            data.candidates.length,
          )}
        </span>
      </div>
      <details className="rounded-lg border px-3 py-2">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
          <SlidersHorizontal size={14} />
          {tr('Filters')}
          {Object.values(filters).filter(Boolean).length
            ? ` (${Object.values(filters).filter(Boolean).length})`
            : ''}
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label={tr('Stage')}>
            <select
              value={filters.stage}
              onChange={(event) => updateFilter('stage', event.target.value)}
            >
              <option value="">{tr('All stages')}</option>
              <option value="unassigned">{tr('No stage')}</option>
              {data.stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tr('Mod category')}>
            <select
              value={filters.category}
              onChange={(event) => updateFilter('category', event.target.value)}
            >
              <option value="">{tr('All categories')}</option>
              {data.categories.map((category) => (
                <option key={category.acronym} value={category.acronym}>
                  {category.acronym} - {category.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tr('Status')}>
            <select
              value={filters.status}
              onChange={(event) => updateFilter('status', event.target.value)}
            >
              <option value="">{tr('All statuses')}</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {tr(humanizeCode(status))}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tr('Skillset')}>
            <select
              value={filters.skillset}
              onChange={(event) => updateFilter('skillset', event.target.value)}
            >
              <option value="">{tr('All skillsets')}</option>
              {data.skillsets.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tr('Suggested by')}>
            <select
              value={filters.author}
              onChange={(event) => updateFilter('author', event.target.value)}
            >
              <option value="">{tr('Anyone')}</option>
              {authors.map((author) => (
                <option key={author.id} value={author.id}>
                  {author.username}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tr('Mapper')}>
            <input
              value={filters.mapper}
              onChange={(event) => updateFilter('mapper', event.target.value)}
            />
          </Field>
          <Field label={tr('Reviews')}>
            <select
              value={filters.review}
              onChange={(event) => updateFilter('review', event.target.value)}
            >
              <option value="">{tr('Any review state')}</option>
              <option value="pending">{tr('Has pending reviews')}</option>
              <option value="completed">{tr('Has completed reviews')}</option>
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
              <legend className="mb-2 text-xs text-muted">{tr(range.title)}</legend>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  step={range.step}
                  aria-label={tr('Minimum {0}', tr(range.title))}
                  placeholder={tr('Min')}
                  value={filters[range.min]}
                  onChange={(event) => updateFilter(range.min, event.target.value)}
                />
                <span className="text-muted">{tr('to')}</span>
                <input
                  type="number"
                  min="0"
                  step={range.step}
                  aria-label={tr('Maximum {0}', tr(range.title))}
                  placeholder={tr('Max')}
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
          {tr('Clear filters')}
        </Button>
      </details>
      {manage && selectedRows.length > 0 && (
        <div
          className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-card px-3 py-2"
          role="region"
          aria-label={tr('Selected suggestions')}
        >
          <span className="text-sm font-medium">
            {selectedRows.length} {tr('visible selected')}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || selectedRows.length > 100}
            onClick={() => setBulkTargets([...selectedRows])}
          >
            <Pencil size={14} />
            {tr('Bulk edit')}
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
            {tr('Clear')}
          </Button>
          {selectedRows.length > 100 && (
            <span className="text-xs text-amber-400">
              {tr('Select up to 100 suggestions per update.')}
            </span>
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
                      aria-label={tr('Select all {0} visible suggestions', visible.length)}
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
                <th className="px-3 py-3 font-medium">{tr('Beatmap')}</th>
                <th className="px-2 py-3 font-medium">{tr('Stage / mod')}</th>
                <th className="px-2 py-3 font-medium">{tr('Status')}</th>
                <th className="px-2 py-3 font-medium">{tr('Skillsets')}</th>
                <th className="px-2 py-3 font-medium">{tr('Completed reviews')}</th>
                <th className="px-2 py-3 font-medium">{tr('Actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {visible.map((candidate) => {
                const map = candidate.metadata,
                  summary = reviewSummary(candidate, language),
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
                          aria-label={tr('Select {0}', map.title)}
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
                        <span>
                          {formatNumber(map.stars, language, 2)} {tr('stars')}
                        </span>
                        <span>
                          {map.bpm} {tr('BPM')}
                        </span>
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
                            {warning.severity === 'BANNED' ? tr('Artist ban') : tr('Warning')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      {manage ? (
                        <div className="space-y-1">
                          <select
                            aria-label={tr('Stage for {0}', map.title)}
                            className="!min-h-8 !py-1 !text-xs"
                            value={candidate.stageId || ''}
                            disabled={busy}
                            onChange={(event) =>
                              quickChange(candidate, { stageId: event.target.value || null })
                            }
                          >
                            <option value="">{tr('No stage')}</option>
                            {data.stages.map((stage) => (
                              <option key={stage.id} value={stage.id}>
                                {stage.name}
                              </option>
                            ))}
                          </select>
                          <select
                            aria-label={tr('Category for {0}', map.title)}
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
                              tr('No stage')}
                          </p>
                          <span>{candidate.category}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {manage && candidate.status !== 'SELECTED' ? (
                        <select
                          aria-label={tr('Status for {0}', map.title)}
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
                              {tr(humanizeCode(status))}
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
                              ?.name || tr('Unknown skillset')}
                            {!tag.primary && tr(' (secondary)')}
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
                          {summary.completed.length}/{candidate.reviews.length} {tr('complete')}
                        </span>
                        {summary.completed.length > 0 && (
                          <span className="block text-muted">
                            {tr('Fit')} {summary.fit}/5 · {tr('Difficulty')} {summary.difficulty}/5
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
                          {tr('Flagged feedback')}
                        </p>
                      )}
                      {mine && (
                        <span className="block text-muted">
                          {tr('Yours:')} {mine.completed ? tr('complete') : tr('pending')}
                        </span>
                      )}
                    </td>
                    <td className="px-1 py-2">
                      <div className="flex flex-wrap">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={tr('Details for {0}', map.title)}
                          title={tr('Map details and reviews')}
                          onClick={() => setDetail(candidate)}
                        >
                          <Info size={15} />
                        </Button>
                        {(manage || !!mine) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={tr('Review {0}', map.title)}
                            title={mine?.completed ? tr('Edit your review') : tr('Add your review')}
                            onClick={() => setReview(candidate)}
                          >
                            <FlaskConical size={15} />
                          </Button>
                        )}
                        {manage && ['ACCEPTED', 'SELECTED'].includes(candidate.status) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={tr('Select {0} into pool', map.title)}
                            title={tr('Select into stage draft')}
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
            {data.candidates.length
              ? tr('No suggestions match this view.')
              : tr('No suggestions yet.')}
          </p>
          {view === 'mine' && (
            <p className="mt-2 text-xs text-muted">
              {tr('No playtesting assignments match the current filters.')}
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
