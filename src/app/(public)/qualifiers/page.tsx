import { getTournament } from '@/lib/queries';
import { db } from '@/lib/db';
import { publishedQualifierStandings } from '@/lib/qualifier-standings-service';
import { QualifierStandings } from '@/components/qualifier-standings';
export const metadata = { title: 'Qualifier results' };
export default async function QualifierResultsPage() {
  const tournament = await getTournament();
  const stages = tournament.published
    ? await db.tournamentStage.findMany({
        where: {
          tournamentId: tournament.id,
          kind: 'QUALIFIERS',
          qualifierStandings: { some: { published: true } },
        },
        select: { id: true },
        orderBy: { position: 'asc' },
      })
    : [];
  const standings = await Promise.all(
    stages.map((stage) => publishedQualifierStandings(tournament.id, stage.id)),
  );
  return (
    <div className="wrap space-y-8 pb-16">
      <h1 className="text-2xl font-semibold">Qualifier results</h1>
      {standings.some(Boolean) ? (
        standings.map((snapshot, index) =>
          snapshot ? <QualifierStandings key={stages[index].id} standings={snapshot} /> : null,
        )
      ) : (
        <p className="text-muted">No qualifier results published yet.</p>
      )}
    </div>
  );
}
