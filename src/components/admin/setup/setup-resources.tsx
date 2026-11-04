'use client';
import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useT } from '@/components/locale';
import { Button } from '@/components/ui/button';
import type { ResourceBoard } from '@/lib/resource-service';
import type { ResourcePolicy } from '@/lib/resources';
import type { SetupWorkspaceData } from '@/lib/setup-queries';
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

type Reload = () => Promise<unknown>;
type Item = ResourceBoard['items'][number];
const LANES: ResourcePolicy['earnings']['overrides'][number]['lane'][] = [
  'WINNERS',
  'LOSERS',
  'FINALS',
];
const LANE_LABEL: Record<string, string> = {
  WINNERS: 'Winners bracket',
  LOSERS: 'Losers bracket',
  FINALS: 'Grand finals',
};

function PolicyForm({
  data,
  board,
  reload,
}: {
  data: SetupWorkspaceData;
  board: ResourceBoard;
  reload: Reload;
}) {
  const tr = useT();
  const { busy, run } = useTask();
  const [policy, setPolicy] = useState(board.policy);
  useEffect(() => setPolicy(board.policy), [board.policy]);
  const dirty = JSON.stringify(policy) !== JSON.stringify(board.policy);
  useUnsaved(dirty);
  const earnings = (fields: Partial<ResourcePolicy['earnings']>) =>
    setPolicy({ ...policy, earnings: { ...policy.earnings, ...fields } });
  const overrides = policy.earnings.overrides;
  const setOverride = (index: number, fields: Partial<(typeof overrides)[number]>) =>
    earnings({
      overrides: overrides.map((row, i) => (i === index ? { ...row, ...fields } : row)),
    });
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await action({
            type: 'settings.save',
            baseVersion: data.tournament.version,
            resourcePolicy: policy,
          });
          await reload();
        }, tr('Budget rules saved.'));
      }}
    >
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={policy.enabled}
          onChange={(event) => setPolicy({ ...policy, enabled: event.target.checked })}
        />
        {tr('Teams have a budget they can spend on items')}
      </label>
      {policy.enabled && (
        <>
          <div className="grid-fields">
            <Field label={tr('Currency')}>
              <input
                value={policy.currency}
                maxLength={8}
                required
                onChange={(event) => setPolicy({ ...policy, currency: event.target.value })}
              />
            </Field>
            <Field
              label={tr('Starting balance')}
              hint={tr('Teams formed at an auction start from what the auction left them.')}
            >
              <NumberInput
                min={0}
                value={policy.startingBalance}
                onChange={(value) => setPolicy({ ...policy, startingBalance: value ?? 0 })}
              />
            </Field>
            <Field label={tr('Earned per map won')}>
              <NumberInput
                min={0}
                value={policy.earnings.mapWin}
                onChange={(value) => earnings({ mapWin: value ?? 0 })}
              />
            </Field>
            <Field label={tr('Earned per match won')}>
              <NumberInput
                min={0}
                value={policy.earnings.matchWin}
                onChange={(value) => earnings({ matchWin: value ?? 0 })}
              />
            </Field>
            <Field label={tr('Most items a team can buy for one stage (optional)')}>
              <NumberInput
                nullable
                min={1}
                max={100}
                value={policy.maxPerStage}
                onChange={(maxPerStage) => setPolicy({ ...policy, maxPerStage })}
              />
            </Field>
          </div>
          <div className="grid gap-2">
            <h3 className="text-sm font-semibold">{tr('Different rates for some rounds')}</h3>
            {overrides.map((row, index) => (
              <div key={index} className={styles.rateRow}>
                <Field label={tr('Bracket')}>
                  <select
                    value={row.lane}
                    onChange={(event) =>
                      setOverride(index, { lane: event.target.value as typeof row.lane })
                    }
                  >
                    {LANES.map((lane) => (
                      <option key={lane} value={lane}>
                        {tr(LANE_LABEL[lane])}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={tr('From round')}>
                  <NumberInput
                    min={1}
                    value={row.fromRound}
                    onChange={(value) => setOverride(index, { fromRound: Math.max(1, value ?? 0) })}
                  />
                </Field>
                <Field label={tr('Per map won')}>
                  <NumberInput
                    min={0}
                    value={row.mapWin}
                    onChange={(value) => setOverride(index, { mapWin: value ?? 0 })}
                  />
                </Field>
                <Field label={tr('Per match won')}>
                  <NumberInput
                    min={0}
                    value={row.matchWin}
                    onChange={(value) => setOverride(index, { matchWin: value ?? 0 })}
                  />
                </Field>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={tr('Remove this rate')}
                  onClick={() => earnings({ overrides: overrides.filter((_, i) => i !== index) })}
                >
                  <X size={16} />
                </Button>
              </div>
            ))}
            <div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  earnings({
                    overrides: [
                      ...overrides,
                      { lane: 'LOSERS', fromRound: 3, mapWin: 0, matchWin: 0 },
                    ],
                  })
                }
              >
                <Plus size={16} /> {tr('Add a rate')}
              </Button>
            </div>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={policy.public}
              onChange={(event) => setPolicy({ ...policy, public: event.target.checked })}
            />
            {tr('Show balances and purchases on the public team formation page')}
          </label>
        </>
      )}
      <div>
        <SaveButton busy={busy} disabled={busy || !dirty}>
          {tr('Save budget rules')}
        </SaveButton>
      </div>
    </form>
  );
}

