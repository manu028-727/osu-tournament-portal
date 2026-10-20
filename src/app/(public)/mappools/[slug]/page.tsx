import Link from '@/components/tournament-scope';
import { notFound } from 'next/navigation';
import { PageHeading } from '@/components/content';
import { PublicMappool } from '@/components/public-mappool';
import { publicPool, publicPools } from '@/lib/queries';
import type { PoolContent } from '@/lib/types';
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const pool = await publicPool((await params).slug);
  return { title: pool ? `${pool.name} mappool` : 'Mappool not found' };
}
export default async function Stage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [stage, stages] = await Promise.all([publicPool(slug), publicPools()]);
  if (!stage?.mappool?.publishedRevision) notFound();
  return (
    <div className="wrap pb-20">
      <PageHeading
        eyebrow="MAPPOOL UFFICIALE"
        title={stage.name}
        description={
          stage.description ||
          'Tutti i pick ufficiali di questo stage. Apri le mappe direttamente su osu!.'
        }
      />
      <nav aria-label="Tournament stages" className="mb-10 flex gap-2 overflow-x-auto pb-3">
        {stages.map((s) => (
          <Link
            href={`/mappools/${s.slug}`}
            key={s.slug}
            className={`whitespace-nowrap rounded-lg border px-5 py-2.5 text-xs ${s.slug === slug ? 'border-primary/30 bg-primary/10 text-primary' : 'border-white/10 text-muted hover:text-foreground'}`}
          >
            {s.name}
          </Link>
        ))}
      </nav>
      <PublicMappool pool={stage.mappool.publishedRevision as unknown as PoolContent} />
    </div>
  );
}
