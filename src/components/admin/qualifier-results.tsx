'use client';
import { useState } from 'react';
import type { Actor } from '@/lib/permissions';
import { QualifierStandings } from './qualifier-standings';
import { Field, LoadingState, useResource } from './shared';
export function QualifierResults({ actor }: { actor: Actor }) {
  const { data, error, reload } = useResource<{ id: string; name: string }[]>('qualifier-stages');
  const [selected, setSelected] = useState('');
  if (!data) return <LoadingState error={error} retry={() => void reload()} />;
  const stageId = data.some((s) => s.id === selected) ? selected : data[0]?.id;
  return (
    <div className="space-y-5">
      <Field label="Qualifier stage">
        <select value={stageId || ''} onChange={(e) => setSelected(e.target.value)}>
          {!data.length && <option value="">No qualifier stages</option>}
          {data.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      {stageId && <QualifierStandings key={stageId} stageId={stageId} actor={actor} />}
    </div>
  );
}
