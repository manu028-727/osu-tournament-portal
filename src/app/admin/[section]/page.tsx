import { notFound, redirect } from 'next/navigation';
import { getWorkspaceActor } from '@/lib/workspace-server';
import { getTournament, publicPage } from '@/lib/queries';
import { canAccessSection, WORKSPACE_SECTIONS } from '@/lib/workspace';
import type { TournamentView } from '@/lib/types';
import { TeamsEditor } from '@/components/admin/teams-editor';
import {
  WebsiteWorkspace,
  StaffWorkspace,
  PoolsWorkspace,
  SettingsWorkspace,
} from '@/components/admin/workspace-sections';
import { requestScope } from '@/lib/tournament-context';
import type { PageContent } from '@/lib/types';
import Link from '@/components/tournament-scope';
import { can } from '@/lib/permissions';
export default async function Section({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const section = (await params).section;
  if (!Object.hasOwn(WORKSPACE_SECTIONS, section)) notFound();
  const actor = await getWorkspaceActor();
  if (!actor) return null;
  if (
    !canAccessSection(actor, section) &&
    !(section === 'mappools' && canAccessSection(actor, 'stages'))
  )
    return (
      <div className="card p-10">
        <h1 className="text-2xl font-semibold">Access restricted</h1>
        <p className="mt-4 text-sm text-muted">
          Your roles don’t include permission to access this part of the workspace.
        </p>
      </div>
    );
  const query = await searchParams;
  const view = typeof query.view === 'string' ? query.view : undefined;
  const stage = typeof query.stage === 'string' ? query.stage : undefined;
  const aliases: Record<string, string> = {
    homepage: 'website?view=homepage',
    rules: 'website?view=rules',
    media: 'website?view=media',
    users: 'staff?view=access',
    roles: 'staff?view=roles',
    stages: 'mappools?view=stages',
    audit: 'settings?view=audit',
    'sheet-data': 'settings?view=sheet',
  };
  if (aliases[section]) redirect(`${(await requestScope()).adminBase}/${aliases[section]}`);
  switch (section) {
    case 'website':
      return (
        <WebsiteWorkspace
          actor={actor}
          view={view}
          tournament={(await getTournament()) as unknown as TournamentView}
          home={(await publicPage('home')) as PageContent | null}
        />
      );
    case 'teams':
      return (
        <>
          {(can(actor, 'matches.view_all') ||
            can(actor, 'matches.manage') ||
            can(actor, 'matches.manage_all')) && (
            <nav aria-label="Participant results" className="mb-4 flex flex-wrap gap-4 text-sm">
              <Link href="/admin/qualifier-results" className="text-primary">
                Qualifier results & seedings
              </Link>
              <Link href="/admin/matches" className="text-primary">
                Matches & brackets
              </Link>
            </nav>
          )}
          <TeamsEditor actor={actor} />
        </>
      );
    case 'mappools':
      return (
        <PoolsWorkspace
          actor={actor}
          view={view}
          stage={stage}
          newStage={query.new === '1'}
          returnToPool={query.return === 'pool'}
        />
      );
    case 'staff':
      return <StaffWorkspace actor={actor} view={view} />;
    case 'settings':
      return <SettingsWorkspace actor={actor} view={view} />;
  }
}
