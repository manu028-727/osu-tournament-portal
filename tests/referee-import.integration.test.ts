import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { db } from '../src/lib/db';
import { actorForTournament } from '../src/lib/auth';
import { tournamentAction } from '../src/lib/tournaments-service';
import { previewWorkbook, applyWorkbook, importApplySchema } from '../src/lib/referee-import';
import { syntheticRecord } from './fixtures/referee-record';
import { refereeFixtureWorkbook } from './fixtures/referee-workbook';
import { matchDiscordResult } from '../src/lib/discord-result';
import { matchInclude } from '../src/lib/matches-service';
import type { MatchView } from '../src/lib/matches-types';
let id = '',
  userId = '',
  stageId = '',
  teamA = '',
  teamB = '';
const code = `synthetic-import-${Date.now()}`;
async function actor() {
  return actorForTournament(
    await db.user.findUniqueOrThrow({
      where: { id: userId },
      include: { roles: { include: { role: { include: { permissions: true } } } } },
    }),
    id,
  );
}
beforeAll(async () => {
  expect(new URL(process.env.DATABASE_URL!).pathname).toBe('/tournament_platform_test');
  userId = (
    await db.user.create({
      data: {
        osuId: 990100001,
        username: code,
        avatarUrl: '',
        profileUrl: '',
        platformAdmin: true,
      },
    })
  ).id;
  id = (
    await tournamentAction(await actor(), {
      type: 'create',
      name: code,
      acronym: 'TEST',
      slug: code,
      description: '',
      gameMode: 'osu',
      timezone: 'UTC',
      format: 'SOLO',
    })
  ).id;
  const stage = await db.tournamentStage.create({
    data: { tournamentId: id, name: 'Test Round', slug: 'test-round', mappool: { create: {} } },
    include: { mappool: true },
  });
  stageId = stage.id;
  const metadata = {
    id: 900000001,
    mode: 'osu',
    title: 'Synthetic map',
    artist: 'Test',
    mapper: 'Test',
    difficulty: 'Test',
    stars: 1,
    bpm: 100,
    length: 60,
    ar: 5,
    cs: 4,
    od: 5,
    hp: 5,
    cover: '',
    url: 'https://osu.ppy.sh/beatmaps/900000001',
  };
  for (const m of syntheticRecord().pool)
    await db.beatmap.upsert({
      where: { id: m.beatmapId },
      create: { id: m.beatmapId, mode: 'osu', metadata: { ...metadata, id: m.beatmapId } },
      update: {},
    });
  const revision = await db.mappoolRevision.create({
    data: {
      tournamentId: id,
      mappoolId: stage.mappool!.id,
      slots: {
        create: syntheticRecord().pool.map((m, position) => ({
          name: m.name,
          category: m.name.replace(/\d+$/, ''),
          categoryName: 'Test',
          color: '#a6c7ef',
          position,
          beatmapId: m.beatmapId,
          metadata: { ...metadata, id: m.beatmapId },
        })),
      },
    },
  });
  await db.mappool.update({
    where: { id: stage.mappool!.id },
    data: { state: 'PUBLISHED', publishedRevisionId: revision.id },
  });
  teamA = (
    await db.team.create({
      data: { tournamentId: id, name: 'Team Alpha', slug: 'alpha', status: 'APPROVED' },
    })
  ).id;
  teamB = (
    await db.team.create({
      data: { tournamentId: id, name: 'Team Beta', slug: 'beta', status: 'APPROVED' },
    })
  ).id;
});
afterAll(async () => {
  if (id) await db.refereeImport.deleteMany({ where: { tournamentId: id } });
  if (id) {
    await db.match.deleteMany({ where: { tournamentId: id } });
    await db.team.deleteMany({ where: { tournamentId: id } });
    await db.mappool.updateMany({
      where: { tournamentId: id },
      data: { publishedRevisionId: null, draftRevisionId: null },
    });
    await db.page.updateMany({
      where: { tournamentId: id },
      data: { draftRevisionId: null, publishedRevisionId: null },
    });
    await db.auditLog.deleteMany({ where: { tournamentId: id } });
    await db.role.deleteMany({ where: { tournamentId: id } });
    await db.tournament.delete({ where: { id } });
  }
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});
describe('persistent synthetic match-history import', () => {
  it('imports numbered sheets as real actions/results and reimports without duplication', async () => {
    const a = await actor(),
      preview = await previewWorkbook(
        a,
        await refereeFixtureWorkbook(['1', '25', '27'].map(syntheticRecord)),
        'synthetic.xlsx',
      );
    expect(preview.records).toHaveLength(3);
    for (const sheet of ['1', '25', '27']) {
      const imported = await applyWorkbook(
        a,
        importApplySchema.parse({
          importId: preview.id,
          sheet,
          create: { stageId, teamAId: teamA, teamBId: teamB },
          reason: 'Synthetic reviewed history',
          confirmResults: true,
        }),
      );
      const m = await db.match.findUniqueOrThrow({
        where: { id: imported.id },
        include: matchInclude,
      });
      expect(m.actions.filter((a) => !a.voided)).toHaveLength(6);
      expect(m.results.filter((r) => !r.voided)).toHaveLength(2);
      expect(m.scoreA).toBe(2);
      expect(m.scoreB).toBe(0);
      expect(m.status).toBe('COMPLETED');
      expect(m.lobbyUrl).toBe('https://osu.ppy.sh/community/matches/100');
      expect(matchDiscordResult(JSON.parse(JSON.stringify(m)) as MatchView)).toContain(
        'Team Alpha',
      );
      const repeated = await applyWorkbook(
        a,
        importApplySchema.parse({
          importId: preview.id,
          sheet,
          matchId: m.id,
          baseVersion: m.version,
          reason: 'Repeat verification',
          confirmResults: true,
        }),
      );
      expect(repeated.alreadyApplied).toBe(true);
    }
    expect(await db.match.count({ where: { tournamentId: id } })).toBe(3);
    expect(await db.matchMapAction.count({ where: { match: { tournamentId: id } } })).toBe(18);
  });
});
