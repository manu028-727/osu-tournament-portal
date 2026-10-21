import { notFound } from 'next/navigation';
import { getWorkspaceActor } from '@/lib/workspace-server';
import { can } from '@/lib/permissions';
import { QualifierResults } from '@/components/admin/qualifier-results';
export default async function QualifierResultsPage() {
  const actor = await getWorkspaceActor();
  if (!actor) return null;
  if (
    !can(actor, 'matches.view_all') &&
    !can(actor, 'matches.manage') &&
    !can(actor, 'matches.manage_all')
  )
    notFound();
  return <QualifierResults actor={actor} />;
}
