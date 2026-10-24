import { getServerT } from '@/lib/server-locale';
import { getWorkspaceActor } from '@/lib/workspace-server';
import { Overview } from '@/components/admin/overview';
import { canAccessSection, WORKSPACE_SECTIONS } from '@/lib/workspace';
import { redirect } from 'next/navigation';
import { requestScope } from '@/lib/tournament-context';
export default async function Admin() {
  const tr = await getServerT();
  const actor = await getWorkspaceActor();
  if (!actor) return null;
  const scope = await requestScope();
  if (scope.path === '/admin') redirect('/admin/tournaments');
  if (
    canAccessSection(actor, 'referee') &&
    !Object.keys(WORKSPACE_SECTIONS)
      .filter((section) => !['referee', 'matches'].includes(section))
      .some((section) => canAccessSection(actor, section))
  )
    redirect(`${scope.adminBase}/matches`);
  if (!actor.permissions.length)
    return (
      <div className="card max-w-2xl p-8">
        <p className="eyebrow mb-4">{tr('SIGNED IN AS PLAYER')}</p>
        <h1 className="text-3xl font-semibold tracking-normal">
          {tr('You’re part of the community.')}
        </h1>
        <p className="mt-5 text-sm text-muted">
          {tr(
            'Your osu! account is connected. An organizer can assign a staff access role if you need to work in the CMS. Public staff listings do not grant website permissions.',
          )}
        </p>
        <a href="/" className="mt-7 inline-block text-sm text-primary">
          {tr('Explore the tournament ↗')}
        </a>
      </div>
    );
  return <Overview actor={actor} />;
}
