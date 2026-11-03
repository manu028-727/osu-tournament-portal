import { z } from 'zod';
import { MODS } from './match-rules';
import { aggregateScores, reportedPlayerScore } from './score-pipeline';
import type { MatchView } from './matches-types';
const mod = z.union([z.string(), z.object({ acronym: z.string() }).transform((v) => v.acronym)]);
const gameSchema = z.object({
  id: z.number().int().positive().safe(),
  beatmap_id: z.number().int().positive(),
  start_time: z.iso.datetime({ offset: true }),
  end_time: z.string().nullable(),
  mode: z.string(),
  scoring_type: z.string(),
  team_type: z.string(),
  mods: z.array(mod),
  scores: z.array(
    z.object({
      user_id: z.number().int().positive(),
      score: z.number().nonnegative(),
      max_combo: z.number().int().nonnegative(),
      accuracy: z.number().min(0).max(1),
      mods: z.array(mod),
      statistics: z.object({ count_miss: z.number().int().nonnegative() }).partial().optional(),
      match: z.object({ team: z.string() }),
    }),
  ),
});
export type MultiplayerProposal = {
  gameId: string;
  beatmapId: number;
  slotName: string;
  startTime: string;
  scoreA: number;
  scoreB: number;
  winnerSide: 'A' | 'B';
  players: {
    osuId: number;
    side: 'A' | 'B';
    score: number;
    accuracy: number;
    maxCombo: number;
    misses: number | null;
    mods: (typeof MODS)[number][];
  }[];
};
export type MultiplayerEvidence = {
  eventId: number;
  gameId: string;
  beatmapId: number;
  slotName: string;
  startTime: string;
  endTime: string | null;
  mode: string;
  scoringType: string;
  teamType: string;
  mods: string[];
  scores: unknown[];
  issue: string | null;
};
const checkpointSchema = z.object({
  latest: z.number().default(0),
  pending: z
    .object({ before: z.number(), target: z.number(), upper: z.number() })
    .nullable()
    .default(null),
});
export type MultiplayerCheckpoint = z.infer<typeof checkpointSchema>;
type ReviewOptions = { historical?: boolean; redSide?: 'A' | 'B' };
export async function collectMultiplayerPages(
  id: number,
  load: (path: string) => Promise<unknown>,
  saved: unknown,
  maxPages = 6,
) {
  const cp = checkpointSchema.catch({ latest: 0, pending: null }).parse(saved || {});
  const target = cp.pending?.target ?? cp.latest;
  let before = cp.pending?.before,
    upper = cp.pending?.upper || 0,
    finished = false;
  const events = new Map<number, unknown>();
  let metadata: {
    id: number;
    name?: string;
    start_time?: string | null;
    end_time?: string | null;
  } = { id };
  for (let page = 0; page < maxPages; page++) {
    const response = z
      .object({
        match: z.object({
          id: z.number(),
          name: z.string().max(500).optional(),
          start_time: z.string().nullable().optional(),
          end_time: z.string().nullable().optional(),
        }),
        first_event_id: z.number().optional(),
        events: z.array(
          z.object({ id: z.number().int().positive(), game: z.unknown().optional() }).passthrough(),
        ),
      })
      .parse(await load(`matches/${id}?limit=100${before ? `&before=${before}` : ''}`));
    if (response.match.id !== id) throw Error('osu! returned a different lobby.');
    metadata = response.match;
    const entries = response.events;
    if (!entries.length) {
      finished = true;
      break;
    }
    const min = Math.min(...entries.map((e) => e.id)),
      max = Math.max(...entries.map((e) => e.id));
    if (!upper) upper = max;
    for (const e of entries) events.set(e.id, e);
    if (min <= target || min <= (response.first_event_id || 0)) {
      finished = true;
      break;
    }
    if (before && min >= before) throw Error('osu! event pagination made no progress.');
    before = min;
  }
  return {
    metadata,
    events: [...events.values()],
    checkpoint: {
      latest: finished ? upper : cp.latest,
      pending: finished ? null : { before: before!, target, upper },
    } satisfies MultiplayerCheckpoint,
    complete: finished,
  };
}
export function multiplayerEvidence(
  events: unknown[],
  match: MatchView,
  options: ReviewOptions = {},
) {
  const games: { evidence: MultiplayerEvidence; proposal: MultiplayerProposal | null }[] = [];
  for (const input of events) {
    const event = z.object({ id: z.number(), game: z.unknown().optional() }).safeParse(input);
    if (!event.success || !event.data.game) continue;
    const parsed = gameSchema
      .partial({ scores: true, mods: true, mode: true, scoring_type: true, team_type: true })
      .safeParse(event.data.game);
    if (!parsed.success) continue;
    const g = parsed.data,
      slot = match.poolRevision?.slots.filter((s) => s.beatmapId === g.beatmap_id) || [];
    const result = multiplayerProposals(
      { match: { id: match.multiplayerId }, events: [{ game: event.data.game }] },
      match,
      options,
    );
    games.push({
      evidence: {
        eventId: event.data.id,
        gameId: String(g.id),
        beatmapId: g.beatmap_id,
        slotName: slot.length === 1 ? slot[0].name : '',
        startTime: g.start_time,
        endTime: g.end_time,
        mode: g.mode || '',
        scoringType: g.scoring_type || '',
        teamType: g.team_type || '',
        mods: g.mods || [],
        scores: g.scores || [],
        issue: !g.end_time ? 'In progress or aborted' : result.rejected[0] || null,
      },
      proposal: result.proposals[0] || null,
    });
  }
  return games;
}
export function multiplayerProposals(
  input: unknown,
  match: MatchView,
  options: ReviewOptions = {},
) {
  const response = z
    .object({
      match: z.object({ id: z.number() }),
      events: z.array(z.object({ game: z.unknown().optional() })),
    })
    .parse(input);
  if (response.match.id !== match.multiplayerId)
    throw new Error('osu! returned a different lobby.');
  const proposals: MultiplayerProposal[] = [],
    rejected: string[] = [];
  for (const event of response.events) {
    if (!event.game) continue;
    try {
      const g = gameSchema.parse(event.game);
      if (match.rules.gameplayScoring === 'LAZER')
        throw Error(
          'The legacy match API cannot verify standardized lazer scoring. Use reviewed manual entry.',
        );
      if (!g.end_time) continue;
      const slots = match.poolRevision?.slots.filter((s) => s.beatmapId === g.beatmap_id) || [];
      if (slots.length !== 1) throw Error('Map is not uniquely identified in the frozen pool.');
      if (
        !options.historical &&
        (!match.startedAt || new Date(g.start_time) < new Date(match.startedAt))
      )
        throw Error('Game predates this match.');
      if (
        g.mode !== match.rules.gameMode ||
        g.scoring_type !==
          { SCORE_V2: 'scorev2', SCORE: 'score', COMBO: 'combo', ACCURACY: 'accuracy' }[
            match.rules.scoreMode
          ]
      )
        throw Error('Game mode or scoring does not match the frozen rules.');
      if (
        !['TEAM_VS', 'HEAD_TO_HEAD'].includes(match.rules.teamMode) ||
        g.team_type !== (match.rules.teamMode === 'TEAM_VS' ? 'team-vs' : 'head-to-head')
      )
        throw Error('This team mode needs manual result entry.');
      const players = g.scores.map((score) => {
        const side = match.participants.A.members.some((m) => m.osuId === score.user_id)
          ? ('A' as const)
          : match.participants.B.members.some((m) => m.osuId === score.user_id)
            ? ('B' as const)
            : null;
        if (
          !side ||
          (match.rules.teamMode === 'TEAM_VS' &&
            score.match.team !== (side === (options.redSide || 'A') ? 'red' : 'blue'))
        )
          throw Error('Player roster or lobby team does not match.');
        const mods = [...new Set([...g.mods, ...score.mods])];
        if (mods.some((m) => !MODS.includes(m as never)))
          throw Error('Unsupported mod combination; use manual review.');
        return {
          osuId: score.user_id,
          side,
          mods: mods as (typeof MODS)[number][],
          score: reportedPlayerScore(match.rules, {
            score: score.score,
            accuracy: score.accuracy,
            maxCombo: score.max_combo,
          }),
          accuracy: score.accuracy * 100,
          maxCombo: score.max_combo,
          misses: score.statistics?.count_miss ?? null,
        };
      });
      const slot = slots[0];
      const totals = aggregateScores(
        match.rules,
        slot.category,
        players,
        {
          A: match.participants.A.members.map((m) => m.osuId),
          B: match.participants.B.members.map((m) => m.osuId),
        },
        0,
        0,
        slot.name,
      );
      proposals.push({
        gameId: String(g.id),
        beatmapId: g.beatmap_id,
        slotName: slot.name,
        startTime: g.start_time,
        players,
        ...totals,
      });
    } catch (e) {
      rejected.push(
        e instanceof z.ZodError
          ? 'Incomplete osu! game data; manual entry remains available.'
          : (e as Error).message,
      );
    }
  }
  return { proposals, rejected };
}
