'use client';
import { useT } from '../locale';
import { Field, NumberInput } from './shared';
import {
  QUALIFIER_METHOD_LABELS,
  QUALIFIER_METRIC_LABELS,
  type QualifierPolicy,
} from '@/lib/qualifier-policy';

export function QualifierPolicyFields({
  value,
  onChange,
  disabled = false,
  gameMode = 'osu',
  gameplayScoring,
}: {
  value: QualifierPolicy;
  onChange: (value: QualifierPolicy) => void;
  disabled?: boolean;
  gameMode?: string;
  gameplayScoring?: string | null;
}) {
  const tr = useT();
  const update = (patch: Partial<QualifierPolicy>) => onChange({ ...value, ...patch });
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <div className="grid-fields">
        <Field label={tr('Seeding method')}>
          <select
            value={value.method}
            onChange={(e) => update({ method: e.target.value as QualifierPolicy['method'] })}
          >
            {Object.entries(QUALIFIER_METHOD_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {tr(label)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr('Seeded on')}>
          <select
            value={value.metric || 'SCORE'}
            onChange={(e) => {
              const metric = e.target.value as NonNullable<QualifierPolicy['metric']>;
              // Team accuracy is an average, so it cannot keep a summed aggregation.
              update(metric === 'ACCURACY' ? { metric, teamAggregation: 'AVERAGE' } : { metric });
            }}
          >
            {Object.entries(QUALIFIER_METRIC_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {tr(label)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr('Playthroughs')}>
          <select
            value={value.runs}
            onChange={(e) =>
              update({ runs: Number(e.target.value) as 1 | 2, runSelection: 'BEST_PER_MAP' })
            }
          >
            <option value={1}>{tr('Once')}</option>
            <option value={2}>{tr('Twice')}</option>
          </select>
        </Field>
        {value.runs === 2 && (
          <Field label={tr('Run selection')}>
            <select
              value={value.runSelection}
              onChange={(e) =>
                update({ runSelection: e.target.value as QualifierPolicy['runSelection'] })
              }
            >
              <option value="BEST_PER_MAP">{tr('Best per map')}</option>
              <option value="BEST_COMPLETE_RUN">{tr('Best complete run')}</option>
              <option value="FIRST_RUN">{tr('First run only')}</option>
              <option value="SECOND_RUN">{tr('Second run only')}</option>
            </select>
          </Field>
        )}
        <Field label={tr('Players counted per map')}>
          <NumberInput
            required
            min={1}
            max={16}
            value={value.requiredPlayers}
            onChange={(requiredPlayers) => update({ requiredPlayers: requiredPlayers ?? 1 })}
          />
        </Field>
        <Field label={tr('Team aggregation')}>
          <select
            value={value.teamAggregation}
            onChange={(e) =>
              update({ teamAggregation: e.target.value as QualifierPolicy['teamAggregation'] })
            }
          >
            <option value="SUM">{tr('Sum')}</option>
            <option value="AVERAGE">{tr('Average')}</option>
            <option value="TOP_N">{tr('Top N players')}</option>
          </select>
        </Field>
        {value.method === 'RAW_SCORE' && (
          <Field label={tr('Pool aggregation')}>
            <select
              value={value.rawAggregation}
              onChange={(e) =>
                update({ rawAggregation: e.target.value as QualifierPolicy['rawAggregation'] })
              }
            >
              <option value="TOTAL">{tr('Total')}</option>
              <option value="AVERAGE">{tr('Average')}</option>
            </select>
          </Field>
        )}
        <Field label={tr('Score normalization')}>
          <select
            value={value.normalization || 'REPORTED'}
            onChange={(e) =>
              update({
                normalization: e.target.value as 'REPORTED' | 'BUILT_IN',
                ...(e.target.value === 'BUILT_IN'
                  ? { multiplierPolicy: 'NONE', rounding: 'FLOOR' }
                  : {}),
              })
            }
          >
            <option value="REPORTED">{tr('Reported scores')}</option>
            <option value="BUILT_IN" disabled={gameMode !== 'osu' || gameplayScoring === 'LAZER'}>
              {tr('Remove built-in mod bonuses')}
            </option>
          </select>
        </Field>
        <Field label={tr('Tournament mod multipliers')}>
          <select
            value={value.multiplierPolicy || 'RULES'}
            onChange={(e) => update({ multiplierPolicy: e.target.value as 'RULES' | 'NONE' })}
          >
            <option value="RULES">{tr('Apply configured rules')}</option>
            <option value="NONE">{tr('No additional multipliers')}</option>
          </select>
        </Field>
        <Field label={tr('Per-player rounding')}>
          <select
            value={value.rounding || 'NONE'}
            onChange={(e) => update({ rounding: e.target.value as QualifierPolicy['rounding'] })}
          >
            <option value="NONE">{tr('Full precision')}</option>
            <option value="FLOOR">{tr('Round down')}</option>
            <option value="ROUND">{tr('Nearest integer')}</option>
          </select>
        </Field>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.countFailed !== false}
          onChange={(e) => update({ countFailed: e.target.checked })}
        />
        {tr('Count failed performances')}
      </label>
      <p className="text-xs text-muted">
        {tr(
          'Played, valid and counted are separate. Excluded scores retain their raw evidence and still complete played maps. Missing scores remain missing.',
        )}
      </p>
    </fieldset>
  );
}
