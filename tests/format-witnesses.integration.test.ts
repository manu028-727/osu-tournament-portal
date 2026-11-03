import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import { assertTestDatabase } from '../src/lib/instance';
import {
  LEGACY_QUALIFIER_CALCULATION_VERSION,
  PREVIOUS_QUALIFIER_CALCULATION_VERSION,
} from '../src/lib/qualifier-seeding';
import { loadQualifierCalculation } from '../src/lib/qualifier-standings-sources';

// Captured from `b974d8c`. Unlike the pure witnesses this reads real rows, so a new
// QualifierScore, QualifierGame or lobby column that leaks into the source hash fails
// here instead of hiding public standings and blocking bracket starts after a deploy.
// Never update a value to make this pass: project the new column out of the old hash.
const tournamentId = 'witness-fixed-tournament';
const stageId = 'witness-fixed-stage';
const poolId = 'witness-fixed-pool';
const revisionId = 'witness-fixed-revision';
const lobbyId = 'witness-fixed-lobby';
const fixed = new Date('2026-10-01T12:00:00.000Z');
const entrants = [
  { teamId: 'witness-team-1', name: 'Witness One', osuIds: [1_690_000_011, 1_690_000_012] },
  { teamId: 'witness-team-2', name: 'Witness Two', osuIds: [1_690_000_021, 1_690_000_022] },
];
const osuIds = entrants.flatMap((entrant) => entrant.osuIds);
const beatmapIds = [1_690_100_001, 1_690_100_002];
// Literal saved JSON: a rule default added later must not alter what a lobby stored.
const savedRules = {
  gameplayScoring: 'SCORE_V2',
  scoreMode: 'SCORE_V2',
  multiplierMode: 'NONE',
  teamSize: 2,
};
const savedPolicy = {
  method: 'Z_SUM',
  runs: 2,
  runSelection: 'BEST_PER_MAP',
  requiredPlayers: 2,
  teamAggregation: 'SUM',
  rawAggregation: 'TOTAL',
};

