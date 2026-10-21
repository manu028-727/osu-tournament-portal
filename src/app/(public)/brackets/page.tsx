import { getTournament } from '@/lib/queries';
import { publicCompetitionData } from '@/lib/competition-service';
import { PublicCompetition } from '@/components/public-competition';
export const metadata = { title: 'Brackets' };
export default async function BracketsPage() {
  const tournament = await getTournament();
  return (
    <div className="wrap pb-16">
      <h1 className="mb-5 text-2xl font-semibold">Brackets</h1>
      <PublicCompetition brackets={await publicCompetitionData(tournament.id)} />
    </div>
  );
}
