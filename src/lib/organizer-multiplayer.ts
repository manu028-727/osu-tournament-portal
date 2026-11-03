import { MODS } from './match-rules';
import { mapWinner, reportedPlayerScore, teamMapValue } from './score-pipeline';
import type { MatchView } from './matches-types';
import type { MultiplayerImportGame } from './match-results-contract';
import { z } from 'zod';

const scoreSchema = z.object({
  user_id: z.number().int().positive(),
  score: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  accuracy: z.number().min(0).max(1),
  max_combo: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  mods: z.array(z.string()),
  statistics: z.object({ count_miss: z.number().int().nonnegative() }).partial().optional(),
});
/** Tournament identities define sides; lobby colours are metadata, never roster ownership. */
export function organizerMultiplayerGames(
  games: MultiplayerImportGame[],
  match: MatchView,
  mappings: Record<string, 'A' | 'B'> = {},
) {
  const members = (['A', 'B'] as const).flatMap((side) =>
    match.participants[side].members.map((member) => ({ ...member, side })),
  );
  const players = new Map<
    number,
    { osuId: number; username: string; side: 'A' | 'B' | null; ambiguous: boolean }
  >();
  const resolved = games.map((game) => {
    const evidence = game.evidence;
    const scores = z.array(scoreSchema).safeParse(evidence.scores);
    if (!scores.success)
      return {
        ...game,
        proposal: null,
        evidence: { ...evidence, issue: 'Player score data is incomplete.' },
      };
    const assigned = scores.data.map((score) => {
      const roster = members.filter((m) => Number(m.osuId) === score.user_id);
      const sides = new Set(roster.map((m) => m.side));
      const side = mappings[String(score.user_id)] || (sides.size === 1 ? roster[0].side : null);
      players.set(score.user_id, {
        osuId: score.user_id,
        username: roster[0]?.username || String(score.user_id),
        side,
        ambiguous: !side,
      });
      return { ...score, side };
    });
    try {
      if (!evidence.endTime) throw Error('In progress or aborted');
      if (match.rules.gameplayScoring === 'LAZER')
        throw Error('The legacy match API cannot verify standardized lazer scoring.');
      const scoring = { SCORE_V2: 'scorev2', SCORE: 'score', COMBO: 'combo', ACCURACY: 'accuracy' }[
        match.rules.scoreMode
      ];
      if (evidence.mode !== match.rules.gameMode || evidence.scoringType !== scoring)
        throw Error('Game mode or scoring does not match the frozen rules.');
      if (assigned.some((p) => !p.side))
        throw Error('Assign the unmatched osu! IDs to a tournament team.');
      const slots =
        match.poolRevision?.slots.filter((s) => s.beatmapId === evidence.beatmapId) || [];
      if (slots.length > 1) throw Error('Choose a unique pool slot before importing this map.');
      if (!slots.length && match.rules.multiplierMode === 'CUSTOM')
        throw Error('A map with custom slot multipliers needs a matching frozen pool slot.');
      const mapped = assigned.map((p) => {
        const mods = [...new Set([...evidence.mods, ...p.mods])];
        if (mods.some((mod) => !MODS.includes(mod as never)))
          throw Error('Unsupported mod combination; use manual review.');
        return {
          osuId: p.user_id,
          side: p.side!,
          mods: mods as (typeof MODS)[number][],
          score: reportedPlayerScore(match.rules, {
            score: p.score,
            accuracy: p.accuracy,
            maxCombo: p.max_combo,
          }),
          accuracy: p.accuracy * 100,
          maxCombo: p.max_combo,
          misses: p.statistics?.count_miss ?? null,
        };
      });
      if (new Set(mapped.map((player) => player.osuId)).size !== mapped.length)
        throw Error('A player score is duplicated.');
      if (
        !mapped.some((player) => player.side === 'A') ||
        !mapped.some((player) => player.side === 'B')
      )
        throw Error('Both tournament teams need score evidence.');
      // A reviewed import keeps usable evidence, so unlike live capture it does not reject
      // short lineups or rule violations. Team values still come from the shared pipeline.
      const total = (side: 'A' | 'B') =>
        teamMapValue(
          match.rules,
          mapped.filter((player) => player.side === side),
          slots[0]?.name || '',
        );
      const scoreA = total('A'),
        scoreB = total('B');
      if (
        !Number.isFinite(scoreA) ||
        !Number.isFinite(scoreB) ||
        Math.max(scoreA, scoreB) > Number.MAX_SAFE_INTEGER
      )
        throw Error('The imported team score exceeds the supported range.');
      const winnerSide = mapWinner(match.rules, scoreA, scoreB);
      if (!winnerSide)
        throw Error('Tied maps must be excluded or reviewed before awarding a point.');
      const totals = { scoreA, scoreB, winnerSide };
      return {
        evidence: { ...evidence, issue: null },
        proposal: {
          gameId: evidence.gameId,
          beatmapId: evidence.beatmapId,
          slotName: slots[0]?.name || '',
          startTime: evidence.startTime,
          players: mapped,
          ...totals,
        },
      };
    } catch (error) {
      return {
        ...game,
        proposal: null,
        evidence: {
          ...evidence,
          issue: error instanceof Error ? error.message : 'Manual review required.',
        },
      };
    }
  });
  return { games: resolved, players: [...players.values()] };
}
