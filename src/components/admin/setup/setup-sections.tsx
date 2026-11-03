'use client';
import { useEffect, useMemo, useState } from 'react';
import { Check, Circle, Send, Undo2, X } from 'lucide-react';
import { useT } from '@/components/locale';
import { Button } from '@/components/ui/button';
import type { MatchRules } from '@/lib/match-rules';
import {
  gameplayScoringSchema,
  SCORING_DESCRIPTIONS,
  SCORING_LABELS,
} from '@/lib/gameplay-scoring';
import type { QualifierBookingPolicy } from '@/lib/qualifier-booking-policy';
import type { RegistrationPolicy } from '@/lib/registration-policy';
import { defaultRulesOperations, rosterOperations } from '@/lib/setup-operations';
import type { SetupWorkspaceData } from '@/lib/setup-queries';
import type { ReadinessItem } from '@/lib/setup-readiness';
import {
  buildTemplate,
  TEMPLATE_KEYS,
  TEMPLATE_LABELS,
  templateDefaults,
  type TemplateChoices,
} from '@/lib/format-templates';
import { templateOperations } from '@/lib/setup-operations';
import { EligibilityPanel } from './setup-eligibility';
import { PhaseFlow } from './setup-format';
import { MatchRulesFields } from '../match-rules-fields';
import { QualifierBookingSettings } from '../qualifier-booking-settings';
import { RegistrationSettings } from '../registration-settings';
import { action, api, ConfirmButton, Field, SaveButton, useTask, useUnsaved } from '../shared';
import styles from './setup.module.css';

type SectionProps = {
  data: SetupWorkspaceData;
  reload: () => Promise<unknown>;
};

export function TemplateSection({ data, reload }: SectionProps) {
  const tr = useT();
  const { busy, run } = useTask();
  const [choices, setChoices] = useState<TemplateChoices>(templateDefaults('QUALIFIER_BRACKET'));
  const update = (fields: Partial<TemplateChoices>) => setChoices({ ...choices, ...fields });
  const built = useMemo(() => {
    try {
      return { result: buildTemplate(choices), error: '' };
    } catch (error) {
      const issues = (error as { issues?: { message: string }[] }).issues;
      return { result: null, error: issues?.[0]?.message ?? (error as Error).message };
    }
  }, [choices]);
  const { template } = choices;
  const usesGroups = ['QUALIFIER_GROUPS_BRACKET', 'DIRECT_ENTRY_GROUPS', 'TIERED_GROUPS'].includes(
    template,
  );
  const usesDirect = ['DIRECT_ENTRY_GROUPS', 'TIERED_GROUPS'].includes(template);
  const usesBracketSize = ['BRACKET', 'QUALIFIER_BRACKET', 'DRAFT'].includes(template);
  const number = (
    key: 'teamSize' | 'rosterSize' | 'bracketSize' | 'directSeeds' | 'groupCount' | 'groupSize',
    label: string,
    hint?: string,
  ) => (
    <Field label={label} hint={hint}>
      <input
        type="number"
        min={key === 'directSeeds' ? 0 : 1}
        value={choices[key]}
        onChange={(event) => update({ [key]: Number(event.target.value) })}
      />
    </Field>
  );
  return (
    <div className="grid gap-4">
      <div className={styles.templates} role="radiogroup" aria-label={tr('Tournament format')}>
        {TEMPLATE_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={template === key}
            className={`${styles.templateCard} ${template === key ? styles.templateActive : ''}`}
            onClick={() => setChoices({ ...templateDefaults(key), teamSize: choices.teamSize })}
          >
            <strong>{tr(TEMPLATE_LABELS[key].name)}</strong>
            <span className="text-muted">{tr(TEMPLATE_LABELS[key].description)}</span>
          </button>
        ))}
      </div>
      <div className="grid-fields">
        {number('teamSize', tr('Players per side'))}
        {number(
          'rosterSize',
          tr('Players on a roster'),
          tr('Include substitutes, so this is at least the players per side.'),
        )}
        {usesBracketSize &&
          number(
            'bracketSize',
            template === 'DRAFT' ? tr('Teams') : tr('Entrants in the bracket'),
            tr('A power of two, such as 8, 16 or 32.'),
          )}
        {usesDirect && number('directSeeds', tr('Seeds skipping groups'))}
        {usesGroups && number('groupCount', tr('Groups per tier'))}
        {usesGroups && number('groupSize', tr('Entrants per group'))}
        {template !== 'BRACKET' && (
          <Field label={tr('Qualifier playthroughs')}>
            <select
              value={choices.runs}
              onChange={(event) => update({ runs: Number(event.target.value) as 1 | 2 })}
            >
              <option value={1}>{tr('Once')}</option>
              <option value={2}>{tr('Twice')}</option>
            </select>
          </Field>
        )}
        {template !== 'BRACKET' && (
          <Field label={tr('Seeding method')}>
            <select
              value={choices.seeding}
              onChange={(event) =>
                update({ seeding: event.target.value as TemplateChoices['seeding'] })
              }
            >
              <option value="Z_SUM">{tr('Z-Sum')}</option>
              <option value="RAW_SCORE">{tr('Raw score')}</option>
              <option value="PERCENT_MAX">{tr('Percent of map maximum (%MAX)')}</option>
              <option value="AVERAGE_PLACEMENT">{tr('Average map placement')}</option>
            </select>
          </Field>
        )}
        {template === 'DRAFT' && (
          <Field label={tr('Formation method')}>
            <select
              value={choices.formation}
              onChange={(event) =>
                update({ formation: event.target.value as TemplateChoices['formation'] })
              }
            >
              <option value="AUCTION">{tr('Auction')}</option>
              <option value="SNAKE_DRAFT">{tr('Snake draft')}</option>
              <option value="MANUAL">{tr('Assigned by organizers')}</option>
            </select>
          </Field>
        )}
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={choices.doubleElimination}
            onChange={(event) => update({ doubleElimination: event.target.checked })}
          />
          {tr('Double elimination')}
        </label>
      </div>
      {built.result ? (
        <>
          <PhaseFlow plan={built.result.plan} />
          <p className="text-sm text-muted">
            {tr(
              'Creates these stages: {0}.',
              built.result.stages.map((stage) => stage.name).join(', '),
            )}
          </p>
        </>
      ) : (
        <p role="status" className={styles.issues}>
          {tr(built.error)}
        </p>
      )}
      <div>
        <SaveButton
          type="button"
          busy={busy}
          disabled={busy || !built.result}
          onClick={() =>
            void run(async () => {
              await action({
                type: 'setup.apply',
                operations: templateOperations(choices, data),
              });
              await reload();
            }, tr('Template applied. Everything it created stays editable below.'))
          }
        >
          {tr('Use this format')}
        </SaveButton>
      </div>
    </div>
  );
}

