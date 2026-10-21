import { can, type Actor, type PermissionKey } from './permissions';

export const WORKSPACE_SECTIONS: Record<string, PermissionKey[]> = {
  website: [
    'homepage.edit',
    'homepage.publish',
    'rules.edit',
    'rules.publish',
    'settings.manage',
    'media.upload',
  ],
  stages: ['mappools.create', 'mappools.edit', 'matches.manage'],
  referee: [
    'referee.access',
    'matches.view',
    'matches.view_all',
    'matches.manage',
    'matches.manage_all',
  ],
  matches: [
    'referee.access',
    'matches.view',
    'matches.view_all',
    'matches.manage',
    'matches.manage_all',
  ],
  teams: [
    'teams.view',
    'teams.create',
    'teams.edit',
    'teams.import',
    'teams.publish',
    'teams.delete',
  ],
  homepage: ['homepage.edit', 'homepage.publish'],
  rules: ['rules.edit', 'rules.publish'],
  mappools: [
    'mappools.view_drafts',
    'mappools.create',
    'mappools.edit',
    'mappools.publish',
    'mappools.delete',
  ],
  staff: ['staff.edit', 'users.manage', 'roles.manage'],
  media: ['media.upload'],
  users: ['users.manage'],
  roles: ['roles.manage'],
  settings: ['settings.manage', 'audit.view', 'tournament.data.read'],
  audit: ['audit.view'],
  'sheet-data': ['tournament.data.read'],
};
export function canAccessSection(actor: Actor | null, section: string) {
  return (
    Object.hasOwn(WORKSPACE_SECTIONS, section) &&
    WORKSPACE_SECTIONS[section].some((permission) => can(actor, permission))
  );
}
export function canAccessWorkspace(actor: Actor | null) {
  return Object.keys(WORKSPACE_SECTIONS).some((section) => canAccessSection(actor, section));
}
