import { notFound } from 'next/navigation';
import { getWorkspaceActor } from '@/lib/workspace-server';
import { getTournament } from '@/lib/queries';
import { db } from '@/lib/db';
import { can } from '@/lib/permissions';
import { matchScope } from '@/lib/matches-service';
import { RefereePanel } from '@/components/admin/referee-panel';
export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getWorkspaceActor();
  if (!actor) return null;
  if (
    !can(actor, 'matches.view') &&
    !can(actor, 'matches.manage') &&
    !can(actor, 'matches.manage_all') &&
    !can(actor, 'matches.view_all')
  )
    notFound();
  const { id } = await params;
  if (
    !(await db.match.findFirst({
      where: { AND: [{ id }, matchScope(actor)] },
      select: { id: true },
    }))
  )
    notFound();
  const tournament = await getTournament();
  return (
    <RefereePanel
      actor={actor}
      id={id}
      acronym={tournament.acronym}
      tournamentName={tournament.name}
      ircEnabled={process.env.IRC_ENABLED === 'true'}
    />
  );
}
