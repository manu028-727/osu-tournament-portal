'use client';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useT } from '@/components/locale';
import { confirmDiscardUnsaved } from '@/components/unsaved-navigation';
import { can, type Actor } from '@/lib/permissions';
import type { SetupWorkspaceData } from '@/lib/setup-queries';
import { sectionStatus, type SetupSection } from '@/lib/setup-readiness';
import type { TournamentView } from '@/lib/types';
import { action, LoadingState, SectionTitle, useResource, useTask } from '../shared';
import { FormatSection, PhaseFlow } from './setup-format';
import { StagesSection } from './setup-stages';
import {
  PublicationSection,
  ReadinessList,
  RegistrationSection,
  RostersSection,
  ScheduleSection,
  ScoringSection,
  TemplateSection,
} from './setup-sections';
import styles from './setup.module.css';

// Heavy editors only load once their section opens, so the page stays fast to resume.
const SettingsEditor = dynamic(() => import('../settings').then((m) => m.SettingsEditor));
const StaffEditor = dynamic(() => import('../staff-editor').then((m) => m.StaffEditor));
const UsersEditor = dynamic(() => import('../access').then((m) => m.UsersEditor));
const RolesEditor = dynamic(() => import('../access').then((m) => m.RolesEditor));
const TeamsEditor = dynamic(() => import('../teams-editor').then((m) => m.TeamsEditor));
const PageEditor = dynamic(() => import('../page-editor').then((m) => m.PageEditor));

type SectionKey = SetupSection | 'template';
const TITLES: Record<SectionKey, string> = {
  template: 'Tournament format',
  identity: 'Identity and branding',
  registration: 'Registration and eligibility',
  rosters: 'Rosters and entrants',
  scoring: 'Scoring and mods',
  stages: 'Stages and mappools',
  format: 'Phases and progression',
  schedule: 'Schedule',
  staff: 'Staff and access',
  publication: 'Publication',
};

