'use client';
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useT } from '@/components/locale';
import { Button } from '@/components/ui/button';
import { poolForBestOf, POOL_CATEGORIES } from '@/lib/format-templates';
import type { Actor } from '@/lib/permissions';
import { qualifierPolicySchema, type QualifierPolicy } from '@/lib/qualifier-policy';
import type { SetupWorkspaceData } from '@/lib/setup-queries';
import { stageGridOperations, stageRows, type StageRow } from '@/lib/setup-operations';
import { confirmDiscardUnsaved } from '@/components/unsaved-navigation';
import { PoolEditor } from '../pool-editor';
import { QualifierPolicyFields } from '../qualifier-policy-fields';
import { action, ConfirmButton, SaveButton, useTask, useUnsaved } from '../shared';
import styles from './setup.module.css';

const KIND_LABELS: Record<StageRow['kind'], string> = {
  QUALIFIERS: 'Qualifiers',
  GROUPS: 'Groups',
  ELIMINATION: 'Bracket',
  CUSTOM: 'Custom',
};

function StagePolicy({
  stage,
  data,
  reload,
}: {
  stage: SetupWorkspaceData['stages'][number];
  data: SetupWorkspaceData;
  reload: () => Promise<unknown>;
}) {
  const tr = useT();
  const { busy, run } = useTask();
  const saved = useMemo(
    () => qualifierPolicySchema.parse(stage.qualifierPolicy ?? {}),
    [stage.qualifierPolicy],
  );
  const [policy, setPolicy] = useState<QualifierPolicy>(saved);
  useEffect(() => setPolicy(saved), [saved]);
  const dirty = JSON.stringify(policy) !== JSON.stringify(saved);
  useUnsaved(dirty);
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await action({
            type: 'stage.save',
            id: stage.id,
            baseConfigurationToken: stage.configurationToken,
            name: stage.name,
            slug: stage.slug,
            description: stage.description,
            position: stage.position,
            startsAt: stage.startsAt,
            kind: stage.kind,
            qualifierPolicy: policy,
          });
          await reload();
        }, tr('Qualifier scoring saved.'));
      }}
    >
      <QualifierPolicyFields
        value={policy}
        onChange={setPolicy}
        disabled={busy}
        gameMode={data.tournament.gameMode}
        gameplayScoring={data.gameplayScoring}
      />
      <div>
        <SaveButton busy={busy} disabled={busy || !dirty}>
          {tr('Save qualifier scoring')}
        </SaveButton>
      </div>
    </form>
  );
}

