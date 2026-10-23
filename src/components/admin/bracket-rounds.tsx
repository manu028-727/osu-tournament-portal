'use client';
import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CompetitionBracketData, CompetitionOptions } from '@/lib/competition-types';
import type { CompetitionAction } from '@/lib/competition-validation';
import { Field, Modal, useTask } from './shared';

export function BracketRoundTools({
  bracket,
  options,
  save,
}: {
  bracket: CompetitionBracketData;
  options: CompetitionOptions;
  save: (input: CompetitionAction) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [stageId, setStageId] = useState('');
  const { busy, run } = useTask();
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setSelected([]);
          setStageId('');
          setOpen(true);
        }}
      >
        <SlidersHorizontal size={16} />
        Round stages
      </Button>
      <Modal title="Assign round stages" open={open} onOpenChange={setOpen}>
        <div className="space-y-4">
          <div className="max-h-72 overflow-auto divide-y">
            {bracket.rounds.map((round) => {
              const matches = bracket.nodes.filter((node) => node.roundId === round.id);
              const locked = matches.some(
                (node) => node.match && (node.match.status !== 'SCHEDULED' || node.match.startedAt),
              );
              return (
                <label key={round.id} className="flex min-h-11 items-center gap-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(round.id)}
                    disabled={locked || busy}
                    onChange={(event) =>
                      setSelected((value) =>
                        event.target.checked
                          ? [...value, round.id]
                          : value.filter((id) => id !== round.id),
                      )
                    }
                  />
                  <span className="min-w-0 flex-1">
                    {round.name}
                    <span className="block text-xs text-muted">
                      {options.stages.find((stage) => stage.id === round.stageId)?.name} ·{' '}
                      {matches.length} positions{locked ? ' · history protected' : ''}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <Field label={`Stage for ${selected.length} selected rounds`}>
            <select value={stageId} onChange={(event) => setStageId(event.target.value)}>
              <option value="">Keep current stages</option>
              {options.stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !selected.length || !stageId}
              onClick={() =>
                void run(async () => {
                  await save({
                    type: 'competition.rounds.stage',
                    id: bracket.id,
                    baseVersion: bracket.version,
                    roundIds: selected,
                    stageId,
                  });
                  setOpen(false);
                }, 'Round stages updated.')
              }
            >
              Apply stage
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
