import { TournamentDirectory } from '@/components/tournament-directory';
export const metadata = { title: 'Tournament directory' };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; mode?: string }>;
}) {
  return <TournamentDirectory {...await searchParams} />;
}
