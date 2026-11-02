'use client';
import { useLocale, useT } from '@/components/locale';
import type { TournamentView } from '@/lib/types';
import { formatDate } from '@/lib/utils';
import { TournamentTabs } from './tournament-tabs';
import styles from './tournament-profile.module.css';

/** Shared tournament identity belongs to settings, independently of CMS revisions. */
export function TournamentProfileHeader({ tournament }: { tournament: TournamentView }) {
  const language = useLocale();
  const tr = useT();
  const { banner, logo, importantDates, navigation } = tournament.settings;
  const statuses: Record<string, string> = {
    UPCOMING: 'In arrivo',
    REGISTRATIONS_OPEN: 'Iscrizioni aperte',
    ONGOING: 'Torneo in corso',
    COMPLETED: 'Torneo concluso',
  };
  return (
    <header className={styles.profile} aria-label={tr('Tournament profile')}>
      <div className={styles.banner} data-has-banner={!!banner}>
        {banner && (
          <img
            src={banner}
            alt={tr('{0} banner', tournament.name)}
            width={1486}
            height={435}
            fetchPriority="high"
          />
        )}
      </div>
      <div className={styles.identity}>
        {logo && <img className={styles.logo} src={logo} alt="" width={80} height={80} />}
        <div className={styles.identityText}>
          <p className={styles.identityTitle}>{tournament.name}</p>
          <div className={styles.metadata}>
            {statuses[tournament.status] && (
              <span className={styles.status}>{tr(statuses[tournament.status])}</span>
            )}
            {importantDates.slice(0, 2).map((date, i) => (
              <span key={i}>
                {date.label}
                <time dateTime={date.date}>
                  {formatDate(date.date, tournament.timezone, language)}
                </time>
              </span>
            ))}
          </div>
        </div>
      </div>
      <TournamentTabs
        links={[
          ...navigation,
          ...(!navigation.some((link) => link.href === '/register')
            ? [{ href: '/register', label: tr('Registration') }]
            : []),
          ...(!navigation.some((link) => link.href === '/qualifier-booking')
            ? [{ href: '/qualifier-booking', label: tr('Qualifier booking') }]
            : []),
        ]}
      />
    </header>
  );
}
