'use client';
import { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useT } from '@/components/locale';
import { Button } from '@/components/ui/button';
import { poolForBestOf } from '@/lib/format-templates';
import type { Actor } from '@/lib/permissions';
import { qualifierPolicySchema, type QualifierPolicy } from '@/lib/qualifier-policy';
import type { SetupWorkspaceData } from '@/lib/setup-queries';
import {
  mapsNeeded,
  newMapTypeOperations,
  poolCounts,
  resizedPool,
  stageGridOperations,
  stageRows,
  type StageRow,
} from '@/lib/setup-operations';
import { confirmDiscardUnsaved } from '@/components/unsaved-navigation';
import { PoolEditor } from '../pool-editor';
import { QualifierPolicyFields } from '../qualifier-policy-fields';
import {
  action,
  ConfirmButton,
  Field,
  NumberInput,
  SaveButton,
  useTask,
  useUnsaved,
} from '../shared';
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
  const openStage = data.stages.find((stage) => stage.id === expanded);
  const openRow = rows.find((row) => row.key === expanded);
  const categories = data.categories.length ? data.categories : Object.keys(saved[0]?.pool ?? {});
  const [newType, setNewType] = useState('');
  // Best of usually rises through a bracket, so one row can fill in the ones after it.
  const copyDown = (index: number) => {
    const { bestOf, bansPerTeam, pool } = rows[index];
    setRows(
      rows.map((row, position) =>
        position > index && row.kind !== 'QUALIFIERS'
          ? { ...row, bestOf, bansPerTeam, pool: { ...pool } }
          : row,
      ),
    );
  };
  return (
    <div className="grid min-w-0 gap-3">
      <div className={styles.gridScroll}>
        <table className={styles.grid}>
          <thead>
            <tr>
              <th aria-label={tr('Details')} />
              <th>{tr('Stage')}</th>
              <th className={styles.typeColumn}>{tr('Type')}</th>
              <th>{tr('Best of')}</th>
              <th>{tr('Bans')}</th>
              {categories.map((category) => (
                <th key={category}>{category}</th>
              ))}
              <th>{tr('Maps')}</th>
              <th>{tr('Mappool')}</th>
              <th aria-label={tr('Copy')} />
              <th aria-label={tr('Remove')} />
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((row, rowIndex) => {
              const qualifier = row.kind === 'QUALIFIERS';
              const total = Object.values(row.pool).reduce((sum, count) => sum + count, 0);
              const needed = mapsNeeded(row.bestOf, row.bansPerTeam);
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
                    {row.id ? (
                      // A saved stage keeps its type, because its pool and matches depend on it.
                      tr(KIND_LABELS[row.kind])
                    ) : (
                      <select
                        aria-label={tr('Type of {0}', row.name)}
                        disabled={!canEdit}
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
                    )}
                  </td>
                  <td>
                    {qualifier ? (
                      <span className={styles.notApplicable} aria-label={tr('Not applicable')}>
                        –
                      </span>
                    ) : (
                      <NumberInput
                        aria-label={tr('Best of for {0}', row.name)}
                        className={styles.count}
                        min={1}
                        max={31}
                        step={2}
                        odd
                        disabled={!canEdit}
                        value={row.bestOf}
                        onChange={(bestOf) =>
                          set(row.key, {
                            bestOf,
                            pool: resizedPool(row.pool, row.bestOf, bestOf),
                          })
                        }
                      />
                    )}
                  </td>
                  <td>
                    {qualifier ? (
                      <span className={styles.notApplicable} aria-label={tr('Not applicable')}>
                        –
                      </span>
                    ) : (
                      <NumberInput
                        aria-label={tr('Bans for {0}', row.name)}
                        className={styles.count}
                        min={0}
                        max={8}
                        disabled={!canEdit}
                        value={row.bansPerTeam}
                        onChange={(bansPerTeam) => set(row.key, { bansPerTeam })}
                      />
                    )}
                  </td>
                  {categories.map((category) => (
                    <td key={category}>
                      <NumberInput
                        aria-label={tr('{0} maps for {1}', category, row.name)}
                        className={styles.count}
                        min={0}
                        max={30}
                        disabled={!canEdit}
                        value={row.pool[category] ?? 0}
                        onChange={(count) =>
                          set(row.key, { pool: { ...row.pool, [category]: count ?? 0 } })
                        }
                      />
                    </td>
                  ))}
                  <td
                    className={total < needed ? styles.short : styles.total}
                    title={
                      total < needed
                        ? tr('This stage needs at least {0} maps for its Best of and bans.', needed)
                        : undefined
                    }
                  >
                    {total}
                    {total < needed && <span> / {needed}</span>}
                  </td>
                  <td className="whitespace-nowrap">
                    {row.id ? (
                      <button
                        type="button"
                        className={styles.poolLink}
                        onClick={() => toggle(row.key)}
                      >
                        {row.poolState === 'PUBLISHED'
                          ? tr('Published')
                          : row.poolSlots
                            ? tr('{0} maps in draft', row.poolSlots)
                            : tr('Add maps')}
                      </button>
                    ) : (
                      tr('Save first')
                    )}
                  </td>
                  <td>
                    {canEdit && !qualifier && rowIndex < rows.length - 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title={tr('Copy to the stages below')}
                        aria-label={tr('Copy {0} to the stages below', row.name)}
                        onClick={() => copyDown(rowIndex)}
                      >
                        <ArrowDownToLine size={16} />
                      </Button>
                    )}
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
                <td colSpan={categories.length + 8} className="py-4 text-sm text-muted">
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
          {openRow && (
            <div className="grid-fields">
              <Field label={tr('Lowest star rating (optional)')}>
                <NumberInput
                  nullable
                  min={0}
                  max={30}
                  step="any"
                  disabled={!canEdit}
                  value={openRow.minStars}
                  onChange={(minStars) => set(openRow.key, { minStars })}
                />
              </Field>
              <Field label={tr('Highest star rating (optional)')}>
                <NumberInput
                  nullable
                  min={0}
                  max={30}
                  step="any"
                  disabled={!canEdit}
                  value={openRow.maxStars}
                  onChange={(maxStars) => set(openRow.key, { maxStars })}
                />
              </Field>
            </div>
          )}
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
                  pool: { ...poolCounts([], categories), ...poolForBestOf(9) },
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
          <form
            className="ml-auto flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await action({
                  type: 'setup.apply',
                  operations: newMapTypeOperations(newType, data),
                });
                setNewType('');
                await reload();
              }, tr('Map type added.'));
            }}
          >
            <Field label={tr('New map type')}>
              <input
                className={styles.newType}
                placeholder="RX"
                maxLength={10}
                value={newType}
                onChange={(event) =>
                  setNewType(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                }
              />
            </Field>
            <Button
              type="submit"
              variant="outline"
              disabled={busy || !newType || categories.includes(newType) || dirty}
            >
              <Plus size={16} />
              {tr('Add')}
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
