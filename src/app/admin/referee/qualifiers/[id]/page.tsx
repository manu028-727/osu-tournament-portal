import { notFound } from 'next/navigation';
import { getWorkspaceActor } from '@/lib/workspace-server';
import { canAccessSection } from '@/lib/workspace';
import { getTournament } from '@/lib/queries';
import { QualifiersWorkspace } from '@/components/admin/qualifiers-workspace';
export default async function QualifierPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getWorkspaceActor();
  if (!actor || !canAccessSection(actor, 'referee')) notFound();
  const tournament = await getTournament();
  return (
    <QualifiersWorkspace
      actor={actor}
      acronym={tournament.acronym}
      id={(await params).id}
      ircEnabled={process.env.IRC_ENABLED === 'true'}
    />
  );
}
