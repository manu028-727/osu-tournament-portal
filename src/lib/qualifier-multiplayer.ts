import { z } from 'zod';
import { MODS } from './match-rules';
import { historicalScoring } from './gameplay-scoring';
import type { QualifierView } from './qualifiers-types';
const mod = z.union([z.string(), z.object({ acronym: z.string() }).transform((v) => v.acronym)]);
const gameSchema = z.object({
  id: z.number().int().positive().safe(),
  beatmap_id: z.number().int().positive(),
  start_time: z.iso.datetime({ offset: true }),
  end_time: z.string().nullable(),
  mode: z.string(),
  scoring_type: z.string(),
  mods: z.array(mod),
  scores: z.array(
    z.object({
      user_id: z.number().int().positive(),
      score: z.number().int().nonnegative().safe(),
      mods: z.array(mod),
    }),
  ),
});
export type QualifierCapture = {
  gameId: string;
  slotName: string;
  beatmapId: number;
  startedAt: string;
  players: { osuId: number; raw: number; mods: (typeof MODS)[number][] }[];
};
export function qualifierCapturePlan(
  lobby: QualifierView,
  options: { historical?: boolean; warmups?: number } = {},
) {
  const time = (evidence: unknown) => {
    const value = evidence as { game?: { start_time?: string }; proposal?: QualifierCapture };
    return value.game?.start_time || value.proposal?.startedAt || '';
  };
  const rows = [...lobby.games].sort(
    (a, b) =>
      time(a.evidence).localeCompare(time(b.evidence)) ||
      a.gameId.localeCompare(b.gameId, 'en', { numeric: true }),
  );
  const sources = [...new Set(rows.map((row) => row.multiplayerId))].map((mp) => ({
    mp,
    ...qualifierGameProposals(
      rows.filter((row) => row.multiplayerId === mp).map((row) => row.evidence),
      lobby,
      options,
    ),
  }));
  const rejected = sources.flatMap((source) =>
    source.rejected.map((issue) => ({ ...issue, multiplayerId: source.mp })),
  );
  const map = new Map(
    sources.flatMap((source) =>
      source.proposals.map((proposal) => [`${source.mp}:${proposal.gameId}`, proposal] as const),
    ),
  );
  const required = new Set(lobby.poolRevision.slots.map((slot) => slot.name));
  let run = 1;
  const played = new Set<string>();
  const games = rows.map((row) => {
    const saved = (row.evidence as { proposal?: QualifierCapture }).proposal;
    const proposal =
      map.get(`${row.multiplayerId}:${row.gameId}`) ||
      (row.status === 'ACCEPTED' ? saved : undefined);
    if (row.status === 'IGNORED') return { row, proposal, run: row.run, issue: null };
    if (!proposal)
      return {
        row,
        proposal,
        run: row.run,
        issue:
          rejected.find(
            (issue) => issue.gameId === row.gameId && issue.multiplayerId === row.multiplayerId,
          )?.issue || 'Incomplete game evidence.',
      };
    if (row.status === 'ACCEPTED' && row.run && row.run > run) {
      run = row.run;
      played.clear();
    } else if (played.size === required.size) {
      run++;
      played.clear();
    }
    const repeat = played.has(proposal.slotName);
    const assignedRun =
      row.status === 'ACCEPTED' && row.run ? row.run : run <= lobby.policy.runs ? run : null;
    const issue =
      row.status === 'ACCEPTED'
        ? null
        : repeat
          ? 'Repeated map before the complete pool finished. Review this retry.'
          : !assignedRun
            ? 'Additional play exceeds the configured runs. Review or ignore it.'
            : null;
    if (!repeat) played.add(proposal.slotName);
    return { row, proposal, run: assignedRun, issue };
  });
  return { games, rejected };
}
export function qualifierGameProposals(
  events: unknown[],
  lobby: QualifierView,
  options: { historical?: boolean; warmups?: number; excludePlayers?: number[] } = {},
) {
  const proposals: QualifierCapture[] = [],
    rejected: { gameId: string; issue: string }[] = [];
  const started = lobby.events
    .filter(
      (e) => e.kind === 'qualifier.status' && (e.data as { command?: string })?.command === 'START',
    )
    .map((e) => new Date(e.createdAt).getTime())
    .sort((a, b) => a - b)[0];
  const roster = new Set(lobby.participants.flatMap((t) => t.members.map((p) => p.osuId)));
  const seen = new Set<string>();
  let played = 0;
  const time = (event: unknown) =>
    z.object({ game: z.object({ start_time: z.string() }).optional() }).safeParse(event);
  const ordered = [...events].sort((a, b) => {
    const left = time(a),
      right = time(b);
    return (left.success ? left.data.game?.start_time || '' : '').localeCompare(
      right.success ? right.data.game?.start_time || '' : '',
    );
  });
  for (const event of ordered) {
    const input = z.object({ game: z.unknown().optional() }).safeParse(event);
    if (!input.success || !input.data.game) continue;
    const parsed = gameSchema.safeParse(input.data.game);
    if (!parsed.success) {
      rejected.push({
        gameId: String((input.data.game as { id?: number }).id || 'unknown'),
        issue: 'Incomplete game data. Use reviewed manual entry.',
      });
      continue;
    }
    const g = parsed.data,
      gameId = String(g.id);
    if (seen.has(gameId)) continue;
    seen.add(gameId);
    try {
      if (!g.end_time) continue;
      if (played++ < (options.warmups || 0)) throw Error('Excluded warmup game.');
      if (!options.historical && (!started || new Date(g.start_time).getTime() < started))
        throw Error('Game predates the qualifier session or its start is unverified.');
      const scoring = historicalScoring(lobby.rules);
      if (scoring === 'LAZER')
        throw Error('Legacy matches cannot verify standardized lazer scores.');
      if (
        !scoring ||
        g.scoring_type !== (scoring === 'SCORE_V1' ? 'score' : 'scorev2') ||
        g.mode !== lobby.rules.gameMode
      )
        throw Error('Gameplay mode or scoring differs from the session snapshot.');
      const slots = lobby.poolRevision.slots.filter((s) => s.beatmapId === g.beatmap_id);
      if (slots.length !== 1) throw Error('Game is not uniquely identified in the qualifier pool.');
      if (!g.scores.length || new Set(g.scores.map((s) => s.user_id)).size !== g.scores.length)
        throw Error('Missing or duplicate player scores.');
      const players = g.scores
        .filter((score) => !options.excludePlayers?.includes(score.user_id))
        .map((s) => {
          if (!roster.has(s.user_id))
            throw Error('A player is outside the snapshotted qualifier roster.');
          const mods = [...new Set([...g.mods, ...s.mods])];
          if (mods.some((m) => !MODS.includes(m as never)))
            throw Error('Unsupported mods require manual review.');
          return { osuId: s.user_id, raw: s.score, mods: mods as (typeof MODS)[number][] };
        });
      if (!players.length) throw Error('No counting player scores remain.');
      proposals.push({
        gameId,
        slotName: slots[0].name,
        beatmapId: g.beatmap_id,
        startedAt: g.start_time,
        players,
      });
    } catch (e) {
      rejected.push({ gameId, issue: (e as Error).message });
    }
  }
  return {
    proposals: proposals.sort(
      (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
    ),
    rejected,
  };
}
