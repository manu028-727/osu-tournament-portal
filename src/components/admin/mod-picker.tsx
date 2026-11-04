'use client';
import { useT } from '@/components/locale';
import { MODS } from '@/lib/match-rules';

// A set of checkboxes in place of typing codes, so a value can never be half-entered or misspelled.
export function CheckList({
  label,
  options,
  value,
  onChange,
  hint,
  locked = [],
}: {
  label: string;
  options: readonly string[];
  value: readonly string[];
  onChange: (value: string[]) => void;
  hint?: string;
  locked?: readonly string[];
}) {
  return (
    <fieldset className="min-w-0 space-y-1">
      <legend className="text-sm">{label}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {options.map((option) => (
          <label key={option} className="flex min-h-8 items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={value.includes(option)}
              disabled={locked.includes(option)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? // Kept in list order, so the same choice always reads the same way.
                      options.filter((item) => item === option || value.includes(item))
                    : value.filter((item) => item !== option),
                )
              }
            />
            {option}
          </label>
        ))}
      </div>
      {hint && <p className="text-xs leading-5 text-muted">{hint}</p>}
    </fieldset>
  );
}

export function ModPicker(props: Omit<Parameters<typeof CheckList>[0], 'options'>) {
  return <CheckList {...props} options={MODS} />;
}

// The mods a multiplier key combines, read and written in the order keys are stored.
const COMBINABLE = ['EZ', 'HD', 'HR', 'DT', 'NC', 'HT', 'FL', 'SD', 'PF'] as const;
export function ModComboPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const tr = useT();
  const picked = value === 'NM' ? [] : (value.match(/.{2}/g) ?? []);
  return (
    <div className="space-y-1">
      <CheckList
        label={label}
        options={COMBINABLE}
        value={picked}
        onChange={(mods) => onChange(mods.join(''))}
      />
      <label className="flex min-h-8 items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          checked={value === 'NM'}
          onChange={(event) => onChange(event.target.checked ? 'NM' : '')}
        />
        {tr('No mod')}
      </label>
    </div>
  );
}
