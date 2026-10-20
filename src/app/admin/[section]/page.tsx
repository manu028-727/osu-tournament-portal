import { notFound } from 'next/navigation';
import { getActor } from '@/lib/auth';
import { getTournament } from '@/lib/queries';
import { canAccessSection, WORKSPACE_SECTIONS } from '@/lib/workspace';
import type { TournamentView } from '@/lib/types';
import { PageEditor } from '@/components/admin/page-editor';
import { PoolEditor } from '@/components/admin/pool-editor';
import { StaffEditor } from '@/components/admin/staff-editor';
import { RolesEditor, UsersEditor } from '@/components/admin/access';
import { MediaLibrary } from '@/components/admin/media';
import { SettingsEditor } from '@/components/admin/settings';
import { AuditLogs, SheetData } from '@/components/admin/overview';
import { TeamsEditor } from '@/components/admin/teams-editor';
import { StagesEditor } from '@/components/admin/stages-editor';
export default async function Section({ params }: { params: Promise<{ section: string }> }) {
  const section = (await params).section;
  if (!WORKSPACE_SECTIONS[section]) notFound();
  const actor = await getActor();
  if (!actor) return null;
  if (!canAccessSection(actor, section))
    return (
      <div className="card p-10">
        <h1 className="text-2xl font-semibold">Access restricted</h1>
        <p className="mt-4 text-sm text-muted">
          Your roles don’t include permission to access this part of the workspace.
        </p>
      </div>
    );
  switch (section) {
    case 'stages':
      return <StagesEditor actor={actor} />;
    case 'teams':
      return <TeamsEditor actor={actor} />;
    case 'homepage':
    case 'rules':
      return (
        <PageEditor
          kind={section}
          actor={actor}
          tournament={(await getTournament()) as unknown as TournamentView}
        />
      );
    case 'mappools':
      return <PoolEditor actor={actor} />;
    case 'staff':
      return <StaffEditor actor={actor} />;
    case 'roles':
      return <RolesEditor actor={actor} />;
    case 'users':
      return <UsersEditor actor={actor} />;
    case 'media':
      return <MediaLibrary />;
    case 'settings':
      return <SettingsEditor actor={actor} />;
    case 'audit':
      return <AuditLogs />;
    case 'sheet-data':
      return <SheetData />;
  }
}