export function RegistrationSection({ data, reload }: SectionProps) {
  const tr = useT();
  const { busy, run } = useTask();
  const [registration, setRegistration] = useState<RegistrationPolicy>(data.registration);
  const [booking, setBooking] = useState<QualifierBookingPolicy>(data.booking);
  useEffect(() => setRegistration(data.registration), [data.registration]);
  useEffect(() => setBooking(data.booking), [data.booking]);
  const dirty =
    JSON.stringify(registration) !== JSON.stringify(data.registration) ||
    JSON.stringify(booking) !== JSON.stringify(data.booking);
  useUnsaved(dirty);
  const isOpen = data.tournament.status === 'REGISTRATIONS_OPEN';
  const save = (extra: Record<string, unknown>, message: string) =>
    void run(async () => {
      await action({
        type: 'settings.save',
        baseVersion: data.tournament.version,
        registrationPolicy: registration,
        qualifierBookingPolicy: booking,
        ...extra,
      });
      await reload();
    }, message);
  return (
    <div className="grid gap-6">
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save({}, tr('Registration settings saved.'));
        }}
      >
        <RegistrationSettings value={registration} onChange={setRegistration} />
        <QualifierBookingSettings value={booking} onChange={setBooking} />
        <div className="flex flex-wrap items-center gap-2">
          <SaveButton busy={busy} disabled={busy || !dirty}>
            {tr('Save registration')}
          </SaveButton>
          {registration.mode === 'WEBSITE' && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                const navigation = data.navigation.some((link) => link.href === '/register')
                  ? data.navigation
                  : [...data.navigation, { label: 'Register', href: '/register' }];
                save(
                  isOpen ? { status: 'UPCOMING' } : { status: 'REGISTRATIONS_OPEN', navigation },
                  isOpen ? tr('Registration closed.') : tr('Registration opened.'),
                );
              }}
            >
              {isOpen ? tr('Close registration') : tr('Open registration')}
            </Button>
          )}
          {isOpen && !data.tournament.published && (
            <span className="text-sm text-muted">
              {tr('Entrants can register once the tournament is published.')}
            </span>
          )}
        </div>
      </form>
      {data.eligibility && <EligibilityPanel review={data.eligibility} reload={reload} />}
    </div>
  );
}

