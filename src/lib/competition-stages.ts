import { AppError } from './permissions';

// Explicit progression takes precedence over display order. Names are authored content.
export type ProgressionStage = { id: string; position: number; nextStageId?: string | null };
type Round = { key: string; lane: string; position: number };

export function orderedCompetitionStages<T extends ProgressionStage>(stages: readonly T[]) {
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  const incoming = new Map(stages.map((stage) => [stage.id, 0]));
  for (const stage of stages)
    if (stage.nextStageId && byId.has(stage.nextStageId))
      incoming.set(stage.nextStageId, incoming.get(stage.nextStageId)! + 1);
  const ready = stages.filter((stage) => incoming.get(stage.id) === 0);
  const ordered: T[] = [];
  while (ready.length) {
    ready.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    const next = ready.shift()!;
    ordered.push(next);
    if (next.nextStageId && byId.has(next.nextStageId)) {
      const count = incoming.get(next.nextStageId)! - 1;
      incoming.set(next.nextStageId, count);
      if (count === 0) ready.push(byId.get(next.nextStageId)!);
    }
  }
  if (ordered.length !== stages.length)
    throw new AppError('Stage progression cannot contain a cycle.');
  return ordered;
}

export function suggestedCompetitionStages(
  rounds: readonly Round[],
  startingStageId: string,
  stages: readonly ProgressionStage[],
) {
  const available = orderedCompetitionStages(stages);
  const start = available.findIndex((stage) => stage.id === startingStageId);
  const path: ProgressionStage[] = start < 0 ? [] : [available[start]];
  while (path.length) {
    const current = path.at(-1)!;
    const next = current.nextStageId
      ? available.find((stage) => stage.id === current.nextStageId)
      : available[available.findIndex((stage) => stage.id === current.id) + 1];
    if (current.nextStageId && !next)
      throw new AppError('Bracket stage progression must use active head-to-head stages.');
    if (!next) break;
    path.push(next);
  }
  const laneRounds = (lane: string) =>
    rounds.filter((round) => round.lane === lane).sort((a, b) => a.position - b.position);
  const winners = laneRounds('WINNERS');
  return Object.fromEntries(
    rounds.map((round) => {
      const index = laneRounds(round.lane).findIndex((item) => item.key === round.key);
      const offset =
        round.lane === 'WINNERS'
          ? index
          : round.lane === 'LOSERS'
            ? Math.floor((index + 1) / 2)
            : round.lane === 'FINALS'
              ? winners.length
              : round.lane === 'THIRD_PLACE'
                ? Math.max(0, winners.length - 1)
                : 0;
      return [round.key, start < 0 ? startingStageId : path[Math.min(offset, path.length - 1)].id];
    }),
  );
}
