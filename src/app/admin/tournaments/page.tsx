import { getActor } from '@/lib/auth';
import { TournamentsEditor } from '@/components/admin/tournaments-editor';
export default async function Page() {
  const actor = await getActor();
  return actor ? <TournamentsEditor actor={actor} /> : null;
}
