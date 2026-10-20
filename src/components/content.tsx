import { ArrowUpRight, Music2 } from 'lucide-react';
import type { PageContent, TournamentView, PoolContent } from '@/lib/types';
import { Badge } from './ui/badge';
import { duration } from '@/lib/utils';
import { HomepageContent } from './home-content';
export function ContentBlocks({
  page,
  tournament,
}: {
  page: PageContent;
  tournament: TournamentView;
}) {
  return <HomepageContent page={page} tournament={tournament} />;
}
export function PoolDisplay({ pool }: { pool: PoolContent }) {
  const categories = [...new Set(pool.slots.map((s) => s.category))];
  return (
    <div className="space-y-12">
      {pool.notes && (
        <p className="rounded-xl border border-white/10 bg-white/[.03] p-5 text-sm text-muted">
          {pool.notes}
        </p>
      )}
      {categories.map((category) => {
        const slots = pool.slots.filter((s) => s.category === category);
        return (
          <section key={category}>
            <div className="mb-5 flex items-center gap-3">
              <span
                className="rounded-md px-2.5 py-1 text-xs font-bold"
                style={{ color: slots[0].color, background: `${slots[0].color}15` }}
              >
                {category}
              </span>
              <h2 className="text-base font-semibold">{slots[0].categoryName}</h2>
              <span className="text-xs text-muted">{slots.length} mappe</span>
              <div className="ml-2 h-px flex-1 bg-white/5" />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {slots.map((s) => {
                const m = s.metadata;
                return (
                  <a
                    key={s.name}
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="card group overflow-hidden hover:border-white/20"
                  >
                    <div className="relative h-32 bg-[#292330]">
                      {m.cover && (
                        <img
                          src={m.cover}
                          alt=""
                          loading="lazy"
                          className="size-full object-cover opacity-70 transition-transform duration-500 group-hover:scale-105"
                        />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-card via-card/20 to-transparent" />
                      <span
                        className="absolute left-4 top-3 rounded-md bg-background/90 px-2.5 py-1 text-xs font-bold"
                        style={{ color: s.color }}
                      >
                        {s.name}
                      </span>
                      <ArrowUpRight className="absolute right-4 top-4 text-white/60" size={17} />
                      <div className="absolute bottom-2 left-5 right-5">
                        <p className="text-[10px] text-white/60">{m.artist}</p>
                        <h3 className="truncate text-lg font-semibold tracking-tight">{m.title}</h3>
                      </div>
                    </div>
                    <div className="px-5 pb-5 pt-2">
                      <div className="mb-4 flex items-start justify-between gap-2">
                        <p className="min-w-0 text-[11px] text-muted">
                          <span className="block truncate text-foreground/80">
                            [{m.difficulty}]
                          </span>
                          mapper: {m.mapper}
                        </p>
                        <Badge className="border-amber-200/10 bg-amber-200/5 text-amber-200">
                          ★ {m.stars.toFixed(2)}
                        </Badge>
                      </div>
                      {m.unavailable && (
                        <p className="mb-3 text-xs text-amber-200">
                          Mappa non disponibile nell’API osu!; dati dal main sheet.
                        </p>
                      )}
                      <div className="grid grid-cols-4 gap-y-3 border-t border-white/5 pt-3 text-[10px]">
                        {[
                          ['BPM', m.bpm],
                          ['Durata', duration(m.length)],
                          ['AR', m.ar],
                          ['CS', m.cs],
                          ['OD', m.od],
                          [m.statisticsSource ? 'HP base' : 'HP', m.hp ?? 'n/d'],
                          ['ID', m.id],
                        ].map(([k, v]) => (
                          <div key={k}>
                            <span className="text-muted">{k}</span>
                            <span className="ml-2 text-white/85">{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          </section>
        );
      })}
      {!pool.slots.length && (
        <EmptyState
          title="Il pool è in preparazione"
          description="Le mappe saranno visibili dopo la pubblicazione degli organizzatori."
        />
      )}
    </div>
  );
}
export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="card px-6 py-20 text-center">
      <Music2 size={30} className="mx-auto mb-5 text-primary/60" />
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {description && <p className="mx-auto mt-3 max-w-md text-sm text-muted">{description}</p>}
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-12 pt-14 md:pt-20">
      {eyebrow && <p className="eyebrow mb-4">{eyebrow}</p>}
      <h1 className="text-4xl font-semibold md:text-5xl">
        {title}
        <span className="text-primary">.</span>
      </h1>
      {description && <p className="mt-5 max-w-xl text-sm text-muted">{description}</p>}
    </div>
  );
}
