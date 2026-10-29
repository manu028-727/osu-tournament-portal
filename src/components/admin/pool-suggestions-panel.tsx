'use client';
import { useState } from 'react';
import { useLocale, useT } from '@/components/locale';
import { formatNumber, humanizeCode } from '@/lib/i18n';
import type { PoolCandidateView, PoolingData } from '@/lib/pooling-types';
import { duration } from '@/lib/utils';
import { Button } from '../ui/button';
import { action, Field, LoadingState, useResource, useTask } from './shared';
import { CandidateStatus, reviewSummary, statuses, warningFor } from './pooling-display';

export function PoolSuggestionsPanel({
  stageId,
  slots,
  editable,
  busy,
  dirty,
  onAssign,
}: {
  stageId: string;
  slots: { name: string; category: string; beatmapId: number }[];
  editable: boolean;
  busy: boolean;
  dirty: boolean;
  onAssign: (
    candidate: PoolCandidateView,
    slot: string,
    replace: boolean,
    resolution: string,
  ) => Promise<boolean>;
}) {
  const tr = useT(),
    language = useLocale();
  const { data, error, reload } = useResource<PoolingData>('pooling');
  const task = useTask();
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState(''),
    [status, setStatus] = useState('');
  const [skillset, setSkillset] = useState(''),
    [allStages, setAllStages] = useState(false);
  const [selected, setSelected] = useState<string | null>(null),
    [slot, setSlot] = useState('');
  const [replace, setReplace] = useState(false),
    [resolution, setResolution] = useState('');
  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  const filtered = data.candidates.filter(
    (candidate) =>
      (allStages || !candidate.stageId || candidate.stageId === stageId) &&
      (!category || candidate.category === category) &&
      (!status || candidate.status === status) &&
      (!skillset || candidate.tags.some((tag) => tag.skillsetId === skillset)) &&
      `${candidate.beatmapId} ${candidate.metadata.artist} ${candidate.metadata.title} ${candidate.metadata.mapper} ${candidate.notes}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const open = (candidate: PoolCandidateView) => {
    setSelected(selected === candidate.id ? null : candidate.id);
    setReplace(false);
    setResolution('');
    const empty = slots.find((row) => row.category === candidate.category && !row.beatmapId);
    let number = 1;
    while (slots.some((row) => row.name === `${candidate.category}${number}`)) number++;
    setSlot(empty?.name || `${candidate.category}${number}`);
  };
  return (
    <section
      aria-label={tr('Mappool suggestions')}
      className="my-4 min-w-0 space-y-3 rounded-2xl border border-[var(--accent-border)] bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{tr('Suggestions')}</h3>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || task.busy}
          onClick={() => void task.run(reload, tr('Suggestions refreshed.'))}
        >
          {tr('Refresh')}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label={tr('Search suggestions')}>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        <Field label={tr('Category')}>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">{tr('All categories')}</option>
            {data.categories.map((cat) => (
              <option key={cat.acronym} value={cat.acronym}>
                {cat.acronym}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr('Suggestion status')}>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{tr('All statuses')}</option>
            {statuses.map((value) => (
              <option key={value} value={value}>
                {tr(humanizeCode(value))}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr('Skillset')}>
          <select value={skillset} onChange={(e) => setSkillset(e.target.value)}>
            <option value="">{tr('All skillsets')}</option>
            {data.skillsets.map((value) => (
              <option key={value.id} value={value.id}>
                {value.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={allStages}
          onChange={(e) => setAllStages(e.target.checked)}
        />
        {tr('Include suggestions from other stages')}
      </label>
      <p className="text-xs text-muted">
        {tr('{0} suggestions', filtered.length)}
        {dirty ? ` · ${tr('Assigning a suggestion also saves your current pool edits.')}` : ''}
      </p>
      <div className="max-h-[34rem] space-y-2 overflow-y-auto pr-1">
        {filtered.map((candidate) => {
          const map = candidate.metadata,
            review = reviewSummary(candidate, language),
            warning = warningFor(data, candidate);
          return (
            <article
              key={candidate.id}
              className="min-w-0 rounded-xl border p-3 [overflow-wrap:anywhere]"
            >
              <button
                type="button"
                disabled={busy || task.busy}
                className="flex min-h-11 w-full min-w-0 items-center gap-3 text-left"
                aria-expanded={selected === candidate.id}
                onClick={() => open(candidate)}
              >
                {map.cover && (
                  <img
                    src={map.cover}
                    alt=""
                    className="size-12 shrink-0 rounded-lg object-cover"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">
                    {map.artist} - {map.title}
                  </span>
                  <span className="block text-xs text-muted">
                    [{map.difficulty}] · {candidate.category} ·{' '}
                    {formatNumber(map.stars, language, 2)} · #{candidate.beatmapId}
                  </span>
                </span>
                <CandidateStatus status={candidate.status} />
              </button>
              {selected === candidate.id && (
                <div className="mt-3 space-y-3 border-t pt-3">
                  <p className="text-xs text-muted">
                    {map.mapper} · {map.bpm} BPM · {duration(map.length)} · AR {map.ar} · CS{' '}
                    {map.cs} · OD {map.od} · HP {map.hp}
                  </p>
                  {candidate.notes && (
                    <p className="whitespace-pre-wrap text-sm">{candidate.notes}</p>
                  )}
                  <p className="text-xs text-muted">
                    {tr('Playtesting feedback')}: {review.completed.length}/
                    {candidate.reviews.length} · {tr('Pool fit')} {review.fit}/5 ·{' '}
                    {tr('Difficulty')} {review.difficulty}/5
                  </p>
                  {candidate.reviews
                    .filter((row) => row.completed)
                    .map((row) => (
                      <p key={row.id} className="text-xs text-muted">
                        {row.reviewer.username}: {row.notes}
                      </p>
                    ))}
                  {warning && (
                    <p className="text-sm text-amber-200">
                      {warning.artist}: {warning.reason}
                    </p>
                  )}
                  <a
                    className="text-xs text-primary"
                    href={`https://osu.ppy.sh/beatmaps/${candidate.beatmapId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {tr('Open beatmap')}
                  </a>
                  {editable && (
                    <div className="space-y-2">
                      {['ACCEPTED', 'SELECTED'].includes(candidate.status) ? (
                        <>
                          <Field label={tr('Destination slot')}>
                            <input
                              maxLength={20}
                              list={`suggestion-slots-${candidate.id}`}
                              value={slot}
                              onChange={(e) => setSlot(e.target.value)}
                            />
                          </Field>
                          <datalist id={`suggestion-slots-${candidate.id}`}>
                            {slots
                              .filter((row) => row.category === candidate.category)
                              .map((row) => (
                                <option key={row.name} value={row.name} />
                              ))}
                          </datalist>
                          {slots.some((row) => row.name === slot && row.beatmapId > 0) && (
                            <label className="flex min-h-11 items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={replace}
                                onChange={(e) => setReplace(e.target.checked)}
                              />
                              {tr('Replace the current map in this slot')}
                            </label>
                          )}
                          {warning?.severity === 'BANNED' && (
                            <Field label={tr('Artist warning resolution')}>
                              <input
                                value={resolution}
                                maxLength={2000}
                                onChange={(e) => setResolution(e.target.value)}
                              />
                            </Field>
                          )}
                          <Button
                            size="sm"
                            disabled={
                              busy ||
                              task.busy ||
                              !slot ||
                              (slots.some((row) => row.name === slot && row.beatmapId > 0) &&
                                !replace) ||
                              (warning?.severity === 'BANNED' && resolution.trim().length < 3)
                            }
                            onClick={() =>
                              void onAssign(candidate, slot, replace, resolution).then(
                                (assigned) => {
                                  if (assigned) void reload().catch(() => {});
                                },
                              )
                            }
                          >
                            {tr('Assign to {0}', slot)}
                          </Button>
                        </>
                      ) : (
                        candidate.status !== 'REJECTED' && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy || task.busy}
                            onClick={() =>
                              void task.run(async () => {
                                await action({
                                  type: 'pooling.bulk',
                                  candidates: [
                                    { id: candidate.id, baseVersion: candidate.version },
                                  ],
                                  patch: { status: 'ACCEPTED' },
                                });
                                await reload();
                              }, tr('Suggestion accepted.'))
                            }
                          >
                            {tr('Accept suggestion')}
                          </Button>
                        )
                      )}
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
        {!filtered.length && (
          <p className="py-6 text-center text-sm text-muted">
            {tr('No suggestions match this view.')}
          </p>
        )}
      </div>
    </section>
  );
}
