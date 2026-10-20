import type { PageContent, TournamentView, PoolContent } from '@/lib/types';
import { HomepageContent } from './home-content';
import { PublicMappool } from './public-mappool';
export function ContentBlocks({
  page,
  tournament,
  showHeader = true,
}: {
  page: PageContent;
  tournament: TournamentView;
  showHeader?: boolean;
}) {
  return <HomepageContent page={page} tournament={tournament} showHeader={showHeader} />;
}
export function PoolDisplay({ pool }: { pool: PoolContent }) {
  return <PublicMappool pool={pool} />;
}
export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <section className="empty-state border-y py-9">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="mt-2 max-w-xl text-sm text-muted">{description}</p>}
    </section>
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
    <header className="page-heading mb-7 border-b pb-6 pt-8 md:pt-10">
      {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
      <h1 className="text-3xl font-semibold">{title}</h1>
      {description && <p className="mt-3 max-w-2xl text-base text-muted">{description}</p>}
    </header>
  );
}
