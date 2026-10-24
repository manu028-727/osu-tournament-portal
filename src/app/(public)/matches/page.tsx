import { Filter } from 'lucide-react';
import { PageHeading, EmptyState } from '@/components/content';
import { MatchList } from '@/components/match-list';
import { Button } from '@/components/ui/button';
import { publicMatchesPage } from '@/lib/public-matches';
import { listPageSchema } from '@/lib/list-pagination';
import { ListPagination } from '@/components/list-pagination';
import Link from '@/components/tournament-scope';
export const metadata = { title: 'Incontri e risultati' };
export default async function Matches({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; status?: string; page?: string }>;
}) {
  const query = await searchParams;
  const page = listPageSchema.safeParse(query.page);
  const result = await publicMatchesPage(query, page.success ? page.data : 1);
  const { items: matches, stages } = result;
  const href = (page: number) =>
    '/matches?' +
    new URLSearchParams({
      ...(query.stage ? { stage: query.stage } : {}),
      ...(query.status ? { status: query.status } : {}),
      page: String(page),
    });
  return (
    <div className="wrap pb-20">
      <PageHeading
        eyebrow="IL TORNEO"
        title="Incontri e risultati"
        description={`${result.allTotal} incontri · ${result.completedTotal} conclusi`}
      />
      <nav aria-label="Competition views" className="mb-5 flex flex-wrap gap-3">
        <Button asChild variant="outline" size="sm">
          <Link href="/brackets">Brackets</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/qualifiers">Qualifier results</Link>
        </Button>
      </nav>
      <form className="mb-8 flex flex-wrap items-end gap-4 border-b pb-7" method="GET">
        <label className="field min-w-40 flex-1">
          <span id="match-stage-label">Stage</span>
          <select aria-labelledby="match-stage-label" name="stage" defaultValue={query.stage || ''}>
            <option value="">Tutti gli stage</option>
            {stages.map((s) => (
              <option value={s.slug} key={s.slug}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field min-w-40 flex-1">
          <span id="match-status-label">Stato</span>
          <select
            aria-labelledby="match-status-label"
            name="status"
            defaultValue={query.status || ''}
          >
            <option value="">Tutti gli incontri</option>
            <option value="upcoming">Da disputare</option>
            <option value="completed">Conclusi</option>
          </select>
        </label>
        <Button type="submit" variant="outline">
          <Filter size={18} />
          Filtra
        </Button>
      </form>
      <ListPagination
        {...result}
        previousHref={href(result.page - 1)}
        nextHref={href(result.page + 1)}
      />
      {matches.length ? (
        <MatchList matches={matches} />
      ) : (
        <EmptyState
          title="Nessun incontro"
          description="Non ci sono incontri pubblicati per questa selezione."
        />
      )}
      <ListPagination
        {...result}
        previousHref={href(result.page - 1)}
        nextHref={href(result.page + 1)}
      />
    </div>
  );
}
