import { getServerT } from '@/lib/server-locale';
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
  const tr = await getServerT();
  const { slug } = await params;
  const [stage, stages] = await Promise.all([publicPool(slug), publicPools()]);
  if (!stage?.mappool?.publishedRevision) notFound();
  return (
    <div className="wrap pb-20">
      <PageHeading
        eyebrow={tr('MAPPOOL UFFICIALE')}
        title={stage.name}
        description={stage.description || ''}
      />
      <nav
        aria-label={tr('Tournament stages')}
        className="stage-tabs mb-6 flex gap-1 overflow-x-auto border-b pb-1"
      >
        {stages.map((s) => (
          <Link
            href={`/mappools/${s.slug}`}
            key={s.slug}
            aria-current={s.slug === slug ? 'page' : undefined}
            className={`min-h-11 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm ${s.slug === slug ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-foreground'}`}
          >
            {s.name}
          </Link>
        ))}
      </nav>
      <PublicMappool pool={stage.mappool.publishedRevision as unknown as PoolContent} />
    </div>
  );
}
