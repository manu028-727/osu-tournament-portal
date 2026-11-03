'use client';
import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useT } from '@/components/locale';
import { Button } from '@/components/ui/button';
import { formatFlow, phaseEntrantCount } from '@/lib/format-flow';
import {
  FORMAT_PLAN_VERSION,
  formatPlanSchema,
  GROUP_TIEBREAKERS,
  type FormatPhase,
  type FormatPlan,
} from '@/lib/format-plan';
import type { PhasePreview } from '@/lib/format-preview';
import type { SetupWorkspaceData } from '@/lib/setup-queries';
import { action, Field, SaveButton, useTask, useUnsaved } from '../shared';
import styles from './setup.module.css';

const KIND_LABELS: Record<FormatPhase['kind'], string> = {
  QUALIFIER: 'Qualifiers',
  TEAM_FORMATION: 'Team formation',
  GROUPS: 'Groups',
  SINGLE_ELIMINATION: 'Single elimination',
  DOUBLE_ELIMINATION: 'Double elimination',
};
const TIEBREAKER_LABELS: Record<(typeof GROUP_TIEBREAKERS)[number], string> = {
  MATCH_WINS: 'Match wins',
  MAP_DIFFERENCE: 'Map difference',
  MAPS_WON: 'Maps won',
  HEAD_TO_HEAD: 'Head-to-head',
  QUALIFIER_SEED: 'Qualifier seed',
};
const LANE_LABELS: Record<string, string> = { WINNERS: 'Winners', LOSERS: 'Losers' };

type Phase = FormatPhase;
type Entry = Extract<Phase, { entries: unknown }>['entries'][number];
type Stage = SetupWorkspaceData['stages'][number];

