'use client';
import { useT } from '@/components/locale';

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
  const tr = useT();
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
        <Field label={tr('Team mode')}>
          <select
            value={rules.teamMode}
            onChange={(e) =>
              onChange({ ...rules, teamMode: e.target.value as MatchRules['teamMode'] })
            }
          >
            <option value="TEAM_VS">{tr('Team versus')}</option>
            <option value="HEAD_TO_HEAD">{tr('Head to head')}</option>
            <option value="TAG_COOP">{tr('Tag coop')}</option>
            <option value="TAG_TEAM_VS">{tr('Tag team versus')}</option>
          </select>
        </Field>
        <Field label={tr('Gameplay scoring')}>
          <output className="block py-2 text-sm">
            {rules.gameplayScoring === 'LAZER'
              ? tr('osu!lazer')
              : rules.scoreMode === 'SCORE'
                ? tr('ScoreV1')
                : rules.scoreMode === 'SCORE_V2'
                  ? tr('ScoreV2')
                  : rules.scoreMode}{' '}
            {tr('(Tournament Settings)')}
          </output>
        </Field>
        {numbers.map(([key, label]) => (
          <Field key={key} label={tr(label)}>
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
          <Field key={key} label={tr(label)}>
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
              {key === 'banOrder' && <option value="AB">{tr('AB - one ban each')}</option>}
              <option value="ABBA">{tr('ABBA')}</option>
              <option value="ABAB">{tr('ABAB')}</option>
            </select>
          </Field>
        ))}
        <Field label={tr('Ban sequence preview')}>
          <output className="block py-2 text-sm">
            {Array.from(
              {
                length:
                  2 *
                  (rules.draftSequence.length
                    ? rules.draftSequence.filter((s) => s === 'BAN').length
                    : rules.bansPerTeam),
              },
              (_, index) => tr('{0} bans', rules.banOrder[index % rules.banOrder.length]),
            ).join(' → ') || tr('No bans')}
          </output>
        </Field>
        {(['firstBanRule', 'firstPickRule', 'firstProtectRule'] as const).map((key) => (
          <Field
            key={key}
            label={
              key === 'firstBanRule'
                ? tr('First banning team')
                : key === 'firstPickRule'
                  ? tr('First picking team')
                  : tr('First protecting team')
            }
          >
            <select
              value={rules[key]}
              onChange={(e) => onChange({ ...rules, [key]: e.target.value })}
            >
              {START_RULES.filter((r) => rules.rollRequired || ['RED', 'BLUE'].includes(r)).map(
                (r) => (
                  <option key={r} value={r}>
                    {tr(
                      {
                        CHOICE: 'Chosen after roll',
                        ROLL_WINNER: 'Roll winner',
                        ROLL_LOSER: 'Roll loser',
                        RED: 'Red',
                        BLUE: 'Blue',
                      }[r],
                    )}
                  </option>
                ),
              )}
            </select>
          </Field>
        ))}
        <Field label={tr('First tiebreaker ban')}>
          <select
            value={rules.tiebreakerBanFirstSide}
            onChange={(e) =>
              onChange({
                ...rules,
                tiebreakerBanFirstSide: e.target.value as MatchRules['tiebreakerBanFirstSide'],
              })
            }
          >
            <option value="A">{tr('Team A')}</option>
            <option value="B">{tr('Team B')}</option>
          </select>
        </Field>
        <Field label={tr('Tiebreaker category')}>
          <input
            value={rules.tiebreakerCategory}
            onChange={(e) =>
              onChange({ ...rules, tiebreakerCategory: e.target.value.toUpperCase() })
            }
          />
        </Field>
        <Field label={tr('Category exceptions (comma-separated)')}>
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
        <Field label={tr('FreeMod categories (comma-separated)')}>
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
        <legend className="font-semibold">{tr('Round action pairs')}</legend>
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
              {tr(kind.replace('_', ' '))}
            </Button>
          ))}
          <Button type="button" size="sm" variant="ghost" onClick={() => setSequence([])}>
            {tr('Use count-based order')}
          </Button>
        </div>
        <ol className="space-y-2">
          {rules.draftSequence.map((kind, index) => (
            <li key={index} className="flex items-center gap-3 border-b pb-2">
              <span className="flex-1">
                {index + 1}. {tr(kind.replace('_', ' '))}
              </span>
              {([-1, 1] as const).map((direction) => (
                <Button
                  key={direction}
                  type="button"
                  size="icon"
                  variant="ghost"
                  title={direction < 0 ? tr('Move pair up') : tr('Move pair down')}
                  aria-label={tr('Move pair {0} {1}', index + 1, tr(direction < 0 ? 'up' : 'down'))}
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
                title={tr('Remove pair')}
                aria-label={tr('Remove pair {0}', index + 1)}
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
          {tr('Require a roll')}
        </label>
        {flags.map(([key, label]) => (
          <label key={key} className="flex items-start gap-3">
            <input
              className="mt-1 shrink-0"
              type="checkbox"
              checked={rules[key]}
              onChange={(e) => onChange({ ...rules, [key]: e.target.checked })}
            />
            {tr(label)}
          </label>
        ))}
      </div>
      <fieldset className="border-t pt-5">
        <legend className="text-lg font-semibold">{tr('Allowed FreeMod mods')}</legend>
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
        <legend className="text-lg font-semibold">{tr('Score multipliers')}</legend>
        <Field label={tr('Multiplier mode')}>
          <select
            value={rules.multiplierMode}
            onChange={(e) =>
              onChange({ ...rules, multiplierMode: e.target.value as MatchRules['multiplierMode'] })
            }
          >
            <option value="LEGACY_PRODUCT">{tr('Legacy product and rounding')}</option>
            <option value="UNIVERSAL">{tr('Universal exact combination')}</option>
            <option value="CUSTOM">{tr('Stage / slot exact combination')}</option>
            <option value="NONE">{tr('No conversion')}</option>
          </select>
        </Field>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {Object.entries(rules.modMultipliers).map(([key, value]) => (
            <div key={key} className="flex items-end gap-2">
              <div className="flex-1">
                <Field label={tr('{0} multiplier', key)}>
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
                aria-label={tr('Remove {0} multiplier', key)}
                title={tr('Remove multiplier')}
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
            <Field label={tr('New mod combination')}>
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
            {tr('Add multiplier')}
          </Button>
        </div>
        <div className="mt-4 space-y-2">
          {rules.slotModMultipliers.map((entry, index) => (
            <div key={`${entry.slot}:${entry.mods}`} className="flex items-center gap-3">
              <span className="flex-1">
                {entry.slot} / {entry.mods} {tr('×')} {entry.multiplier}
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                title={tr('Remove slot multiplier')}
                aria-label={tr('Remove {0} {1} multiplier', entry.slot, entry.mods)}
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
            <Field label={tr('Multiplier slot')}>
              <input
                value={slotMod.slot}
                onChange={(e) => setSlotMod({ ...slotMod, slot: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label={tr('Slot mod combination')}>
              <input
                value={slotMod.mods}
                onChange={(e) => setSlotMod({ ...slotMod, mods: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label={tr('Slot multiplier')}>
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
            {tr('Add slot multiplier')}
          </Button>
        </div>
      </fieldset>
      <div className="grid-fields">
        <Field label={tr('Red team emoji')}>
          <input
            value={rules.redEmoji}
            onChange={(e) => onChange({ ...rules, redEmoji: e.target.value })}
          />
        </Field>
        <Field label={tr('Blue team emoji')}>
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
          {tr('World Cup flags')}
        </label>
      </div>
      <fieldset className="border-t pt-5">
        <legend className="text-lg font-semibold">{tr('Lobby mod commands')}</legend>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {Object.entries(rules.categoryMods).map(([key, value]) => (
            <Field key={key} label={tr('{0} lobby mods', key)}>
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
            <Field label={tr('New mod category')}>
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
            {tr('Add category')}
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
          <Field key={key} label={tr(label)}>
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
