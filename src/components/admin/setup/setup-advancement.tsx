'use client';
import { useState } from 'react';
import { useT } from '@/components/locale';
import Link from '@/components/tournament-scope';
import { Button } from '@/components/ui/button';
import type { AdvancementIssue, DrawnGroup } from '@/lib/format-advancement';
import type { SetupWorkspaceData } from '@/lib/setup-queries';
import { action, ConfirmButton, Field, SaveButton, useTask, useUnsaved } from '../shared';
import { FormationPanel } from './setup-formation';
import styles from './setup.module.css';

type PhaseStatus = NonNullable<SetupWorkspaceData['format']>['phases'][number];
type Preview = {
  phaseKey: string;
  seats: { seed: number; lane: string; teamId: string | null; detail: string }[];
  groups: DrawnGroup[];
  randomSeed: string | null;
  issues: AdvancementIssue[];
  changes: unknown[];
  candidates: { id: string; name: string }[];
  reviewHash: string;
};

function PhaseAdvancer({
  phase,
  reload,
  canEdit,
}: {
  phase: PhaseStatus;
  reload: () => Promise<unknown>;
  canEdit: boolean;
}) {
  const tr = useT();
  const { busy, run } = useTask();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reviewed, setReviewed] = useState('');
  const [randomSeed, setRandomSeed] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [reason, setReason] = useState('');
  const [explicit, setExplicit] = useState<Record<string, string[]>>({});
  const [manual, setManual] = useState<Record<string, string[][]>>({});
  const dirty =
    Object.keys(overrides).length > 0 ||
    Object.keys(explicit).length > 0 ||
    Object.keys(manual).length > 0;
  useUnsaved(dirty);
  const nameOf = (id: string | null) =>
    preview?.candidates.find((team) => team.id === id)?.name ?? tr('No entrant');
  const request = (seed = randomSeed) => ({
    phaseKey: phase.key,
    ...(seed ? { randomSeed: seed } : {}),
    ...(Object.keys(explicit).length ? { explicit } : {}),
    ...(Object.keys(manual).length ? { manual } : {}),
    ...(Object.keys(overrides).length ? { overrides, reason } : {}),
  });
  const review = (seed = randomSeed) =>
    void run(async () => {
      const result = await action<Preview>({ type: 'format.advance.preview', ...request(seed) });
      setPreview(result);
      setRandomSeed(result.randomSeed);
      setReviewed(JSON.stringify(request(result.randomSeed)));
    }, tr('Preview updated.'));
  const errors = preview?.issues.filter((issue) => issue.severity === 'ERROR') ?? [];
  // Anything changed since the last review must be reviewed again before it can apply.
  const edited = !!preview && JSON.stringify(request()) !== reviewed;
  return (
    <div className="grid gap-3">
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || phase.started}
            onClick={() => review()}
          >
            {tr('Review entrants')}
          </Button>
          {phase.draw === 'RANDOM_BY_POT' && preview && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || phase.started}
              onClick={() => {
                setRandomSeed(null);
                review(null);
              }}
            >
              {tr('Draw again')}
            </Button>
          )}
          {phase.reseeds && phase.revision !== null && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await action({ type: 'format.reseed', phaseKey: phase.key });
                  await reload();
                }, tr('Next round reseeded.'))
              }
            >
              {tr('Reseed next round')}
            </Button>
          )}
        </div>
      )}
      {preview && (
        <>
          {preview.issues.length > 0 && (
            <ul className={styles.issues} role="status">
              {preview.issues.map((issue, index) => (
                <li key={index}>{tr(issue.message, ...(issue.values ?? []))}</li>
              ))}
            </ul>
          )}
          {preview.changes.length > 0 && (
            <p className="text-sm" role="status">
              {tr('Pairings changed to avoid {0} rematches.', preview.changes.length / 2)}
            </p>
          )}
          {phase.explicit.map((source) => (
            <fieldset key={source.phase} className="min-w-0">
              <div className="grid-fields">
                {Array.from({ length: source.count }, (_, index) => (
                  <Field key={index} label={tr('Choose entrant {0}', index + 1)}>
                    <select
                      value={explicit[source.phase]?.[index] ?? ''}
                      onChange={(event) => {
                        const list = [...(explicit[source.phase] ?? [])];
                        list[index] = event.target.value;
                        setExplicit({ ...explicit, [source.phase]: list });
                      }}
                    >
                      <option value="">{tr('No entrant')}</option>
                      {preview.candidates.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                ))}
              </div>
            </fieldset>
          ))}
          {phase.draw === 'MANUAL' &&
            phase.tiers.map((tier) => (
              <fieldset key={tier.key} className="min-w-0">
                <legend className="font-semibold">{tier.name}</legend>
                <div className="grid-fields">
                  {Array.from({ length: tier.groupCount }, (_, group) =>
                    Array.from({ length: tier.groupSize }, (_, seat) => (
                      <Field
                        key={`${group}-${seat}`}
                        label={tr('Group {0}, seat {1}', group + 1, seat + 1)}
                      >
                        <select
                          value={manual[tier.key]?.[group]?.[seat] ?? ''}
                          onChange={(event) => {
                            const groups = Array.from({ length: tier.groupCount }, (_, index) => [
                              ...(manual[tier.key]?.[index] ?? []),
                            ]);
                            groups[group][seat] = event.target.value;
                            setManual({ ...manual, [tier.key]: groups });
                          }}
                        >
                          <option value="">{tr('No entrant')}</option>
                          {preview.candidates.map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )),
                  )}
                </div>
              </fieldset>
            ))}
          {preview.groups.length > 0 && (
            <ul className={styles.pairs}>
              {preview.groups.map((group) => (
                <li key={group.group} className={styles.pair}>
                  <strong>{group.label}</strong>
                  <ol>
                    {group.teams.map((team) => (
                      <li key={team.teamId}>
                        #{team.seed} {nameOf(team.teamId)}
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ul>
          )}
          {preview.seats.length > 0 && (
            <div className={styles.gridScroll}>
              <table className={styles.grid} style={{ minWidth: 560 }}>
                <thead>
                  <tr>
                    <th>{tr('Seed')}</th>
                    <th>{tr('Joins')}</th>
                    <th>{tr('Source')}</th>
                    <th>{tr('Entrant')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.seats.map((seat) => (
                    <tr key={seat.seed}>
                      <td>{seat.seed}</td>
                      <td>{tr(seat.lane === 'LOSERS' ? 'Losers' : 'Winners')}</td>
                      <td>{seat.detail}</td>
                      <td>
                        <select
                          aria-label={tr('Seed {0} in {1}', seat.seed, phase.name)}
                          disabled={!canEdit}
                          value={
                            String(seat.seed) in overrides
                              ? (overrides[seat.seed] ?? '')
                              : (seat.teamId ?? '')
                          }
                          onChange={(event) =>
                            setOverrides({
                              ...overrides,
                              [seat.seed]: event.target.value || null,
                            })
                          }
                        >
                          <option value="">{tr('No entrant')}</option>
                          {preview.candidates.map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {Object.keys(overrides).length > 0 && (
            <Field label={tr('Why are you setting seats by hand?')}>
              <input
                value={reason}
                maxLength={1000}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
          )}
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              {edited && (
                <Button type="button" variant="outline" disabled={busy} onClick={() => review()}>
                  {tr('Review entrants')}
                </Button>
              )}
              <SaveButton
                type="button"
                busy={busy}
                disabled={busy || errors.length > 0 || edited}
                onClick={() =>
                  void run(async () => {
                    await action({
                      type: 'format.advance',
                      ...request(),
                      reviewHash: preview.reviewHash,
                    });
                    setPreview(null);
                    setOverrides({});
                    setExplicit({});
                    setManual({});
                    setReason('');
                    await reload();
                  }, tr('Entrants applied.'))
                }
              >
                {tr('Apply entrants')}
              </SaveButton>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function FormatLifecycle({
  data,
  reload,
  canEdit,
  canForm,
  savePlan,
  dirty,
  valid,
}: {
  data: SetupWorkspaceData;
  reload: () => Promise<unknown>;
  canEdit: boolean;
  canForm: boolean;
  savePlan: () => Promise<string>;
  dirty: boolean;
  valid: boolean;
}) {
  const tr = useT();
  const { busy, run } = useTask();
  if (!data.plan) return null;
  if (!data.planLocked)
    return canEdit ? (
      <div>
        <ConfirmButton
          variant="default"
          disabled={busy || !valid}
          title={tr('Lock this format?')}
          description={tr(
            "This creates every phase's bracket and permanently reserves its match numbers, in phase order. You can still unlock it until a match has started.",
          )}
          onConfirm={() =>
            void run(async () => {
              // Unsaved changes go in with the lock, rather than asking for a separate save first.
              const baseToken = dirty ? await savePlan() : data.planToken;
              await action({ type: 'format.lock', baseToken });
              await reload();
            }, tr('Format locked. Its matches are reserved.'))
          }
        >
          {dirty ? tr('Save and lock format') : tr('Lock format')}
        </ConfirmButton>
      </div>
    ) : null;
  const phases = data.format?.phases ?? [];
  const anyStarted = phases.some((phase) => phase.started);
  return (
    <section className={styles.stack} aria-label={tr('Phases')}>
      {phases.map((phase) => (
        <div key={phase.key} className={styles.phase}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="font-semibold">{phase.name}</h3>
            {phase.bracketId ? (
              <>
                <span className="text-sm text-muted">
                  {phase.revision === null
                    ? tr('Waiting for entrants')
                    : tr('Entrants set, revision {0}', phase.revision)}
                </span>
                <span className="text-sm text-muted">
                  {tr('{0} of {1} matches played', phase.played, phase.matches)}
                </span>
                <Link className="text-sm text-primary" href="/admin/matches?view=bracket">
                  {tr('Open bracket')}
                </Link>
              </>
            ) : null}
          </div>
          {phase.stale && (
            <p className={styles.issues} role="status">
              {tr('The results seeding this phase have changed. Review its entrants again.')}
            </p>
          )}
          {phase.bracketId && <PhaseAdvancer phase={phase} reload={reload} canEdit={canEdit} />}
          {phase.kind === 'TEAM_FORMATION' &&
            data.formation
              .filter((board) => board.phaseKey === phase.key)
              .map((board) => (
                <FormationPanel
                  key={board.phaseKey}
                  board={board}
                  reload={reload}
                  canEdit={canForm}
                />
              ))}
        </div>
      ))}
      {canEdit && !anyStarted && (
        <div>
          <ConfirmButton
            variant="outline"
            disabled={busy}
            title={tr('Unlock this format?')}
            description={tr(
              "This removes every phase's bracket and its unplayed matches, so the format can be replanned.",
            )}
            onConfirm={() =>
              void run(async () => {
                await action({ type: 'format.unlock', baseToken: data.planToken });
                await reload();
              }, tr('Format unlocked.'))
            }
          >
            {tr('Unlock format')}
          </ConfirmButton>
        </div>
      )}
    </section>
  );
}