function ItemRow({
  item,
  board,
  reload,
}: {
  item: Item | null;
  board: ResourceBoard;
  reload: Reload;
}) {
  const tr = useT();
  const { busy, run } = useTask();
  const empty = { name: '', description: '', price: 0, unlockStageId: null, published: false };
  const [fields, setFields] = useState({ ...empty, ...(item ?? {}) });
  useEffect(() => setFields({ ...empty, ...(item ?? {}) }), [item]);
  const dirty =
    !!fields.name &&
    (!item ||
      fields.name !== item.name ||
      fields.description !== item.description ||
      fields.price !== item.price ||
      fields.unlockStageId !== item.unlockStageId ||
      fields.published !== item.published);
  return (
    <form
      className={styles.itemRow}
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await action({
            type: 'resource.item.save',
            ...(item ? { id: item.id, baseVersion: item.version } : {}),
            name: fields.name,
            description: fields.description,
            price: fields.price,
            unlockStageId: fields.unlockStageId,
            published: fields.published,
          });
          if (!item) setFields(empty);
          await reload();
        }, tr('Item saved.'));
      }}
    >
      <Field label={tr('Item')}>
        <input
          value={fields.name}
          maxLength={120}
          required
          onChange={(event) => setFields({ ...fields, name: event.target.value })}
        />
      </Field>
      <Field label={tr('Price')}>
        <NumberInput
          min={0}
          value={fields.price}
          onChange={(value) => setFields({ ...fields, price: value ?? 0 })}
        />
      </Field>
      <Field label={tr('Unlocks at')}>
        <select
          value={fields.unlockStageId ?? ''}
          onChange={(event) => setFields({ ...fields, unlockStageId: event.target.value || null })}
        >
          <option value="">{tr('Always')}</option>
          {board.stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </select>
      </Field>
      <div className={styles.itemWide}>
        <Field
          label={tr('What it does')}
          hint={tr('Staff apply the effect during the match. Nothing here changes a score.')}
        >
          <input
            value={fields.description}
            maxLength={2000}
            onChange={(event) => setFields({ ...fields, description: event.target.value })}
          />
        </Field>
      </div>
      <div className={`${styles.itemWide} flex flex-wrap items-center gap-3`}>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={fields.published}
            onChange={(event) => setFields({ ...fields, published: event.target.checked })}
          />
          {tr('Revealed')}
        </label>
        <Button type="submit" size="sm" variant="outline" disabled={busy || !dirty}>
          {item ? tr('Save') : tr('Add item')}
        </Button>
        {item && (
          <ConfirmButton
            variant="outline"
            disabled={busy}
            title={tr('Remove {0} from sale?', item.name)}
            description={tr('Purchases already made stay on record.')}
            onConfirm={() =>
              void run(async () => {
                await action({
                  type: 'resource.item.archive',
                  id: item.id,
                  baseVersion: item.version,
                });
                await reload();
              }, tr('Item removed from sale.'))
            }
          >
            {tr('Remove')}
          </ConfirmButton>
        )}
      </div>
    </form>
  );
}

