'use client';
import { useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '../ui/button';
import { Field } from './shared';
import { MODS, START_RULES, type MatchRules } from '@/lib/match-rules';
const numbers = [
  ['teamSize', 'Players per side'],
  ['bestOf', 'Best of'],
  ['bansPerTeam', 'Bans per team'],
  ['protectsPerTeam', 'Protects per team'],
  ['warmupsPerTeam', 'Warmups per team'],
  ['timeoutsPerTeam', 'Timeouts per team'],
  ['pickSeconds', 'Pick timer (seconds)'],
  ['banSeconds', 'Ban timer (seconds)'],
  ['readySeconds', 'Ready timer (seconds)'],
  ['timeoutSeconds', 'Timeout (seconds)'],
  ['freeModRequiredHD', 'FreeMod: required HD/EZ players'],
  ['freeModRequiredHR', 'FreeMod: required HR players'],
] as const;
const flags = [
  ['enforceNoFail', 'Require NoFail'],
  ['enableTiebreaker', 'Use a tiebreaker at match point'],
  ['allowTiebreakerBans', 'Allow tiebreaker bans/protects'],
  ['allowDoublePicks', 'Allow consecutive picks from the same category'],
  ['allowDoubleBans', 'Allow consecutive bans from the same category'],
  ['timeoutOnlyOwnPick', 'Timeouts only on the team’s own pick'],
] as const;
export function MatchRulesFields({
  rules,
  onChange,
}: {
  rules: MatchRules;
  onChange: (rules: MatchRules) => void;
}) {
  const [mod, setMod] = useState(''),
    [category, setCategory] = useState(''),
    [slotMod, setSlotMod] = useState({ slot: '', mods: 'HDHR', multiplier: 1 });
  const setSequence = (draftSequence: MatchRules['draftSequence']) =>
    onChange({
      ...rules,
      draftSequence,
      ...(draftSequence.length
        ? {
            bestOf: 1 + 2 * draftSequence.filter((a) => a === 'PICK').length,
            bansPerTeam: draftSequence.filter((a) => a === 'BAN').length,
            protectsPerTeam: draftSequence.filter((a) => a === 'PROTECT').length,
          }
        : {}),
    });
  return (
    <div className="space-y-7">
      <div className="grid-fields">
        <Field label="Team mode">
          <select
            value={rules.teamMode}
            onChange={(e) =>
              onChange({ ...rules, teamMode: e.target.value as MatchRules['teamMode'] })
            }
          >
            <option value="TEAM_VS">Team versus</option>
            <option value="HEAD_TO_HEAD">Head to head</option>
            <option value="TAG_COOP">Tag coop</option>
            <option value="TAG_TEAM_VS">Tag team versus</option>
          </select>
        </Field>
        <Field label="Scoring">
          <select
            value={rules.scoreMode}
            onChange={(e) =>
              onChange({ ...rules, scoreMode: e.target.value as MatchRules['scoreMode'] })
            }
          >
            <option value="SCORE_V2">ScoreV2</option>
            <option value="SCORE">Score</option>
            <option value="COMBO">Combo</option>
            <option value="ACCURACY">Accuracy</option>
          </select>
        </Field>
        {numbers.map(([key, label]) => (
          <Field key={key} label={label}>
            <input
              type="number"
              min={0}
              max={key.endsWith('Seconds') ? 900 : 31}
              value={rules[key]}
              onChange={(e) => onChange({ ...rules, [key]: Number(e.target.value) })}
            />
          </Field>
        ))}
        {(
          [
            ['pickOrder', 'Pick order'],
            ['banOrder', 'Ban order'],
            ['protectOrder', 'Protect order'],
            ['tiebreakerBanOrder', 'Tiebreaker ban order'],
          ] as const
        ).map(([key, label]) => (
          <Field key={key} label={label}>
            <select
              value={rules[key]}
              onChange={(e) =>
                onChange({
                  ...rules,
                  [key]: e.target.value,
                  ...(key === 'banOrder'
                    ? { bansPerTeam: e.target.value === 'AB' ? 1 : 2, draftSequence: [] }
                    : {}),
                })
              }
            >
              {key === 'banOrder' && <option value="AB">AB - one ban each</option>}
              <option value="ABBA">ABBA</option>
              <option value="ABAB">ABAB</option>
            </select>
          </Field>
        ))}
        <Field label="Ban sequence preview">
          <output className="block py-2 text-sm">
            {Array.from(
              {
                length:
                  2 *
                  (rules.draftSequence.length
                    ? rules.draftSequence.filter((s) => s === 'BAN').length
                    : rules.bansPerTeam),
              },
              (_, index) => `${rules.banOrder[index % rules.banOrder.length]} bans`,
            ).join(' → ') || 'No bans'}
          </output>
        </Field>
        {(['firstBanRule', 'firstPickRule', 'firstProtectRule'] as const).map((key) => (
          <Field
            key={key}
            label={
              key === 'firstBanRule'
                ? 'First banning team'
                : key === 'firstPickRule'
                  ? 'First picking team'
                  : 'First protecting team'
            }
          >
            <select
              value={rules[key]}
              onChange={(e) => onChange({ ...rules, [key]: e.target.value })}
            >
              {START_RULES.filter((r) => rules.rollRequired || ['RED', 'BLUE'].includes(r)).map(
                (r) => (
                  <option key={r} value={r}>
                    {
                      {
                        CHOICE: 'Chosen after roll',
                        ROLL_WINNER: 'Roll winner',
                        ROLL_LOSER: 'Roll loser',
                        RED: 'Red',
                        BLUE: 'Blue',
                      }[r]
                    }
                  </option>
                ),
              )}
            </select>
          </Field>
        ))}
        <Field label="First tiebreaker ban">
          <select
            value={rules.tiebreakerBanFirstSide}
            onChange={(e) =>
              onChange({
                ...rules,
                tiebreakerBanFirstSide: e.target.value as MatchRules['tiebreakerBanFirstSide'],
              })
            }
          >
            <option value="A">Team A</option>
            <option value="B">Team B</option>
          </select>
        </Field>
        <Field label="Tiebreaker category">
          <input
            value={rules.tiebreakerCategory}
            onChange={(e) =>
              onChange({ ...rules, tiebreakerCategory: e.target.value.toUpperCase() })
            }
          />
        </Field>
        <Field label="Category exceptions (comma-separated)">
          <input
            value={rules.categoryExceptions.join(',')}
            onChange={(e) =>
              onChange({
                ...rules,
                categoryExceptions: e.target.value.toUpperCase().split(',').filter(Boolean),
              })
            }
          />
        </Field>
        <Field label="FreeMod categories (comma-separated)">
          <input
            value={rules.freeModCategories.join(',')}
            onChange={(e) =>
              onChange({
                ...rules,
                freeModCategories: e.target.value.toUpperCase().split(',').filter(Boolean),
              })
            }
          />
        </Field>
      </div>
      <fieldset className="border-t pt-4">
        <legend className="font-semibold">Round action pairs</legend>
        <div className="my-3 flex flex-wrap gap-2">
          {(['PROTECT', 'BAN', 'PICK', 'TB_BAN'] as const).map((kind) => (
            <Button
              key={kind}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setSequence([...rules.draftSequence, kind])}
            >
              <Plus size={14} />
              {kind.replace('_', ' ')}
            </Button>
          ))}
          <Button type="button" size="sm" variant="ghost" onClick={() => setSequence([])}>
            Use count-based order
          </Button>
        </div>
        <ol className="space-y-2">
          {rules.draftSequence.map((kind, index) => (
            <li key={index} className="flex items-center gap-3 border-b pb-2">
              <span className="flex-1">
                {index + 1}. {kind.replace('_', ' ')}
              </span>
              {([-1, 1] as const).map((direction) => (
                <Button
                  key={direction}
                  type="button"
                  size="icon"
                  variant="ghost"
                  title={direction < 0 ? 'Move pair up' : 'Move pair down'}
                  aria-label={`Move pair ${index + 1} ${direction < 0 ? 'up' : 'down'}`}
                  disabled={
                    index + direction < 0 || index + direction >= rules.draftSequence.length
                  }
                  onClick={() => {
                    const next = [...rules.draftSequence];
                    [next[index], next[index + direction]] = [next[index + direction], next[index]];
                    setSequence(next);
                  }}
                >
                  {direction < 0 ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
                </Button>
              ))}
              <Button
                type="button"
                size="icon"
                variant="ghost"
                title="Remove pair"
                aria-label={`Remove pair ${index + 1}`}
                onClick={() => setSequence(rules.draftSequence.filter((_, i) => i !== index))}
              >
                <Trash2 size={16} />
              </Button>
            </li>
          ))}
        </ol>
      </fieldset>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={rules.rollRequired}
            onChange={(e) =>
              onChange({
                ...rules,
                rollRequired: e.target.checked,
                ...(!e.target.checked
                  ? { firstBanRule: 'RED', firstPickRule: 'RED', firstProtectRule: 'RED' }
                  : {}),
              })
            }
          />
          Require a roll
        </label>
        {flags.map(([key, label]) => (
          <label key={key} className="flex items-start gap-3">
            <input
              className="mt-1 shrink-0"
              type="checkbox"
              checked={rules[key]}
              onChange={(e) => onChange({ ...rules, [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
      <fieldset className="border-t pt-5">
        <legend className="text-lg font-semibold">Allowed FreeMod mods</legend>
        <div className="mt-4 flex flex-wrap gap-5">
          {MODS.map((mod) => (
            <label key={mod} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={rules.freeModAllowed.includes(mod)}
                onChange={(e) =>
                  onChange({
                    ...rules,
                    freeModAllowed: e.target.checked
                      ? [...rules.freeModAllowed, mod]
                      : rules.freeModAllowed.filter((m) => m !== mod),
                  })
                }
              />
              {mod}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="border-t pt-5">
        <legend className="text-lg font-semibold">Score multipliers</legend>
        <Field label="Multiplier mode">
          <select
            value={rules.multiplierMode}
            onChange={(e) =>
              onChange({ ...rules, multiplierMode: e.target.value as MatchRules['multiplierMode'] })
            }
          >
            <option value="LEGACY_PRODUCT">Legacy product and rounding</option>
            <option value="UNIVERSAL">Universal exact combination</option>
            <option value="CUSTOM">Stage / slot exact combination</option>
            <option value="NONE">No conversion</option>
          </select>
        </Field>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {Object.entries(rules.modMultipliers).map(([key, value]) => (
            <div key={key} className="flex items-end gap-2">
              <div className="flex-1">
                <Field label={`${key} multiplier`}>
                  <input
                    type="number"
                    step="any"
                    min="0.01"
                    max={10}
                    value={value}
                    onChange={(e) =>
                      onChange({
                        ...rules,
                        modMultipliers: { ...rules.modMultipliers, [key]: Number(e.target.value) },
                      })
                    }
                  />
                </Field>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Remove ${key} multiplier`}
                title="Remove multiplier"
                onClick={() =>
                  onChange({
                    ...rules,
                    modMultipliers: Object.fromEntries(
                      Object.entries(rules.modMultipliers).filter(([name]) => name !== key),
                    ),
                  })
                }
              >
                <Trash2 size={17} />
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-end gap-2">
          <div className="flex-1">
            <Field label="New mod combination">
              <input value={mod} onChange={(e) => setMod(e.target.value.toUpperCase())} />
            </Field>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!/^(?:NM|(?:EZ|HD|HR|DT|NC|HT|FL|SD|PF){1,8})$/.test(mod)}
            onClick={() => {
              onChange({ ...rules, modMultipliers: { ...rules.modMultipliers, [mod]: 1 } });
              setMod('');
            }}
          >
            <Plus size={17} />
            Add multiplier
          </Button>
        </div>
        <div className="mt-4 space-y-2">
          {rules.slotModMultipliers.map((entry, index) => (
            <div key={`${entry.slot}:${entry.mods}`} className="flex items-center gap-3">
              <span className="flex-1">
                {entry.slot} / {entry.mods} × {entry.multiplier}
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                title="Remove slot multiplier"
                aria-label={`Remove ${entry.slot} ${entry.mods} multiplier`}
                onClick={() =>
                  onChange({
                    ...rules,
                    slotModMultipliers: rules.slotModMultipliers.filter((_, i) => i !== index),
                  })
                }
              >
                <Trash2 size={16} />
              </Button>
            </div>
          ))}
          <div className="grid-fields">
            <Field label="Multiplier slot">
              <input
                value={slotMod.slot}
                onChange={(e) => setSlotMod({ ...slotMod, slot: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label="Slot mod combination">
              <input
                value={slotMod.mods}
                onChange={(e) => setSlotMod({ ...slotMod, mods: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label="Slot multiplier">
              <input
                type="number"
                step="any"
                min="0.01"
                max={10}
                value={slotMod.multiplier}
                onChange={(e) => setSlotMod({ ...slotMod, multiplier: Number(e.target.value) })}
              />
            </Field>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={
              !/^[A-Z0-9_-]{1,20}$/.test(slotMod.slot) ||
              !/^(?:NM|(?:EZ|HD|HR|DT|NC|HT|FL|SD|PF){1,8})$/.test(slotMod.mods)
            }
            onClick={() =>
              onChange({
                ...rules,
                slotModMultipliers: [
                  ...rules.slotModMultipliers.filter(
                    (m) => m.slot !== slotMod.slot || m.mods !== slotMod.mods,
                  ),
                  slotMod,
                ],
              })
            }
          >
            <Plus size={16} />
            Add slot multiplier
          </Button>
        </div>
      </fieldset>
      <div className="grid-fields">
        <Field label="Red team emoji">
          <input
            value={rules.redEmoji}
            onChange={(e) => onChange({ ...rules, redEmoji: e.target.value })}
          />
        </Field>
        <Field label="Blue team emoji">
          <input
            value={rules.blueEmoji}
            onChange={(e) => onChange({ ...rules, blueEmoji: e.target.value })}
          />
        </Field>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={rules.worldCup}
            onChange={(e) => onChange({ ...rules, worldCup: e.target.checked })}
          />
          World Cup flags
        </label>
      </div>
      <fieldset className="border-t pt-5">
        <legend className="text-lg font-semibold">Lobby mod commands</legend>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {Object.entries(rules.categoryMods).map(([key, value]) => (
            <Field key={key} label={`${key} lobby mods`}>
              <input
                value={value}
                onChange={(e) =>
                  onChange({
                    ...rules,
                    categoryMods: { ...rules.categoryMods, [key]: e.target.value },
                  })
                }
              />
            </Field>
          ))}
        </div>
        <div className="mt-4 flex items-end gap-2">
          <div className="flex-1">
            <Field label="New mod category">
              <input value={category} onChange={(e) => setCategory(e.target.value.toUpperCase())} />
            </Field>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!/^[A-Z0-9_-]{1,20}$/.test(category)}
            onClick={() => {
              onChange({ ...rules, categoryMods: { ...rules.categoryMods, [category]: '' } });
              setCategory('');
            }}
          >
            <Plus size={17} />
            Add category
          </Button>
        </div>
      </fieldset>
      <div className="grid gap-5">
        {(
          [
            ['latePolicy', 'Late arrival policy'],
            ['rollPolicy', 'Roll policy'],
            ['freeModPolicy', 'FreeMod policy'],
            ['tiebreakerPolicy', 'Tiebreaker policy'],
            ['disconnectPolicy', 'Disconnect policy'],
            ['warmupPolicy', 'Warmup policy'],
            ['timeoutPolicy', 'Timeout policy'],
            ['doublePickPolicy', 'Double pick policy'],
            ['doubleBanPolicy', 'Double ban policy'],
          ] as const
        ).map(([key, label]) => (
          <Field key={key} label={label}>
            <textarea
              value={rules[key]}
              onChange={(e) => onChange({ ...rules, [key]: e.target.value })}
            />
          </Field>
        ))}
      </div>
    </div>
  );
}
