import { getServerT } from '@/lib/server-locale';
import { PublicCompetition } from '@/components/public-competition';
import { publicCompetitionData } from '@/lib/competition-queries';
import { getTournament } from '@/lib/queries';
export async function generateMetadata() {
  const tr = await getServerT();
  return { title: tr('Brackets') };
}
export default async function BracketsPage() {
  const tr = await getServerT();
  const tournament = await getTournament();
  return (
    <div className="wrap pb-16">
      <h1 className="mb-5 text-2xl font-semibold">{tr('Brackets')}</h1>
      <PublicCompetition brackets={await publicCompetitionData(tournament.id)} />
    </div>
  );
}
