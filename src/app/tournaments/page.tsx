import { getServerT } from '@/lib/server-locale';
import { TournamentDirectory } from '@/components/tournament-directory';
export async function generateMetadata() {
  const tr = await getServerT();
  return { title: tr('Tournament directory') };
}
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; mode?: string }>;
}) {
  return <TournamentDirectory {...await searchParams} />;
}
