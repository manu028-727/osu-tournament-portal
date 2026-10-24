import ExcelJS from 'exceljs';
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actorForTournament } from '../src/lib/auth';
import { applyCompetitionAction } from '../src/lib/competition-service';
import { competitionActionSchema } from '../src/lib/competition-validation';
import { db } from '../src/lib/db';
import { matchDiscordResult } from '../src/lib/discord-result';
import { inheritedRules } from '../src/lib/gameplay-scoring';
import { assertTestDatabase } from '../src/lib/instance';
import { matchInclude } from '../src/lib/match-record';
import type { MatchView } from '../src/lib/matches-types';
import { applyWorkbook, importApplySchema, previewWorkbook } from '../src/lib/referee-import';
import { validateSheetRecord } from '../src/lib/referee-workbook-state';
import { objectMetadata } from '../src/lib/stage-reconciliation';
import { tournamentAction } from '../src/lib/tournaments-service';
import { syntheticRecord } from './fixtures/referee-record';
import { refereeFixtureWorkbook } from './fixtures/referee-workbook';
assertTestDatabase(process.env.DATABASE_URL);
let id = '',
  userId = '',
  stageId = '',
  teamA = '',
  teamB = '';
const code = `synthetic-import-${randomUUID()}`;
const beatmapBase = randomInt(1_500_000_000, 1_900_000_000);
const ownedBeatmaps: number[] = [];
const ownedParticipants: number[] = [];
function sourceRecord(sheet = '1') {
  const record = syntheticRecord(sheet);
  record.pool = record.pool.map((map, index) => ({ ...map, beatmapId: beatmapBase + index }));
  return record;
}
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
  assertTestDatabase(process.env.DATABASE_URL);
  const [database] = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  expect(database.name).toBe('tournament_platform_test');
  userId = (
    await db.user.create({
      data: {
        osuId: randomInt(1_500_000_000, 1_900_000_000),
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
      gameplayScoring: 'SCORE_V2',
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
  for (const m of sourceRecord().pool) {
    await db.beatmap.create({
      data: {
        id: m.beatmapId,
        mode: 'osu',
        metadata: { ...metadata, id: m.beatmapId, fixture: code },
      },
    });
    ownedBeatmaps.push(m.beatmapId);
  }
  const revision = await db.mappoolRevision.create({
    data: {
      tournamentId: id,
      mappoolId: stage.mappool!.id,
      slots: {
        create: sourceRecord().pool.map((m, position) => ({
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
  assertTestDatabase(process.env.DATABASE_URL);
  if (id) await db.refereeImport.deleteMany({ where: { tournamentId: id } });
  if (id) {
    await db.bracketSlot.deleteMany({ where: { tournamentId: id } });
    await db.bracketNode.deleteMany({ where: { tournamentId: id } });
    await db.bracketEntry.deleteMany({ where: { tournamentId: id } });
    await db.bracketRound.deleteMany({ where: { tournamentId: id } });
    await db.bracket.deleteMany({ where: { tournamentId: id } });
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
  await db.participant.deleteMany({ where: { osuId: { in: ownedParticipants } } });
  await db.beatmap.deleteMany({
    where: { id: { in: ownedBeatmaps }, metadata: { path: ['fixture'], equals: code } },
  });
  expect(await db.tournament.count({ where: { id } })).toBe(0);
  expect(await db.role.count({ where: { tournamentId: id } })).toBe(0);
  expect(await db.beatmap.count({ where: { id: { in: ownedBeatmaps } } })).toBe(0);
  await db.$disconnect();
});
describe.sequential('persistent synthetic match-history import', () => {
  it('imports numbered sheets as real actions/results and reimports without duplication', async () => {
    const a = await actor(),
      preview = await previewWorkbook(
        a,
        await refereeFixtureWorkbook(['1', '25', '27'].map(sourceRecord)),
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
  it('preserves explicit source scoring declarations and refuses incompatible scores and qualifier records', async () => {
    const a = await actor();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await refereeFixtureWorkbook([sourceRecord('201')])) as never);
    workbook.getWorksheet('Settings')!.getCell('F10').value = 'ScoreV1';
    const rejected = await previewWorkbook(
      a,
      Buffer.from(await workbook.xlsx.writeBuffer()),
      'incompatible.xlsx',
    );
    expect(rejected.records[0].errors.join(' ')).toContain('Import is blocked');
    const before = await db.match.count({ where: { tournamentId: id } });
    const input = {
      sheet: '201',
      create: { stageId, teamAId: teamA, teamBId: teamB },
      reason: 'Reviewed explicit source metadata',
      confirmResults: false,
    };
    await expect(
      applyWorkbook(a, importApplySchema.parse({ ...input, importId: rejected.id })),
    ).rejects.toMatchObject({ status: 409 });
    expect(await db.match.count({ where: { tournamentId: id } })).toBe(before);
    workbook.getWorksheet('Settings')!.getCell('F10').value = 'ScoreV2';
    const accepted = await previewWorkbook(
      a,
      Buffer.from(await workbook.xlsx.writeBuffer()),
      'compatible.xlsx',
    );
    const imported = await applyWorkbook(
      a,
      importApplySchema.parse({ ...input, importId: accepted.id }),
    );
    const saved = await db.match.findUniqueOrThrow({
      where: { id: imported.id },
      include: matchInclude,
    });
    expect(saved.status).toBe('AWAITING_CONFIRMATION');
    expect(saved.source).toMatchObject({
      scoring: {
        mode: 'SCORE_V2',
        declarations: [{ sheet: 'Settings', cell: 'F10', value: 'ScoreV2' }],
      },
    });
    for (const action of saved.actions)
      expect(action.provenance).toMatchObject({
        sourceScoring: {
          mode: 'SCORE_V2',
          declarations: [{ sheet: 'Settings', cell: 'F10', value: 'ScoreV2' }],
        },
        sourceGameMode: 'osu',
        resolution: 'SOURCE',
      });
    expect(
      saved.results.every(
        (result) =>
          result.entryMode === 'WINNER_ONLY' && result.scoreA === null && result.scoreB === null,
      ),
    ).toBe(true);
    const keptResult = saved.results[0];
    await db.matchMapResult.update({
      where: { id: keptResult.id },
      data: {
        entryMode: 'SCORES',
        scoreA: 700_000,
        scoreB: 600_000,
        notes: 'Verified original website scores',
      },
    });
    const keptAction = saved.actions.find((action) => action.id === keptResult.actionId)!;
    const sourceRow = sourceRecord('201').actions[saved.actions.indexOf(keptAction)].row;
    await applyWorkbook(
      a,
      importApplySchema.parse({
        importId: accepted.id,
        sheet: '201',
        matchId: saved.id,
        baseVersion: saved.version,
        replace: true,
        confirmResults: false,
        choices: [{ row: sourceRow, use: 'WEBSITE' }],
        reason: 'Keep verified website map scores',
      }),
    );
    const preserved = await db.match.findUniqueOrThrow({
      where: { id: saved.id },
      include: matchInclude,
    });
    const keptCopy = preserved.actions.find(
      (action) =>
        !action.voided &&
        objectMetadata(action.provenance).retainedWebsiteResultId === keptResult.id,
    )!;
    expect(
      preserved.results.find((result) => !result.voided && result.actionId === keptCopy.id),
    ).toMatchObject({
      entryMode: 'SCORES',
      scoreA: 700_000,
      scoreB: 600_000,
      notes: 'Verified original website scores',
    });
    expect(preserved.results.find((result) => result.id === keptResult.id)).toMatchObject({
      voided: true,
      scoreA: 700_000,
      scoreB: 600_000,
    });
    expect(preserved.rules).toEqual(saved.rules);
    expect(preserved.status).toBe('AWAITING_CONFIRMATION');
    const qualifier = { ...sourceRecord('202'), stage: 'Qualifiers' };
    const unsupported = await previewWorkbook(
      a,
      await refereeFixtureWorkbook([qualifier]),
      'qualifiers.xlsx',
    );
    expect(unsupported.records[0].errors.join(' ')).toContain(
      'Qualifier workbook normalization is unavailable',
    );
    await expect(
      applyWorkbook(
        a,
        importApplySchema.parse({ ...input, sheet: '202', importId: unsupported.id }),
      ),
    ).rejects.toThrow('Qualifier workbook normalization is unavailable');
    expect(await db.qualifierLobby.count({ where: { tournamentId: id } })).toBe(0);
    expect(await db.match.count({ where: { tournamentId: id } })).toBe(before + 1);
  });
  it('advances confirmed native bracket imports and rejects unreviewed downstream corrections without touching children', async () => {
    const a = await actor();
    const stage = await db.tournamentStage.findUniqueOrThrow({
      where: { id: stageId },
      include: {
        mappool: { include: { publishedRevision: { include: { slots: true } } } },
      },
    });
    const rules = validateSheetRecord(
      sourceRecord(),
      inheritedRules({ teamSize: 1, freeModRequiredHD: 0, freeModRequiredHR: 0 }, 'SCORE_V2'),
      stage.mappool!.publishedRevision!.slots,
    ).rules;
    await db.tournamentStage.update({
      where: { id: stageId },
      data: { matchRules: JSON.parse(JSON.stringify(rules)) },
    });
    const otherTeams = [];
    for (const name of ['Gamma', 'Delta'])
      otherTeams.push(
        await db.team.create({
          data: {
            tournamentId: id,
            name: `Team ${name}`,
            slug: name.toLowerCase(),
            status: 'APPROVED',
          },
        }),
      );
    const teamIds = [teamA, teamB, ...otherTeams.map((team) => team.id)];
    const osuBase = randomInt(1_500_000_000, 1_900_000_000);
    for (const [index, teamId] of teamIds.entries()) {
      const participant = await db.participant.create({
        data: {
          osuId: osuBase + index,
          username: `${code}-${index}`,
          avatarUrl: '',
        },
      });
      ownedParticipants.push(participant.osuId);
      await db.teamMember.create({
        data: { tournamentId: id, teamId, osuId: participant.osuId, captain: true, position: 0 },
      });
    }
    const bracket = (await db.$transaction((tx) =>
      applyCompetitionAction(
        tx,
        a,
        competitionActionSchema.parse({
          type: 'competition.create',
          name: 'Workbook import native regression',
          generationKey: randomUUID(),
          format: 'SINGLE_ELIMINATION',
          stageId,
          teamIds,
        }),
      ),
    )) as { id: string };
    const nodes = () =>
      db.bracketNode.findMany({
        where: { bracketId: bracket.id },
        include: { slots: { orderBy: { side: 'asc' } }, match: { include: matchInclude } },
        orderBy: { key: 'asc' },
      });
    const initial = await nodes();
    const firstRound = initial.filter((node) => node.matchId);
    expect(firstRound).toHaveLength(2);
    const finalId = initial.find((node) => !node.matchId)!.id;
    const sources = [];
    for (const [index, node] of firstRound.entries()) {
      const sheet = String(101 + index);
      // Configure the source's numeric identifier on the same native match, never a duplicate.
      await db.match.update({ where: { id: node.matchId! }, data: { code: sheet } });
      const participants = objectMetadata(node.match!.participants);
      sources.push({
        ...sourceRecord(sheet),
        red: String(objectMetadata(participants.A).name),
        blue: String(objectMetadata(participants.B).name),
      });
    }
    const first = firstRound[0].matchId!;
    const firstPreview = await previewWorkbook(
      a,
      await refereeFixtureWorkbook([sources[0]]),
      'native-101.xlsx',
    );
    const firstInput = importApplySchema.parse({
      importId: firstPreview.id,
      sheet: sources[0].sheet,
      matchId: first,
      baseVersion: firstPreview.records[0].target!.version,
      reason: 'Reviewed native source',
      confirmResults: false,
      replace: true,
    });
    expect((await applyWorkbook(a, firstInput)).status).toBe('AWAITING_CONFIRMATION');
    expect(
      (await nodes()).find((node) => node.id === finalId)!.slots.every((slot) => !slot.resolved),
    ).toBe(true);
    const provisional = await db.match.findUniqueOrThrow({ where: { id: first } });
    expect(
      (
        await applyWorkbook(a, {
          ...firstInput,
          baseVersion: provisional.version,
          replace: true,
          confirmResults: true,
        })
      ).status,
    ).toBe('COMPLETED');
    expect(
      (await nodes())
        .find((node) => node.id === finalId)!
        .slots.some((slot) => slot.resolved && slot.teamId === provisional.teamAId),
    ).toBe(true);
    const secondPreview = await previewWorkbook(
      a,
      await refereeFixtureWorkbook([sources[1]]),
      'native-102.xlsx',
    );
    await applyWorkbook(
      a,
      importApplySchema.parse({
        importId: secondPreview.id,
        sheet: sources[1].sheet,
        matchId: firstRound[1].matchId!,
        baseVersion: secondPreview.records[0].target!.version,
        reason: 'Reviewed second confirmed source',
        confirmResults: true,
        replace: true,
      }),
    );
    const childBefore = (await nodes()).find((node) => node.id === finalId)!;
    expect(childBefore.matchId).toBeTruthy();
    expect(childBefore.slots.every((slot) => slot.resolved && slot.teamId)).toBe(true);
    const historyOnly = structuredClone(sources[0]);
    [historyOnly.actions[0].slotName, historyOnly.actions[1].slotName] = [
      historyOnly.actions[1].slotName,
      historyOnly.actions[0].slotName,
    ];
    const sameOutcome = await previewWorkbook(
      a,
      await refereeFixtureWorkbook([historyOnly]),
      'same-outcome.xlsx',
    );
    const sameInput = importApplySchema.parse({
      importId: sameOutcome.id,
      sheet: historyOnly.sheet,
      matchId: first,
      baseVersion: sameOutcome.records[0].target!.version,
      replace: true,
      reason: 'Reviewed same-outcome history correction',
    });
    expect((await applyWorkbook(a, sameInput)).status).toBe('COMPLETED');
    expect((await nodes()).find((node) => node.id === finalId)).toEqual(childBefore);
    const advancementCount = await db.auditLog.count({
      where: { tournamentId: id, action: 'competition.advance' },
    });
    expect((await applyWorkbook(a, sameInput)).alreadyApplied).toBe(true);
    expect(
      await db.auditLog.count({ where: { tournamentId: id, action: 'competition.advance' } }),
    ).toBe(advancementCount);
    const changedWinner = structuredClone(historyOnly);
    changedWinner.scoreA = 0;
    changedWinner.scoreB = 2;
    changedWinner.actions = changedWinner.actions.map((action) => ({
      ...action,
      winner: action.winner ? ('B' as const) : null,
    }));
    const correction = await previewWorkbook(
      a,
      await refereeFixtureWorkbook([changedWinner]),
      'changed-winner.xlsx',
    );
    const correctionInput = importApplySchema.parse({
      importId: correction.id,
      sheet: changedWinner.sheet,
      matchId: first,
      baseVersion: correction.records[0].target!.version,
      replace: true,
      confirmResults: true,
      reason: 'Attempt without separately reviewed downstream correction',
    });
    const parentBefore = await db.match.findUniqueOrThrow({
      where: { id: first },
      include: {
        ...matchInclude,
        events: { orderBy: { version: 'asc' } },
        revisions: { orderBy: { version: 'asc' } },
      },
    });
    await expect(applyWorkbook(a, correctionInput)).rejects.toMatchObject({ status: 409 });
    await expect(
      applyWorkbook(a, { ...correctionInput, confirmResults: false }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await nodes()).find((node) => node.id === finalId)).toEqual(childBefore);
    await db.match.update({
      where: { id: childBefore.matchId! },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });
    await expect(applyWorkbook(a, correctionInput)).rejects.toThrow(
      'started or completed downstream',
    );
    expect(
      await db.match.findUniqueOrThrow({
        where: { id: first },
        include: {
          ...matchInclude,
          events: { orderBy: { version: 'asc' } },
          revisions: { orderBy: { version: 'asc' } },
        },
      }),
    ).toEqual(parentBefore);
    expect(
      await db.match.count({ where: { tournamentId: id, bracketNode: { isNot: null } } }),
    ).toBe(3);
  });
});
