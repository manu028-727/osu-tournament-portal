import { notFound } from 'next/navigation';
import { getWorkspaceActor } from '@/lib/workspace-server';
import { canAccessSection } from '@/lib/workspace';
import { MatchesDashboard } from '@/components/admin/matches-dashboard';
export default async function RefereePage() {
  const actor = await getWorkspaceActor();
  if (!actor) return null;
  if (!canAccessSection(actor, 'referee')) notFound();
  return <MatchesDashboard actor={actor} />;
}
