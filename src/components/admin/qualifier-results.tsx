'use client';
import { useT } from '@/components/locale';

import { useState } from 'react';
import type { Actor } from '@/lib/permissions';
import { QualifierStandings } from './qualifier-standings';
import { Field, LoadingState, useResource } from './shared';
import { QualifierImport } from './qualifier-import';
import { QualifierScoreManager } from './qualifier-score-manager';
import type { QualifierData } from '@/lib/qualifiers-types';
import { can } from '@/lib/permissions';
import styles from './qualifier-workflow.module.css';
import Link from '@/components/tournament-scope';
import { Button } from '../ui/button';
export function QualifierResults({ actor }: { actor: Actor }) {
  const tr = useT();
  const { data, error, reload } = useResource<{ id: string; name: string }[]>('qualifier-stages');
  const [selected, setSelected] = useState('');
  const [revision, setRevision] = useState(0);
  const sessions = useResource<QualifierData>('qualifiers&deleted=true');
  if (!data) return <LoadingState error={error} retry={() => void reload()} />;
  const stageId = data.some((s) => s.id === selected) ? selected : data[0]?.id;
  return (
    <div className={`${styles.workspace} space-y-4`}>
      <div className={styles.toolbar}>
        <Button asChild variant="ghost">
          <Link href="/admin/referee/qualifiers">{tr('Qualifier sessions')}</Link>
        </Button>
        <Field label={tr('Qualifier stage')}>
          <select value={stageId || ''} onChange={(e) => setSelected(e.target.value)}>
            {!data.length && <option value="">{tr('No qualifier stages')}</option>}
            {data.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        {stageId && can(actor, 'matches.manage') && (
          <QualifierImport
            key={stageId}
            stageId={stageId}
            onChanged={() => setRevision((value) => value + 1)}
          />
        )}
      </div>
      {stageId && (
        <>
          <QualifierStandings key={`${stageId}:${revision}`} stageId={stageId} actor={actor} />
          {can(actor, 'matches.manage') && sessions.data && (
            <QualifierScoreManager
              key={`${stageId}:${revision}`}
              stageId={stageId}
              lobbies={sessions.data.lobbies.filter(
                (l) => l.stage.id === stageId && l.status !== 'CANCELLED',
              )}
              onChanged={async () => {
                await sessions.reload();
                setRevision((v) => v + 1);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
