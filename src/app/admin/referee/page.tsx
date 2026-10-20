import { notFound } from 'next/navigation';
import { getActor } from '@/lib/auth';
import { canAccessSection } from '@/lib/workspace';
import { MatchesDashboard } from '@/components/admin/matches-dashboard';
export default async function RefereePage() {
  const actor = await getActor();
  if (!actor) return null;
  if (!canAccessSection(actor, 'referee')) notFound();
  return <MatchesDashboard actor={actor} />;
}
