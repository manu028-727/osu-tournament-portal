'use client';
import { useId } from 'react';
import { useLocale } from '@/components/locale';
import Link from '@/components/tournament-scope';
import { ArrowUpRight, CalendarDays, Megaphone } from 'lucide-react';
import type { PageContent, TournamentView } from '@/lib/types';
import { siteCopy } from '@/lib/copy';
import { formatDate } from '@/lib/utils';
import { TournamentProfileHeader } from './tournament-profile';
import styles from './homepage.module.css';

type HomepageBlock = PageContent['blocks'][number];

function BlockLinks({ buttons }: { buttons: HomepageBlock['content']['buttons'] }) {
  const links = buttons?.filter((button) => button.href && button.label);
  if (!links?.length) return null;
  return (
    <div className={styles.links}>
      {links.map((button, i) => (
        <Link href={button.href} key={i}>
          <span>{button.label}</span>
          <ArrowUpRight size={17} aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
}

function HomepageSection({
  block,
  tournament,
  identityNote,
}: {
  block: HomepageBlock;
  tournament: TournamentView;
  identityNote?: string;
}) {
  const language = useLocale();
  const headingId = useId();
  const c = block.content;
  const timeline = block.type === 'timeline';
  const dates = timeline ? tournament.settings.importantDates : [];
  const note = timeline ? siteCopy(tournament.settings.copy).timelineNote : identityNote;
  // TipTap represents an empty body as <p></p>; it should not create an empty panel.
  const hasHtml =
    !!c.html &&
    (!!c.html.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;|\s/g, '') ||
      /<(img|table|hr)\b/i.test(c.html));
  if (!(
    c.title?.trim() ||
    c.eyebrow?.trim() ||
    (c.html ? hasHtml : c.text?.trim()) ||
    c.image ||
    c.buttons?.some((button) => button.href && button.label) ||
    dates.length ||
    note
  ))
    return null;
  const Icon = timeline ? CalendarDays : block.type === 'announcements' ? Megaphone : null;
  return (
    <section
      className={styles.block}
      data-block-type={block.type}
      data-has-image={!!c.image}
      aria-labelledby={c.title ? headingId : undefined}
    >
      <div className={styles.copy}>
        {Icon && (
          <span className={styles.icon}>
            <Icon size={22} aria-hidden="true" />
          </span>
        )}
        {c.eyebrow && <p className={styles.eyebrow}>{c.eyebrow}</p>}
        {c.title && <h2 id={headingId}>{c.title}</h2>}
        {c.html
          ? hasHtml && (
              <div
                className={`prose ${styles.body}`}
                dangerouslySetInnerHTML={{ __html: c.html }}
              />
            )
          : c.text && <p className={styles.bodyText}>{c.text}</p>}
        {dates.length > 0 && (
          <ol className={styles.dates}>
            {dates.map((date, i) => (
              <li key={i}>
                <span className={styles.dateMarker} aria-hidden="true" />
                <time dateTime={date.date}>
                  {formatDate(date.date, tournament.timezone, language)}
                </time>
                <span>{date.label}</span>
              </li>
            ))}
          </ol>
        )}
        {note && <p className={styles.note}>{note}</p>}
        <BlockLinks buttons={c.buttons} />
      </div>
      {c.image && (
        <div className={styles.artwork}>
          <img src={c.image} alt={c.title || ''} loading="lazy" />
        </div>
      )}
    </section>
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
  const blocks = page.blocks.filter((block) => block.visible);
  const firstHero = blocks.find((block) => block.type === 'hero');
  const copy = siteCopy(tournament.settings.copy);
  const identityNote = [
    copy.communityLabel,
    copy.competitionLabel,
    copy.formatLabel,
    copy.finalsLabel,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      {showHeader && <TournamentProfileHeader tournament={tournament} />}
      <div className={styles.home} data-homepage="">
        <h1 className="sr-only">{page.title || tournament.name}</h1>
        {!firstHero && tournament.description && (
          <p className={styles.description}>{tournament.description}</p>
        )}
        {page.html && (
          <div
            className={`prose ${styles.legacy}`}
            dangerouslySetInnerHTML={{ __html: page.html }}
          />
        )}
        <div className={styles.blocks}>
          {blocks.map((block, index) => (
            <HomepageSection
              key={block.id || index}
              block={block}
              tournament={tournament}
              identityNote={block === firstHero ? identityNote : undefined}
            />
          ))}
        </div>
      </div>
    </>
  );
}