export function RostersSection({ data, reload }: SectionProps) {
  const tr = useT();
  const { busy, run } = useTask();
  const saved = useMemo(
    () => ({
      teamSize: data.rules.teamSize,
      format: data.registration.format,
      minPlayers: data.registration.minPlayers,
      maxPlayers: data.registration.maxPlayers,
      maxSubstitutes: data.registration.maxSubstitutes,
    }),
    [data.rules.teamSize, data.registration],
  );
  const [roster, setRoster] = useState(saved);
  useEffect(() => setRoster(saved), [saved]);
  const dirty = JSON.stringify(roster) !== JSON.stringify(saved);
  useUnsaved(dirty);
  const number = (key: Exclude<keyof typeof roster, 'format'>, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <input
        type="number"
        min={key === 'teamSize' || key === 'maxPlayers' ? 1 : 0}
        max={key === 'teamSize' ? 8 : 32}
        value={roster[key]}
        onChange={(event) => setRoster({ ...roster, [key]: Number(event.target.value) })}
      />
    </Field>
  );
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await action({ type: 'setup.apply', operations: rosterOperations(roster, data) });
          await reload();
        }, tr('Roster settings saved.'));
      }}
    >
      <div className="grid-fields">
        {number(
          'teamSize',
          tr('Players per side'),
          tr('Also sets match rules and how many players each qualifier map needs.'),
        )}
        <Field label={tr('Entrants')}>
          <select
            value={roster.format}
            onChange={(event) =>
              setRoster({ ...roster, format: event.target.value as typeof roster.format })
            }
          >
            <option value="AUTO">{tr('Follow the tournament format')}</option>
            <option value="TEAM">{tr('Teams')}</option>
            <option value="INDIVIDUAL">{tr('Individual players')}</option>
          </select>
        </Field>
        {number('minPlayers', tr('Minimum roster'))}
        {number('maxPlayers', tr('Maximum roster'))}
        {number('maxSubstitutes', tr('Substitutes allowed'))}
      </div>
      {roster.maxPlayers < roster.teamSize && (
        <p role="status" className={styles.issues}>
          {tr('Rosters must hold at least the players per side.')}
        </p>
      )}
      <div>
        <SaveButton busy={busy} disabled={busy || !dirty || roster.maxPlayers < roster.teamSize}>
          {tr('Save rosters')}
        </SaveButton>
      </div>
    </form>
  );
}

export function ScoringSection({ data, reload }: SectionProps) {
  const tr = useT();
  const { busy, run } = useTask();
  const [rules, setRules] = useState<MatchRules>(data.rules);
  const [scoring, setScoring] = useState(data.gameplayScoring ?? '');
  useEffect(() => setRules(data.rules), [data.rules]);
  useEffect(() => setScoring(data.gameplayScoring ?? ''), [data.gameplayScoring]);
  const dirty =
    JSON.stringify(rules) !== JSON.stringify(data.rules) ||
    scoring !== (data.gameplayScoring ?? '');
  useUnsaved(dirty);
  const parsedScoring = gameplayScoringSchema.safeParse(scoring);
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await action({
            type: 'setup.apply',
            operations: defaultRulesOperations(
              rules,
              data,
              parsedScoring.success && scoring !== data.gameplayScoring
                ? [
                    {
                      type: 'settings.save',
                      baseVersion: data.tournament.version,
                      gameplayScoring: scoring,
                    },
                  ]
                : [],
            ),
          });
          await reload();
        }, tr('Scoring saved.'));
      }}
    >
      <Field
        label={tr('Gameplay scoring')}
        hint={parsedScoring.success ? tr(SCORING_DESCRIPTIONS[parsedScoring.data]) : undefined}
      >
        <select value={scoring} onChange={(event) => setScoring(event.target.value)}>
          <option value="">{tr('Choose a scoring system')}</option>
          {gameplayScoringSchema.options.map((option) => (
            <option key={option} value={option}>
              {tr(SCORING_LABELS[option])}
            </option>
          ))}
        </select>
      </Field>
      <p className="text-sm text-muted">
        {tr(
          'These rules apply to every stage. Each stage keeps its own Best of and bans from the stage list.',
        )}
      </p>
      <MatchRulesFields rules={rules} onChange={setRules} />
      <div>
        <SaveButton busy={busy} disabled={busy || !dirty}>
          {tr('Save scoring and mods')}
        </SaveButton>
      </div>
    </form>
  );
}

