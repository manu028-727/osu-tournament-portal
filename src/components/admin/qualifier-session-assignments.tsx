'use client';
import { useState } from 'react';
import { useT } from '@/components/locale';
import { localDateTimeInput } from '@/lib/utils';
import type { QualifierData, QualifierView } from '@/lib/qualifiers-types';
import { MoveEntrants } from './qualifier-bulk-tools';
import { action, Field, LoadingState, Modal, useResource, useTask } from './shared';
import { Button } from '../ui/button';

export function QualifierSessionAssignments({
  lobby,
  manager,
  onChanged,
}: {
  lobby: QualifierView;
  manager: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const tr = useT();
  const { data, error, reload } = useResource<QualifierData>('qualifiers');
  const { run, busy } = useTask();
  const [assigning, setAssigning] = useState(false);
  const [override, setOverride] = useState(false),
    [reason, setReason] = useState('');
  const [booking, setBooking] = useState<{
    capacity: number;
    bookingOpen: boolean;
    bookingClosesAt: string;
    version: number;
  } | null>(null);
  const saved = async () => {
    await reload();
    await onChanged();
  };
  return (
    <section className="space-y-3 rounded-2xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{tr('Session entrants and booking')}</h2>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!lobby.access.operate}
            onClick={() => setAssigning(true)}
          >
            {tr('Assign entrants')}
          </Button>
          {manager && (
            <Button
              size="sm"
              variant="outline"
              disabled={!lobby.canTransfer}
              onClick={() =>
                setBooking({
                  capacity: lobby.capacity,
                  bookingOpen: lobby.bookingOpen,
                  bookingClosesAt: localDateTimeInput(lobby.bookingClosesAt),
                  version: lobby.version,
                })
              }
            >
              {tr('Booking settings')}
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted">
        {tr(
          '{0}/{1} player places',
          lobby.participants.length * lobby.policy.requiredPlayers,
          lobby.capacity,
        )}{' '}
        ·{' '}
        {tr(
          lobby.bookingOpen &&
            lobby.canTransfer &&
            !!lobby.scheduledAt &&
            new Date(lobby.scheduledAt).getTime() > Date.now() &&
            (!lobby.bookingClosesAt || new Date(lobby.bookingClosesAt).getTime() > Date.now())
            ? 'Captain booking open'
            : 'Captain booking closed',
        )}
      </p>
      {!lobby.participants.length && (
        <p className="text-sm text-muted">
          {tr(
            'This session is empty. Assign approved entrants here or let their captains reserve a place.',
          )}
        </p>
      )}
      {manager && lobby.status === 'IN_PROGRESS' && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={override}
              onChange={(event) => setOverride(event.target.checked)}
            />
            {tr('Override active-session assignments')}
          </label>
          {override && (
            <Field label={tr('Assignment override reason')}>
              <input
                minLength={3}
                maxLength={2000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
          )}
        </>
      )}
      {lobby.participants.map((team) => {
        const recorded = lobby.scores.some((score) =>
          team.members.some((player) => player.osuId === score.osuId),
        );
        return (
          <div
            key={team.id}
            className="flex min-w-0 items-center justify-between gap-2 border-t pt-2"
          >
            <span className="min-w-0 break-words text-sm">{team.name}</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={
                busy || recorded || (!lobby.canTransfer && !(override && reason.trim().length >= 3))
              }
              onClick={() =>
                void run(async () => {
                  await action({
                    type: 'qualifier.participants.remove',
                    id: lobby.id,
                    baseVersion: lobby.version,
                    teamIds: [team.id],
                    override,
                    reason: reason || 'Organizer or assigned referee removed an unstarted entrant',
                  });
                  await saved();
                }, 'Entrant removed from session.')
              }
            >
              {recorded ? tr('History protected') : tr('Remove')}
            </Button>
          </div>
        );
      })}
      <Modal
        open={assigning}
        onOpenChange={setAssigning}
        title={tr('Assign qualifier entrants')}
        wide
      >
        {!data ? (
          <LoadingState error={error} />
        ) : (
          <MoveEntrants
            options={{ teams: data.entrantOptions || data.options?.teams || [] }}
            lobbies={data.lobbies.filter((row) => manager || row.access.operate)}
            initialTarget={lobby.id}
            allowOverride={manager}
            reload={saved}
            close={() => setAssigning(false)}
          />
        )}
      </Modal>
      <Modal
        open={!!booking}
        onOpenChange={(open) => {
          if (!open) setBooking(null);
        }}
        title={tr('Booking settings')}
      >
        {booking && (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await action({
                  type: 'qualifier.booking',
                  id: lobby.id,
                  baseVersion: booking.version,
                  capacity: booking.capacity,
                  bookingOpen: booking.bookingOpen,
                  bookingClosesAt: booking.bookingClosesAt
                    ? new Date(booking.bookingClosesAt).toISOString()
                    : null,
                });
                setBooking(null);
                await saved();
              }, 'Booking settings saved.');
            }}
          >
            <Field label={tr('Player capacity')}>
              <input
                required
                type="number"
                min={1}
                max={16}
                value={booking.capacity}
                onChange={(event) =>
                  setBooking({ ...booking, capacity: Number(event.target.value) })
                }
              />
            </Field>
            <Field label={tr('Booking deadline (your timezone)')}>
              <input
                type="datetime-local"
                value={booking.bookingClosesAt}
                onChange={(event) =>
                  setBooking({ ...booking, bookingClosesAt: event.target.value })
                }
              />
            </Field>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={booking.bookingOpen}
                onChange={(event) => setBooking({ ...booking, bookingOpen: event.target.checked })}
              />
              {tr('Allow captain qualifier booking')}
            </label>
            <Button type="submit" disabled={busy}>
              {tr('Save booking settings')}
            </Button>
          </form>
        )}
      </Modal>
    </section>
  );
}
