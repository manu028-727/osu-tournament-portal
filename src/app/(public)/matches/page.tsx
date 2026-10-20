import { Filter } from 'lucide-react';
import { PageHeading, EmptyState } from '@/components/content';
import { MatchList } from '@/components/match-list';
import { Button } from '@/components/ui/button';
import { publicMatches } from '@/lib/public-matches';
export const metadata = { title: 'Incontri e risultati' };
export default async function Matches({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; status?: string }>;
}) {
  const query = await searchParams;
  const all = await publicMatches();
  const stages = [...new Map(all.map((m) => [m.stage.slug, m.stage])).values()];
  const matches = all.filter(
    (m) =>
      (!query.stage || m.stage.slug === query.stage) &&
      (query.status === 'completed'
        ? m.status === 'COMPLETED'
        : query.status === 'upcoming'
          ? !['COMPLETED', 'CANCELLED'].includes(m.status)
          : true),
  );
  return (
    <div className="wrap pb-20">
      <PageHeading
        eyebrow="IL TORNEO"
        title="Incontri e risultati"
        description={`${all.length} incontri · ${all.filter((m) => m.status === 'COMPLETED').length} conclusi`}
      />
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
      {matches.length ? (
        <MatchList matches={matches} />
      ) : (
        <EmptyState
          title="Nessun incontro"
          description="Non ci sono incontri pubblicati per questa selezione."
        />
      )}
    </div>
  );
}
