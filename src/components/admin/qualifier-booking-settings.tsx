'use client';
import { useT } from '../locale';
import { Field } from './shared';
import { localDateTimeInput } from '@/lib/utils';
import type { QualifierBookingPolicy } from '@/lib/qualifier-booking-policy';

export function QualifierBookingSettings({
  value,
  onChange,
}: {
  value: QualifierBookingPolicy;
  onChange: (value: QualifierBookingPolicy) => void;
}) {
  const tr = useT();
  return (
    <section id="qualifier-booking" className="form-section space-y-3">
      <h2 className="text-lg font-semibold">{tr('Qualifier booking')}</h2>
      <p className="text-sm text-muted">
        {tr(
          'Registered entrants reserve sessions independently. Booking changes never unregister teams or change roster deadlines.',
        )}
      </p>
      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
        />
        {tr('Allow captain qualifier booking')}
      </label>
      <div className="grid-fields">
        {(['opensAt', 'closesAt'] as const).map((key, index) => (
          <Field
            key={key}
            label={tr(index ? 'Booking deadline (your timezone)' : 'Booking opens (your timezone)')}
          >
            <input
              type="datetime-local"
              value={localDateTimeInput(value[key])}
              onChange={(e) =>
                onChange({
                  ...value,
                  [key]: e.target.value ? new Date(e.target.value).toISOString() : null,
                })
              }
            />
          </Field>
        ))}
      </div>
    </section>
  );
}