function SubTabs({
  label,
  tabs,
}: {
  label: string;
  tabs: { key: string; label: string; render: () => ReactNode }[];
}) {
  const [active, setActive] = useState(tabs[0]?.key);
  const selected = tabs.find((tab) => tab.key === active) ?? tabs[0];
  if (!selected) return null;
  return (
    <div className="grid min-w-0 gap-4">
      {tabs.length > 1 && (
        <div className={styles.subTabs} role="group" aria-label={label}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              aria-pressed={selected.key === tab.key}
              className={`${styles.subTab} ${selected.key === tab.key ? styles.subTabActive : ''}`}
              onClick={() => {
                if (selected.key !== tab.key && confirmDiscardUnsaved()) setActive(tab.key);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
      <div key={selected.key} className="min-w-0">
        {selected.render()}
      </div>
    </div>
  );
}

export function SetupWorkspace({
  actor,
  tournament,
}: {
  actor: Actor;
  tournament: TournamentView;
}) {
  const tr = useT();
  const { data, error, reload } = useResource<SetupWorkspaceData>('setup', true);
  const { run } = useTask();
  const [open, setOpen] = useState<SectionKey | null>(null);
  const [chosen, setChosen] = useState(false);

  // Resume where the organizer left off: a linked section, or the next unfinished one.
  useEffect(() => {
    if (!data || chosen) return;
    const hash = window.location.hash.slice(1) as SectionKey;
    if (hash && hash in TITLES) {
      setOpen(hash);
      setChosen(true);
      return;
    }
    const fresh = !data.stages.length && !data.plan;
    setOpen(
      fresh
        ? 'template'
        : (data.readiness.find((item) => item.required && !item.done)?.section ?? null),
    );
  }, [data, chosen]);

  // Links and browser history can name a section while the page is already open.
  useEffect(() => {
    const follow = () => {
      const hash = window.location.hash.slice(1) as SectionKey;
      if (hash in TITLES && confirmDiscardUnsaved()) {
        setOpen(hash);
        setChosen(true);
      }
    };
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);

  const visible = useMemo(() => {
    const allowed: Record<SectionKey, boolean> = {
      template:
        !!data &&
        !data.stages.length &&
        !data.plan &&
        can(actor, 'matches.manage') &&
        can(actor, 'mappools.create') &&
        can(actor, 'settings.manage'),
      identity: can(actor, 'settings.manage'),
      registration: can(actor, 'settings.manage'),
      rosters: can(actor, 'settings.manage') && can(actor, 'matches.manage'),
      scoring: can(actor, 'matches.manage'),
      stages: can(actor, 'mappools.edit') || can(actor, 'mappools.create'),
      format: can(actor, 'matches.manage'),
      schedule: can(actor, 'settings.manage'),
      staff: can(actor, 'staff.edit') || can(actor, 'users.manage') || can(actor, 'roles.manage'),
      publication:
        can(actor, 'tournament.publish') || can(actor, 'homepage.edit') || can(actor, 'rules.edit'),
    };
    return (Object.keys(TITLES) as SectionKey[]).filter((key) => allowed[key]);
  }, [actor, data]);

  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;

  const items = data.readiness;
  const required = items.filter((item) => item.required);
  const finished = required.filter((item) => item.done).length;
  const select = (key: SectionKey) => {
    setChosen(true);
    if (open === key) {
      if (confirmDiscardUnsaved()) setOpen(null);
      return;
    }
    if (!confirmDiscardUnsaved()) return;
    setOpen(key);
    window.history.replaceState(null, '', `#${key}`);
    requestAnimationFrame(() =>
      document.getElementById(`setup-${key}`)?.scrollIntoView({ block: 'nearest' }),
    );
  };
  const dismissed = data.setupState.dismissed ?? [];
  const status = (key: SectionKey) => (key === 'template' ? 'OPTIONAL' : sectionStatus(items, key));

  const body = (key: SectionKey) => {
    switch (key) {
      case 'template':
        return <TemplateSection data={data} reload={reload} />;
      case 'identity':
        return (
          <SubTabs
            label={tr('Identity sections')}
            tabs={[
              {
                key: 'info',
                label: tr('Tournament info'),
                render: () => <SettingsEditor actor={actor} area="info" />,
              },
              {
                key: 'branding',
                label: tr('Appearance'),
                render: () => <SettingsEditor actor={actor} area="branding" />,
              },
              {
                key: 'navigation',
                label: tr('Navigation & text'),
                render: () => <SettingsEditor actor={actor} area="navigation" />,
              },
            ]}
          />
        );
      case 'registration':
        return <RegistrationSection data={data} reload={reload} />;
      case 'rosters':
        return (
          <SubTabs
            label={tr('Roster sections')}
            tabs={[
              {
                key: 'limits',
                label: tr('Roster rules'),
                render: () => <RostersSection data={data} reload={reload} />,
              },
              {
                key: 'entrants',
                label: tr('Entrants'),
                render: () => <TeamsEditor actor={actor} />,
              },
            ]}
          />
        );
      case 'scoring':
        return <ScoringSection data={data} reload={reload} />;
      case 'stages':
        return (
          <StagesSection
            actor={actor}
            data={data}
            reload={reload}
            canEdit={can(actor, 'mappools.edit') && can(actor, 'matches.manage')}
          />
        );
      case 'format':
        return <FormatSection data={data} reload={reload} canEdit={can(actor, 'matches.manage')} />;
      case 'schedule':
        return <ScheduleSection data={data} reload={reload} actor={actor} />;
      case 'staff':
        return (
          <SubTabs
            label={tr('Staff sections')}
            tabs={[
              ...(can(actor, 'staff.edit')
                ? [
                    {
                      key: 'listing',
                      label: tr('Public listing'),
                      render: () => <StaffEditor actor={actor} />,
                    },
                  ]
                : []),
              ...(can(actor, 'users.manage')
                ? [
                    {
                      key: 'access',
                      label: tr('Website access'),
                      render: () => <UsersEditor actor={actor} />,
                    },
                  ]
                : []),
              ...(can(actor, 'roles.manage')
                ? [
                    {
                      key: 'roles',
                      label: tr('Roles & permissions'),
                      render: () => <RolesEditor actor={actor} />,
                    },
                  ]
                : []),
            ]}
          />
        );
      case 'publication':
        return (
          <PublicationSection data={data} reload={reload} items={items}>
            <SubTabs
              label={tr('Page sections')}
              tabs={[
                ...(can(actor, 'homepage.edit')
                  ? [
                      {
                        key: 'homepage',
                        label: tr('Homepage'),
                        render: () => (
                          <PageEditor kind="homepage" actor={actor} tournament={tournament} />
                        ),
                      },
                    ]
                  : []),
                ...(can(actor, 'rules.edit')
                  ? [
                      {
                        key: 'rules',
                        label: tr('Rules'),
                        render: () => (
                          <PageEditor kind="rules" actor={actor} tournament={tournament} />
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </PublicationSection>
        );
    }
  };

  return (
    <>
      <SectionTitle
        title={data.tournament.name}
        description={
          data.tournament.published
            ? tr('Published. Everything here stays editable.')
            : tr('Private until you publish. Changes save to the tournament as you go.')
        }
      />
      <div className={styles.layout}>
        <aside className={styles.rail}>
          <div>
            <p className={styles.railHeading}>
              {tr('{0} of {1} required steps finished', finished, required.length)}
            </p>
            <div
              className={styles.progress}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={required.length}
              aria-valuenow={finished}
              aria-label={tr('Setup progress')}
            >
              <span
                className={styles.progressValue}
                style={{ width: `${(finished / Math.max(1, required.length)) * 100}%` }}
              />
            </div>
          </div>
          <nav aria-label={tr('Setup sections')} className={styles.steps}>
            {visible.map((key) => (
              <button
                key={key}
                type="button"
                aria-current={open === key ? 'true' : undefined}
                className={`${styles.step} ${open === key ? styles.stepActive : ''}`}
                onClick={() => select(key)}
              >
                <span className={`${styles.dot} ${styles[`dot${status(key)}`]}`} aria-hidden />
                {tr(TITLES[key])}
              </button>
            ))}
          </nav>
          {data.plan && (
            <div className={styles.railReadiness}>
              <p className={styles.railHeading}>{tr('Phases')}</p>
              <ol className={styles.railFlow}>
                {data.plan.phases.map((phase, index) => (
                  <li key={phase.key}>
                    <span className="text-muted">{index + 1}.</span> {phase.name}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className={styles.railReadiness}>
            <p className={styles.railHeading}>{tr('Readiness')}</p>
            <ReadinessList
              items={items.filter((item) => !item.done || dismissed.includes(item.id))}
              canDismiss={can(actor, 'settings.manage')}
              dismissed={dismissed}
              onOpen={(item) => select(item.section)}
              onDismiss={(id, dismiss) =>
                void run(async () => {
                  await action({
                    type: 'setup.state',
                    dismissed: dismiss
                      ? [...dismissed, id]
                      : dismissed.filter((item) => item !== id),
                  });
                  await reload();
                }, tr('Checklist updated.'))
              }
            />
          </div>
        </aside>
        <div className={styles.sections}>
          {data.plan && visible.includes('format') && open !== 'format' && (
            <PhaseFlow plan={data.plan} />
          )}
          {visible.map((key) => (
            <section key={key} id={`setup-${key}`} className={styles.section}>
              <button
                type="button"
                className={styles.sectionHeader}
                aria-expanded={open === key}
                aria-controls={`setup-${key}-body`}
                onClick={() => select(key)}
              >
                {open === key ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                <span className={`${styles.dot} ${styles[`dot${status(key)}`]}`} aria-hidden />
                <h2 className={styles.sectionTitle}>{tr(TITLES[key])}</h2>
              </button>
              {open === key && (
                <div id={`setup-${key}-body`} className={styles.sectionBody}>
                  {body(key)}
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
