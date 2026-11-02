'use client';
import { useState } from 'react';
import type { QualifierBookingData as Data } from '@/lib/qualifier-booking-contract';
import { useT } from './locale';
import Link, { useTournamentTime } from './tournament-scope';
import { Button } from './ui/button';
import { Field, api, useTask } from './admin/shared';
import styles from './admin/qualifier-workflow.module.css';
export function QualifierBookingPortal({ initial, loginUrl }: { initial: Data; loginUrl: string }) {
  const tr = useT(),
    time = useTournamentTime();
  const [data, setData] = useState(initial);
  const [bookingFilter, setBookingFilter] = useState('available');
  const [bookingStage, setBookingStage] = useState('');
  const { run, busy } = useTask();
  const refresh = async () => {
    const next = await api<Data>('/api/qualifier-booking');
    setData(next);
    return next;
  };
  if (!data.user)
    return (
      <section className="space-y-3">
        <p>{tr('Sign in with osu! to reserve a qualifier session.')}</p>
        <a className="button" href={loginUrl}>
          {tr('Sign in with osu!')}
        </a>
      </section>
    );
  return (
    <div className="max-w-6xl space-y-4">
      <p className="text-sm">
        {tr('Reservations do not change your tournament registration.')}{' '}
        <Link className="text-primary" href="/register">
          {tr('Manage registration')}
        </Link>
      </p>
      <section id="qualifiers" className={`${styles.workspace} min-w-0 space-y-3`}>
        <h2 className="text-lg font-semibold">{tr('Qualifier reservations')}</h2>
        <p className="text-sm text-muted">
          {tr(
            'Session times use your selected display timezone. Each team reserves one shared lobby per stage.',
          )}
        </p>
        {!data.team || data.team.status !== 'APPROVED' ? (
          <p>{tr('An approved registration is required to book a qualifier session.')}</p>
        ) : null}
        {!data.sessions.length && (
          <p className="text-sm text-muted">{tr('No qualifier sessions are available yet.')}</p>
        )}
        <div className={styles.toolbar}>
          <Field label={tr('Qualifier stage')}>
            <select value={bookingStage} onChange={(event) => setBookingStage(event.target.value)}>
              <option value="">{tr('All stages')}</option>
              {[
                ...new Map(
                  data.sessions.map((session) => [session.stageId, session.stage.name]),
                ).entries(),
              ].map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tr('Show sessions')}>
            <select
              value={bookingFilter}
              onChange={(event) => setBookingFilter(event.target.value)}
            >
              <option value="available">{tr('Available and reserved')}</option>
              <option value="all">{tr('All sessions')}</option>
              <option value="mine">{tr('Your reservations')}</option>
            </select>
          </Field>
        </div>
        {data.sessions
          .filter((session) => !bookingStage || session.stageId === bookingStage)
          .map((session) => {
            const source = data.sessions.find(
              (row) => row.stageId === session.stageId && row.booked,
            );
            const deadlines = [session.bookingClosesAt, data.policy.closesAt]
              .filter((value) => !!value)
              .map((value) => new Date(value!).getTime());
            const bookingDeadline = deadlines.length
              ? new Date(Math.min(...deadlines)).toISOString()
              : null;
            const deadlineClosed =
              !data.policy.enabled ||
              !!(data.policy.opensAt && new Date(data.policy.opensAt).getTime() > Date.now()) ||
              !!(data.policy.closesAt && new Date(data.policy.closesAt).getTime() <= Date.now());
            const closed =
              deadlineClosed ||
              !session.bookingOpen ||
              session.status !== 'SCHEDULED' ||
              !session.scheduledAt ||
              new Date(session.scheduledAt).getTime() <= Date.now() ||
              (session.bookingClosesAt &&
                new Date(session.bookingClosesAt).getTime() <= Date.now()) ||
              session.capacity - session.usedPlayers < session.requiredPlayers;
            if (
              (bookingFilter === 'mine' && !session.booked) ||
              (bookingFilter === 'available' && closed && !session.booked)
            )
              return null;
            return (
              <article
                key={session.id}
                className={styles.booking}
                aria-current={session.booked ? 'true' : undefined}
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <h3 className="font-semibold">
                    {session.stage.name} / {session.code}
                  </h3>
                  <span className="text-xs text-muted">
                    {tr('{0}/{1} player places', session.usedPlayers, session.capacity)}
                  </span>
                </div>
                <p className="text-sm">
                  {time(session.scheduledAt ? String(session.scheduledAt) : null)}
                </p>
                {bookingDeadline && (
                  <p className="text-xs text-muted">
                    {tr('Booking deadline')}: {time(bookingDeadline)}
                  </p>
                )}
                <p className="text-xs text-muted">
                  {tr('{0} runs · {1} players per entrant', session.runs, session.requiredPlayers)}
                  {session.booked ? ` · ${tr('Your reservation')}` : ''}
                </p>
                <Button
                  disabled={
                    busy ||
                    !data.team ||
                    (session.booked
                      ? session.status !== 'SCHEDULED' || deadlineClosed
                      : data.team.status !== 'APPROVED' || !!closed)
                  }
                  size="sm"
                  variant={session.booked ? 'outline' : 'default'}
                  onClick={() =>
                    void run(async () => {
                      try {
                        await api('/api/qualifier-booking', {
                          method: 'POST',
                          body: JSON.stringify({
                            type: 'qualifier.booking.reserve',
                            policyToken: data.policyToken,
                            teamVersion: data.team!.version,
                            stageId: session.stageId,
                            lobbyId: session.booked ? null : session.id,
                            baseVersion: session.version,
                            sourceVersion: source?.version,
                          }),
                        });
                      } finally {
                        await refresh();
                      }
                    }, 'Qualifier reservation updated.')
                  }
                >
                  {tr(
                    session.booked
                      ? 'Cancel reservation'
                      : source
                        ? 'Move reservation here'
                        : closed
                          ? 'Unavailable'
                          : 'Reserve session',
                  )}
                </Button>
              </article>
            );
          })}
      </section>
    </div>
  );
}
