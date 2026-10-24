'use client';
import { localeTag } from '@/lib/i18n';
import { useLocale, useT } from '@/components/locale';

import { useState } from 'react';
import { MODS, type MatchRules } from '@/lib/match-rules';
import { convertedScore } from '@/lib/match-engine';
import { Field } from './shared';
export function FreeModCalculator({ rules }: { rules: MatchRules }) {
  const language = useLocale();
  const tr = useT();
  const [raw, setRaw] = useState(0),
    [mods, setMods] = useState<string[]>([]),
    [slot, setSlot] = useState('FM1');
  let result = '',
    issue = '';
  try {
    const value = convertedScore(rules, raw, mods, slot);
    result = `${raw.toLocaleString(localeTag(language))} × ${value.multiplier} = ${value.adjusted.toLocaleString(localeTag(language), { maximumFractionDigits: 10 })}`;
  } catch (error) {
    issue = (error as Error).message;
  }
  return (
    <details className="border-y py-4">
      <summary className="cursor-pointer font-semibold">{tr('FreeMod calculator')}</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label={tr('Calculator raw score')}>
          <input
            type="number"
            min={0}
            step="any"
            value={raw}
            onChange={(e) => setRaw(Number(e.target.value))}
          />
        </Field>
        <Field label={tr('Calculator slot')}>
          <input value={slot} onChange={(e) => setSlot(e.target.value.toUpperCase())} />
        </Field>
      </div>
      <div className="my-4 flex flex-wrap gap-3">
        {MODS.filter((m) => m !== 'NF').map((mod) => (
          <label key={mod} className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={mods.includes(mod)}
              onChange={(e) =>
                setMods(e.target.checked ? [...mods, mod] : mods.filter((m) => m !== mod))
              }
            />
            {mod}
          </label>
        ))}
      </div>
      <output className="block break-words font-mono text-sm">{issue || result}</output>
      <p className="mt-2 text-xs text-muted">{rules.multiplierMode}</p>
    </details>
  );
}
