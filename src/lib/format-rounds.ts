// Which stage each round of a bracket plays in. Client-safe, so the setup screen, the preview
// and locking all read one answer.
export type StageRef = { id: string; name?: string; kind?: string };
type RoundRef = { key: string; lane: string };

export const roundNumber = (round: RoundRef) => Number(round.key.split('-r')[1]);

// What a stage is for, read from its name. Unrecognized names fall back to stage order.
function stageRole(name = '') {
  const text = name.trim().toLowerCase();
  if (/grand\s*final|^gf$|finalissima|gran\s*finale/.test(text)) return 'GRAND';
  if (/semi|^sf$/.test(text)) return 'R4';
  if (/quarter|quart[io]\b|^qf$/.test(text)) return 'R8';
  if (/ottavi/.test(text)) return 'R16';
  if (/sedicesimi/.test(text)) return 'R32';
  const round = text.match(/(?:round of|^ro|^last|^top)\s*(\d+)/);
  if (round) return `R${round[1]}`;
  if (/^(?:the\s+)?finals?$|^f$|^finale$/.test(text)) return 'R2';
  return null;
}

// How many entrants a Winners round starts with: 16 for a Round of 16, 2 for the final.
export function winnersRoundEntrants(round: RoundRef, rounds: readonly RoundRef[]) {
  const total = rounds.filter((item) => item.lane === 'WINNERS').length;
  return 2 ** (total - roundNumber(round) + 1);
}

// Matches rounds to stages by name where it can, running on through the stage list where names
// say nothing. Later rounds never land on an earlier stage. A Losers round shares the stage of
// the Winners round played alongside it, and a bracket never runs in a group stage.
export function automaticRoundStages(
  anchorId: string,
  rounds: readonly RoundRef[],
  stages: readonly (string | StageRef)[],
): Record<string, string> {
  const all = stages.map((stage) => (typeof stage === 'string' ? { id: stage } : stage));
  if (!all.length) return Object.fromEntries(rounds.map((round) => [round.key, anchorId]));
  const bracketStages = all.filter((stage) => stage.kind !== 'GROUPS');
  const list = bracketStages.length ? bracketStages : all;
  const last = list.length - 1;
  const roles = new Map<string, number>();
  list.forEach((stage, index) => {
    const role = stageRole(stage.name);
    if (role && !roles.has(role)) roles.set(role, index);
  });
  const winners = rounds
    .filter((round) => round.lane === 'WINNERS')
    .sort((a, b) => roundNumber(a) - roundNumber(b));
  const named = winners.map((round) => {
    const position = roles.get(`R${winnersRoundEntrants(round, rounds)}`);
    return position ?? null;
  });
  const positions: number[] = [];
  if (named.some((value) => value !== null)) {
    // A round with no stage of its own sits one stage before the next named round.
    const filled = [...named];
    for (let index = filled.length - 2; index >= 0; index--)
      if (filled[index] === null && filled[index + 1] !== null)
        filled[index] = Math.max(0, filled[index + 1]! - 1);
    filled.forEach((value, index) => {
      const previous = index ? positions[index - 1] : 0;
      positions.push(Math.max(previous, value ?? Math.min(previous + (index ? 1 : 0), last)));
    });
  } else {
    const anchor = Math.max(
      0,
      list.findIndex((stage) => stage.id === anchorId),
    );
    winners.forEach((_, index) => positions.push(Math.min(anchor + index, last)));
  }
  const lastWinners = positions.at(-1) ?? 0;
  const position = (round: RoundRef) => {
    if (round.lane === 'WINNERS')
      return positions[winners.findIndex((item) => item.key === round.key)] ?? 0;
    if (round.lane === 'LOSERS')
      return positions[Math.min(Math.floor(roundNumber(round) / 2), positions.length - 1)] ?? 0;
    if (round.lane === 'FINALS') return roles.get('GRAND') ?? Math.min(lastWinners + 1, last);
    return lastWinners;
  };
  return Object.fromEntries(
    rounds.map((round) => [
      round.key,
      round.lane === 'WINNERS' ||
      round.lane === 'LOSERS' ||
      round.lane === 'FINALS' ||
      round.lane === 'THIRD_PLACE'
        ? list[position(round)].id
        : // Group rounds all belong to the stage their phase names.
          anchorId,
    ]),
  );
}

// A later round cannot be played in an earlier stage, or match order would run backwards.
export function roundStageConflict(
  rounds: readonly (RoundRef & { stageId: string })[],
  stages: readonly StageRef[],
) {
  const order = (id: string) => stages.findIndex((stage) => stage.id === id);
  for (const lane of ['WINNERS', 'LOSERS', 'FINALS']) {
    const own = rounds
      .filter((round) => round.lane === lane)
      .sort((a, b) => roundNumber(a) - roundNumber(b));
    for (let index = 1; index < own.length; index++)
      if (order(own[index].stageId) < order(own[index - 1].stageId)) return own[index];
  }
  return null;
}
