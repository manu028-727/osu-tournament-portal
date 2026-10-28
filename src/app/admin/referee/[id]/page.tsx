import { RefereePanel } from '@/components/admin/referee-panel';
import { db } from '@/lib/db';
import { matchScope } from '@/lib/match-access';
import { can } from '@/lib/permissions';
import { getTournament } from '@/lib/queries';
import { getWorkspaceActor } from '@/lib/workspace-server';
import { notFound } from 'next/navigation';
import { numericMatchIdentifier } from '@/lib/match-numbering';
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
  const number = numericMatchIdentifier(id);
  const match = await db.match.findFirst({
    where: { AND: [number ? { matchNumber: number } : { id }, matchScope(actor)] },
    select: { id: true },
  });
  if (!match) notFound();
  const tournament = await getTournament();
  return (
    <RefereePanel
      actor={actor}
      id={match.id}
      acronym={tournament.acronym}
      tournamentName={tournament.name}
      ircEnabled={process.env.IRC_ENABLED === 'true'}
    />
  );
}