export function ScheduleSection({ data, reload }: SectionProps) {
  const tr = useT();
  const { busy, run } = useTask();
  const saved = useMemo(() => data.importantDates, [data.importantDates]);
  const [dates, setDates] = useState(saved);
  useEffect(() => setDates(saved), [saved]);
  const dirty = JSON.stringify(dates) !== JSON.stringify(saved);
  useUnsaved(dirty);
  const missingStages = data.stages.filter(
    (stage) => !dates.some((date) => date.label === stage.name),
  );
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await action({
            type: 'settings.save',
            baseVersion: data.tournament.version,
            importantDates: dates.filter((date) => date.label && date.date),
          });
          await reload();
        }, tr('Key dates saved.'));
      }}
    >
      <p className="text-sm text-muted">
        {tr(
          'Key dates appear on the public timeline. Registration and booking windows are set under Registration and eligibility.',
        )}
      </p>
      <ul className="grid gap-2">
        {dates.map((date, index) => (
          <li key={index} className="flex flex-wrap items-end gap-2">
            <div className="min-w-40 flex-1">
              <Field label={tr('Label')}>
                <input
                  value={date.label}
                  maxLength={120}
                  onChange={(event) =>
                    setDates(
                      dates.map((item, position) =>
                        position === index ? { ...item, label: event.target.value } : item,
                      ),
                    )
                  }
                />
              </Field>
            </div>
            <Field label={tr('Date')}>
              <input
                type="date"
                value={date.date}
                onChange={(event) =>
                  setDates(
                    dates.map((item, position) =>
                      position === index ? { ...item, date: event.target.value } : item,
                    ),
                  )
                }
              />
            </Field>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDates(dates.filter((_, position) => position !== index))}
            >
              {tr('Remove')}
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setDates([...dates, { label: '', date: '' }])}
        >
          {tr('Add a date')}
        </Button>
        {missingStages.length > 0 && (
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setDates([
                ...dates,
                ...missingStages.map((stage) => ({ label: stage.name, date: '' })),
              ])
            }
          >
            {tr('Add a date for each stage')}
          </Button>
        )}
        <SaveButton busy={busy} disabled={busy || !dirty}>
          {tr('Save key dates')}
        </SaveButton>
      </div>
    </form>
  );
}

export function ReadinessList({
  items,
  onOpen,
  canDismiss,
  dismissed,
  onDismiss,
}: {
  items: readonly ReadinessItem[];
  onOpen: (item: ReadinessItem) => void;
  canDismiss: boolean;
  dismissed: readonly string[];
  onDismiss: (id: string, dismissed: boolean) => void;
}) {
  const tr = useT();
  return (
    <ul className={styles.readiness}>
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-1">
          <button
            type="button"
            className={`${styles.readinessItem} ${item.done ? styles.readinessDone : ''}`}
            onClick={() => onOpen(item)}
          >
            {item.done ? <Check size={16} /> : <Circle size={16} />}
            <span>
              {tr(item.label, ...(item.values || []))}
              {!item.required && !item.done ? ` · ${tr('optional')}` : ''}
            </span>
          </button>
          {canDismiss && !item.required && (!item.done || dismissed.includes(item.id)) && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={
                dismissed.includes(item.id)
                  ? tr('Undo not needed: {0}', tr(item.label, ...(item.values || [])))
                  : tr('Not needed: {0}', tr(item.label, ...(item.values || [])))
              }
              title={dismissed.includes(item.id) ? tr('Undo') : tr('Not needed')}
              onClick={() => onDismiss(item.id, !dismissed.includes(item.id))}
            >
              {dismissed.includes(item.id) ? <Undo2 size={15} /> : <X size={15} />}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function PublicationSection({
  data,
  reload,
  items,
  children,
}: SectionProps & { items: readonly ReadinessItem[]; children?: React.ReactNode }) {
  const tr = useT();
  const { busy, run } = useTask();
  const { tournament } = data;
  const missing = items.filter(
    (item) => item.required && !item.done && item.id !== 'publish',
  ).length;
  return (
    <div className="grid gap-4">
      <p className="text-sm">
        {tournament.published
          ? tr('The tournament is public. Pages, pools and brackets publish separately.')
          : tr('The tournament is private. Only organizers can see it.')}
        {!tournament.published && missing > 0
          ? ` ${tr('{0} setup items are unfinished, but you can publish whenever you are ready.', missing)}`
          : ''}
      </p>
      <div>
        <ConfirmButton
          variant={tournament.published ? 'outline' : 'default'}
          disabled={busy || !!tournament.archivedAt}
          title={tournament.published ? tr('Unpublish tournament?') : tr('Publish tournament?')}
          description={
            tournament.published
              ? tr('The public website will become unavailable. Saved content is preserved.')
              : tr(
                  'The tournament will become visible to visitors. Only published pages and pools appear.',
                )
          }
          onConfirm={() =>
            void run(
              async () => {
                await api('/api/tournaments', {
                  method: 'POST',
                  body: JSON.stringify({
                    type: 'lifecycle',
                    id: tournament.id,
                    baseVersion: tournament.version,
                    published: !tournament.published,
                    archived: !!tournament.archivedAt,
                  }),
                });
                await reload();
              },
              tournament.published ? tr('Tournament unpublished.') : tr('Tournament published.'),
            )
          }
        >
          <Send size={15} />
          {tournament.published ? tr('Unpublish tournament') : tr('Publish tournament')}
        </ConfirmButton>
      </div>
      {children}
    </div>
  );
}
