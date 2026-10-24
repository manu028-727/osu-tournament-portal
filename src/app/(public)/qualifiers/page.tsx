import { getServerT } from '@/lib/server-locale';
import { QualifierStandings } from '@/components/qualifier-standings';
import { db } from '@/lib/db';
import { publishedQualifierStandings } from '@/lib/qualifier-standings-sources';
import { getTournament } from '@/lib/queries';
export async function generateMetadata() {
  const tr = await getServerT();
  return { title: tr('Qualifier results') };
}
export default async function QualifierResultsPage() {
  const tr = await getServerT();
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
      <h1 className="text-2xl font-semibold">{tr('Qualifier results')}</h1>
      {standings.some(Boolean) ? (
        standings.map((snapshot, index) =>
          snapshot ? <QualifierStandings key={stages[index].id} standings={snapshot} /> : null,
        )
      ) : (
        <p className="text-muted">{tr('No qualifier results published yet.')}</p>
      )}
    </div>
  );
}
