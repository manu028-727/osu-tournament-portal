import { notFound, redirect } from 'next/navigation';
import { getWorkspaceActor } from '@/lib/workspace-server';
import { canAccessSection } from '@/lib/workspace';
import { requestScope } from '@/lib/tournament-context';
export default async function RefereePage() {
  const actor = await getWorkspaceActor();
  if (!actor) return null;
  if (!canAccessSection(actor, 'referee')) notFound();
  redirect(`${(await requestScope()).adminBase}/matches`);
}
