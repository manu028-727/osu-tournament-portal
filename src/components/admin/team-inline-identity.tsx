'use client';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../locale';
import { Button } from '../ui/button';
import { action, Field, useTask, useUnsaved } from './shared';
import type { TeamView } from '@/lib/teams-types';
export function TeamInlineIdentity({
  team,
  onChanged,
  onDirty,
}: {
  team: TeamView;
  onChanged: () => Promise<unknown>;
  onDirty: (id: string, dirty: boolean) => void;
}) {
  const tr = useT(),
    { run, busy } = useTask();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [editing, setEditing] = useState(false),
    [name, setName] = useState(team.name),
    [seed, setSeed] = useState(team.seed);
  const [baseline, setBaseline] = useState({
    version: team.version,
    name: team.name,
    seed: team.seed,
  });
  const dirty = editing && (name !== baseline.name || seed !== baseline.seed);
  useUnsaved(dirty);
  useEffect(() => {
    onDirty(team.id, dirty);
    return () => onDirty(team.id, false);
  }, [team.id, dirty, onDirty]);
  return editing ? (
    <form
      className="min-w-48 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await action({
            type: 'team.patch',
            id: team.id,
            baseVersion: baseline.version,
            name,
            seed,
          });
          if (!mounted.current) return;
          setEditing(false);
          await onChanged();
        }, tr('Team saved.'));
      }}
    >
      <Field label={tr('Team name')}>
        <input
          autoFocus
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label={tr('Seed')}>
        <input
          type="number"
          min={1}
          max={100000}
          value={seed ?? ''}
          onChange={(e) => setSeed(e.target.value ? Number(e.target.value) : null)}
        />
      </Field>
      <div className="flex gap-1">
        <Button size="sm" disabled={!dirty || busy}>
          {tr('Save')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            setEditing(false);
            setName(team.name);
            setSeed(team.seed);
          }}
        >
          {tr('Cancel')}
        </Button>
      </div>
    </form>
  ) : (
    <Button
      className="h-auto max-w-full justify-start whitespace-normal p-0 text-left font-semibold"
      variant="ghost"
      onClick={() => {
        setBaseline({ version: team.version, name: team.name, seed: team.seed });
        setName(team.name);
        setSeed(team.seed);
        setEditing(true);
      }}
      aria-label={tr('Edit name and seed for {0}', team.name)}
    >
      {team.name}
    </Button>
  );
}
