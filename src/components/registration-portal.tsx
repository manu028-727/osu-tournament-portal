'use client';
import { useState } from 'react';
import type { RegistrationData as Data } from '@/lib/registration-types';
import { useT } from './locale';
import { useTournamentTime } from './tournament-scope';
import { Button } from './ui/button';
import { Field, api, useTask, useUnsaved } from './admin/shared';
import styles from './admin/qualifier-workflow.module.css';

export function RegistrationPortal({ initial, loginUrl }: { initial: Data; loginUrl: string }) {
  const tr = useT(),
    time = useTournamentTime();
  const [data, setData] = useState(initial);
  const [bookingFilter, setBookingFilter] = useState('available');
  const [bookingStage, setBookingStage] = useState('');
  const [name, setName] = useState(data.team?.name || data.user?.username || '');
  const [format, setFormat] = useState<'TEAM' | 'INDIVIDUAL'>(
    data.team?.format === 'INDIVIDUAL' ||
      data.policy.format === 'INDIVIDUAL' ||
      data.format === 'SOLO'
      ? 'INDIVIDUAL'
      : 'TEAM',
  );
  const [members, setMembers] = useState(
    data.team?.members.map((member) => ({
      osuId: String(member.osuId),
      substitute: member.substitute,
      discordId: member.discordId,
    })) || [{ osuId: String(data.user?.osuId || ''), substitute: false, discordId: '' }],
  );
  const [answers, setAnswers] = useState<Record<string, string | number | boolean>>(
    (data.team?.answers || {}) as Record<string, string | number | boolean>,
  );
  const { run, busy } = useTask();
  const [witness, setWitness] = useState({
    baseVersion: initial.team?.version || 0,
    policyToken: initial.policyToken,
  });
  const draft = JSON.stringify({ name, format, members, answers });
  const [savedDraft, setSavedDraft] = useState(draft);
  useUnsaved(draft !== savedDraft);
  const refresh = async () => {
    const next = await api<Data>('/api/registration');
    setData(next);
    return next;
  };
  const external = data.externalUrl ? (
    <a className="button" href={data.externalUrl}>
      {tr('Open external registration')}
    </a>
  ) : null;
  if (!data.user)
    return (
      <section className="card space-y-3 p-5">
        {external}
        <p>{tr('Sign in with osu! to register or manage a qualifier reservation.')}</p>
        <a className="button" href={loginUrl}>
          {tr('Sign in with osu!')}
        </a>
      </section>
    );
  if (data.membership && !data.team)
    return (
      <section className="card p-5">
        {tr(
          'You are already registered on a roster. Your captain manages its registration and qualifier booking.',
        )}
      </section>
    );
  return (
    <div className="grid items-start gap-6 xl:grid-cols-2">
      <section className="card min-w-0 p-4 sm:p-5">
        {external && <div className="mb-4">{external}</div>}
        <h2 className="mb-3 text-lg font-semibold">
          {tr(data.team ? 'Your registration' : 'Register your entry')}
        </h2>
        {data.team && (
          <p className="mb-3 text-sm">
            {tr(
              data.team.status === 'APPROVED'
                ? 'Approved'
                : data.team.status === 'REJECTED'
                  ? 'Rejected'
                  : 'Pending',
            )}
            {data.team.rejectionReason ? `: ${data.team.rejectionReason}` : ''}
          </p>
        )}
        {!data.open && (
          <p role="status" className="mb-4 text-sm text-muted">
            {tr(
              'Registration or roster editing is closed. Your existing registration is retained.',
            )}
          </p>
        )}
        {data.policy.closesAt && (
          <p className="mb-3 text-xs text-muted">
            {tr('Registration deadline')}: {time(data.policy.closesAt)}
          </p>
        )}
        {data.policy.rosterClosesAt && (
          <p className="mb-3 text-xs text-muted">
            {tr('Roster deadline')}: {time(data.policy.rosterClosesAt)}
          </p>
        )}
        <details open={!data.team}>
          <summary className="mb-3 cursor-pointer text-sm font-semibold">
            {tr('Roster and registration details')}
          </summary>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                async () => {
                  await api('/api/registration', {
                    method: 'POST',
                    body: JSON.stringify({
                      type: 'registration.save',
                      baseVersion: witness.baseVersion,
                      policyToken: witness.policyToken,
                      name,
                      format,
                      members: members.map((member) => ({
                        ...member,
                        osuId: Number(member.osuId),
                      })),
                      answers,
                    }),
                  });
                  const next = await refresh();
                  setWitness({
                    baseVersion: next.team?.version || 0,
                    policyToken: next.policyToken,
                  });
                  setSavedDraft(draft);
                },
                data.team
                  ? 'Registration saved.'
                  : 'Registration saved and automatically approved.',
              );
            }}
          >
            <fieldset disabled={busy || !data.open} className="min-w-0 space-y-4">
              <Field label={tr('Entry name')}>
                <input
                  required
                  maxLength={120}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              {data.format === 'CUSTOM' && data.policy.format === 'AUTO' && !data.team && (
                <Field label={tr('Registration format')}>
                  <select
                    value={format}
                    onChange={(event) => {
                      const next = event.target.value as typeof format;
                      setFormat(next);
                      if (next === 'INDIVIDUAL')
                        setMembers([
                          { osuId: String(data.user!.osuId), substitute: false, discordId: '' },
                        ]);
                    }}
                  >
                    <option value="TEAM">{tr('Team')}</option>
                    <option value="INDIVIDUAL">{tr('Solo')}</option>
                  </select>
                </Field>
              )}
              <p className="text-xs text-muted">
                {tr(
                  'Starting players: {0}. Maximum roster: {1}. Substitutes: {2}.',
                  format === 'INDIVIDUAL' ? 1 : data.minimumPlayers,
                  data.policy.maxPlayers,
                  data.policy.maxSubstitutes,
                )}
              </p>
              <div className="space-y-3">
                {members.map((member, index) => (
                  <div key={index} className="space-y-2 rounded-xl border p-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Field label={tr(index === 0 ? 'Captain osu! ID' : 'Player osu! ID')}>
                        <input
                          inputMode="numeric"
                          required
                          value={member.osuId}
                          readOnly={index === 0}
                          onChange={(event) =>
                            setMembers((rows) =>
                              rows.map((row, i) =>
                                i === index ? { ...row, osuId: event.target.value } : row,
                              ),
                            )
                          }
                        />
                      </Field>
                      <Field label={tr('Discord user ID (optional)')}>
                        <input
                          inputMode="numeric"
                          value={member.discordId}
                          onChange={(event) =>
                            setMembers((rows) =>
                              rows.map((row, i) =>
                                i === index ? { ...row, discordId: event.target.value } : row,
                              ),
                            )
                          }
                        />
                      </Field>
                    </div>
                    {index > 0 && (
                      <div className="flex flex-wrap justify-between gap-2">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={member.substitute}
                            onChange={(event) =>
                              setMembers((rows) =>
                                rows.map((row, i) =>
                                  i === index ? { ...row, substitute: event.target.checked } : row,
                                ),
                              )
                            }
                          />
                          {tr('Substitute')}
                        </label>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setMembers((rows) => rows.filter((_, i) => i !== index))}
                        >
                          {tr('Remove')}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {format === 'TEAM' && members.length < data.policy.maxPlayers && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setMembers((rows) => [...rows, { osuId: '', substitute: false, discordId: '' }])
                  }
                >
                  {tr('Add player')}
                </Button>
              )}
              {data.policy.fields.map((field) => (
                <Field key={field.key} label={`${field.label}${field.required ? ' *' : ''}`}>
                  {field.type === 'checkbox' ? (
                    <input
                      type="checkbox"
                      required={field.required}
                      checked={answers[field.key] === true}
                      onChange={(event) =>
                        setAnswers((values) => ({ ...values, [field.key]: event.target.checked }))
                      }
                    />
                  ) : field.type === 'choice' ? (
                    <select
                      required={field.required}
                      value={String(answers[field.key] || '')}
                      onChange={(event) =>
                        setAnswers((values) => ({ ...values, [field.key]: event.target.value }))
                      }
                    >
                      <option value="">{tr('Select an option')}</option>
                      {field.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : field.type === 'longtext' ? (
                    <textarea
                      required={field.required}
                      maxLength={4000}
                      value={String(answers[field.key] || '')}
                      onChange={(event) =>
                        setAnswers((values) => ({ ...values, [field.key]: event.target.value }))
                      }
                    />
                  ) : (
                    <input
                      type={field.type === 'number' ? 'number' : 'text'}
                      required={field.required}
                      maxLength={4000}
                      value={answers[field.key] === undefined ? '' : String(answers[field.key])}
                      onChange={(event) =>
                        setAnswers((values) => ({
                          ...values,
                          [field.key]:
                            field.type === 'number' && event.target.value !== ''
                              ? Number(event.target.value)
                              : event.target.value,
                        }))
                      }
                    />
                  )}
                </Field>
              ))}
              <Button type="submit" disabled={busy}>
                {tr(data.team ? 'Save registration' : 'Register')}
              </Button>
            </fieldset>
          </form>
        </details>
      </section>
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
            const deadlines = [session.bookingClosesAt, data.policy.bookingClosesAt]
              .filter((value) => !!value)
              .map((value) => new Date(value!).getTime());
            const bookingDeadline = deadlines.length
              ? new Date(Math.min(...deadlines)).toISOString()
              : null;
            const deadlineClosed =
              !data.policy.bookingEnabled ||
              !!(
                data.policy.bookingClosesAt &&
                new Date(data.policy.bookingClosesAt).getTime() <= Date.now()
              );
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
                        await api('/api/registration', {
                          method: 'POST',
                          body: JSON.stringify({
                            type: 'registration.booking',
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