async function purge() {
  const where = { tournamentId };
  await db.qualifierStanding.deleteMany({ where });
  await db.qualifierLobby.deleteMany({ where });
  await db.mappool.updateMany({
    where,
    data: { publishedRevisionId: null, draftRevisionId: null },
  });
  await db.mappoolSlot.deleteMany({ where: { revision: where } });
  await db.mappoolRevision.deleteMany({ where });
  await db.mappool.deleteMany({ where });
  await db.tournamentStage.deleteMany({ where });
  await db.team.deleteMany({ where });
  await db.tournament.deleteMany({ where: { id: tournamentId } });
  await db.participant.deleteMany({ where: { osuId: { in: osuIds } } });
  await db.beatmap.deleteMany({ where: { id: { in: beatmapIds } } });
}

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL);
  await purge();
  await db.tournament.create({
    data: {
      id: tournamentId,
      slug: tournamentId,
      name: 'Witness',
      acronym: 'WIT',
      description: '',
      settings: {
        create: {
          gameplayScoring: 'SCORE_V2',
          socialLinks: [],
          importantDates: [],
          navigation: [],
          footer: '',
          matchRules: savedRules,
        },
      },
    },
  });
  await db.tournamentStage.create({
    data: {
      id: stageId,
      tournamentId,
      name: 'Qualifiers',
      slug: 'qualifiers',
      kind: 'QUALIFIERS',
      qualifierPolicy: savedPolicy,
    },
  });
  await db.mappool.create({ data: { id: poolId, tournamentId, stageId } });
  await db.mappoolRevision.create({ data: { id: revisionId, tournamentId, mappoolId: poolId } });
  for (const [index, beatmapId] of beatmapIds.entries()) {
    await db.beatmap.create({ data: { id: beatmapId, mode: 'osu', metadata: {} } });
    await db.mappoolSlot.create({
      data: {
        revisionId,
        name: `NM${index + 1}`,
        category: 'NM',
        categoryName: 'No Mod',
        color: '#ffffff',
        position: index,
        beatmapId,
        metadata: {},
      },
    });
  }
  await db.mappool.update({
    where: { id: poolId },
    data: { state: 'PUBLISHED', publishedRevisionId: revisionId },
  });
  for (const osuId of osuIds)
    await db.participant.create({ data: { osuId, username: `witness-${osuId}`, avatarUrl: '' } });
  for (const entrant of entrants) {
    await db.team.create({
      data: {
        id: entrant.teamId,
        tournamentId,
        name: entrant.name,
        slug: entrant.teamId,
        status: 'APPROVED',
        format: 'TEAM',
      },
    });
    await db.teamMember.createMany({
      data: entrant.osuIds.map((osuId, position) => ({
        tournamentId,
        teamId: entrant.teamId,
        osuId,
        position,
        captain: position === 0,
      })),
    });
  }
  await db.qualifierLobby.create({
    data: {
      id: lobbyId,
      tournamentId,
      code: 'WITNESS-Q1',
      stageId,
      poolRevisionId: revisionId,
      status: 'COMPLETED',
      rules: savedRules,
      policy: savedPolicy,
      gameplayScoring: 'SCORE_V2',
      createdAt: fixed,
      updatedAt: fixed,
      participants: entrants.map((entrant) => ({
        id: entrant.teamId,
        name: entrant.name,
        members: entrant.osuIds.map((osuId) => ({ osuId })),
      })),
    },
  });
  await db.qualifierEntry.createMany({
    data: entrants.map((entrant, position) => ({
      tournamentId,
      lobbyId,
      teamId: entrant.teamId,
      position,
    })),
  });
  await db.qualifierGame.create({
    data: {
      id: 'witness-game-1',
      lobbyId,
      multiplayerId: 555,
      gameId: '9001',
      run: 1,
      slotName: 'NM1',
      startedAt: fixed,
      evidence: { beatmap_id: beatmapIds[0], scores: [] },
      status: 'ACCEPTED',
      reason: '',
      createdAt: fixed,
      updatedAt: fixed,
    },
  });
  await db.qualifierScore.createMany({
    data: entrants.flatMap((entrant, e) =>
      entrant.osuIds.flatMap((osuId, p) =>
        [1, 2].flatMap((run) =>
          ['NM1', 'NM2'].map((slotName, m) => {
            const raw = 500_000 + e * 111_111 + p * 22_222 + run * 3_333 + m * 444;
            return {
              id: `witness-score-${osuId}-${slotName}-${run}`,
              lobbyId,
              osuId,
              slotName,
              run,
              raw,
              adjusted: raw,
              mods: ['NF'],
              actualScoring: 'SCORE_V2',
              representation: 'LEGACY',
              source: 'IMPORT',
              gameId: run === 1 && slotName === 'NM1' ? '555:9001' : null,
              verified: true,
              updatedAt: fixed,
            };
          }),
        ),
      ),
    ),
  });
});
afterAll(async () => {
  await purge();
  await db.$disconnect();
});

describe('qualifier source hashes read from stored rows', () => {
  it('keeps the current calculation witness', async () => {
    const { calculation } = await loadQualifierCalculation(db, stageId, tournamentId);
    expect(calculation.canFinalize).toBe(true);
    expect(calculation.rows.map((row) => [row.name, row.seed])).toEqual([
      ['Witness Two', 1],
      ['Witness One', 2],
    ]);
    expect(calculation.sourceHash).toMatchInlineSnapshot(
      `"321ade86f9c37042aab14843df51ec65f46923b0db27bbf72e980b99d9248e5e"`,
    );
  });

  it('keeps both historical calculation witnesses', async () => {
    const hashes = [];
    for (const version of [
      LEGACY_QUALIFIER_CALCULATION_VERSION,
      PREVIOUS_QUALIFIER_CALCULATION_VERSION,
    ])
      hashes.push(
        (await loadQualifierCalculation(db, stageId, tournamentId, version)).calculation.sourceHash,
      );
    expect(hashes).toMatchInlineSnapshot(`
      [
        "576e53bbed27c47f3d6cbd6ad7639aefbfdca395ec460a20313fcfaedff024f0",
        "52e1b755083e819f6ba1b12b882363f7f9c50271bd6423f5fc92da701019acf1",
      ]
    `);
  });
});
