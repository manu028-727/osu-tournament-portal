import { Prisma } from '@/generated/prisma/client';
import {
  competitionEliminated,
  groupStandings,
  recalculateCompetition,
} from './competition-engine';
import type {
  CompetitionBracketData,
  CompetitionData,
  CompetitionNode,
  CompetitionOptions,
} from './competition-types';
import { db } from './db';
import { AppError, assertPermission, can, type Actor, type PermissionKey } from './permissions';
import { publicTournamentWhere } from './public-visibility';
import { competitionStoredConfigSchema } from './competition-archive';

import { GroupConfig, resolvedGroupSeeds, reviewedGroupOrder } from './competition-groups';
const matchSelect = {
  id: true,
  code: true,
  matchNumber: true,
  status: true,
  teamAId: true,
  teamBId: true,
  scoreA: true,
  scoreB: true,
  winnerSide: true,
  forfeitSide: true,
  version: true,
  startedAt: true,
  scheduledAt: true,
  published: true,
  deletedAt: true,
};
export const include = {
  rounds: { orderBy: { position: 'asc' as const }, include: { stage: { select: { name: true } } } },
  entries: {
    orderBy: { seed: 'asc' as const },
    include: { team: { select: { id: true, name: true, slug: true } } },
  },
  nodes: {
    orderBy: { position: 'asc' as const },
    include: { slots: { orderBy: { side: 'asc' as const } }, match: { select: matchSelect } },
  },
};
export function tenant(actor: Actor) {
  if (actor.tournamentId === 'none') throw new AppError('Select a tournament before continuing.');
  return actor.tournamentId || 'main';
}
export function assertView(actor: Actor) {
  if (
    !['matches.manage', 'matches.view_all', 'matches.manage_all'].some((key) =>
      can(actor, key as PermissionKey),
    )
  )
    throw new AppError('Full competition access is not permitted.', 403);
}
export async function allNodes(
  tx: Prisma.TransactionClient,
  tournamentId: string,
): Promise<CompetitionNode[]> {
  return tx.bracketNode.findMany({
    where: { tournamentId },
    include: {
      slots: true,
      match: { select: matchSelect },
    },
  });
}
export function withStandings<T extends CompetitionBracketData & { config: Prisma.JsonValue }>(
  bracket: T,
): T & Pick<CompetitionBracketData, 'standings'> {
  const config = bracket.config as { advancePerGroup?: number; manualMatches?: boolean };
  return {
    ...bracket,
    manualMatches: !!config.manualMatches,
    standings: groupStandings(
      bracket.nodes,
      bracket.rounds,
      bracket.entries,
      config.advancePerGroup || 2,
      reviewedGroupOrder(bracket, bracket.nodes),
    ),
  };
}
export async function competitionOptions(actor: Actor): Promise<CompetitionOptions> {
  assertPermission(actor, 'matches.manage');
  const tournamentId = tenant(actor);
  const [stages, teams, standings, groups, nodes, linkableMatches] = await Promise.all([
    db.tournamentStage.findMany({
      where: { tournamentId, archivedAt: null, kind: { notIn: ['QUALIFIERS', 'QUALIFIER'] } },
      orderBy: { position: 'asc' },
      include: { mappool: { select: { state: true, publishedRevisionId: true } } },
    }),
    db.team.findMany({
      where: { tournamentId, status: 'APPROVED' },
      orderBy: [{ seed: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
      select: { id: true, name: true, seed: true },
    }),
    db.qualifierStanding.findMany({
      where: { tournamentId },
      orderBy: [{ stageId: 'asc' }, { version: 'desc' }],
      select: { id: true, stageId: true, version: true, snapshot: true },
    }),
    db.bracket.findMany({
      where: { tournamentId, format: 'GROUPS' },
      include: { rounds: true, entries: true },
      orderBy: { createdAt: 'asc' },
    }),
    allNodes(db, tournamentId),
    db.match.findMany({
      where: {
        tournamentId,
        bracketNode: { is: null },
        status: { not: 'CANCELLED' },
        teamAId: { not: null },
        teamBId: { not: null },
      },
      orderBy: [{ scheduledAt: 'asc' }, { matchNumber: 'asc' }],
      select: {
        id: true,
        matchNumber: true,
        version: true,
        code: true,
        stageId: true,
        status: true,
        scoreA: true,
        scoreB: true,
        teamA: { select: { id: true, name: true } },
        teamB: { select: { id: true, name: true } },
        stage: { select: { name: true } },
      },
    }),
  ]);
  return {
    stages: stages.map((s) => ({
      id: s.id,
      name: s.name,
      ready: s.mappool?.state === 'PUBLISHED' && !!s.mappool.publishedRevisionId,
    })),
    teams,
    linkableMatches: linkableMatches.flatMap((match) =>
      match.teamA && match.teamB
        ? [
            {
              id: match.id,
              matchNumber: match.matchNumber,
              version: match.version,
              code: match.code,
              stageId: match.stageId,
              stageName: match.stage.name,
              status: match.status,
              teamAId: match.teamA.id,
              teamAName: match.teamA.name,
              teamBId: match.teamB.id,
              teamBName: match.teamB.name,
              scoreA: match.scoreA,
              scoreB: match.scoreB,
            },
          ]
        : [],
    ),
    standings,
    groupSources: groups.flatMap((group) => {
      try {
        return [
          {
            id: group.id,
            name: group.name,
            ...resolvedGroupSeeds(group, recalculateCompetition(nodes)),
          },
        ];
      } catch (error) {
        if (error instanceof AppError) return [];
        throw error;
      }
    }),
  };
}
export async function competitionData(actor: Actor): Promise<CompetitionData> {
  assertView(actor);
  const tournamentId = tenant(actor);
  const [brackets, options] = await Promise.all([
    db.bracket.findMany({ where: { tournamentId }, include, orderBy: { createdAt: 'asc' } }),
    can(actor, 'matches.manage') ? competitionOptions(actor) : null,
  ]);
  return {
    brackets: brackets.map((bracket) => ({
      ...withStandings({
        ...bracket,
        rounds: bracket.rounds.map(({ stage, ...round }) => ({ ...round, stageName: stage.name })),
      }),
      configuration: options ? competitionStoredConfigSchema.parse(bracket.config) : undefined,
    })),
    options,
  };
}
export async function publicCompetitionData(
  tournamentId: string,
): Promise<CompetitionBracketData[]> {
  const tournament = await db.tournament.findFirst({
    where: { id: tournamentId, ...publicTournamentWhere },
    select: { id: true },
  });
  if (!tournament) return [];
  const brackets = await db.bracket.findMany({
    where: { tournamentId, published: true },
    include,
    orderBy: { createdAt: 'asc' },
  });
  const visibleTeams = new Set(
    (
      await db.team.findMany({
        where: { tournamentId, published: true, status: 'APPROVED' },
        select: { id: true },
      })
    ).map((team) => team.id),
  );
  const visibleMatch = (match: (typeof brackets)[number]['nodes'][number]['match']) =>
    !!match?.published &&
    !match.deletedAt &&
    [match.teamAId, match.teamBId].every((id) => !id || visibleTeams.has(id));
  // Publish only the explicit read model, never configuration, seed provenance, rosters, or audit data.
  return brackets.map((b) => {
    const data = withStandings({
      ...b,
      rounds: b.rounds.map(({ stage, ...round }) => ({ ...round, stageName: stage.name })),
    });
    return {
      id: b.id,
      name: b.name,
      format: b.format,
      version: b.version,
      published: true,
      rounds: data.rounds,
      entries: b.entries
        .filter((entry) => visibleTeams.has(entry.teamId))
        .map((entry) => ({
          teamId: entry.teamId,
          seed: entry.seed,
          status: entry.status,
          team: entry.team,
        })),
      standings: data.standings?.filter((row) => visibleTeams.has(row.teamId)),
      nodes: b.nodes.map((n) => ({
        id: n.id,
        bracketId: n.bracketId,
        roundId: n.roundId,
        key: n.key,
        position: n.position,
        matchNumber: n.matchNumber,
        state: n.state,
        matchId: visibleMatch(n.match) ? n.matchId : null,
        slots: n.slots.map((s) => ({
          side: s.side,
          teamId: s.teamId && visibleTeams.has(s.teamId) ? s.teamId : null,
          resolved: s.resolved && (!s.teamId || visibleTeams.has(s.teamId)),
          mode: s.mode,
          sourceNodeId: s.sourceNodeId,
          outcome: s.outcome,
        })),
        match: visibleMatch(n.match) ? n.match : null,
      })),
    };
  });
}
export async function competitionEligibilityOptions(actor: Actor): Promise<
  {
    id: string;
    name: string;
    stageIds: string[];
    teams: { teamId: string; eligible: boolean; reason: string }[];
  }[]
> {
  assertPermission(actor, 'matches.manage');
  const tournamentId = tenant(actor);
  const [brackets, teams, nodes] = await Promise.all([
    db.bracket.findMany({
      where: { tournamentId },
      include: { entries: true, rounds: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.team.findMany({ where: { tournamentId, status: 'APPROVED' }, select: { id: true } }),
    allNodes(db, tournamentId),
  ]);
  const computed = recalculateCompetition(nodes);
  return brackets.map((bracket) => {
    const path = computed.filter((n) => n.bracketId === bracket.id);
    const standings = groupStandings(
      path,
      bracket.rounds,
      bracket.entries,
      (bracket.config as { advancePerGroup?: number }).advancePerGroup || 2,
      reviewedGroupOrder(bracket, path),
    );
    return {
      id: bracket.id,
      name: bracket.name,
      stageIds: [...new Set(bracket.rounds.map((r) => r.stageId))],
      teams: teams.map((team) => {
        const entry = bracket.entries.find((e) => e.teamId === team.id);
        let reason =
          !entry ||
          ((bracket.sourceStandingId || (bracket.config as GroupConfig).sourceBracketId) &&
            !(bracket.seedOrder as string[]).includes(team.id))
            ? 'Participant is outside this path or qualifier cutoff.'
            : entry.status !== 'ACTIVE'
              ? `Participant is ${entry.status.toLowerCase()} in this path.`
              : '';
        if (!reason && competitionEliminated(path, bracket.rounds, bracket.format, team.id))
          reason = 'Participant is eliminated from this competition path.';
        const standing = standings.find((s) => s.teamId === team.id);
        if (
          !reason &&
          standing &&
          standings
            .filter((s) => s.group === standing.group)
            .every(
              (s) => s.played === standings.filter((r) => r.group === standing.group).length - 1,
            ) &&
          !standing.qualified &&
          !standing.tied
        )
          reason = 'Participant did not qualify from this group.';
        return { teamId: team.id, eligible: !reason, reason };
      }),
    };
  });
}
