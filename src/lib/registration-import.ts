import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { profileSchema } from './osu';
import { matchRulesSchema } from './match-rules';
import { teamInclude } from './teams-service';
import { rosterSnapshot, matchInclude } from './matches-service';
import { slugify } from './utils';
import type { RegistrationImport } from './registration-validation';
import { scopedDb } from './scoped-db';
export { registrationImportSchema } from './registration-validation';
const json = (data: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(data));
export async function importRegistrations(
  tx: Prisma.TransactionClient,
  source: RegistrationImport,
  profiles: z.infer<typeof profileSchema>[],
  tournamentId: string,
  namespace: string,
) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(namespace)) throw new Error('Choose an import namespace.');
  tx = scopedDb(tx, tournamentId);
  const byId = new Map(profiles.map((p) => [p.id, p]));
  for (const team of source.teams)
    for (const player of team.members)
      if (!byId.has(player.osuId))
        throw new Error(`Missing verified osu! profile: ${player.osuId}`);
  const settings = await tx.tournamentSettings.findUniqueOrThrow({
    where: { tournamentId },
  });
  const stages = await tx.tournamentStage.findMany({
    include: { mappool: { select: { state: true, publishedRevisionId: true } } },
  });
  const teams = new Map<string, Prisma.TeamGetPayload<{ include: typeof teamInclude }>>();
  let createdTeams = 0,
    createdMatches = 0;
  for (const entry of source.teams) {
    const sourceKey = `${tournamentId}:${namespace}:team:${entry.registrationOrder}`;
    let team = await tx.team.findUnique({ where: { sourceKey }, include: teamInclude });
    if (!team) {
      for (const player of entry.members) {
        const p = byId.get(player.osuId)!;
        await tx.participant.upsert({
          where: { osuId: p.id },
          create: {
            osuId: p.id,
            username: p.username,
            avatarUrl: p.avatar_url,
            country: p.country_code,
          },
          update: {},
        });
      }
      team = await tx.team.create({
        data: {
          sourceKey,
          name: entry.name,
          slug: `${slugify(entry.name) || 'team'}-${entry.registrationOrder}`,
          seed: entry.seed,
          qualifierPlayed: entry.seed !== null,
          rankSum: entry.rankSum,
          position: entry.seed === null ? 100 + entry.registrationOrder : entry.seed - 1,
          status: 'APPROVED',
          published: true,
          members: {
            create: entry.members.map((m, position) => ({
              osuId: m.osuId,
              registrationRank: m.rank,
              registeredUsername: m.username,
              position,
              captain: position === 0,
              substitute: false,
            })),
          },
        },
        include: teamInclude,
      });
      createdTeams++;
    }
    teams.set(entry.name, team);
  }
  for (const entry of source.matches) {
    const sourceKey = `${tournamentId}:${namespace}:match:${entry.number}`;
    if (await tx.match.findUnique({ where: { sourceKey } })) continue;
    const stage = stages.find((s) => s.name === entry.stage);
    if (!stage) throw new Error(`Missing existing stage: ${entry.stage}`);
    const teamA = teams.get(entry.red),
      teamB = teams.get(entry.blue);
    const completed = entry.scoreRed !== null;
    const rules = matchRulesSchema.parse(stage.matchRules || settings.matchRules);
    if (completed) rules.bestOf = 2 * Math.max(entry.scoreRed!, entry.scoreBlue!) - 1;
    else if (!stage.matchRules && source.stageBestOf[entry.stage])
      rules.bestOf = source.stageBestOf[entry.stage];
    const placeholder = (name: string) => ({
      id: null,
      name,
      slug: '',
      format: 'TEAM',
      logoImageId: null,
      members: [],
    });
    const scoreA = Math.max(0, entry.scoreRed || 0),
      scoreB = Math.max(0, entry.scoreBlue || 0);
    const mp = /^https:\/\/osu\.ppy\.sh\/(?:community\/matches|mp)\/(\d+)$/.exec(entry.lobbyUrl);
    if (entry.lobbyUrl && !mp) throw new Error(`Invalid lobby link: ${entry.number}`);
    const created = await tx.match.create({
      data: {
        sourceKey,
        code: String(entry.number),
        stageId: stage.id,
        teamAId: teamA?.id,
        teamBId: teamB?.id,
        poolRevisionId:
          stage.mappool?.state === 'PUBLISHED' ? stage.mappool.publishedRevisionId : null,
        participants: json({
          A: teamA ? rosterSnapshot(teamA) : placeholder(entry.red),
          B: teamB ? rosterSnapshot(teamB) : placeholder(entry.blue),
        }),
        rules: json(rules),
        status: completed ? 'COMPLETED' : 'SCHEDULED',
        resultMode: completed ? 'SUMMARY' : 'MAPS',
        published: true,
        bracket: entry.bracket,
        scheduledAt: entry.scheduledAt,
        scoreA,
        scoreB,
        winnerSide: completed ? (scoreA > scoreB ? 'A' : 'B') : null,
        forfeitSide: entry.scoreRed === -1 ? 'A' : entry.scoreBlue === -1 ? 'B' : null,
        lobbyUrl: mp ? `https://osu.ppy.sh/community/matches/${mp[1]}` : '',
        multiplayerId: mp ? Number(mp[1]) : null,
        source: json({
          ...entry,
          sheetUrl: source.sheetUrl,
          kind: 'organizer-import',
          timeZone: source.timeZone,
        }),
        notes: completed
          ? 'Historical result supplied by the organizer. Per-map scores and exact completion time were not supplied.'
          : 'Scheduled fixture; date and unresolved opponents are to be confirmed.',
        events: {
          create: { version: 1, kind: 'match.import', notes: source.source, data: json(entry) },
        },
      },
      include: matchInclude,
    });
    if (completed)
      await tx.matchResultRevision.create({
        data: {
          matchId: created.id,
          version: 1,
          kind: 'match.import',
          reason: 'Organizer-supplied historical result; no per-map score data invented.',
          snapshot: json(created),
        },
      });
    await tx.auditLog.create({
      data: {
        action: 'match.import',
        entityType: 'match',
        entityId: created.id,
        details: { sourceKey, published: true, scoreA, scoreB },
      },
    });
    createdMatches++;
  }
  if (createdTeams || createdMatches)
    await tx.auditLog.create({
      data: {
        action: 'registration.import',
        entityType: 'tournament',
        entityId: tournamentId,
        details: { createdTeams, createdMatches, source: source.sheetUrl },
      },
    });
  const nav = settings.navigation as { label: string; href: string }[];
  if ((createdTeams || createdMatches) && !nav.some((item) => item.href === '/matches'))
    await tx.tournamentSettings.update({
      where: { tournamentId },
      data: { navigation: [...nav, { label: 'Matches', href: '/matches' }] },
    });
  return {
    createdTeams,
    createdMatches,
    sourceTeams: source.teams.length,
    sourceMatches: source.matches.length,
  };
}
