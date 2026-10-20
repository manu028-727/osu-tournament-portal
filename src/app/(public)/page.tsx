import { ContentBlocks, EmptyState } from '@/components/content';
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
  return page ? (
    <ContentBlocks
      page={page as unknown as PageContent}
      tournament={tournament as unknown as TournamentView}
    />
  ) : (
    <div className="wrap py-20">
      <EmptyState
        title={tournament.name}
        description="Gli organizzatori stanno preparando questa pagina."
      />
    </div>
  );
}