export function StagesSection({
  actor,
  data,
  reload,
  canEdit,
}: {
  actor: Actor;
  data: SetupWorkspaceData;
  reload: () => Promise<unknown>;
  canEdit: boolean;
}) {
  const tr = useT();
  const { busy, run } = useTask();
  const saved = useMemo(() => stageRows(data), [data]);
  const [rows, setRows] = useState<StageRow[]>(saved);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => setRows(saved), [saved]);
  const dirty = JSON.stringify(rows) !== JSON.stringify(saved);
  useUnsaved(dirty);
  const set = (key: string, fields: Partial<StageRow>) =>
    setRows(rows.map((row) => (row.key === key ? { ...row, ...fields } : row)));
  const toggle = (key: string) => {
    if (expanded && expanded !== key && !confirmDiscardUnsaved()) return;
    setExpanded(expanded === key ? null : key);
  };
  const num = (value: string) => (value === '' ? null : Number(value));
  const openStage = data.stages.find((stage) => stage.id === expanded);
  return (
    <div className="grid min-w-0 gap-3">
      <div className={styles.gridScroll}>
        <table className={styles.grid}>
          <thead>
            <tr>
              <th aria-label={tr('Details')} />
              <th>{tr('Stage')}</th>
              <th>{tr('Type')}</th>
              <th>{tr('Best of')}</th>
              <th>{tr('Bans')}</th>
              {POOL_CATEGORIES.map((category) => (
                <th key={category}>{category}</th>
              ))}
              <th>{tr('Min ★')}</th>
              <th>{tr('Max ★')}</th>
              <th>{tr('Mappool')}</th>
              <th aria-label={tr('Remove')} />
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((row) => {
              const qualifier = row.kind === 'QUALIFIERS';
              return [
                <tr key={row.key}>
                  <td>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={!row.id}
                      aria-expanded={expanded === row.key}
                      aria-label={tr('Details for {0}', row.name)}
                      onClick={() => toggle(row.key)}
                    >
                      {expanded === row.key ? (
                        <ChevronDown size={16} />
                      ) : (
                        <ChevronRight size={16} />
                      )}
                    </Button>
                  </td>
                  <td className={styles.nameColumn}>
                    <input
                      aria-label={tr('Stage name')}
                      required
                      maxLength={120}
                      disabled={!canEdit}
                      value={row.name}
                      onChange={(event) => set(row.key, { name: event.target.value })}
                    />
                  </td>
                  <td className={styles.typeColumn}>
                    <select
                      aria-label={tr('Type of {0}', row.name)}
                      disabled={!canEdit || !!row.id}
                      value={row.kind}
                      onChange={(event) => {
                        const kind = event.target.value as StageRow['kind'];
                        set(row.key, {
                          kind,
                          bestOf: kind === 'QUALIFIERS' ? null : (row.bestOf ?? 9),
                          bansPerTeam: kind === 'QUALIFIERS' ? null : (row.bansPerTeam ?? 1),
                        });
                      }}
                    >
                      {Object.entries(KIND_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {tr(label)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={tr('Best of for {0}', row.name)}
                      className={styles.count}
                      type="number"
                      min={1}
                      max={31}
                      step={2}
                      disabled={!canEdit || qualifier}
                      value={row.bestOf ?? ''}
                      onChange={(event) => set(row.key, { bestOf: num(event.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={tr('Bans for {0}', row.name)}
                      className={styles.count}
                      type="number"
                      min={0}
                      max={8}
                      disabled={!canEdit || qualifier}
                      value={row.bansPerTeam ?? ''}
                      onChange={(event) => set(row.key, { bansPerTeam: num(event.target.value) })}
                    />
                  </td>
                  {POOL_CATEGORIES.map((category) => (
                    <td key={category}>
                      <input
                        aria-label={tr('{0} maps for {1}', category, row.name)}
                        className={styles.count}
                        type="number"
                        min={0}
                        max={30}
                        disabled={!canEdit}
                        value={row.pool[category]}
                        onChange={(event) =>
                          set(row.key, {
                            pool: { ...row.pool, [category]: Number(event.target.value) },
                          })
                        }
                      />
                    </td>
                  ))}
                  <td>
                    <input
                      aria-label={tr('Minimum stars for {0}', row.name)}
                      className={styles.stars}
                      type="number"
                      min={0}
                      max={30}
                      step="any"
                      disabled={!canEdit}
                      value={row.minStars ?? ''}
                      onChange={(event) => set(row.key, { minStars: num(event.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={tr('Maximum stars for {0}', row.name)}
                      className={styles.stars}
                      type="number"
                      min={0}
                      max={30}
                      step="any"
                      disabled={!canEdit}
                      value={row.maxStars ?? ''}
                      onChange={(event) => set(row.key, { maxStars: num(event.target.value) })}
                    />
                  </td>
                  <td className="whitespace-nowrap">
                    {row.poolState === 'PUBLISHED'
                      ? tr('Published')
                      : row.poolSlots
                        ? tr('{0} maps in draft', row.poolSlots)
                        : tr('Empty')}
                  </td>
                  <td>
                    {row.id ? (
                      <ConfirmButton
                        title={tr('Delete {0}?', row.name)}
                        description={tr('This stage and its empty mappool will be removed.')}
                        disabled={!canEdit || busy}
                        onConfirm={() =>
                          void run(async () => {
                            await action({ type: 'stage.delete', id: row.id });
                            await reload();
                          }, tr('Stage deleted.'))
                        }
                      >
                        <Trash2 size={16} />
                      </ConfirmButton>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={tr('Remove {0}', row.name)}
                        onClick={() => setRows(rows.filter((item) => item.key !== row.key))}
                      >
                        <Trash2 size={16} />
                      </Button>
                    )}
                  </td>
                </tr>,
              ];
            })}
            {!rows.length && (
              <tr>
                <td colSpan={POOL_CATEGORIES.length + 9} className="py-4 text-sm text-muted">
                  {tr('No stages yet.')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {openStage && (
        <section className={styles.stageDetails} aria-label={openStage.name}>
          <h3 className="font-semibold">{openStage.name}</h3>
          {openStage.kind === 'QUALIFIERS' && (
            <StagePolicy stage={openStage} data={data} reload={reload} />
          )}
          <PoolEditor key={openStage.id} actor={actor} initialStageId={openStage.id} />
        </section>
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setRows([
                ...rows,
                {
                  key: `new-${Date.now()}`,
                  id: null,
                  token: null,
                  name: '',
                  kind: 'ELIMINATION',
                  bestOf: 9,
                  bansPerTeam: 1,
                  pool: poolForBestOf(9),
                  minStars: null,
                  maxStars: null,
                  planVersion: null,
                  poolState: 'DRAFT',
                  poolSlots: 0,
                },
              ])
            }
          >
            <Plus size={16} />
            {tr('Add stage')}
          </Button>
          <SaveButton
            type="button"
            busy={busy}
            disabled={busy || !dirty || rows.some((row) => !row.name.trim())}
            onClick={() =>
              void run(async () => {
                await action({ type: 'setup.apply', operations: stageGridOperations(rows, data) });
                await reload();
              }, tr('Stages saved.'))
            }
          >
            {tr('Save stages')}
          </SaveButton>
        </div>
      )}
    </div>
  );
}
