import { describe, it, expect } from 'vitest';
import { safeReturnTo } from '../src/lib/return-url';
import { canAccessSection, canAccessWorkspace } from '../src/lib/workspace';
import { DEFAULT_ROLES, type Actor } from '../src/lib/permissions';
describe('public sign-in and workspace policy', () => {
  const staff = (permissions: Actor['permissions']): Actor => ({
    id: 'workspace-test',
    osuId: 1,
    username: 'test',
    avatarUrl: '',
    permissions,
    roles: [],
  });
  it('puts referees in Matches without granting unrelated editing access', () => {
    expect(canAccessSection(staff(DEFAULT_ROLES.Referee), 'matches')).toBe(true);
    expect(canAccessSection(staff(DEFAULT_ROLES.Referee), 'website')).toBe(false);
    expect(canAccessSection(staff(DEFAULT_ROLES.Referee), 'settings')).toBe(false);
    expect(canAccessSection(staff(['matches.view_all']), 'matches')).toBe(true);
  });
  it('groups website editors without granting configuration permissions', () => {
    expect(canAccessSection(staff(['rules.publish']), 'website')).toBe(true);
    expect(canAccessSection(staff(['rules.publish']), 'settings')).toBe(false);
    expect(canAccessSection(staff(['media.upload']), 'website')).toBe(true);
    expect(canAccessSection(staff(['users.manage']), 'staff')).toBe(true);
    expect(canAccessSection(staff(['staff.edit']), 'users')).toBe(false);
  });
  it('rejects unknown and prototype section names', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'unknown'])
      expect(canAccessSection(staff(DEFAULT_ROLES.Owner), name)).toBe(false);
  });
  it.each(['/', '/rules', '/mappools/finals?view=maps', '/teams/example#roster'])(
    'preserves a public return path %s',
    (path) => expect(safeReturnTo(path)).toBe(path),
  );
  it.each([
    '/admin/tournaments',
    '/t/spring-cup/admin',
    '/t/spring-cup/admin/homepage',
    '/t/spring-cup/admin/referee/match-1',
  ])('preserves a scoped organizer return path %s', (path) =>
    expect(safeReturnTo(path)).toBe(path),
  );
  it.each([
    undefined,
    '',
    '//evil.example',
    'https://evil.example',
    '/\\evil.example',
    '/%2f%2fevil.example',
    '/admin',
    '/admin/roles',
    '/api/auth/logout',
    '/_next/static/a',
    '/\n/evil.example',
    '/staff/../../admin',
  ])('rejects unsafe or non-public return paths %s', (path) =>
    expect(safeReturnTo(path)).toBe('/'),
  );
  it('uses permissions, not role names, for workspace and section access', () => {
    const actor = (permissions: Actor['permissions']) => ({
      id: 'test',
      osuId: 1,
      username: 'test',
      avatarUrl: '',
      roles: [],
      permissions,
    });
    expect(canAccessWorkspace(null)).toBe(false);
    expect(canAccessWorkspace(actor(DEFAULT_ROLES.Guest))).toBe(false);
    expect(canAccessWorkspace(actor(DEFAULT_ROLES.Player))).toBe(false);
    expect(canAccessWorkspace(actor(['rules.publish']))).toBe(true);
    expect(canAccessSection(actor(['rules.publish']), 'rules')).toBe(true);
    expect(canAccessSection(actor(DEFAULT_ROLES.Pooler), 'roles')).toBe(false);
    expect(canAccessSection(actor(DEFAULT_ROLES.Admin), 'settings')).toBe(true);
  });
});