function TeamLedger({
  team,
  board,
  reload,
}: {
  team: ResourceBoard['teams'][number];
  board: ResourceBoard;
  reload: Reload;
}) {
  const tr = useT();
  const { busy, run } = useTask();
  const [buy, setBuy] = useState({ itemId: '', stageId: '', note: '' });
  const [adjust, setAdjust] = useState({ amount: '', reason: '' });
  const [reversal, setReversal] = useState<Record<string, string>>({});
  const item = board.items.find((row) => row.id === buy.itemId);
  const { currency } = board.policy;
  return (
    <details className={styles.ledgerTeam}>
      <summary>
        <strong>{team.name}</strong>
        <span className={team.balance < 0 ? styles.overdrawn : undefined}>
          {currency} {team.balance}
        </span>
      </summary>
      <div className="grid gap-3 pt-3">
        <p className="text-sm text-muted">
          {tr(
            'Started with {0}, spent {1} at auction, earned {2}, bought {3}, adjusted by {4}.',
            team.starting,
            team.spentAtAuction,
            team.earned,
            team.purchased,
            team.adjusted,
          )}
        </p>
        {team.balance < 0 && (
          <p className={styles.issues} role="status">
            {tr('This team is overdrawn. Organizers decide how to settle it.')}
          </p>
        )}
        <form
          className={styles.itemRow}
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await action({
                type: 'resource.purchase',
                teamId: team.id,
                itemId: buy.itemId,
                stageId: buy.stageId || null,
                expectedPrice: item?.price ?? 0,
                note: buy.note,
              });
              setBuy({ itemId: '', stageId: '', note: '' });
              await reload();
            }, tr('Purchase recorded.'));
          }}
        >
          <Field label={tr('Item to buy')}>
            <select
              required
              value={buy.itemId}
              onChange={(event) => setBuy({ ...buy, itemId: event.target.value })}
            >
              <option value="">{tr('Choose an item')}</option>
              {board.items.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name} ({currency} {row.price})
                </option>
              ))}
            </select>
          </Field>
          <Field label={tr('For stage')}>
            <select
              value={buy.stageId}
              onChange={(event) => setBuy({ ...buy, stageId: event.target.value })}
            >
              <option value="">{tr('No particular stage')}</option>
              {board.stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tr('Note for staff')}>
            <input
              maxLength={1000}
              value={buy.note}
              onChange={(event) => setBuy({ ...buy, note: event.target.value })}
            />
          </Field>
          <div>
            <Button type="submit" size="sm" variant="outline" disabled={busy}>
              {tr('Record purchase')}
            </Button>
          </div>
        </form>
        {team.purchases.length > 0 && (
          <ul className="grid gap-2 text-sm">
            {team.purchases.map((purchase) => (
              <li key={purchase.id} className={styles.inlineDecision}>
                <span className={purchase.reversed ? 'text-muted line-through' : undefined}>
                  {purchase.item} ({currency} {purchase.price})
                  {purchase.stage ? ` · ${purchase.stage}` : ''}
                  {purchase.note ? ` · ${purchase.note}` : ''}
                </span>
                {purchase.reversed ? (
                  <span className="text-muted">{purchase.reversedReason}</span>
                ) : (
                  <>
                    <input
                      aria-label={tr('Why this purchase is reversed')}
                      placeholder={tr('Why this purchase is reversed')}
                      maxLength={1000}
                      value={reversal[purchase.id] ?? ''}
                      onChange={(event) =>
                        setReversal({ ...reversal, [purchase.id]: event.target.value })
                      }
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy || (reversal[purchase.id] ?? '').trim().length < 3}
                      onClick={() =>
                        void run(async () => {
                          await action({
                            type: 'resource.purchase.reverse',
                            id: purchase.id,
                            reason: reversal[purchase.id],
                          });
                          await reload();
                        }, tr('Purchase reversed.'))
                      }
                    >
                      {tr('Reverse')}
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <form
          className={styles.itemRow}
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await action({
                type: 'resource.adjust',
                teamId: team.id,
                amount: Number(adjust.amount),
                reason: adjust.reason,
              });
              setAdjust({ amount: '', reason: '' });
              await reload();
            }, tr('Balance adjusted.'));
          }}
        >
          <Field label={tr('Adjust balance by')} hint={tr('Use a minus sign to take money away.')}>
            <input
              type="number"
              required
              value={adjust.amount}
              onChange={(event) => setAdjust({ ...adjust, amount: event.target.value })}
            />
          </Field>
          <Field label={tr('Why')}>
            <input
              required
              minLength={3}
              maxLength={1000}
              value={adjust.reason}
              onChange={(event) => setAdjust({ ...adjust, reason: event.target.value })}
            />
          </Field>
          <div>
            <Button type="submit" size="sm" variant="outline" disabled={busy}>
              {tr('Adjust')}
            </Button>
          </div>
        </form>
        {team.adjustments.length > 0 && (
          <ul className="grid gap-1 text-sm text-muted">
            {team.adjustments.map((row) => (
              <li key={row.id}>
                {row.amount > 0 ? `+${row.amount}` : row.amount} · {row.reason}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

export function ResourcesSection({
  data,
  reload,
  canEdit,
}: {
  data: SetupWorkspaceData;
  reload: Reload;
  canEdit: boolean;
}) {
  const tr = useT();
  const board = data.resources;
  if (!board) return null;
  return (
    <div className={styles.stack}>
      {canEdit && <PolicyForm data={data} board={board} reload={reload} />}
      {board.policy.enabled && (
        <>
          <section className="grid gap-3" aria-labelledby="resource-items">
            <h3 id="resource-items" className="font-semibold">
              {tr('Items on sale')}
            </h3>
            {board.items.map((item) => (
              <ItemRow key={item.id} item={item} board={board} reload={reload} />
            ))}
            {canEdit && <ItemRow key="new" item={null} board={board} reload={reload} />}
          </section>
          <section className="grid gap-2" aria-labelledby="resource-balances">
            <h3 id="resource-balances" className="font-semibold">
              {tr('Team balances')}
            </h3>
            {board.teams.length ? (
              board.teams.map((team) => (
                <TeamLedger key={team.id} team={team} board={board} reload={reload} />
              ))
            ) : (
              <p className="text-sm text-muted">{tr('Teams appear here once they exist.')}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
