import { describe, it, expect } from 'vitest';
import { matchAccess } from '../src/lib/match-access';
import type { Actor } from '../src/lib/permissions';
const actor: Actor = {
  id: 'ref-a',
  osuId: 1,
  username: 'A',
  avatarUrl: '',
  roles: [],
  permissions: [
    'matches.view_all',
    'matches.view_history',
    'matches.manage_assigned',
    'matches.manage_draft',
    'matches.update_scores',
    'matches.submit_results',
    'matches.assign_referees',
  ],
};
describe('independent match visibility and editing', () => {
  it('does not allow read-all referees to operate unassigned or other matches', () => {
    for (const assignments of [[], [{ userId: 'ref-b' }]])
      expect(matchAccess(actor, { assignments })).toMatchObject({
        editable: false,
        operate: false,
        score: false,
        draft: false,
        submit: false,
        schedule: false,
      });
  });
  it('permits assigned operations without granting organizer-only privileges', () => {
    expect(matchAccess(actor, { assignments: [{ userId: actor.id }] })).toMatchObject({
      assigned: true,
      editable: true,
      operate: true,
      score: true,
      draft: true,
      submit: true,
      schedule: true,
      manager: false,
    });
  });
  it('keeps a view-only assigned user read-only and permits explicit overrides', () => {
    expect(
      matchAccess(
        { ...actor, permissions: ['matches.view_all'] },
        { assignments: [{ userId: actor.id }] },
      ).editable,
    ).toBe(false);
    expect(
      matchAccess({ ...actor, permissions: ['matches.manage_all'] }, { assignments: [] }).editable,
    ).toBe(true);
    expect(
      matchAccess({ ...actor, permissions: ['matches.manage'] }, { assignments: [] }).manager,
    ).toBe(true);
  });
});
