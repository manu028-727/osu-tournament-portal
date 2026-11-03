import { localeTag } from '@/lib/i18n';
import { getLocale, getServerT } from '@/lib/server-locale';
import Link from '@/components/tournament-scope';
import { ArrowUpRight } from 'lucide-react';
import { PageHeading, EmptyState } from '@/components/content';
import { publicPools, getTournament } from '@/lib/queries';
import { siteCopy } from '@/lib/copy';
export async function generateMetadata() {
  const tr = await getServerT();
  return { title: tr('Mappools') };
}
export default async function Mappools() {
  const tr = await getServerT();
  const language = await getLocale();
  const [stages, t] = await Promise.all([publicPools(), getTournament()]);
  const copy = siteCopy(t.settings?.copy);
  return (
    <div className="wrap pb-12">
      <PageHeading
        eyebrow={copy.mappoolsEyebrow}
        title={copy.mappoolsTitle}
        description={copy.mappoolsDescription}
      />
      {stages.length ? (
        <div className="stage-list border-t">
          {stages.map((s, i) => (
            <Link
              key={s.id}
              href={`/mappools/${s.slug}`}
              className="group flex min-w-0 items-center gap-4 border-b py-4 hover:border-primary/40"
            >
              {s.bannerImageId ? (
                <img
                  src={`/api/media/${s.bannerImageId}`}
                  alt=""
                  className="h-16 w-24 shrink-0 rounded object-cover sm:w-36"
                />
              ) : (
                <span className="font-mono text-sm text-muted">
                  {String(i + 1).padStart(2, '0')}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-semibold">{s.name}</h2>
                {s.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted">{s.description}</p>
                )}
                <p className="mt-1 text-sm text-muted">
                  {s.mappool?.publishedRevision?.slots.length || 0} {tr('mappe')}
                  {s.startsAt &&
                    ` · ${tr(
                      'Starts {0}',
                      s.startsAt.toLocaleDateString(localeTag(language), { timeZone: t.timezone }),
                    )}`}
                </p>
              </div>
              <ArrowUpRight size={20} className="shrink-0 text-muted group-hover:text-primary" />
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState title={tr('Nessun mappool pubblicato')} />
      )}
    </div>
  );
}
