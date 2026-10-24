import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import { assertTestDatabase } from '../src/lib/instance';
import { publicPage, publicPools, publicStaff } from '../src/lib/queries';
import { publicMatches } from '../src/lib/public-matches';
import { publicTeams } from '../src/lib/teams-service';
import { tournamentList } from '../src/lib/tournaments-service';
import { isPublicAsset } from '../src/lib/media-access';
import { publicCompetitionData } from '../src/lib/competition-service';

assertTestDatabase(process.env.DATABASE_URL);
const id = randomUUID();
let assetId: string, hiddenId: string, pageId: string, privateTeamId: string;
beforeAll(async () => {
  await db.tournament.create({
    data: {
      id,
      slug: `visibility-${id}`,
      name: 'Synthetic visibility',
      acronym: 'TEST',
      description: '',
    },
  });
  for (const name of ['visible', 'hidden']) {
    const asset = await db.mediaAsset.create({
      data: {
        tournamentId: id,
        key: `${randomUUID()}.webp`,
        name,
        mimeType: 'image/webp',
        size: 1,
        width: 1,
        height: 1,
      },
    });
    if (name === 'visible') assetId = asset.id;
    else hiddenId = asset.id;
  }
  const page = await db.page.create({ data: { tournamentId: id, slug: 'home', title: 'Home' } });
  pageId = page.id;
  const revision = await db.pageRevision.create({
    data: {
      tournamentId: id,
      pageId,
      title: 'Home',
      blocks: {
        create: [
          {
            type: 'richtext',
            visible: true,
            position: 0,
            content: { html: `<img src="/api/media/${assetId}">` },
          },
          {
            type: 'richtext',
            visible: false,
            position: 1,
            content: { html: `<img src="/api/media/${hiddenId}">private block` },
          },
        ],
      },
    },
  });
  await db.page.update({
    where: { id: pageId },
    data: { state: 'PUBLISHED', publishedRevisionId: revision.id },
  });
  const stage = await db.tournamentStage.create({
    data: { tournamentId: id, slug: 'stage', name: 'Stage', mappool: { create: {} } },
    include: { mappool: true },
  });
  const pool = await db.mappoolRevision.create({
    data: { tournamentId: id, mappoolId: stage.mappool!.id },
  });
  await db.mappool.update({
    where: { id: stage.mappool!.id },
    data: { state: 'PUBLISHED', publishedRevisionId: pool.id },
  });
  const team = await db.team.create({
    data: {
      tournamentId: id,
      name: 'Public team',
      slug: 'public',
      published: true,
      status: 'APPROVED',
    },
  });
  const privateTeam = await db.team.create({
    data: { tournamentId: id, name: 'Private entrant', slug: 'private', status: 'APPROVED' },
  });
  privateTeamId = privateTeam.id;
  await db.staffCategory.create({ data: { tournamentId: id, name: 'Staff' } });
  await db.match.create({
    data: {
      tournamentId: id,
      code: 'fixture',
      stageId: stage.id,
      teamAId: team.id,
      participants: {},
      rules: {},
      published: true,
    },
  });
  await db.bracket.create({
    data: {
      tournamentId: id,
      name: 'Bracket',
      format: 'SINGLE_ELIMINATION',
      generationKey: randomUUID(),
      published: true,
      config: {},
      seedOrder: [],
      entries: {
        create: [
          { teamId: team.id, seed: 1 },
          { teamId: privateTeam.id, seed: 2 },
        ],
      },
    },
  });
});
afterAll(async () => {
  await db.bracketEntry.deleteMany({ where: { tournamentId: id } });
  await db.bracket.deleteMany({ where: { tournamentId: id } });
  await db.match.deleteMany({ where: { tournamentId: id } });
  await db.team.deleteMany({ where: { tournamentId: id } });
  await db.page.updateMany({
    where: { tournamentId: id },
    data: { draftRevisionId: null, publishedRevisionId: null },
  });
  await db.mappool.updateMany({
    where: { tournamentId: id },
    data: { draftRevisionId: null, publishedRevisionId: null },
  });
  await db.mediaAsset.deleteMany({ where: { tournamentId: id } });
  await db.tournament.delete({ where: { id } });
});

it.each([
  [false, false],
  [false, true],
  [true, false],
  [true, true],
])(
  'uses the same guest gate with published=%s archived=%s without hiding organizer data',
  async (published, archived) => {
    await db.tournament.update({
      where: { id },
      data: { published, archivedAt: archived ? new Date() : null },
    });
    const visible = published && !archived;
    expect(!!(await publicPage('home', id))).toBe(visible);
    for (const read of [publicPools, publicStaff, publicCompetitionData])
      expect((await read(id)).length > 0).toBe(visible);
    expect((await publicMatches({}, id)).length > 0).toBe(visible);
    expect((await publicTeams(undefined, id)).length > 0).toBe(visible);
    expect((await tournamentList(null, true)).some((t) => t.id === id)).toBe(visible);
    expect(await isPublicAsset(assetId, id)).toBe(visible);
    expect(await isPublicAsset(hiddenId, id)).toBe(false);
    expect(await db.pageRevision.count({ where: { tournamentId: id } })).toBe(1);
    if (visible) {
      expect((await publicPage('home', id))?.blocks).toHaveLength(1);
      expect(JSON.stringify(await publicCompetitionData(id))).not.toContain(privateTeamId);
      expect(JSON.stringify(await publicCompetitionData(id))).not.toContain('Private entrant');
    }
  },
);
