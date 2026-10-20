import 'server-only';
import { redirect } from 'next/navigation';
import { getActor } from './auth';
import { requestScope } from './tournament-context';

// Layouts persist during client navigation, so each page must validate its context too.
export async function getWorkspaceActor() {
  const actor = await getActor();
  const scope = await requestScope();
  if (
    actor &&
    (!actor.tournamentId ||
      actor.tournamentId === 'none' ||
      scope.path === '/admin' ||
      scope.path.startsWith('/admin/'))
  )
    redirect('/admin/tournaments');
  return actor;
}
