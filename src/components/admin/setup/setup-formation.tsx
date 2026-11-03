'use client';
import { useState } from 'react';
import { useT } from '@/components/locale';
import { Button } from '@/components/ui/button';
import type { FormationBoards } from '@/lib/team-formation-service';
import { action, ConfirmButton, Field, useTask, useUnsaved } from '../shared';
import styles from './setup.module.css';

type Board = FormationBoards[number];
type Session = NonNullable<Board['session']>;
type Lot = Session['lots'][number];
type PastedRow = { line: string; error: string | null };

const METHOD_LABEL: Record<string, string> = {
  AUCTION: 'Auction',
  SNAKE_DRAFT: 'Snake draft',
  MANUAL: 'Assigned by organizers',
};
const LOT_STATE: Record<string, string> = {
  WAITING: 'Waiting',
  SOLD: 'On a team',
  RESERVE: 'Reserve',
};
const seedLabel = (seed: number | null) => (seed === null ? '–' : `#${seed}`);

function StartBoard({ board, reload }: { board: Board; reload: () => Promise<unknown> }) {
  const tr = useT();
  const { busy, run } = useTask();
  const [captains, setCaptains] = useState<string[]>([]);
  const blocking = board.issues.filter((issue) => issue.severity === 'ERROR');
  const manual = board.captains === 'MANUAL';
  const needed = board.teamCount * (board.rosterSize - 1) + board.teamCount;
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted">
        {tr(
          '{0} into {1} teams of {2}. {3} players are eligible and {4} are needed.',
          tr(METHOD_LABEL[board.method]),
          board.teamCount,
          board.rosterSize,
          board.seats,
          needed,
        )}
      </p>
      {blocking.map((issue) => (
        <p key={issue.code} className={styles.issues} role="status">
          {tr(issue.message, ...(issue.values ?? []))}
        </p>
      ))}
      {manual && !blocking.length && (
        <fieldset className="grid gap-2">
          <legend className="text-sm font-semibold">
            {tr('Choose {0} captains ({1} chosen)', board.teamCount, captains.length)}
          </legend>
          <div className={styles.captainGrid}>
            {board.entrants.map((entrant) => (
              <label key={entrant.teamId} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={captains.includes(entrant.teamId)}
                  onChange={(event) =>
                    setCaptains(
                      event.target.checked
                        ? [...captains, entrant.teamId]
                        : captains.filter((id) => id !== entrant.teamId),
                    )
                  }
                />
                {entrant.username}
                <span className="text-muted">{seedLabel(entrant.seed)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {!manual && (
        <p className="text-sm text-muted">
          {tr('The best {0} qualifier seeds become captains.', board.teamCount)}
        </p>
      )}
      <div>
        <ConfirmButton
          variant="default"
          disabled={busy || !!blocking.length || (manual && captains.length !== board.teamCount)}
          title={tr('Start team formation?')}
          description={tr(
            'Captains can no longer edit their rosters, and a public page shows the board as it happens. Nothing moves until you confirm the teams.',
          )}
          onConfirm={() =>
            void run(async () => {
              await action({
                type: 'formation.start',
                phaseKey: board.phaseKey,
                ...(manual ? { captainTeamIds: captains } : {}),
              });
              await reload();
            }, tr('Team formation started.'))
          }
        >
          {tr('Start team formation')}
        </ConfirmButton>
      </div>
    </div>
  );
}

// Sells, picks or assigns the next player, depending on how this board forms teams.
function NextDecision({
  board,
  session,
  submit,
  busy,
}: {
  board: Board;
  session: Session;
  submit: (input: Record<string, unknown>, message: string) => Promise<unknown>;
  busy: boolean;
}) {
  const tr = useT();
  const auction = session.teams.some((team) => team.budget !== null);
  const undecided = session.lots.filter((lot) => !lot.captain && lot.state !== 'SOLD');
  const current = session.lots.find((lot) => lot.id === session.currentLotId);
  const clock = session.teams.find((team) => team.id === session.onTheClockId);
  const [lotId, setLotId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [price, setPrice] = useState('');
  const [outOfTurn, setOutOfTurn] = useState('');
  const chosenLot = auction ? current?.id : lotId;
  const chosenTeam = clock && !teamId ? clock.id : teamId;
  const pickingOutOfTurn = !!clock && !!teamId && teamId !== clock.id;
  if (!undecided.length)
    return <p className="text-sm text-muted">{tr('Every player is placed.')}</p>;
  const reset = () => {
    setLotId('');
    setTeamId('');
    setPrice('');
    setOutOfTurn('');
  };
  return (
    <form
      className={styles.decision}
      onSubmit={(event) => {
        event.preventDefault();
        void submit(
          {
            type: 'formation.assign',
            lotId: chosenLot,
            formationTeamId: chosenTeam,
            ...(auction ? { price: Number(price) } : {}),
            ...(pickingOutOfTurn ? { reason: outOfTurn } : {}),
          },
          auction ? tr('Sale recorded.') : tr('Player placed.'),
        ).then((done) => done && reset());
      }}
    >
      {auction ? (
        <div className={styles.decisionLead}>
          <span className="text-xs uppercase text-muted">{tr('Now offering')}</span>
          <strong>{current?.username ?? tr('Every player has been offered')}</strong>
          {current && <span className="text-sm text-muted">{seedLabel(current.seed)}</span>}
        </div>
      ) : (
        <Field label={tr('Player')}>
          <select required value={lotId} onChange={(event) => setLotId(event.target.value)}>
            <option value="">{tr('Choose a player')}</option>
            {undecided.map((lot) => (
              <option key={lot.id} value={lot.id}>
                {lot.username} {seedLabel(lot.seed)}
              </option>
            ))}
          </select>
        </Field>
      )}
      {clock && (
        <div className={styles.decisionLead}>
          <span className="text-xs uppercase text-muted">{tr('On the clock')}</span>
          <strong>{clock.name}</strong>
        </div>
      )}
      <Field label={tr('Team')}>
        <select required value={chosenTeam} onChange={(event) => setTeamId(event.target.value)}>
          <option value="">{tr('Choose a team')}</option>
          {session.teams.map((team) => (
            <option key={team.id} value={team.id} disabled={team.seatsLeft <= 0}>
              {team.name}
            </option>
          ))}
        </select>
      </Field>
      {auction && (
        <Field
          label={tr('Winning price')}
          hint={tr('At least {0}', board.auction?.minimumRaise ?? 0)}
        >
          <input
            type="number"
            required
            min={board.auction?.minimumRaise ?? 0}
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
        </Field>
      )}
      {pickingOutOfTurn && (
        <Field label={tr('Why this team picks out of turn')}>
          <input
            required
            minLength={3}
            maxLength={1000}
            value={outOfTurn}
            onChange={(event) => setOutOfTurn(event.target.value)}
          />
        </Field>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Button type="submit" disabled={busy || !chosenLot}>
          {auction ? tr('Sold') : clock ? tr('Pick player') : tr('Assign player')}
        </Button>
        {auction && current && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void submit(
                { type: 'formation.reserve', lotId: current.id },
                tr('{0} moved to the reserves.', current.username),
              ).then((done) => done && reset())
            }
          >
            {tr('No bids')}
          </Button>
        )}
      </div>
    </form>
  );
}

function PasteResults({
  submit,
  busy,
}: {
  submit: (input: Record<string, unknown>, message: string) => Promise<unknown>;
  busy: boolean;
}) {
  const tr = useT();
  const [text, setText] = useState('');
  const [rows, setRows] = useState<PastedRow[] | null>(null);
  const clean = !!rows?.length && rows.every((row) => !row.error);
  useUnsaved(!!text);
  return (
    <details className={styles.reviewDetails}>
      <summary>{tr('Paste results from a bot')}</summary>
      <div className="grid gap-3 pt-3">
        <Field
          label={tr('One player per line')}
          hint={tr('Player, team or captain, price. Write "unsold" for a player with no bids.')}
        >
          <textarea
            rows={5}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setRows(null);
            }}
          />
        </Field>
        {rows && (
          <ul className="grid gap-1 text-sm">
            {rows.map((row, index) => (
              <li key={index} className={row.error ? styles.pasteError : undefined}>
                {row.line}
                {row.error && <strong> {tr(row.error)}</strong>}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy || !text.trim()}
            onClick={() =>
              void submit(
                { type: 'formation.paste', text, apply: false },
                tr('Lines checked.'),
              ).then((result) =>
                setRows((result as { rows: PastedRow[] } | undefined)?.rows ?? null),
              )
            }
          >
            {tr('Check lines')}
          </Button>
          <Button
            type="button"
            disabled={busy || !clean}
            onClick={() =>
              void submit(
                { type: 'formation.paste', text, apply: true },
                tr('Results applied.'),
              ).then((done) => {
                if (!done) return;
                setText('');
                setRows(null);
              })
            }
          >
            {tr('Apply {0} lines', rows?.length ?? 0)}
          </Button>
        </div>
      </div>
    </details>
  );
}

function PlayerRow({
  lot,
  session,
  currency,
  submit,
  busy,
}: {
  lot: Lot;
  session: Session;
  currency: boolean;
  submit: (input: Record<string, unknown>, message: string) => Promise<unknown>;
  busy: boolean;
}) {
  const tr = useT();
  const [reason, setReason] = useState<string | null>(null);
  const team = session.teams.find((item) => item.id === lot.formationTeamId);
  return (
    <>
      <tr>
        <td>{seedLabel(lot.seed)}</td>
        <td>
          {lot.username}
          {lot.captain && <span className="text-muted"> ({tr('Captain')})</span>}
        </td>
        <td>{tr(LOT_STATE[lot.state])}</td>
        <td>{team?.name ?? ''}</td>
        {currency && (
          <td>
            {lot.price ?? ''}
            {lot.filled ? ` (${tr('filled')})` : ''}
          </td>
        )}
        <td className="text-right">
          {session.state === 'OPEN' && !lot.captain && lot.state === 'SOLD' && reason === null && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setReason('')}>
              {tr('Undo')}
            </Button>
          )}
          {session.state === 'OPEN' && lot.state === 'RESERVE' && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void submit(
                  {
                    type: 'formation.unassign',
                    lotId: lot.id,
                    reason: 'Offered again from the reserves',
                  },
                  tr('{0} can be offered again.', lot.username),
                )
              }
            >
              {tr('Offer again')}
            </Button>
          )}
        </td>
      </tr>
      {reason !== null && (
        <tr>
          <td colSpan={currency ? 6 : 5}>
            <form
              className={styles.inlineDecision}
              onSubmit={(event) => {
                event.preventDefault();
                void submit(
                  { type: 'formation.unassign', lotId: lot.id, reason },
                  tr('Decision undone.'),
                ).then((done) => done && setReason(null));
              }}
            >
              <input
                aria-label={tr('Why this is being undone')}
                placeholder={tr('Why this is being undone')}
                required
                minLength={3}
                maxLength={1000}
                autoFocus
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <Button type="submit" size="sm" variant="outline" disabled={busy}>
                {tr('Undo')}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setReason(null)}>
                {tr('Keep it')}
              </Button>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

// A reason, then a confirmation. Used by the steps that throw away or undo decisions.
function ReasonedStep({
  label,
  field,
  title,
  description,
  busy,
  onConfirm,
}: {
  label: string;
  field: string;
  title: string;
  description: string;
  busy: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className={styles.inlineDecision}>
      <input
        aria-label={field}
        placeholder={field}
        maxLength={1000}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <ConfirmButton
        variant="outline"
        disabled={busy || reason.trim().length < 3}
        title={title}
        description={description}
        onConfirm={() => onConfirm(reason)}
      >
        {label}
      </ConfirmButton>
    </div>
  );
}

export function FormationPanel({
  board,
  reload,
  canEdit,
}: {
  board: Board;
  reload: () => Promise<unknown>;
  canEdit: boolean;
}) {
  const tr = useT();
  const { busy, run } = useTask();
  const [incomplete, setIncomplete] = useState('');
  const session = board.session;
  if (!session)
    return canEdit ? (
      <StartBoard board={board} reload={reload} />
    ) : (
      <p className="text-sm text-muted">{tr('Team formation has not started.')}</p>
    );
  const submit = (input: Record<string, unknown>, message: string) =>
    run(async () => {
      const result = await action({
        sessionId: session.id,
        baseVersion: session.version,
        ...input,
      });
      await reload();
      return result ?? true;
    }, message);
  const open = session.state === 'OPEN' && canEdit;
  const auction = session.teams.some((team) => team.budget !== null);
  const short = session.teams.filter((team) => team.seatsLeft > 0);
  const waiting = session.lots.some((lot) => lot.state === 'WAITING');
  const players = [...session.lots].sort(
    (a, b) => (a.seed ?? Infinity) - (b.seed ?? Infinity) || a.position - b.position,
  );
  return (
    <div className={styles.stack}>
      <ul className={styles.formedTeams}>
        {session.teams.map((team) => (
          <li key={team.id} className={styles.formedTeam}>
            {open ? (
              <input
                aria-label={tr('Team name')}
                defaultValue={team.name}
                key={`${team.id}-${team.name}`}
                maxLength={120}
                onBlur={(event) => {
                  const name = event.target.value.trim();
                  if (name && name !== team.name)
                    void submit(
                      { type: 'formation.rename', formationTeamId: team.id, name },
                      tr('Team renamed.'),
                    );
                }}
              />
            ) : (
              <strong>{team.name}</strong>
            )}
            <span className="text-sm text-muted">
              {team.seatsLeft > 1
                ? tr('{0} seats left', team.seatsLeft)
                : team.seatsLeft === 1
                  ? tr('1 seat left')
                  : tr('Full')}
              {team.moneyLeft !== null && ` · ${tr('{0} left', team.moneyLeft)}`}
            </span>
            <ul className="text-sm">
              {session.lots
                .filter((lot) => lot.formationTeamId === team.id)
                .map((lot) => (
                  <li key={lot.id}>
                    {lot.username}
                    {lot.price !== null && <span className="text-muted"> {lot.price}</span>}
                  </li>
                ))}
            </ul>
          </li>
        ))}
      </ul>
      {open && <NextDecision board={board} session={session} submit={submit} busy={busy} />}
      {open && auction && !waiting && session.fill.length > 0 && (
        <div className="grid gap-2">
          <p className="text-sm">
            {tr(
              'Fill {0} open seats from the reserves, best seed first, at {1} each.',
              session.fill.length,
              board.auction?.reserveFillPrice ?? 0,
            )}
          </p>
          <div>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void submit({ type: 'formation.fill' }, tr('Teams filled.'))}
            >
              {tr('Fill from reserves')}
            </Button>
          </div>
        </div>
      )}
      {open && <PasteResults submit={submit} busy={busy} />}
      <details className={styles.reviewDetails} open={session.lots.length <= 24}>
        <summary>
          {tr('All players')} ({session.lots.length})
        </summary>
        <div className="overflow-x-auto pt-2">
          <table className={styles.formationTable}>
            <thead>
              <tr>
                <th>{tr('Seed')}</th>
                <th>{tr('Player')}</th>
                <th>{tr('Status')}</th>
                <th>{tr('Team')}</th>
                {auction && <th>{tr('Price')}</th>}
                <th aria-label={tr('Actions')} />
              </tr>
            </thead>
            <tbody>
              {players.map((lot) => (
                <PlayerRow
                  key={lot.id}
                  lot={lot}
                  session={session}
                  currency={auction}
                  submit={submit}
                  busy={busy}
                />
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {open && (
        <div className="grid gap-2">
          {short.length > 0 && (
            <Field label={tr('{0} teams are not full. Why confirm them anyway?', short.length)}>
              <input
                maxLength={1000}
                value={incomplete}
                onChange={(event) => setIncomplete(event.target.value)}
              />
            </Field>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <ConfirmButton
              variant="default"
              disabled={busy || (short.length > 0 && incomplete.trim().length < 3)}
              title={tr('Confirm these teams?')}
              description={tr(
                'Players move onto their new teams and their solo entries are retired. Qualifier results keep their history. You can reopen this until the teams enter a later phase.',
              )}
              onConfirm={() =>
                void submit(
                  {
                    type: 'formation.confirm',
                    ...(short.length ? { incompleteReason: incomplete } : {}),
                  },
                  tr('Teams confirmed.'),
                )
              }
            >
              {tr('Confirm teams')}
            </ConfirmButton>
          </div>
          <details className={styles.reviewDetails}>
            <summary>{tr('Start over')}</summary>
            <div className="pt-3">
              <ReasonedStep
                label={tr('Start over')}
                field={tr('Why this is starting over')}
                title={tr('Discard this board?')}
                description={tr(
                  'Every sale and pick is removed. The audit log keeps a copy of what was recorded.',
                )}
                busy={busy}
                onConfirm={(reason) =>
                  void submit({ type: 'formation.restart', reason }, tr('Board discarded.'))
                }
              />
            </div>
          </details>
        </div>
      )}
      {canEdit && session.state === 'CONFIRMED' && (
        <ReasonedStep
          label={tr('Reopen')}
          field={tr('Why these teams are reopening')}
          title={tr('Reopen team formation?')}
          description={tr(
            'The formed teams are removed and every player returns to their solo entry, with the board as you left it.',
          )}
          busy={busy}
          onConfirm={(reason) =>
            void submit({ type: 'formation.reopen', reason }, tr('Team formation reopened.'))
          }
        />
      )}
    </div>
  );
}
