'use client';
import { useLocale, useT } from '@/components/locale';
import Link from '@/components/tournament-scope';
import { ArrowUpRight } from 'lucide-react';
import type { PageContent, TournamentView } from '@/lib/types';
import { siteCopy } from '@/lib/copy';
import { formatDate } from '@/lib/utils';
import { TournamentTabs } from './tournament-tabs';
import styles from './home-pilot.module.css';

function BlockLinks({
  buttons,
  navigation,
}: {
  buttons: PageContent['blocks'][number]['content']['buttons'];
  navigation: TournamentView['settings']['navigation'];
}) {
  const visible = buttons?.filter(
    (button) => button.href && !navigation.some((link) => link.href === button.href),
  );
  if (!visible?.length) return null;
  return (
    <div className={styles.links}>
      {visible.map((button) => (
        <Link href={button.href} key={button.href + button.label}>
          {button.label}
          <ArrowUpRight size={15} />
        </Link>
      ))}
    </div>
  );
}

export function TournamentProfileHeader({
  page,
  tournament,
}: {
  page?: PageContent | null;
  tournament: TournamentView;
}) {
  const language = useLocale();
  const tr = useT();
  const identityBlock = page?.blocks.find((block) => block.visible && block.type === 'hero');
  const banner = identityBlock?.content.image || tournament.settings.banner;
  const statuses: Record<string, string> = {
    UPCOMING: 'In arrivo',
    REGISTRATIONS_OPEN: 'Iscrizioni aperte',
    ONGOING: 'Torneo in corso',
    COMPLETED: 'Torneo concluso',
  };
  const dates = tournament.settings.importantDates;
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
        {tournament.settings.logo && (
          <img
            className={styles.logo}
            src={tournament.settings.logo}
            alt=""
            width={80}
            height={80}
          />
        )}
        <div className={styles.identityText}>
          <p className={styles.identityTitle}>{identityBlock?.content.title || tournament.name}</p>
          <div className={styles.metadata}>
            {statuses[tournament.status] && (
              <span className={styles.status}>{tr(statuses[tournament.status])}</span>
            )}
            {dates.slice(0, 2).map((date, i) => (
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
      <TournamentTabs links={tournament.settings.navigation} />
    </header>
  );
}

export function HomepageContent({
  page,
  tournament,
  showHeader = true,
}: {
  page: PageContent;
  tournament: TournamentView;
  showHeader?: boolean;
}) {
  const language = useLocale();
  const blocks = page.blocks.filter((block) => block.visible);
  const identityBlock = blocks.find((block) => block.type === 'hero');
  const copy = siteCopy(tournament.settings.copy);
  const dates = tournament.settings.importantDates;
  return (
    <>
      {showHeader && <TournamentProfileHeader page={page} tournament={tournament} />}
      <div className={styles.home}>
        <h1 className="sr-only">{identityBlock?.content.title || tournament.name}</h1>
        <div className={styles.content}>
          {!identityBlock && tournament.description && (
            <p className={styles.description}>{tournament.description}</p>
          )}
          {blocks.map((block, index) => {
            const c = block.content;
            const remainingDates = block.type === 'timeline' ? dates.slice(2) : [];
            const hasLinks = c.buttons?.some(
              (button) =>
                button.href &&
                !tournament.settings.navigation.some((link) => link.href === button.href),
            );
            const isIdentity = block === identityBlock;
            if (!(
              c.text?.trim() ||
              c.html?.trim() ||
              (c.image && !isIdentity) ||
              hasLinks ||
              remainingDates.length ||
              (block.type === 'timeline' && copy.timelineNote)
            ))
              return null;
            return (
              <section key={index} className={styles.section}>
                {!isIdentity && block.type !== 'timeline' && c.title && <h2>{c.title}</h2>}
                {c.eyebrow && <p className={styles.note}>{c.eyebrow}</p>}
                {c.image && !isIdentity && (
                  <img
                    className={styles.contentImage}
                    src={c.image}
                    alt={c.title || ''}
                    loading="lazy"
                  />
                )}
                {c.html ? (
                  <div className="prose" dangerouslySetInnerHTML={{ __html: c.html }} />
                ) : (
                  c.text && <p className={styles.body}>{c.text}</p>
                )}
                {remainingDates.length > 0 && (
                  <ul className={styles.extraDates}>
                    {remainingDates.map((date, i) => (
                      <li key={i}>
                        {date.label}
                        <time dateTime={date.date}>
                          {formatDate(date.date, tournament.timezone, language)}
                        </time>
                      </li>
                    ))}
                  </ul>
                )}
                {block.type === 'timeline' && copy.timelineNote && (
                  <p className={styles.note}>{copy.timelineNote}</p>
                )}
                {isIdentity &&
                  [
                    copy.communityLabel,
                    copy.competitionLabel,
                    copy.formatLabel,
                    copy.finalsLabel,
                  ].some(Boolean) && (
                    <p className={styles.note}>
                      {[
                        copy.communityLabel,
                        copy.competitionLabel,
                        copy.formatLabel,
                        copy.finalsLabel,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                <BlockLinks buttons={c.buttons} navigation={tournament.settings.navigation} />
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
