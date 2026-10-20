import { describe, it, expect } from 'vitest';
import { safeReturnTo } from '../src/lib/return-url';
import { canAccessSection, canAccessWorkspace } from '../src/lib/workspace';
import { DEFAULT_ROLES, type Actor } from '../src/lib/permissions';
describe('public sign-in and workspace policy', () => {
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
