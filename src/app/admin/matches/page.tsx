import { notFound } from 'next/navigation';
import { getActor } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { MatchesDashboard } from '@/components/admin/matches-dashboard';
export default async function MatchesPage() {
  const actor = await getActor();
  if (!actor) return null;
  if (!can(actor, 'matches.manage')) notFound();
  return <MatchesDashboard actor={actor} management />;
}
