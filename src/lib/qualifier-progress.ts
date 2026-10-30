import type { QualifierView } from './qualifiers-types';
import { qualifierTeamAggregate } from './qualifier-policy';

// A performance belongs to the whole shared lobby, never a sequence of team matches.
export function qualifierProgress(
  lobby: Pick<QualifierView, 'participants' | 'poolRevision' | 'policy' | 'scores'>,
) {
  return Array.from({ length: lobby.policy.runs }, (_, index) => index + 1).flatMap((run) =>
    lobby.poolRevision.slots.map((slot) => {
      const teams = lobby.participants.map((team) => {
        const scores = lobby.scores.filter(
          (score) =>
            score.run === run &&
            score.slotName === slot.name &&
            team.members.some((player) => player.osuId === score.osuId),
        );
        const aggregate = qualifierTeamAggregate(scores, lobby.policy);
        return {
          team,
          scores,
          complete: aggregate !== null,
          value: aggregate && Number.isFinite(aggregate.value) ? aggregate.value : null,
        };
      });
      return {
        run,
        slot,
        teams,
        complete: teams.length > 0 && teams.every((team) => team.complete),
      };
    }),
  );
}