export function PhaseFlow({ plan }: { plan: Pick<FormatPlan, 'phases'> }) {
  const tr = useT();
  const edges = formatFlow(plan);
  return (
    <ol className={styles.flow} aria-label={tr('Phase flow')}>
      {plan.phases.map((phase, index) => {
        const incoming = edges.filter((edge) => edge.to === phase.key);
        const count = phaseEntrantCount(plan.phases, phase);
        return (
          <li key={phase.key} className="contents">
            {index > 0 && (
              <span className={styles.flowArrow} aria-hidden="true">
                <ArrowRight size={16} />
              </span>
            )}
            <div className={styles.flowPhase}>
              <div className={styles.flowName}>{phase.name}</div>
              <div className={styles.flowKind}>
                {tr(KIND_LABELS[phase.kind])}
                {count ? ` · ${tr('{0} entrants', count)}` : ''}
              </div>
              {!!incoming.length && (
                <ul className={styles.flowEdges}>
                  {incoming.map((edge, position) => (
                    <li key={position}>
                      {edge.from
                        ? plan.phases.find((other) => other.key === edge.from)?.name
                        : tr('Registered entrants')}
                      {edge.label ? ` ${edge.label}` : ''}
                      {edge.lane ? ` → ${tr(LANE_LABELS[edge.lane])}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const newKey = (phases: readonly Phase[], base: string) => {
  let key = base;
  for (let suffix = 2; phases.some((phase) => phase.key === key); suffix++)
    key = `${base}-${suffix}`;
  return key;
};

function newPhase(kind: Phase['kind'], phases: readonly Phase[], stages: readonly Stage[]): Phase {
  const qualifierStage = stages.find((stage) => stage.kind === 'QUALIFIERS')?.id ?? '';
  const matchStage = stages.find((stage) => stage.kind !== 'QUALIFIERS')?.id ?? '';
  const source = phases.at(-1);
  const entries: Entry[] = [
    {
      source: source
        ? { kind: 'RANK_RANGE', phase: source.key, from: 1, to: 8 }
        : { kind: 'REGISTRATION', count: 8 },
      seedFrom: 1,
    },
  ];
  if (kind === 'QUALIFIER')
    return {
      kind,
      key: newKey(phases, 'qualifiers'),
      name: 'Qualifiers',
      stageId: qualifierStage,
      entrantUnit: 'REGISTERED_ENTRANT',
      advance: null,
    };
  if (kind === 'TEAM_FORMATION')
    return {
      kind,
      key: newKey(phases, 'formation'),
      name: 'Team formation',
      entries: [{ source: { kind: 'ALL', phase: source?.key ?? '' }, seedFrom: 1 }],
      method: 'MANUAL',
      teamCount: 8,
      rosterSize: 4,
      captains: 'MANUAL',
    };
  if (kind === 'GROUPS')
    return {
      kind,
      key: newKey(phases, 'groups'),
      name: 'Groups',
      stageId: matchStage,
      entries,
      tiers: [{ key: 'all', name: 'All', seedFrom: 1, seedTo: 8, groupCount: 2, groupSize: 4 }],
      draw: 'SEEDED',
      labels: 'NUMBERS',
      labelOrder: 'DRAW',
      tiebreakers: ['MATCH_WINS', 'MAP_DIFFERENCE', 'QUALIFIER_SEED'],
      forfeitMapDifference: 'COUNT',
    };
  if (kind === 'SINGLE_ELIMINATION')
    return {
      kind,
      key: newKey(phases, 'bracket'),
      name: 'Bracket',
      stageId: matchStage,
      roundStages: {},
      rematch: 'ALLOW',
      entries,
      size: 8,
      pairing: 'STANDARD',
      thirdPlace: false,
      reseed: 'NONE',
    };
  return {
    kind,
    key: newKey(phases, 'bracket'),
    name: 'Bracket',
    stageId: matchStage,
    roundStages: {},
    rematch: 'ALLOW',
    entries: entries.map((item) => ({ ...item, lane: 'WINNERS' as const })),
    winners: { size: 8, pairing: 'STANDARD' },
    losers: null,
    grandFinalReset: true,
  };
}

const parsePairs = (value: string): [number, number][] | null => {
  const pairs = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(/\s*(?:-|v|vs)\s*/i).map(Number));
  if (!pairs.length || pairs.some((pair) => pair.length !== 2 || pair.some((n) => !n))) return null;
  return pairs as [number, number][];
};
const pairsText = (pairing: 'STANDARD' | [number, number][]) =>
  pairing === 'STANDARD' ? '' : pairing.map(([a, b]) => `${a}-${b}`).join(', ');

function NumberField({
  label,
  value,
  onChange,
  min = 1,
  hint,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        min={min}
        value={value ?? ''}
        onChange={(event) =>
          onChange(event.target.value === '' ? null : Number(event.target.value))
        }
      />
    </Field>
  );
}

function EntryEditor({
  entry,
  phases,
  twoLanes,
  onChange,
  onRemove,
}: {
  entry: Entry;
  phases: readonly Phase[];
  twoLanes: boolean;
  onChange: (entry: Entry) => void;
  onRemove: () => void;
}) {
  const tr = useT();
  const source = entry.source;
  const set = (next: Entry['source']) => onChange({ ...entry, source: next });
  const sourcePhase = 'phase' in source ? phases.find((p) => p.key === source.phase) : undefined;
  const qualifierPhases = phases.filter((phase) => phase.kind === 'QUALIFIER');
  const groupPhases = phases.filter((phase) => phase.kind === 'GROUPS');
  const formationPhases = phases.filter((phase) => phase.kind === 'TEAM_FORMATION');
  const fallback = phases.at(-1)?.key ?? '';
  return (
    <div className={styles.entry}>
      <Field label={tr('Entrants from')}>
        <select
          value={source.kind}
          onChange={(event) => {
            const kind = event.target.value as Entry['source']['kind'];
            if (kind === 'REGISTRATION') set({ kind, count: 8 });
            else if (kind === 'RANK_RANGE')
              set({ kind, phase: qualifierPhases[0]?.key ?? fallback, from: 1, to: 8 });
            else if (kind === 'PLACEMENT')
              set({
                kind,
                phase: groupPhases[0]?.key ?? fallback,
                placement: 1,
                orderWithin: 'CROSS_GROUP_RANK',
              });
            else if (kind === 'EXPLICIT')
              set({ kind, phase: formationPhases[0]?.key ?? fallback, count: 8 });
            else set({ kind, phase: qualifierPhases[0]?.key ?? fallback });
          }}
        >
          <option value="REGISTRATION">{tr('Registered entrants')}</option>
          <option value="RANK_RANGE">{tr('Qualifier ranks')}</option>
          <option value="ALL">{tr('Everyone from a phase')}</option>
          <option value="PLACEMENT">{tr('A group placement')}</option>
          <option value="EXPLICIT">{tr('Chosen by the organizer')}</option>
        </select>
      </Field>
      {'phase' in source && (
        <Field label={tr('Phase')}>
          <select
            value={source.phase}
            onChange={(event) => set({ ...source, phase: event.target.value } as Entry['source'])}
          >
            {phases.map((phase) => (
              <option key={phase.key} value={phase.key}>
                {phase.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {source.kind === 'RANK_RANGE' && (
        <>
          <NumberField
            label={tr('From rank')}
            value={source.from}
            onChange={(from) => set({ ...source, from: from ?? 1 })}
          />
          <NumberField
            label={tr('To rank')}
            value={source.to}
            onChange={(to) => set({ ...source, to: to ?? 1 })}
          />
        </>
      )}
      {(source.kind === 'REGISTRATION' || source.kind === 'EXPLICIT') && (
        <NumberField
          label={tr('Entrants')}
          value={source.count}
          onChange={(count) => set({ ...source, count: count ?? 1 })}
        />
      )}
      {source.kind === 'PLACEMENT' && (
        <>
          <NumberField
            label={tr('Group placement')}
            value={source.placement}
            onChange={(placement) => set({ ...source, placement: placement ?? 1 })}
          />
          {sourcePhase?.kind === 'GROUPS' && sourcePhase.tiers.length > 1 && (
            <Field label={tr('Tier')}>
              <select
                value={source.tier ?? ''}
                onChange={(event) => set({ ...source, tier: event.target.value || undefined })}
              >
                <option value="">{tr('Choose a tier')}</option>
                {sourcePhase.tiers.map((tier) => (
                  <option key={tier.key} value={tier.key}>
                    {tier.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label={tr('Order across groups')}>
            <select
              value={source.orderWithin}
              onChange={(event) =>
                set({
                  ...source,
                  orderWithin: event.target.value as 'GROUP_LABEL' | 'CROSS_GROUP_RANK',
                })
              }
            >
              <option value="CROSS_GROUP_RANK">{tr('By group results')}</option>
              <option value="GROUP_LABEL">{tr('By group label')}</option>
            </select>
          </Field>
        </>
      )}
      {twoLanes && (
        <Field label={tr('Joins')}>
          <select
            value={'lane' in entry ? entry.lane : 'WINNERS'}
            onChange={(event) =>
              onChange({ ...entry, lane: event.target.value as 'WINNERS' | 'LOSERS' } as Entry)
            }
          >
            <option value="WINNERS">{tr('Winners')}</option>
            <option value="LOSERS">{tr('Losers')}</option>
          </select>
        </Field>
      )}
      <NumberField
        label={tr('First seed')}
        value={entry.seedFrom}
        onChange={(seedFrom) => onChange({ ...entry, seedFrom: seedFrom ?? 1 })}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={tr('Remove this entry')}
        onClick={onRemove}
      >
        <Trash2 size={16} />
      </Button>
    </div>
  );
}

function PhaseEditor({
  phase,
  index,
  phases,
  stages,
  onChange,
  onMove,
  onRemove,
}: {
  phase: Phase;
  index: number;
  phases: readonly Phase[];
  stages: readonly Stage[];
  onChange: (phase: Phase) => void;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
}) {
  const tr = useT();
  const earlier = phases.slice(0, index);
  const stageOptions = stages.filter((stage) =>
    phase.kind === 'QUALIFIER' ? stage.kind === 'QUALIFIERS' : stage.kind !== 'QUALIFIERS',
  );
  const patch = (fields: Partial<Phase>) => onChange({ ...phase, ...fields } as Phase);
  const twoLanes = phase.kind === 'DOUBLE_ELIMINATION' && !!phase.losers;
  return (
    <section className={styles.phase} aria-label={phase.name}>
      <div className={styles.phaseHeader}>
        <div className={styles.phaseName}>
          <Field label={tr('{0} name', tr(KIND_LABELS[phase.kind]))}>
            <input
              value={phase.name}
              maxLength={100}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </Field>
        </div>
        {'stageId' in phase && (
          <div className={styles.phaseName}>
            <Field label={tr('Stage')}>
              <select
                value={phase.stageId}
                onChange={(event) => patch({ stageId: event.target.value } as Partial<Phase>)}
              >
                <option value="">{tr('Choose a stage')}</option>
                {stageOptions.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={tr('Move {0} earlier', phase.name)}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUp size={16} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={tr('Move {0} later', phase.name)}
          disabled={index === phases.length - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDown size={16} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={tr('Remove {0}', phase.name)}
          onClick={onRemove}
        >
          <Trash2 size={16} />
        </Button>
      </div>

      {phase.kind === 'QUALIFIER' && (
        <div className="grid-fields">
          <NumberField
            label={tr('Entrants advancing')}
            hint={tr('Leave empty when every entrant continues.')}
            value={phase.advance}
            onChange={(advance) => patch({ advance } as Partial<Phase>)}
          />
          <Field label={tr('Who plays')}>
            <select
              value={phase.entrantUnit}
              onChange={(event) =>
                patch({
                  entrantUnit: event.target.value as 'REGISTERED_ENTRANT' | 'INDIVIDUAL_PLAYER',
                } as Partial<Phase>)
              }
            >
              <option value="REGISTERED_ENTRANT">{tr('Registered entrants')}</option>
              <option value="INDIVIDUAL_PLAYER">{tr('Players, who form teams afterwards')}</option>
            </select>
          </Field>
        </div>
      )}

      {phase.kind === 'TEAM_FORMATION' && (
        <div className="grid-fields">
          <Field label={tr('Formation method')}>
            <select
              value={phase.method}
              onChange={(event) => {
                const method = event.target.value as typeof phase.method;
                onChange({
                  ...phase,
                  method,
                  auction:
                    method === 'AUCTION'
                      ? (phase.auction ?? {
                          budget: 4000,
                          minimumRaise: 100,
                          lotOrder: 'SEED',
                          reserveFillPrice: 0,
                        })
                      : undefined,
                });
              }}
            >
              <option value="AUCTION">{tr('Auction')}</option>
              <option value="SNAKE_DRAFT">{tr('Snake draft')}</option>
              <option value="MANUAL">{tr('Assigned by organizers')}</option>
            </select>
          </Field>
          <NumberField
            label={tr('Teams')}
            value={phase.teamCount}
            onChange={(teamCount) => patch({ teamCount: teamCount ?? 2 } as Partial<Phase>)}
          />
          <NumberField
            label={tr('Players per team')}
            value={phase.rosterSize}
            onChange={(rosterSize) => patch({ rosterSize: rosterSize ?? 1 } as Partial<Phase>)}
          />
          <Field label={tr('Captains')}>
            <select
              value={phase.captains}
              onChange={(event) =>
                patch({ captains: event.target.value as 'MANUAL' | 'TOP_SEEDS' } as Partial<Phase>)
              }
            >
              <option value="MANUAL">{tr('Chosen by organizers')}</option>
              <option value="TOP_SEEDS">{tr('Best qualifier seeds')}</option>
            </select>
          </Field>
          {phase.auction && (
            <>
              <NumberField
                label={tr('Budget per captain')}
                value={phase.auction.budget}
                onChange={(budget) =>
                  onChange({ ...phase, auction: { ...phase.auction!, budget: budget ?? 1 } })
                }
              />
              <NumberField
                label={tr('Minimum raise')}
                value={phase.auction.minimumRaise}
                onChange={(minimumRaise) =>
                  onChange({
                    ...phase,
                    auction: { ...phase.auction!, minimumRaise: minimumRaise ?? 1 },
                  })
                }
              />
              <NumberField
                label={tr('Price to fill from reserves')}
                min={0}
                value={phase.auction.reserveFillPrice}
                onChange={(reserveFillPrice) =>
                  onChange({
                    ...phase,
                    auction: { ...phase.auction!, reserveFillPrice: reserveFillPrice ?? 0 },
                  })
                }
              />
              <Field label={tr('Lot order')}>
                <select
                  value={phase.auction.lotOrder}
                  onChange={(event) =>
                    onChange({
                      ...phase,
                      auction: {
                        ...phase.auction!,
                        lotOrder: event.target.value as 'SEED' | 'RANDOM',
                      },
                    })
                  }
                >
                  <option value="SEED">{tr('By qualifier seed')}</option>
                  <option value="RANDOM">{tr('Random draw')}</option>
                </select>
              </Field>
            </>
          )}
        </div>
      )}

      {phase.kind === 'GROUPS' && (
        <>
          <div className="grid-fields">
            <Field label={tr('Group draw')}>
              <select
                value={phase.draw}
                onChange={(event) =>
                  patch({ draw: event.target.value as typeof phase.draw } as Partial<Phase>)
                }
              >
                <option value="SEEDED">{tr('Balanced by seed')}</option>
                <option value="RANDOM_BY_POT">{tr('Random, one from each pot')}</option>
                <option value="MANUAL">{tr('Entered by organizers')}</option>
              </select>
            </Field>
            <Field label={tr('Group names')}>
              <select
                value={phase.labels}
                onChange={(event) =>
                  patch({ labels: event.target.value as typeof phase.labels } as Partial<Phase>)
                }
              >
                <option value="NUMBERS">{tr('Numbers')}</option>
                <option value="LETTERS">{tr('Letters')}</option>
              </select>
            </Field>
            <Field label={tr('Name groups in order of')}>
              <select
                value={phase.labelOrder}
                onChange={(event) =>
                  patch({
                    labelOrder: event.target.value as typeof phase.labelOrder,
                  } as Partial<Phase>)
                }
              >
                <option value="DRAW">{tr('The draw')}</option>
                <option value="SOURCE_AGGREGATE">{tr('Average qualifier result')}</option>
              </select>
            </Field>
            <Field label={tr('A forfeit in map difference')}>
              <select
                value={phase.forfeitMapDifference}
                onChange={(event) =>
                  patch({
                    forfeitMapDifference: event.target.value as typeof phase.forfeitMapDifference,
                  } as Partial<Phase>)
                }
              >
                <option value="COUNT">{tr('Counts like any result')}</option>
                <option value="IGNORE">{tr('Counts as a win only')}</option>
              </select>
            </Field>
          </div>
          <fieldset className="min-w-0 space-y-2">
            <legend className="font-semibold">{tr('Tiers')}</legend>
            {phase.tiers.map((tier, tierIndex) => {
              const setTier = (fields: Partial<typeof tier>) =>
                onChange({
                  ...phase,
                  tiers: phase.tiers.map((item, position) =>
                    position === tierIndex ? { ...item, ...fields } : item,
                  ),
                });
              return (
                <div key={tierIndex} className={styles.entry}>
                  <Field label={tr('Tier name')}>
                    <input
                      value={tier.name}
                      maxLength={100}
                      onChange={(event) => setTier({ name: event.target.value })}
                    />
                  </Field>
                  <NumberField
                    label={tr('First seed')}
                    value={tier.seedFrom}
                    onChange={(seedFrom) => setTier({ seedFrom: seedFrom ?? 1 })}
                  />
                  <NumberField
                    label={tr('Last seed')}
                    value={tier.seedTo}
                    onChange={(seedTo) => setTier({ seedTo: seedTo ?? 1 })}
                  />
                  <NumberField
                    label={tr('Groups')}
                    value={tier.groupCount}
                    onChange={(groupCount) => setTier({ groupCount: groupCount ?? 1 })}
                  />
                  <NumberField
                    label={tr('Entrants per group')}
                    value={tier.groupSize}
                    onChange={(groupSize) => setTier({ groupSize: groupSize ?? 2 })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={phase.tiers.length === 1}
                    aria-label={tr('Remove {0}', tier.name)}
                    onClick={() =>
                      onChange({
                        ...phase,
                        tiers: phase.tiers.filter((_, position) => position !== tierIndex),
                      })
                    }
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              );
            })}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                onChange({
                  ...phase,
                  tiers: [
                    ...phase.tiers,
                    {
                      key: newKey(
                        phase.tiers as unknown as Phase[],
                        `tier-${phase.tiers.length + 1}`,
                      ),
                      name: tr('Tier {0}', phase.tiers.length + 1),
                      seedFrom: phase.tiers.at(-1)!.seedTo + 1,
                      seedTo: phase.tiers.at(-1)!.seedTo + 8,
                      groupCount: 2,
                      groupSize: 4,
                    },
                  ],
                })
              }
            >
              <Plus size={16} />
              {tr('Add tier')}
            </Button>
          </fieldset>
          <fieldset className="min-w-0 space-y-2">
            <legend className="font-semibold">{tr('Tiebreakers, in order')}</legend>
            <ol className="space-y-1">
              {phase.tiebreakers.map((criterion, position) => (
                <li key={criterion} className="flex flex-wrap items-center gap-1 text-sm">
                  <span className="min-w-40">
                    {position + 1}. {tr(TIEBREAKER_LABELS[criterion])}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={tr('Move {0} earlier', tr(TIEBREAKER_LABELS[criterion]))}
                    disabled={position === 0}
                    onClick={() => {
                      const next = [...phase.tiebreakers];
                      next.splice(position - 1, 0, next.splice(position, 1)[0]);
                      onChange({ ...phase, tiebreakers: next });
                    }}
                  >
                    <ArrowUp size={14} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={tr('Remove {0}', tr(TIEBREAKER_LABELS[criterion]))}
                    disabled={phase.tiebreakers.length === 1}
                    onClick={() =>
                      onChange({
                        ...phase,
                        tiebreakers: phase.tiebreakers.filter((item) => item !== criterion),
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </Button>
                </li>
              ))}
            </ol>
            {GROUP_TIEBREAKERS.filter((item) => !phase.tiebreakers.includes(item)).map((item) => (
              <Button
                key={item}
                type="button"
                variant="outline"
                size="sm"
                className="mr-1"
                onClick={() => onChange({ ...phase, tiebreakers: [...phase.tiebreakers, item] })}
              >
                <Plus size={14} />
                {tr(TIEBREAKER_LABELS[item])}
              </Button>
            ))}
          </fieldset>
        </>
      )}

      {phase.kind === 'SINGLE_ELIMINATION' && (
        <div className="grid-fields">
          <NumberField
            label={tr('Bracket size')}
            value={phase.size}
            onChange={(size) => patch({ size: size ?? 2 } as Partial<Phase>)}
          />
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={phase.thirdPlace}
              onChange={(event) => patch({ thirdPlace: event.target.checked } as Partial<Phase>)}
            />
            {tr('Third-place match')}
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={phase.reseed === 'EACH_ROUND'}
              onChange={(event) =>
                patch({ reseed: event.target.checked ? 'EACH_ROUND' : 'NONE' } as Partial<Phase>)
              }
            />
            {tr('Reseed after each round')}
          </label>
        </div>
      )}

      {phase.kind === 'DOUBLE_ELIMINATION' && (
        <div className="grid-fields">
          <NumberField
            label={tr('Winners bracket size')}
            value={phase.winners.size}
            onChange={(size) =>
              onChange({
                ...phase,
                winners: { ...phase.winners, size: size ?? 2 },
                losers: phase.losers ? { ...phase.losers, size: size ?? 2 } : null,
              })
            }
          />
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={!!phase.losers}
              onChange={(event) =>
                onChange({
                  ...phase,
                  losers: event.target.checked
                    ? { size: phase.winners.size, pairing: 'STANDARD' }
                    : null,
                })
              }
            />
            {tr('Some entrants start in Losers')}
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={phase.grandFinalReset}
              onChange={(event) => onChange({ ...phase, grandFinalReset: event.target.checked })}
            />
            {tr('Grand Finals reset')}
          </label>
          {phase.losers && (
            <Field
              label={tr('Losers opening matches')}
              hint={tr('Empty pairs best against worst. Otherwise list seeds, like 9-16, 10-15.')}
            >
              <input
                defaultValue={pairsText(phase.losers.pairing)}
                onChange={(event) =>
                  onChange({
                    ...phase,
                    losers: {
                      ...phase.losers!,
                      pairing: parsePairs(event.target.value) ?? 'STANDARD',
                    },
                  })
                }
              />
            </Field>
          )}
        </div>
      )}

      {(phase.kind === 'SINGLE_ELIMINATION' || phase.kind === 'DOUBLE_ELIMINATION') && (
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={phase.rematch === 'AVOID_SAME_GROUP'}
            onChange={(event) =>
              patch({
                rematch: event.target.checked ? 'AVOID_SAME_GROUP' : 'ALLOW',
              } as Partial<Phase>)
            }
          />
          {tr('Avoid rematches between entrants from the same group')}
        </label>
      )}

      {'entries' in phase && (
        <fieldset className="min-w-0">
          <legend className="font-semibold">{tr('Who enters this phase')}</legend>
          {phase.entries.map((entry, entryIndex) => (
            <EntryEditor
              key={entryIndex}
              entry={entry as Entry}
              phases={earlier}
              twoLanes={twoLanes}
              onChange={(next) =>
                onChange({
                  ...phase,
                  entries: phase.entries.map((item, position) =>
                    position === entryIndex ? next : item,
                  ),
                } as Phase)
              }
              onRemove={() =>
                onChange({
                  ...phase,
                  entries: phase.entries.filter((_, position) => position !== entryIndex),
                } as Phase)
              }
            />
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() =>
              onChange({
                ...phase,
                entries: [
                  ...phase.entries,
                  {
                    source: {
                      kind: 'RANK_RANGE',
                      phase: earlier.at(-1)?.key ?? '',
                      from: 1,
                      to: 1,
                    },
                    seedFrom: Math.max(0, ...phase.entries.map((item) => item.seedFrom)) + 1,
                    ...(phase.kind === 'DOUBLE_ELIMINATION' ? { lane: 'WINNERS' } : {}),
                  },
                ],
              } as Phase)
            }
          >
            <Plus size={16} />
            {tr('Add entrants')}
          </Button>
        </fieldset>
      )}
    </section>
  );
}

function PlanPreview({
  plan,
  stages,
}: {
  plan: { phases: PhasePreview[]; totalMatches: number };
  stages: readonly Stage[];
}) {
  const tr = useT();
  return (
    <section className={styles.previewTable} aria-label={tr('Preview')}>
      <h3 className="font-semibold">{tr('{0} matches would be created', plan.totalMatches)}</h3>
      {plan.phases
        .filter((phase) => phase.matchCount)
        .map((phase) => (
          <details key={phase.key}>
            <summary className="min-h-10 cursor-pointer py-2">
              {phase.name} · {tr('{0} matches', phase.matchCount)}
            </summary>
            <ul className="space-y-1 pb-2">
              {phase.rounds.map((round) => (
                <li key={round.key} className="text-sm">
                  {round.name} · {tr('{0} matches', round.matches)} ·{' '}
                  {stages.find((stage) => stage.id === round.stageId)?.name ?? ''}
                </li>
              ))}
            </ul>
            {phase.openings.map((opening) => (
              <div key={opening.lane} className="pb-2">
                <h4 className="pb-1 text-sm font-semibold">
                  {tr('{0} opening matches', tr(LANE_LABELS[opening.lane]))}
                </h4>
                <ul className={styles.pairs}>
                  {opening.pairs.map(([a, b], index) => (
                    <li key={index} className={styles.pair}>
                      {a} {tr('vs')} {b}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </details>
        ))}
    </section>
  );
}

export function FormatSection({
  data,
  reload,
  canEdit,
}: {
  data: SetupWorkspaceData;
  reload: () => Promise<unknown>;
  canEdit: boolean;
}) {
  const tr = useT();
  const { busy, run } = useTask();
  const saved = useMemo(() => data.plan?.phases ?? [], [data.plan]);
  const [phases, setPhases] = useState<Phase[]>(saved);
  const [preview, setPreview] = useState<{
    phases: PhasePreview[];
    totalMatches: number;
  } | null>(null);
  useEffect(() => setPhases(saved), [saved]);
  const dirty = JSON.stringify(phases) !== JSON.stringify(saved);
  useUnsaved(dirty);
  const candidate = { version: FORMAT_PLAN_VERSION, phases };
  const validation = formatPlanSchema.safeParse(candidate);
  // One broken range can report several seeds, so each message shows once per phase.
  const issues =
    phases.length && !validation.success
      ? [
          ...new Map(
            validation.error.issues.map((issue) => [
              `${String(issue.path[1])}:${issue.message}`,
              issue,
            ]),
          ).values(),
        ]
      : [];
  const showPreview = () =>
    void run(async () => {
      setPreview(
        await action<{ phases: PhasePreview[]; totalMatches: number }>({
          type: 'format.plan.preview',
          plan: candidate,
        }),
      );
    }, tr('Preview updated.'));
  const replace = (index: number, phase: Phase) =>
    setPhases(phases.map((item, position) => (position === index ? phase : item)));
  return (
    <div className="grid gap-4">
      {phases.length > 0 ? (
        <PhaseFlow plan={{ phases }} />
      ) : (
        <p className="text-sm text-muted">
          {tr('No phases yet. Start from a template, or add the first phase below.')}
        </p>
      )}
      {data.planLocked && (
        <p className="text-sm text-muted">
          {tr('This format is locked, so its reserved matches stay as they are.')}
        </p>
      )}
      <fieldset disabled={!canEdit || busy || data.planLocked} className="grid min-w-0 gap-3">
        {phases.map((phase, index) => (
          <PhaseEditor
            key={phase.key}
            phase={phase}
            index={index}
            phases={phases}
            stages={data.stages}
            onChange={(next) => replace(index, next)}
            onMove={(offset) => {
              const next = [...phases];
              next.splice(index + offset, 0, next.splice(index, 1)[0]);
              setPhases(next);
            }}
            onRemove={() => setPhases(phases.filter((_, position) => position !== index))}
          />
        ))}
        <div className="flex flex-wrap gap-2">
          {(Object.keys(KIND_LABELS) as Phase['kind'][]).map((kind) => (
            <Button
              key={kind}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPhases([...phases, newPhase(kind, phases, data.stages)])}
            >
              <Plus size={16} />
              {tr(KIND_LABELS[kind])}
            </Button>
          ))}
        </div>
      </fieldset>
      {issues.length > 0 && (
        <ul className={styles.issues} role="status">
          {issues.slice(0, 8).map((issue, index) => (
            <li key={index}>
              {typeof issue.path[1] === 'number' && phases[issue.path[1]]
                ? `${phases[issue.path[1]].name}: `
                : ''}
              {tr(issue.message)}
            </li>
          ))}
        </ul>
      )}
      {canEdit && !data.planLocked && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await action({
                type: 'format.plan.save',
                baseToken: data.planToken,
                plan: candidate,
              });
              await reload();
            }, tr('Tournament format saved.'));
          }}
        >
          <SaveButton busy={busy} disabled={busy || !dirty || !validation.success}>
            {tr('Save format')}
          </SaveButton>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !phases.length || !validation.success}
            onClick={showPreview}
          >
            {tr('Preview matches')}
          </Button>
        </form>
      )}
      {preview && <PlanPreview plan={preview} stages={data.stages} />}
    </div>
  );
}
