'use client';
import { useT } from '@/components/locale';
import { can, type Actor } from '@/lib/permissions';
import { canAccessSection } from '@/lib/workspace';
import type { TournamentView } from '@/lib/types';
import { SectionNav } from './section-nav';
import { PageEditor } from './page-editor';
import { SettingsEditor } from './settings';
import { MediaLibrary } from './media';
import { StaffEditor } from './staff-editor';
import { RolesEditor, UsersEditor } from './access';
import { PoolEditor } from './pool-editor';
import { PoolingWorkspace } from './pooling-workspace';
import { StagesEditor } from './stages-editor';
import { AuditLogs, SheetData } from './overview';

export function WebsiteWorkspace({
  actor,
  tournament,
  view,
}: {
  actor: Actor;
  tournament: TournamentView;
  view?: string;
}) {
  const tr = useT();
  const views = [
    { value: 'homepage', label: 'Homepage', allowed: canAccessSection(actor, 'homepage') },
    { value: 'rules', label: 'Rules', allowed: canAccessSection(actor, 'rules') },
    { value: 'info', label: 'Tournament info', allowed: can(actor, 'settings.manage') },
    { value: 'branding', label: 'Appearance', allowed: can(actor, 'settings.manage') },
    { value: 'navigation', label: 'Navigation & text', allowed: can(actor, 'settings.manage') },
    { value: 'media', label: 'Media library', allowed: can(actor, 'media.upload') },
  ].filter((item) => item.allowed);
  const selected = views.find((item) => item.value === view)?.value || views[0]?.value;
  return (
    <>
      <SectionNav
        label={tr('Website sections')}
        active={selected}
        links={views.map((item) => ({ ...item, href: `/admin/website?view=${item.value}` }))}
      />
      {selected === 'homepage' || selected === 'rules' ? (
        <PageEditor key={selected} kind={selected} actor={actor} tournament={tournament} />
      ) : selected === 'media' ? (
        <MediaLibrary />
      ) : (
        <SettingsEditor
          key={selected}
          actor={actor}
          area={selected as 'info' | 'branding' | 'navigation'}
        />
      )}
    </>
  );
}

export function StaffWorkspace({ actor, view }: { actor: Actor; view?: string }) {
  const tr = useT();
  const views = [
    { value: 'listing', label: 'Public listing', allowed: can(actor, 'staff.edit') },
    { value: 'access', label: 'Website access', allowed: can(actor, 'users.manage') },
    { value: 'roles', label: 'Roles & permissions', allowed: can(actor, 'roles.manage') },
  ].filter((item) => item.allowed);
  const selected = views.find((item) => item.value === view)?.value || views[0]?.value;
  return (
    <>
      <SectionNav
        label={tr('Staff sections')}
        active={selected}
        links={views.map((item) => ({ ...item, href: `/admin/staff?view=${item.value}` }))}
      />
      {selected === 'listing' ? (
        <StaffEditor actor={actor} />
      ) : selected === 'access' ? (
        <UsersEditor actor={actor} />
      ) : (
        <RolesEditor actor={actor} />
      )}
    </>
  );
}

export function PoolsWorkspace({
  actor,
  view,
  stage,
  newStage,
  returnToPool,
}: {
  actor: Actor;
  view?: string;
  stage?: string;
  newStage?: boolean;
  returnToPool?: boolean;
}) {
  const tr = useT();
  const views = [
    { value: 'pools', label: 'Mappools', allowed: canAccessSection(actor, 'mappools') },
    {
      value: 'pooling',
      label: 'Suggestions & playtesting',
      allowed: (['mappools.edit', 'mappools.view_drafts', 'mappools.publish'] as const).some(
        (permission) => can(actor, permission),
      ),
    },
    { value: 'stages', label: 'Stage settings', allowed: canAccessSection(actor, 'stages') },
  ].filter((item) => item.allowed);
  const selected = views.find((item) => item.value === view)?.value || views[0]?.value;
  return (
    <>
      <SectionNav
        label={tr('Stages & mappools sections')}
        active={selected}
        links={views.map((item) => ({ ...item, href: `/admin/mappools?view=${item.value}` }))}
      />
      {selected === 'pooling' ? (
        <PoolingWorkspace actor={actor} />
      ) : selected === 'stages' ? (
        <StagesEditor
          key={`${stage}-${newStage}`}
          actor={actor}
          initialStageId={stage}
          newStage={newStage}
          returnToPool={returnToPool}
        />
      ) : (
        <PoolEditor key={stage || 'pools'} actor={actor} initialStageId={stage} />
      )}
    </>
  );
}

export function SettingsWorkspace({ actor, view }: { actor: Actor; view?: string }) {
  const tr = useT();
  const views = [
    {
      value: 'configuration',
      label: 'Configuration & export',
      allowed: can(actor, 'settings.manage'),
    },
    { value: 'audit', label: 'Audit logs', allowed: can(actor, 'audit.view') },
    { value: 'sheet', label: 'Sheet data', allowed: can(actor, 'tournament.data.read') },
  ].filter((item) => item.allowed);
  const selected = views.find((item) => item.value === view)?.value || views[0]?.value;
  return (
    <>
      <SectionNav
        label={tr('Settings sections')}
        active={selected}
        links={views.map((item) => ({ ...item, href: `/admin/settings?view=${item.value}` }))}
      />
      {selected === 'audit' ? (
        <AuditLogs />
      ) : selected === 'sheet' ? (
        <SheetData />
      ) : (
        <SettingsEditor actor={actor} />
      )}
    </>
  );
}
