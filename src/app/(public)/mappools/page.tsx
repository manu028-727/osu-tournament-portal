import Link from '@/components/tournament-scope';
import { ArrowUpRight, Layers3 } from 'lucide-react';
import { PageHeading, EmptyState } from '@/components/content';
import { publicPools, getTournament } from '@/lib/queries';
import { siteCopy } from '@/lib/copy';
import { Badge } from '@/components/ui/badge';
export const metadata = { title: 'Mappools' };
export default async function Mappools() {
  const [stages, t] = await Promise.all([publicPools(), getTournament()]);
  const copy = siteCopy(t.settings?.copy);
  return (
    <div className="wrap pb-14">
      <PageHeading
        eyebrow={copy.mappoolsEyebrow}
        title={copy.mappoolsTitle}
        description={copy.mappoolsDescription}
      />
      {stages.length ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {stages.map((s, i) => (
            <Link
              key={s.id}
              href={`/mappools/${s.slug}`}
              className="card group overflow-hidden hover:border-primary/30"
            >
              <div className="relative flex h-40 items-center justify-center overflow-hidden border-b bg-card">
                {s.bannerImageId ? (
                  <img
                    src={`/api/media/${s.bannerImageId}`}
                    alt=""
                    className="size-full object-cover opacity-60 transition-transform group-hover:scale-105"
                  />
                ) : (
                  <Layers3 size={44} className="text-primary/60" aria-hidden="true" />
                )}
                <span className="absolute left-5 top-5 text-xs text-white/40">
                  STAGE {String(i + 1).padStart(2, '0')}
                </span>
                <ArrowUpRight size={20} className="absolute right-5 top-5 text-primary" />
              </div>
              <div className="p-6">
                <Badge className="mb-4 text-emerald-200">Pubblicato</Badge>
                <h2 className="text-2xl font-semibold tracking-tight">{s.name}</h2>
                {s.description && <p className="mt-3 text-sm text-muted">{s.description}</p>}
                <div className="mt-6 flex items-center gap-2 border-t border-white/5 pt-4 text-xs text-muted">
                  <Layers3 size={13} />
                  {s.mappool?.publishedRevision?.slots.length || 0} mappe
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState title="Nessun mappool pubblicato" />
      )}
    </div>
  );
}
