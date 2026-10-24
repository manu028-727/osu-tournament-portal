import { formatMessage, isMessageList, messageList, type MessageValue } from './messages';

export const PERMISSIONS = {
  'tournaments.create': 'Create tournaments at platform level',
  'tournaments.manage_all': 'Administer all platform tournaments',
  'platform.manage': 'Manage platform configuration and administrators',
  'tournament.publish': 'Publish or hide this tournament',
  'referee.access': 'Access the referee workspace',
  'matches.view': 'View assigned matches',
  'matches.view_all': 'View all tournament matches',
  'matches.manage': 'Create, schedule, assign, confirm and correct all matches',
  'matches.delete': 'Permanently delete matches and their referee records',
  'matches.import': 'Preview and accept tournament referee workbook records',
  'matches.manage_all': 'Operate matches regardless of referee assignment',
  'matches.assign_referees': 'Schedule and reassign authorized matches',
  'matches.manage_assigned': 'Operate assigned matches',
  'matches.update_scores': 'Record scores in assigned matches',
  'matches.manage_draft': 'Manage picks and bans in assigned matches',
  'matches.submit_results': 'Submit assigned match results',
  'matches.view_history': 'View authorized match event and score history',
  'teams.view': 'View team registrations and rosters',
  'teams.create': 'Create tournament teams and solo entrants',
  'teams.edit': 'Edit teams and player rosters',
  'teams.import': 'Preview and import team CSV files',
  'teams.publish': 'Approve, reject, publish and hide teams',
  'teams.delete': 'Delete unused teams',
  'homepage.edit': 'Edit homepage drafts',
  'homepage.publish': 'Publish homepage',
  'rules.edit': 'Edit rules drafts',
  'rules.publish': 'Publish rules',
  'mappools.view_drafts': 'View unpublished mappools',
  'mappools.create': 'Create stages and mappools',
  'mappools.edit': 'Edit mappool drafts and mod categories',
  'mappools.publish': 'Publish or unpublish mappools',
  'mappools.delete': 'Delete mappools and stages',
  'staff.edit': 'Manage public staff',
  'users.manage': 'Manage user roles',
  'roles.manage': 'Manage roles and permissions',
  'settings.manage': 'Manage tournament settings',
  'media.upload': 'Upload, replace and remove media',
  'audit.view': 'View administrative audit trail',
  'tournament.data.read': 'Read designated tournament data',
} as const;
export type PermissionKey = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];
export const PLATFORM_PERMISSIONS: PermissionKey[] = [
  'tournaments.create',
  'tournaments.manage_all',
  'platform.manage',
];
export const TOURNAMENT_PERMISSIONS = ALL_PERMISSIONS.filter(
  (key) => !PLATFORM_PERMISSIONS.includes(key),
);
export const DEFAULT_ROLES: Record<string, PermissionKey[]> = {
  Guest: [],
  Player: [],
  Sheeter: ['tournament.data.read'],
  Pooler: ['mappools.view_drafts', 'mappools.create', 'mappools.edit'],
  Referee: [
    'referee.access',
    'matches.view',
    'matches.view_all',
    'matches.assign_referees',
    'matches.manage_assigned',
    'matches.update_scores',
    'matches.manage_draft',
    'matches.submit_results',
    'matches.view_history',
  ],
  'Staff Manager': ['staff.edit', 'media.upload'],
  'Content Editor': ['homepage.edit', 'rules.edit', 'media.upload'],
  Admin: TOURNAMENT_PERMISSIONS,
  Owner: TOURNAMENT_PERMISSIONS,
};
export type Actor = {
  tournamentId?: string;
  platformAdmin?: boolean;
  workspaceAny?: boolean;
  id: string;
  osuId: number;
  username: string;
  avatarUrl: string;
  permissions: PermissionKey[];
  roles: { id: string; name: string; systemKey: string | null }[];
};
export function can(actor: Pick<Actor, 'permissions'> | null, permission: PermissionKey) {
  return !!actor?.permissions.includes(permission);
}
export class AppError extends Error {
  declare readonly translationKey: string;
  declare readonly translationValues: readonly MessageValue[];
  constructor(
    message: string,
    public status = 400,
    values: readonly unknown[] = [],
  ) {
    const parameters = values.map((value) =>
      isMessageList(value) ? messageList(value.items, value.separator) : String(value),
    );
    super(formatMessage(message, parameters));
    // Preserve the English Error.message contract without exposing extra values
    // through JSON serialization or ordinary error logging.
    Object.defineProperties(this, {
      translationKey: { value: message },
      translationValues: { value: parameters },
    });
  }
  static fromMessages(messages: readonly string[], status = 400, separator = ' ') {
    return new AppError('{0}', status, [messageList(messages, separator)]);
  }
}
export function assertPermission(
  actor: Actor | null,
  permission: PermissionKey,
): asserts actor is Actor {
  if (!actor) throw new AppError('Sign in to continue.', 401);
  if (!can(actor, permission))
    throw new AppError('You do not have permission for this action.', 403);
}
export function assertRoleGrant(
  actor: Actor,
  targetId: string,
  requested: PermissionKey[],
  owner = false,
) {
  if (actor.id === targetId) throw new AppError('You cannot change your own roles.', 403);
  if (owner && !actor.platformAdmin && !actor.roles.some((r) => r.systemKey === 'Owner'))
    throw new AppError('Only an Owner can appoint another Owner.', 403);
  if (requested.some((p) => !actor.permissions.includes(p)))
    throw new AppError('You cannot grant permissions you do not hold.', 403);
}
