import Link from '@/components/tournament-scope';
import { ArrowUpRight, CalendarDays, Headphones, Users, Trophy } from 'lucide-react';
import type { PageContent, TournamentView } from '@/lib/types';
import { siteCopy } from '@/lib/copy';
import { formatDate } from '@/lib/utils';
import { Button } from './ui/button';
import { Badge } from './ui/badge';

export function HomepageContent({
  page,
  tournament,
}: {
  page: PageContent;
  tournament: TournamentView;
}) {
  const copy = siteCopy(tournament.settings.copy);
  const statuses: Record<string, string> = {
    UPCOMING: 'In arrivo',
    REGISTRATIONS_OPEN: 'Iscrizioni aperte',
    ONGOING: 'Torneo in corso',
    COMPLETED: 'Torneo concluso',
  };
  return (
    <>
      {page.blocks
        .filter((block) => block.visible)
        .map((block, index) => {
          const c = block.content;
          const buttons = (
            <div className="flex flex-wrap gap-3">
              {c.buttons
                ?.filter((button) => button.href)
                .map((button, i) => (
                  <Button
                    asChild
                    key={button.href + button.label}
                    variant={i === 0 ? 'default' : 'outline'}
                  >
                    <Link href={button.href}>
                      {button.label}
                      <ArrowUpRight size={15} />
                    </Link>
                  </Button>
                ))}
            </div>
          );
          if (block.type === 'hero')
            return (
              <section className="tournament-hero border-b border-white/10" key={index}>
                <div className="wrap pb-9 pt-8 md:pt-10">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    {c.eyebrow && <p className="eyebrow">{c.eyebrow}</p>}
                    <Badge className="gap-2 border-accent/20 bg-accent/5 text-accent">
                      <span className="size-1.5 rounded-full bg-accent" />
                      {statuses[tournament.status] || tournament.status}
                    </Badge>
                  </div>
                  <h1
                    className={
                      c.image || tournament.settings.banner
                        ? 'sr-only'
                        : 'text-4xl font-semibold my-8'
                    }
                  >
                    {c.title || tournament.name}
                  </h1>
                  {(c.image || tournament.settings.banner) && (
                    <img
                      src={c.image || tournament.settings.banner}
                      alt={c.title || tournament.name}
                      className="tournament-hero-art"
                      fetchPriority="high"
                      width={1486}
                      height={435}
                    />
                  )}
                  <div className="flex flex-col justify-between gap-6 border-t border-white/10 pt-7 md:flex-row md:items-center">
                    <p className="max-w-lg text-sm leading-7 text-muted">{c.text}</p>
                    {buttons}
                  </div>
                  {[
                    copy.communityLabel,
                    copy.competitionLabel,
                    copy.formatLabel,
                    copy.finalsLabel,
                  ].some(Boolean) && (
                    <div className="mt-8 grid grid-cols-2 gap-4 border-t border-white/10 pt-6 text-xs text-white/75 md:grid-cols-4">
                      {[
                        { text: copy.communityLabel, Icon: Users, color: 'text-primary' },
                        { text: copy.competitionLabel, Icon: Headphones, color: 'text-accent' },
                        { text: copy.formatLabel, Icon: Trophy, color: 'text-[#efce81]' },
                        { text: copy.finalsLabel, Icon: CalendarDays, color: 'text-[#90bdf4]' },
                      ]
                        .filter((item) => item.text)
                        .map(({ text, Icon, color }) => (
                          <span key={text} className="flex items-center gap-3">
                            <Icon size={16} className={color} />
                            {text}
                          </span>
                        ))}
                    </div>
                  )}
                </div>
              </section>
            );
          if (block.type === 'timeline')
            return (
              <section key={index} className="wrap py-14 md:py-18">
                <div className="flex flex-wrap items-end justify-between gap-5">
                  <div>
                    {c.eyebrow && <p className="eyebrow mb-3">{c.eyebrow}</p>}
                    <h2 className="section-title">{c.title}</h2>
                  </div>
                  {copy.timelineNote && (
                    <p className="flex items-center gap-2 text-xs text-muted">
                      <CalendarDays size={14} />
                      {copy.timelineNote}
                    </p>
                  )}
                </div>
                <ol className="tournament-timeline mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {tournament.settings.importantDates.map((date, i) => (
                    <li className="card p-5" key={date.label}>
                      <div className="mb-5 flex items-center justify-between">
                        <span className="font-mono text-[10px] text-muted">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span className="h-px w-7 bg-primary/40" />
                      </div>
                      <h3 className="text-xs text-muted">{date.label}</h3>
                      <p className="mt-2 text-lg font-semibold">
                        {formatDate(date.date, tournament.timezone)}
                      </p>
                    </li>
                  ))}
                </ol>
              </section>
            );
          if (block.type === 'image')
            return (
              <section className="wrap py-10" key={index}>
                {c.title && <h2 className="section-title mb-6">{c.title}</h2>}
                {c.image && (
                  <img
                    src={c.image}
                    alt={c.text || c.title || ''}
                    className="h-auto max-h-[650px] w-full object-contain"
                    loading="lazy"
                  />
                )}
              </section>
            );
          if (block.type === 'announcements')
            return (
              <section key={index} className="border-b border-white/10 bg-white/[.02]">
                <div className="wrap grid gap-7 py-9 md:grid-cols-[.85fr_1.15fr] md:py-11">
                  <div>
                    {c.eyebrow && <p className="eyebrow mb-3">{c.eyebrow}</p>}
                    <h2 className="max-w-sm text-2xl font-semibold leading-tight">{c.title}</h2>
                  </div>
                  <div>
                    <p className="mb-3 text-base font-semibold text-accent">
                      {c.text?.split('\n')[0]}
                    </p>
                    <p className="mb-6 max-w-xl text-sm text-muted">
                      {c.text?.split('\n').slice(1).join('\n')}
                    </p>
                    {buttons}
                  </div>
                </div>
              </section>
            );
          if (block.type === 'buttons')
            return (
              <section key={index} className="mt-8 border-y border-white/10 bg-white/[.02]">
                <div className="wrap py-12 md:py-16">
                  {c.eyebrow && <p className="eyebrow mb-4">{c.eyebrow}</p>}
                  <h2 className="section-title max-w-2xl">{c.title}</h2>
                  <p className="mb-7 mt-5 max-w-xl text-sm text-muted">{c.text}</p>
                  {buttons}
                </div>
              </section>
            );
          return (
            <section
              key={index}
              className="wrap grid gap-7 border-t border-white/10 py-12 md:grid-cols-2 md:gap-16"
            >
              <div>
                {c.eyebrow && <p className="eyebrow mb-4">{c.eyebrow}</p>}
                <h2 className="section-title max-w-md">{c.title}</h2>
              </div>
              <div>
                {c.html ? (
                  <div className="prose text-sm" dangerouslySetInnerHTML={{ __html: c.html }} />
                ) : (
                  <p className="text-sm text-muted">{c.text}</p>
                )}
                <div className="mt-6">{buttons}</div>
              </div>
            </section>
          );
        })}
    </>
  );
}
