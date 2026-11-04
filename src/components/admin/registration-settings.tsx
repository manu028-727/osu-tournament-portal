'use client';
import { useState } from 'react';
import { useT } from '@/components/locale';
import type { RegistrationPolicy } from '@/lib/registration-policy';
import { localDateTimeInput } from '@/lib/utils';
import { Field, NumberInput } from './shared';
import { Button } from '../ui/button';

type NumberKey = 'minPlayers' | 'maxPlayers' | 'maxSubstitutes' | 'minRank' | 'maxRank';
const NUMBER_LABELS: Record<NumberKey, string> = {
  minPlayers: 'Minimum starters (0 uses gameplay rules)',
  maxPlayers: 'Maximum roster size',
  maxSubstitutes: 'Maximum substitutes',
  minRank: 'Minimum rank (optional)',
  maxRank: 'Maximum rank (optional)',
};
export function RegistrationSettings({
  value,
  onChange,
  rostersElsewhere = false,
}: {
  value: RegistrationPolicy;
  onChange: (value: RegistrationPolicy) => void;
  // The setup workspace edits roster sizes and entry format beside team size.
  rostersElsewhere?: boolean;
}) {
  const tr = useT();
  const update = (patch: Partial<RegistrationPolicy>) => onChange({ ...value, ...patch });
  // Limits stay folded until an event uses them, and open once one is set.
  const [limitsOpen] = useState(
    !!(
      value.minRank ||
      value.maxRank ||
      value.rankSumMin ||
      value.rankSumMax ||
      value.rankLockAt ||
      value.countries.length ||
      value.countryTeams ||
      value.ineligible !== 'REJECT'
    ),
  );
  const numberField = (key: NumberKey) => (
    <Field key={key} label={tr(NUMBER_LABELS[key])}>
      <NumberInput
        nullable={key.includes('Rank')}
        min={key.includes('Rank') ? 1 : 0}
        max={key.includes('Rank') ? 2147483647 : 32}
        value={value[key]}
        onChange={(number) => update({ [key]: number })}
      />
    </Field>
  );
  return (
    <section id="registration" className="form-section space-y-4">
      <h2 className="text-lg font-semibold">{tr('Tournament registration')}</h2>
      <p className="text-sm text-muted">
        {tr(
          'Website entries within the limits and new organizer imports are approved automatically. Public rejection reasons and private notes remain separate.',
        )}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={tr('Registration workflow')}>
          <select
            value={value.mode}
            onChange={(event) => update({ mode: event.target.value as RegistrationPolicy['mode'] })}
          >
            <option value="WEBSITE">{tr('Website registration')}</option>
            <option value="EXTERNAL">{tr('External registration link')}</option>
          </select>
        </Field>
        {!rostersElsewhere && (
          <Field label={tr('Entry format')}>
            <select
              value={value.format}
              onChange={(event) =>
                update({ format: event.target.value as RegistrationPolicy['format'] })
              }
            >
              <option value="AUTO">{tr('Use tournament format')}</option>
              <option value="TEAM">{tr('Teams')}</option>
              <option value="INDIVIDUAL">{tr('Solo')}</option>
            </select>
          </Field>
        )}
        {(['opensAt', 'closesAt', 'rosterClosesAt'] as const).map((key, index) => (
          <Field
            key={key}
            label={tr(
              [
                'Registration opens (your timezone)',
                'Registration deadline (your timezone)',
                'Roster deadline (your timezone)',
              ][index],
            )}
          >
            <input
              type="datetime-local"
              value={localDateTimeInput(value[key])}
              onChange={(event) =>
                update({
                  [key]: event.target.value ? new Date(event.target.value).toISOString() : null,
                })
              }
            />
          </Field>
        ))}
        {!rostersElsewhere &&
          (['minPlayers', 'maxPlayers', 'maxSubstitutes'] as const).map(numberField)}
      </div>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={value.rosterLocked}
          onChange={(event) => update({ rosterLocked: event.target.checked })}
        />
        {tr('Lock captain roster edits')}
      </label>
      <details open={limitsOpen} className="border-y py-2">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">
          {tr('Eligibility limits')}
        </summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {(['minRank', 'maxRank'] as const).map(numberField)}
          {(['rankSumMin', 'rankSumMax'] as const).map((key, index) => (
            <Field
              key={key}
              label={tr(
                ['Lowest team rank sum (optional)', 'Highest team rank sum (optional)'][index],
              )}
            >
              <NumberInput
                nullable
                min={1}
                max={2147483647}
                value={value[key]}
                onChange={(number) => update({ [key]: number })}
              />
            </Field>
          ))}
          {(value.rankSumMin !== null || value.rankSumMax !== null) && (
            <Field label={tr('The rank sum counts')}>
              <select
                value={value.rankSumScope}
                onChange={(event) =>
                  update({ rankSumScope: event.target.value as RegistrationPolicy['rankSumScope'] })
                }
              >
                <option value="STARTERS">{tr('Starting players')}</option>
                <option value="ROSTER">{tr('The whole roster')}</option>
              </select>
            </Field>
          )}
          <Field
            label={tr('Ranks lock at (your timezone, optional)')}
            hint={tr('After this, a player already on a roster keeps their recorded rank.')}
          >
            <input
              type="datetime-local"
              value={localDateTimeInput(value.rankLockAt)}
              onChange={(event) =>
                update({
                  rankLockAt: event.target.value
                    ? new Date(event.target.value).toISOString()
                    : null,
                })
              }
            />
          </Field>
          <Field label={tr('When a player does not meet these limits')}>
            <select
              value={value.ineligible}
              onChange={(event) =>
                update({ ineligible: event.target.value as RegistrationPolicy['ineligible'] })
              }
            >
              <option value="REJECT">{tr('Refuse the registration')}</option>
              <option value="REVIEW">{tr('Keep it for an organizer to decide')}</option>
            </select>
          </Field>
          <Field label={tr('Eligible countries (ISO codes, optional)')}>
            <input
              defaultValue={value.countries.join(', ')}
              placeholder="IT, FR"
              onBlur={(event) =>
                update({
                  countries: event.target.value
                    .split(',')
                    .map((code) => code.trim().toUpperCase())
                    .filter(Boolean),
                })
              }
            />
          </Field>
        </div>
        <label className="mt-4 flex items-center gap-2">
          <input
            type="checkbox"
            checked={value.countryTeams}
            onChange={(event) => update({ countryTeams: event.target.checked })}
          />
          {tr('National teams: one team per country, with players from that country')}
        </label>
      </details>
      <h3 className="font-semibold">{tr('Custom registration fields')}</h3>
      <p className="text-xs text-muted">
        {tr(
          'Answers are private to the captain and authorized organizers. Labels remain in the language you write.',
        )}
      </p>
      {value.fields.map((field, index) => (
        <div key={index} className="space-y-3 rounded-xl border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tr('Field key')}>
              <input
                value={field.key}
                pattern="[a-z][a-z0-9_]{0,39}"
                onChange={(event) =>
                  update({
                    fields: value.fields.map((item, i) =>
                      i === index ? { ...item, key: event.target.value } : item,
                    ),
                  })
                }
              />
            </Field>
            <Field label={tr('Field label')}>
              <input
                value={field.label}
                maxLength={120}
                onChange={(event) =>
                  update({
                    fields: value.fields.map((item, i) =>
                      i === index ? { ...item, label: event.target.value } : item,
                    ),
                  })
                }
              />
            </Field>
            <Field label={tr('Field type')}>
              <select
                value={field.type}
                onChange={(event) =>
                  update({
                    fields: value.fields.map((item, i) =>
                      i === index
                        ? { ...item, type: event.target.value as typeof field.type }
                        : item,
                    ),
                  })
                }
              >
                {(['text', 'longtext', 'number', 'choice', 'checkbox'] as const).map((type) => (
                  <option key={type} value={type}>
                    {tr(
                      {
                        text: 'Text',
                        longtext: 'Long text',
                        number: 'Number',
                        choice: 'Choice',
                        checkbox: 'Checkbox',
                      }[type],
                    )}
                  </option>
                ))}
              </select>
            </Field>
            {field.type === 'choice' && (
              <Field label={tr('Choices (one per line)')}>
                <textarea
                  defaultValue={field.options.join('\n')}
                  onBlur={(event) =>
                    update({
                      fields: value.fields.map((item, i) =>
                        i === index
                          ? {
                              ...item,
                              options: event.target.value
                                .split('\n')
                                .map((option) => option.trim())
                                .filter(Boolean),
                            }
                          : item,
                      ),
                    })
                  }
                />
              </Field>
            )}
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={field.required}
                onChange={(event) =>
                  update({
                    fields: value.fields.map((item, i) =>
                      i === index ? { ...item, required: event.target.checked } : item,
                    ),
                  })
                }
              />
              {tr('Required')}
            </label>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => update({ fields: value.fields.filter((_, i) => i !== index) })}
            >
              {tr('Remove field')}
            </Button>
          </div>
        </div>
      ))}
      {value.fields.length < 20 && (
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            update({
              fields: [
                ...value.fields,
                {
                  key: `field_${value.fields.length + 1}`,
                  label: tr('New field'),
                  type: 'text',
                  required: false,
                  options: [],
                },
              ],
            })
          }
        >
          {tr('Add registration field')}
        </Button>
      )}
    </section>
  );
}
