import type { Prisma } from '@/generated/prisma/client';
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

export function eligibleRefereeFor(tournamentId: string): Prisma.UserWhereInput {
  return {
    AND: [
      {
        roles: {
          some: {
            tournamentId,
            role: {
              permissions: {
                some: {
                  permissionKey: {
                    in: [
                      'matches.view',
                      'matches.view_all',
                      'matches.manage',
                      'matches.manage_all',
                    ],
                  },
                },
              },
            },
          },
        },
      },
      {
        roles: {
          some: {
            tournamentId,
            role: {
              permissions: {
                some: {
                  permissionKey: {
                    in: ['matches.manage_assigned', 'matches.manage', 'matches.manage_all'],
                  },
                },
              },
            },
          },
        },
      },
    ],
  };
}
