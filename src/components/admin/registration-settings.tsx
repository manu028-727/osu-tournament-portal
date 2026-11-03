'use client';
import { useT } from '@/components/locale';
import type { RegistrationPolicy } from '@/lib/registration-policy';
import { localDateTimeInput } from '@/lib/utils';
import { Field } from './shared';
import { Button } from '../ui/button';

export function RegistrationSettings({
  value,
  onChange,
}: {
  value: RegistrationPolicy;
  onChange: (value: RegistrationPolicy) => void;
}) {
  const tr = useT();
  const update = (patch: Partial<RegistrationPolicy>) => onChange({ ...value, ...patch });
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
        {(['minPlayers', 'maxPlayers', 'maxSubstitutes', 'minRank', 'maxRank'] as const).map(
          (key, index) => (
            <Field
              key={key}
              label={tr(
                [
                  'Minimum starters (0 uses gameplay rules)',
                  'Maximum roster size',
                  'Maximum substitutes',
                  'Minimum rank (optional)',
                  'Maximum rank (optional)',
                ][index],
              )}
            >
              <input
                type="number"
                min={key.includes('Rank') ? 1 : 0}
                max={key.includes('Rank') ? 2147483647 : 32}
                value={value[key] ?? ''}
                onChange={(event) =>
                  update({
                    [key]:
                      event.target.value === '' && key.includes('Rank')
                        ? null
                        : Number(event.target.value),
                  })
                }
              />
            </Field>
          ),
        )}
        {(['rankSumMin', 'rankSumMax'] as const).map((key, index) => (
          <Field
            key={key}
            label={tr(
              ['Lowest team rank sum (optional)', 'Highest team rank sum (optional)'][index],
            )}
          >
            <input
              type="number"
              min={1}
              max={2147483647}
              value={value[key] ?? ''}
              onChange={(event) =>
                update({ [key]: event.target.value === '' ? null : Number(event.target.value) })
              }
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
                rankLockAt: event.target.value ? new Date(event.target.value).toISOString() : null,
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
      <div className="flex flex-wrap gap-5">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={value.rosterLocked}
            onChange={(event) => update({ rosterLocked: event.target.checked })}
          />
          {tr('Lock captain roster edits')}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={value.countryTeams}
            onChange={(event) => update({ countryTeams: event.target.checked })}
          />
          {tr('National teams: one team per country, with players from that country')}
        </label>
      </div>
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
