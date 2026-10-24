import { HomepageContent } from '@/components/home-content';
import { getTournament, publicPage } from '@/lib/queries';
import type { PageContent, TournamentView } from '@/lib/types';
import { db } from '@/lib/db';
import { requestScope } from '@/lib/tournament-context';
import { TournamentDirectory } from '@/components/tournament-directory';
export default async function Home() {
  if (
    (await requestScope()).path === '/' &&
    ((await db.platformSettings.findUnique({ where: { id: 'main' } }))?.rootMode !== 'FEATURED' ||
      (await requestScope()).tournamentId === 'none')
  )
    return <TournamentDirectory />;
  const [page, tournament] = await Promise.all([publicPage('home'), getTournament()]);
  return (
    <HomepageContent
      showHeader={false}
      page={
        (page || { id: '', title: tournament.name, html: '', blocks: [] }) as unknown as PageContent
      }
      tournament={tournament as unknown as TournamentView}
    />
  );
}
