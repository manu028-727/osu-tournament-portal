'use client';

import { useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StateBadge } from '@/components/ui/badge';
import { action, Field, Modal, SaveButton, useTask } from './shared';

type ReleaseStage = {
  id: string;
  name: string;
  mappool: {
    id: string;
    state: string;
    draftRevisionId: string | null;
    publishedRevisionId: string | null;
    draftRevision: { slots: unknown[] } | null;
  } | null;
};

export function PoolReleaseManager({
  stages,
  disabled,
  onSaved,
}: {
  stages: ReleaseStage[];
  disabled: boolean;
  onSaved: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [operation, setOperation] = useState<'PUBLISH' | 'UNPUBLISH'>('PUBLISH');
  const [selected, setSelected] = useState<string[]>([]);
  const { busy, run } = useTask();
  const eligible = stages.filter(
    (stage) =>
      stage.mappool &&
      (operation === 'PUBLISH'
        ? stage.mappool.draftRevision?.slots.length &&
          stage.mappool.draftRevisionId !== stage.mappool.publishedRevisionId
        : stage.mappool.state === 'PUBLISHED'),
  );
  const chosen = eligible.filter((stage) => selected.includes(stage.id));
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => {
          setSelected([]);
          setOpen(true);
        }}
      >
        <Send size={14} />
        Pool releases
      </Button>
      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
        title="Pool releases"
        wide
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              async () => {
                await action({
                  type: 'pooling.pools.release',
                  operation,
                  pools: chosen.map((stage) => ({
                    id: stage.mappool!.id,
                    state: stage.mappool!.state,
                    draftRevisionId: stage.mappool!.draftRevisionId,
                    publishedRevisionId: stage.mappool!.publishedRevisionId,
                  })),
                });
                await onSaved();
                setOpen(false);
                setSelected([]);
              },
              operation === 'PUBLISH' ? 'Selected pools published.' : 'Selected pools unpublished.',
            );
          }}
        >
          <Field label="Release action">
            <select
              value={operation}
              disabled={busy}
              onChange={(event) => {
                setOperation(event.target.value as typeof operation);
                setSelected([]);
              }}
            >
              <option value="PUBLISH">Publish saved drafts</option>
              <option value="UNPUBLISH">Unpublish public pools</option>
            </select>
          </Field>
          <div className="overflow-x-auto">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Select all eligible pools"
                      disabled={busy || !eligible.length}
                      checked={!!eligible.length && chosen.length === eligible.length}
                      onChange={(event) =>
                        setSelected(event.target.checked ? eligible.map((stage) => stage.id) : [])
                      }
                    />
                  </th>
                  <th>Stage</th>
                  <th>Publication</th>
                  <th>Saved maps</th>
                </tr>
              </thead>
              <tbody>
                {stages.map((stage) => (
                  <tr key={stage.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Release ${stage.name}`}
                        disabled={busy || !eligible.some((item) => item.id === stage.id)}
                        checked={chosen.some((item) => item.id === stage.id)}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, stage.id]
                              : current.filter((id) => id !== stage.id),
                          )
                        }
                      />
                    </td>
                    <td>{stage.name}</td>
                    <td>
                      <StateBadge state={stage.mappool?.state || 'DRAFT'} />
                    </td>
                    <td>{stage.mappool?.draftRevision?.slots.length ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted">
            {operation === 'PUBLISH'
              ? 'Selected saved drafts become public. Incomplete plans, invalid stages and unresolved artist bans block the entire release.'
              : 'Selected pools disappear from public pages. Saved drafts, revisions and match snapshots are preserved.'}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SaveButton busy={busy} disabled={!chosen.length}>
              {operation === 'PUBLISH' ? 'Publish' : 'Unpublish'} {chosen.length} pools
            </SaveButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
