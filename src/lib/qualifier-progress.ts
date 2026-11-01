import type { QualifierView } from './qualifiers-types';
import { qualifierTeamAggregate } from './qualifier-policy';
import { qualifierTeamModViolation } from './qualifier-eligibility';

// A performance belongs to the whole shared lobby, never a sequence of team matches.
export function qualifierProgress(
  lobby: Pick<QualifierView, 'participants' | 'poolRevision' | 'policy' | 'scores'> &
    Partial<Pick<QualifierView, 'rules'>>,
) {
  return Array.from({ length: lobby.policy.runs }, (_, index) => index + 1).flatMap((run) =>
    lobby.poolRevision.slots.map((slot) => {
      const teams = lobby.participants.map((team) => {
        const scores = lobby.scores.filter(
          (score) =>
            score.eligible !== false &&
            score.verified !== false &&
            score.run === run &&
            score.slotName === slot.name &&
            team.members.some((player) => player.osuId === score.osuId),
        );
        const aggregate = qualifierTeamAggregate(scores, lobby.policy);
        const validMods =
          !lobby.rules || !qualifierTeamModViolation(lobby.rules, slot.category, scores);
        return {
          team,
          scores,
          complete: aggregate !== null && validMods,
          value:
            validMods && aggregate && Number.isFinite(aggregate.value) ? aggregate.value : null,
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

export function qualifierCompletion(lobby: Parameters<typeof qualifierProgress>[0]) {
  const progress = qualifierProgress(lobby);
  const runs = Array.from({ length: lobby.policy.runs }, (_, i) => i + 1);
  const requiredRun =
    lobby.policy.runSelection === 'SECOND_RUN' && lobby.policy.runs === 2
      ? 2
      : lobby.policy.runSelection === 'FIRST_RUN' || lobby.policy.runs === 1
        ? 1
        : null;
  const completeRuns = runs.filter((run) => {
    const maps = progress.filter((map) => map.run === run);
    return maps.length > 0 && maps.every((map) => map.complete);
  });
  const entrants = lobby.participants.map((team) => ({
    id: team.id,
    runs: runs.filter(
      (run) =>
        (!requiredRun || run === requiredRun) &&
        progress.some((map) => map.run === run) &&
        progress
          .filter((map) => map.run === run)
          .every((map) => map.teams.find((t) => t.team.id === team.id)?.complete),
    ),
  }));
  const complete = entrants.length > 0 && entrants.every((team) => team.runs.length > 0);
  const targetRun = new Map(
    entrants.map((entrant) => [
      entrant.id,
      requiredRun ||
        [...runs].sort((a, b) => {
          const count = (run: number) =>
            progress.filter(
              (map) => map.run === run && map.teams.find((t) => t.team.id === entrant.id)?.complete,
            ).length;
          return count(b) - count(a) || a - b;
        })[0],
    ]),
  );
  const blockers = complete
    ? []
    : progress
        .filter((map) => !map.complete && (!requiredRun || map.run === requiredRun))
        .flatMap((map) =>
          map.teams
            .filter(
              (team) =>
                !team.complete &&
                targetRun.get(team.team.id) === map.run &&
                !entrants.find((t) => t.id === team.team.id)?.runs.length,
            )
            .map(({ team, scores }) => ({
              team: team.name,
              slotName: map.slot.name,
              run: map.run,
              recorded: scores.length,
              required: lobby.policy.requiredPlayers,
            })),
        );
  return { complete, completeRuns, entrants, blockers };
}

export function qualifierScoreExceptions(lobby: QualifierView) {
  return lobby.scores.flatMap((score) => {
    const slot = lobby.poolRevision.slots.find((slot) => slot.name === score.slotName);
    const team = lobby.participants.find((team) =>
      team.members.some((p) => p.osuId === score.osuId),
    );
    const scores = lobby.scores.filter(
      (s) =>
        s.eligible !== false &&
        s.slotName === score.slotName &&
        s.run === score.run &&
        team?.members.some((p) => p.osuId === s.osuId),
    );
    const reason =
      score.eligible === false
        ? score.eligibilityReason
        : slot
          ? qualifierTeamModViolation(lobby.rules, slot.category, scores)
          : null;
    return reason ? [{ ...score, eligibilityReason: reason }] : [];
  });
}
