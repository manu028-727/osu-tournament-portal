import { randomInt, randomUUID } from 'node:crypto';
import Papa from 'papaparse';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
import { assertTestDatabase } from '../src/lib/instance';
import { teamCsvStream } from '../src/lib/teams-export';
import type { Actor } from '../src/lib/permissions';
import { publicTeams, publicTeamsPage } from '../src/lib/teams-service';
import { publicMatches, publicMatchesPage } from '../src/lib/public-matches';

assertTestDatabase(process.env.DATABASE_URL);
const id = randomUUID(),
  foreign = randomUUID(),
  firstOsuId = randomInt(1_800_000_000, 1_900_000_000);
const teamId = (index: number) => `${id}-${String(index).padStart(4, '0')}`;
const actor: Actor = {
  id: 'synthetic-export-reader',
  tournamentId: id,
  osuId: 1,
  username: 'Synthetic',
  avatarUrl: '',
  roles: [],
  permissions: ['teams.view'],
};
beforeAll(async () => {
  for (const tournamentId of [id, foreign])
    await db.tournament.create({
      data: {
        id: tournamentId,
        slug: `export-${tournamentId}`,
        name: 'Synthetic export',
        acronym: 'TEST',
        description: '',
      },
    });
  await db.participant.createMany({
    data: Array.from({ length: 501 }, (_, index) => ({
      osuId: firstOsuId + index,
      username: `Synthetic ${index}`,
      avatarUrl: '',
    })),
  });
  await db.team.createMany({
    data: Array.from({ length: 502 }, (_, index) => ({
      id: teamId(index),
      tournamentId: id,
      name: index === 0 ? '=FORMULA()' : `Export ${index}`,
      slug: `team-${index}`,
      position: 0,
    })),
  });
  await db.teamMember.createMany({
    data: Array.from({ length: 501 }, (_, index) => ({
      tournamentId: id,
      teamId: teamId(index),
      osuId: firstOsuId + index,
      captain: true,
      position: 0,
    })),
  });
  await db.team.create({
    data: { tournamentId: foreign, name: 'Foreign private team', slug: 'foreign' },
  });
  await db.tournament.update({ where: { id }, data: { published: true } });
  await db.team.updateMany({
    where: { tournamentId: id },
    data: { published: true, status: 'APPROVED' },
  });
  const stage = await db.tournamentStage.create({
    data: { tournamentId: id, slug: 'fixtures', name: 'Fixtures' },
  });
  await db.match.createMany({
    data: Array.from({ length: 501 }, (_, index) => ({
      tournamentId: id,
      code: `fixture-${String(index).padStart(4, '0')}`,
      stageId: stage.id,
      published: true,
      participants: {},
      rules: {},
    })),
  });
});
afterAll(async () => {
  await db.match.deleteMany({ where: { tournamentId: id } });
  await db.team.deleteMany({ where: { tournamentId: { in: [id, foreign] } } });
  await db.tournament.deleteMany({ where: { id: { in: [id, foreign] } } });
  await db.participant.deleteMany({ where: { osuId: { gte: firstOsuId, lt: firstOsuId + 501 } } });
});

it('paginates public lists past the old cap with deterministic tied ordering and complete compatibility reads', async () => {
  const teamIds: string[] = [],
    matchIds: string[] = [];
  for (let page = 1; page <= 11; page++) {
    const teams = await publicTeamsPage(page, id),
      matches = await publicMatchesPage({}, page, id);
    expect(teams.total).toBe(502);
    expect(matches.total).toBe(501);
    teamIds.push(...teams.items.map((row) => row.id));
    matchIds.push(...matches.items.map((row) => row.id));
    expect(matches.stages.map((stage) => stage.slug)).toEqual(['fixtures']);
  }
  expect(new Set(teamIds).size).toBe(502);
  expect(teamIds).toHaveLength(502);
  expect(new Set(matchIds).size).toBe(501);
  expect(matchIds).toHaveLength(501);
  expect(await publicTeams(undefined, id)).toHaveLength(502);
  expect(await publicMatches({}, id)).toHaveLength(501);
  expect((await publicMatchesPage({ status: 'completed' }, 1, id)).items).toEqual([]);
});

it('exports cap+1 rosters, empty teams and tied positions completely without crossing tenants', async () => {
  const csv = await new Response(teamCsvStream(actor)).text();
  expect(csv.split('\r\n')[1]).not.toBe('');
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
  expect(parsed.errors).toEqual([]);
  expect(parsed.data).toHaveLength(502);
  expect(parsed.data.map((row) => row.team_slug)).toEqual(
    Array.from({ length: 502 }, (_, index) => `team-${index}`),
  );
  expect(parsed.data[0].team_name).toBe("'=FORMULA()");
  expect(parsed.data.at(-1)?.osu_id).toBe('');
  expect(csv).not.toContain('Foreign private team');
});

it('retains a repeatable snapshot while a later batch is edited', async () => {
  const reader = teamCsvStream(actor).getReader(),
    decoder = new TextDecoder();
  let csv = decoder.decode((await reader.read()).value); // header
  csv += decoder.decode((await reader.read()).value); // first database batch establishes snapshot
  await db.team.update({ where: { id: teamId(500) }, data: { name: 'Concurrent replacement' } });
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    csv += decoder.decode(chunk.value);
  }
  expect(csv).toContain('Export 500');
  expect(csv).not.toContain('Concurrent replacement');
});

it('fails the stream on a database error instead of reporting a truncated success', async () => {
  const transaction = vi
    .spyOn(db, '$transaction')
    .mockRejectedValueOnce(new Error('Synthetic read failure'));
  try {
    await expect(new Response(teamCsvStream(actor)).text()).rejects.toThrow(
      'Synthetic read failure',
    );
  } finally {
    transaction.mockRestore();
  }
  expect(() => teamCsvStream({ ...actor, permissions: [] })).toThrow('Forbidden');
});
