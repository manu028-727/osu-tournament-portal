import { can, type Actor } from './permissions';

export function matchAccess(actor: Actor, match: { assignments: { userId: string }[] }) {
  const manager = can(actor, 'matches.manage');
  const assigned = match.assignments.some((r) => r.userId === actor.id);
  const override = can(actor, 'matches.manage_all');
  const scope = manager || assigned || override;
  return {
    manager,
    assigned,
    operate: scope && (manager || override || can(actor, 'matches.manage_assigned')),
    draft: scope && (manager || override || can(actor, 'matches.manage_draft')),
    score: scope && (manager || override || can(actor, 'matches.update_scores')),
    submit: scope && (manager || override || can(actor, 'matches.submit_results')),
    schedule: scope && (manager || can(actor, 'matches.assign_referees')),
    editable:
      scope &&
      (manager ||
        override ||
        can(actor, 'matches.manage_assigned') ||
        can(actor, 'matches.update_scores') ||
        can(actor, 'matches.manage_draft')),
  };
}
export type MatchAccess = ReturnType<typeof matchAccess>;
