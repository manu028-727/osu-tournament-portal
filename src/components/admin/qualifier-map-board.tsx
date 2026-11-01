'use client';
import { useEffect, useState } from 'react';
import { useT, useLocale } from '@/components/locale';
import { localeTag } from '@/lib/i18n';
import type { QualifierView } from '@/lib/qualifiers-types';
import { qualifierProgress } from '@/lib/qualifier-progress';
import { MODS } from '@/lib/match-rules';
import { Button } from '../ui/button';
import { action, Field, useTask, useUnsaved } from './shared';
import styles from './qualifier-workflow.module.css';
import { qualifierDefaultMods } from '@/lib/qualifier-eligibility';

export function QualifierMapBoard({
  lobby,
  selected,
  onChanged,
  onDirty,
}: {
  lobby: QualifierView;
  selected: { run: number; slotName: string };
  onChanged: () => Promise<unknown>;
  onDirty: (dirty: boolean) => void;
}) {
  const tr = useT();
  const language = useLocale();
  const current = qualifierProgress(lobby).find(
    (item) => item.run === selected.run && item.slot.name === selected.slotName,
  )!;
  const [draft, setDraft] = useState<Record<string, { raw: string; mods: string[] }>>({});
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const { run, busy } = useTask();
  const dirty = Object.keys(draft).length > 0;
  useUnsaved(dirty);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const writable =
    lobby.access.score &&
    !lobby.deletedAt &&
    (lobby.status === 'IN_PROGRESS' || (lobby.status === 'COMPLETED' && lobby.autoCompleted));
  const edit = (osuId: number, value: Partial<{ raw: string; mods: string[] }>) => {
    if (baseVersion === null) setBaseVersion(lobby.version);
    const previous = lobby.scores.find(
      (score) =>
        score.osuId === osuId && score.slotName === selected.slotName && score.run === selected.run,
    );
    setDraft((values) => ({
      ...values,
      [osuId]: {
        ...(values[osuId] || {
          raw: previous ? String(previous.raw) : '',
          mods: previous?.mods || qualifierDefaultMods(lobby.rules, current.slot.category),
        }),
        ...value,
      },
    }));
  };
  return (
    <section
      className="space-y-3 rounded-xl border bg-card p-3"
      aria-label={tr('Shared qualifier map scores')}
    >
      <div className="flex flex-wrap justify-between gap-2">
        <h2 className="font-semibold">{tr('Run {0} · {1}', selected.run, selected.slotName)}</h2>
        <span className="text-xs text-muted">
          {tr(
            '{0}/{1} entrants complete',
            current.teams.filter((team) => team.complete).length,
            current.teams.length,
          )}
        </span>
      </div>
      <p className="text-xs text-muted">
        {tr(
          'Everyone plays this map together. Enter only observed scores; empty fields remain missing.',
        )}
      </p>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const scores = Object.entries(draft)
              .filter(([, score]) => score.raw !== '')
              .map(([osuId, score]) => ({
                osuId: Number(osuId),
                raw: Number(score.raw),
                mods: score.mods,
              }));
            if (!scores.length) return;
            await action({
              type: 'qualifier.scores',
              id: lobby.id,
              baseVersion: baseVersion ?? lobby.version,
              run: selected.run,
              slotName: selected.slotName,
              representation: lobby.gameplayScoring === 'LAZER' ? 'STANDARDIZED' : 'LEGACY',
              scores,
              reason: reason || 'Record shared qualifier map scores',
            });
            setDraft({});
            setBaseVersion(null);
            setReason('');
            await onChanged();
          }, 'Qualifier map scores saved.');
        }}
      >
        <fieldset disabled={busy || !writable} className="min-w-0 space-y-3">
          {current.teams.map(({ team, scores, complete, value }) => (
            <section key={team.id} className="space-y-1 border-t pt-2">
              <h3 className="text-sm font-semibold">
                {team.name}{' '}
                <span className="ml-2 font-normal text-muted">
                  {complete ? tr('Complete') : tr('Missing scores')} · {scores.length}/
                  {lobby.policy.requiredPlayers}
                  {value !== null
                    ? ` · ${tr('Team value')}: ${value.toLocaleString(localeTag(language))}`
                    : ''}
                </span>
              </h3>
              {team.members.map((player) => {
                const recorded = lobby.scores.find(
                    (score) =>
                      score.osuId === player.osuId &&
                      score.slotName === selected.slotName &&
                      score.run === selected.run,
                  ),
                  value = draft[player.osuId];
                return (
                  <div
                    key={player.osuId}
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(5.5rem,0.55fr)] items-center gap-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm">
                        {player.username}
                        {player.substitute ? ` · ${tr('Substitute')}` : ''}
                      </p>
                      <p className="text-xs text-muted">
                        #{player.osuId}
                        {recorded
                          ? ` · ${tr('Converted')}: ${recorded.adjusted.toLocaleString(localeTag(language))}`
                          : ` · ${tr('Not recorded')}`}
                      </p>
                      {recorded?.eligible === false && (
                        <p className="text-xs text-amber-200">
                          {tr('Excluded')}:{' '}
                          {tr(recorded.eligibilityReason || 'Score excluded by qualifier rules.')}
                        </p>
                      )}
                    </div>
                    <div className={styles.scoreInput}>
                      <Field label={tr('Score for {0}', player.username)}>
                        <input
                          type="number"
                          min={0}
                          max={1000000000000}
                          step={lobby.rules.scoreMode === 'ACCURACY' ? 'any' : 1}
                          inputMode="numeric"
                          value={value?.raw ?? (recorded ? String(recorded.raw) : '')}
                          placeholder={tr('Missing')}
                          onChange={(event) => edit(player.osuId, { raw: event.target.value })}
                        />
                      </Field>
                    </div>
                    {(lobby.rules.freeModCategories.includes(current.slot.category) ||
                      recorded?.eligible === false) && (
                      <details className="col-span-2">
                        <summary className="cursor-pointer text-xs">
                          {tr('Player mods')}:{' '}
                          {(value?.mods || recorded?.mods || []).join(' ') || tr('NM')}
                        </summary>
                        <div className="mt-2 flex flex-wrap gap-3">
                          {[...new Set([...MODS, ...(recorded?.mods || [])])].map((mod) => (
                            <label key={mod} className="flex items-center gap-1 text-xs">
                              <input
                                type="checkbox"
                                checked={(value?.mods || recorded?.mods || []).includes(mod)}
                                onChange={(event) => {
                                  const mods = value?.mods || recorded?.mods || [];
                                  edit(player.osuId, {
                                    mods: event.target.checked
                                      ? [...mods, mod]
                                      : mods.filter((item) => item !== mod),
                                  });
                                }}
                              />
                              {mod}
                            </label>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
          {writable && dirty && (
            <>
              <details>
                <summary className="cursor-pointer text-xs">
                  {tr('Correction note (optional)')}
                </summary>
                <Field label={tr('Correction note (optional)')}>
                  <input
                    maxLength={2000}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </Field>
              </details>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={!dirty || busy}>
                  {tr('Save map scores')}
                </Button>
                {dirty && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setDraft({});
                      setBaseVersion(null);
                    }}
                  >
                    {tr('Discard edits')}
                  </Button>
                )}
              </div>
            </>
          )}
        </fieldset>
      </form>
    </section>
  );
}
