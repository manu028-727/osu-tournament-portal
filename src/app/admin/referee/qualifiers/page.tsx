import { notFound } from 'next/navigation';
import { getActor } from '@/lib/auth';
import { canAccessSection } from '@/lib/workspace';
import { getTournament } from '@/lib/queries';
import { QualifiersWorkspace } from '@/components/admin/qualifiers-workspace';
export default async function QualifiersPage() {
  const actor = await getActor();
  if (!actor || !canAccessSection(actor, 'referee')) notFound();
  const tournament = await getTournament();
  return <QualifiersWorkspace actor={actor} acronym={tournament.acronym} />;
}
