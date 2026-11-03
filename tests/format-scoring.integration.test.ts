import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executeAction } from '../src/lib/admin-service';
import { actorForTournament } from '../src/lib/auth';
import { db } from '../src/lib/db';
import { rulesHash } from '../src/lib/match-record';
import { matchRulesSchema } from '../src/lib/match-rules';
import type { Actor } from '../src/lib/permissions';
import { qualifierPolicySchema } from '../src/lib/qualifier-policy';
import { loadQualifierCalculation } from '../src/lib/qualifier-standings-sources';
import { tournamentAction } from '../src/lib/tournaments-service';
import { actionSchema } from '../src/lib/validation';

// Saved settings do not prove support: these run real actions and read stored rows back.
const prefix = `format-scoring-${Date.now()}`;
const offset = Date.now() % 1_000_000;
const osuIds = [961000001, 961000002, 961000003, 961000004].map((id) => id + offset);
const beatmapIds = [962000001, 962000002, 962000003].map((id) => id + offset);
const tournamentIds: string[] = [];
let userId: string;
let base: Actor;
let actor: Actor;
let teamA: string;
let teamB: string;

const act = (who: Actor, input: unknown) => executeAction(who, actionSchema.parse(input));
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

async function createTournament(slug: string) {
  const { id } = await tournamentAction(base, {
    type: 'create',
    name: prefix,
    acronym: 'FMT',
    slug: `${prefix}-${slug}`,
    description: '',
    gameMode: 'osu',
    format: 'TEAMS',
    gameplayScoring: 'SCORE_V2',
  });
  tournamentIds.push(id);
  return { ...base, tournamentId: id };
}

async function stageWithPool(
  tournamentId: string,
  name: string,
  kind: 'ELIMINATION' | 'QUALIFIERS',
  extra: Record<string, unknown> = {},
) {
  const stage = await db.tournamentStage.create({
    data: { tournamentId, name, slug: name.toLowerCase(), kind, ...extra },
  });
  const pool = await db.mappool.create({ data: { tournamentId, stageId: stage.id } });
  const revision = await db.mappoolRevision.create({ data: { tournamentId, mappoolId: pool.id } });
  for (const [position, slot] of ['NM1', 'NM2', 'TB'].entries())
    await db.mappoolSlot.create({
      data: {
        revisionId: revision.id,
        name: slot,
        category: slot.replace(/\d+$/, ''),
        categoryName: slot,
        color: '#90bdf4',
        position,
        beatmapId: beatmapIds[position],
        metadata: {},
      },
    });
  await db.mappool.update({
    where: { id: pool.id },
    data: { state: 'PUBLISHED', publishedRevisionId: revision.id, draftRevisionId: revision.id },
  });
  return { stageId: stage.id, revisionId: revision.id };
}

async function entrants(tournamentId: string) {
  const team = async (name: string, members: number[]) => {
    const created = await db.team.create({
      data: { tournamentId, name, slug: name.toLowerCase(), status: 'APPROVED' },
    });
    await db.teamMember.createMany({
      data: members.map((osuId, position) => ({
        tournamentId,
        teamId: created.id,
        osuId,
        position,
        captain: position === 0,
      })),
    });
    return created;
  };
  teamA = (await team('Alpha', osuIds.slice(0, 2))).id;
  teamB = (await team('Bravo', osuIds.slice(2, 4))).id;
}

beforeAll(async () => {
  if (new URL(process.env.DATABASE_URL!).pathname !== '/tournament_platform_test')
    throw Error('Test database only.');
  const user = await db.user.create({
    data: {
      osuId: 960000001 + offset,
      username: prefix,
      avatarUrl: '',
      profileUrl: '',
      platformAdmin: true,
    },
    include: { roles: { include: { role: { include: { permissions: true } } } } },
  });
  userId = user.id;
  base = actorForTournament(user, 'main');
  for (const osuId of osuIds)
    await db.participant.create({ data: { osuId, username: `p${osuId}`, avatarUrl: '' } });
  for (const id of beatmapIds) await db.beatmap.create({ data: { id, mode: 'osu', metadata: {} } });
  actor = await createTournament('main');
  await entrants(actor.tournamentId!);
});

afterAll(async () => {
  const where = { tournamentId: { in: tournamentIds } };
  await db.qualifierStanding.deleteMany({ where });
  await db.qualifierLobby.deleteMany({ where });
  await db.match.deleteMany({ where });
  await db.mappool.updateMany({
    where,
    data: { publishedRevisionId: null, draftRevisionId: null },
  });
  await db.mappoolSlot.deleteMany({ where: { revision: where } });
  await db.mappoolRevision.deleteMany({ where });
  await db.mappool.deleteMany({ where });
  await db.tournamentStage.deleteMany({ where });
  await db.team.deleteMany({ where });
  await db.auditLog.deleteMany({ where });
  await db.role.deleteMany({ where });
  await db.tournament.deleteMany({ where: { id: { in: tournamentIds } } });
  await db.participant.deleteMany({ where: { osuId: { in: osuIds } } });
  await db.beatmap.deleteMany({ where: { id: { in: beatmapIds } } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

describe.sequential('win conditions through real actions', () => {
  it('starts a new tournament from neutral rules', async () => {
    const settings = await db.tournamentSettings.findUniqueOrThrow({
      where: { tournamentId: actor.tournamentId! },
    });
    const rules = matchRulesSchema.parse(settings.matchRules);
    expect(rules.multiplierMode).toBe('NONE');
    expect(rules.modMultipliers).toEqual({});
    expect(rules.latePolicy).toBe('');
    expect(rules.disconnectPolicy).toBe('');
    expect(rules.winCondition.metric).toBe('SCORE');
  });

  it('asks for no FreeMod quota a solo entrant could never meet', async () => {
    const { id } = await tournamentAction(base, {
      type: 'create',
      name: prefix,
      acronym: 'FMT',
      slug: `${prefix}-solo`,
      description: '',
      gameMode: 'osu',
      format: 'SOLO',
      gameplayScoring: 'SCORE_V2',
    });
    tournamentIds.push(id);
    const settings = await db.tournamentSettings.findUniqueOrThrow({ where: { tournamentId: id } });
    expect(matchRulesSchema.parse(settings.matchRules)).toMatchObject({
      freeModRequiredHD: 0,
      freeModRequiredHR: 0,
    });
  });

  it('decides a ScoreV2 Relax map on stored team average accuracy', async () => {
    const tournamentId = actor.tournamentId!;
    const { stageId } = await stageWithPool(tournamentId, 'Finals', 'ELIMINATION');
    await act(actor, {
      type: 'match.rules.save',
      stageId,
      baseHash: rulesHash(null),
      rules: {
        ...matchRulesSchema.parse({ teamSize: 2, bestOf: 3, bansPerTeam: 0, banOrder: 'ABAB' }),
        multiplierMode: 'LEGACY_PRODUCT',
        modMultipliers: { EZ: 2 },
        winCondition: { metric: 'ACCURACY', teamAggregation: 'AVERAGE', applyMultipliers: false },
        requiredMods: ['RX'],
        enforceNoFail: false,
      },
    });
    const stage = await db.tournamentStage.findUniqueOrThrow({ where: { id: stageId } });
    expect(matchRulesSchema.parse(stage.matchRules)).toMatchObject({
      scoreMode: 'SCORE_V2',
      winCondition: { metric: 'ACCURACY' },
    });

    const created = (await act(actor, {
      type: 'match.create',
      code: `${prefix}-1`,
      stageId,
      teamAId: teamA,
      teamBId: teamB,
      refereeIds: [],
    })) as { id: string };
    const frozen = await db.match.findUniqueOrThrow({ where: { id: created.id } });
    expect(matchRulesSchema.parse(frozen.rules).winCondition.metric).toBe('ACCURACY');

    await act(actor, { type: 'match.start', id: created.id, baseVersion: 1 });
    await act(actor, {
      type: 'match.roll',
      id: created.id,
      baseVersion: 2,
      rollA: 90,
      rollB: 1,
      firstPickSide: 'A',
      firstBanSide: 'A',
    });
    await act(actor, {
      type: 'match.draft',
      id: created.id,
      baseVersion: 3,
      kind: 'PICK',
      side: 'A',
      slotName: 'NM1',
    });
    const picked = await db.matchMapAction.findFirstOrThrow({
      where: { matchId: created.id, kind: 'PICK' },
    });
    await act(actor, {
      type: 'match.score',
      id: created.id,
      baseVersion: 4,
      actionId: picked.id,
      scoreA: 0,
      scoreB: 0,
      reason: 'Accuracy decides this map',
      players: [
        // EZ's 2x multiplier would let Alpha win if accuracy were ever multiplied.
        { osuId: osuIds[0], side: 'A', score: 100, accuracy: 96.1234, mods: ['RX', 'EZ'] },
        { osuId: osuIds[1], side: 'A', score: 100, accuracy: 93.5, mods: ['RX'] },
        { osuId: osuIds[2], side: 'B', score: 900000, accuracy: 97.25, mods: ['RX'] },
        { osuId: osuIds[3], side: 'B', score: 900000, accuracy: 95.0005, mods: ['RX'] },
      ],
    });
    const result = await db.matchMapResult.findFirstOrThrow({
      where: { matchId: created.id },
      include: { playerScores: { orderBy: { osuId: 'asc' } } },
    });
    expect(result.scoreA).toBeCloseTo(94.8117, 10);
    expect(result.scoreB).toBeCloseTo(96.12525, 10);
    expect(result.winnerSide).toBe('B');
    // Raw score stays as evidence and is not replaced by the deciding metric.
    expect(result.playerScores[0]).toMatchObject({ score: 100, accuracy: 96.1234 });
    expect((await db.match.findUniqueOrThrow({ where: { id: created.id } })).scoreB).toBe(1);
  });

  it('accepts decimal team accuracy from aggregate entry', async () => {
    const match = await db.match.findFirstOrThrow({
      where: { code: `${prefix}-1` },
      include: { actions: true },
    });
    const next = match.version;
    await act(actor, {
      type: 'match.draft',
      id: match.id,
      baseVersion: next,
      kind: 'PICK',
      side: 'B',
      slotName: 'NM2',
    });
    const picked = await db.matchMapAction.findFirstOrThrow({
      where: { matchId: match.id, slotName: 'NM2' },
    });
    await act(actor, {
      type: 'match.score',
      id: match.id,
      baseVersion: next + 1,
      actionId: picked.id,
      scoreA: 98.7654,
      scoreB: 98.7653,
      reason: 'Team totals from the sheet',
      players: [],
    });
    const result = await db.matchMapResult.findUniqueOrThrow({ where: { actionId: picked.id } });
    expect(result).toMatchObject({ scoreA: 98.7654, scoreB: 98.7653, winnerSide: 'A' });
  });

  it('keeps the win condition when tournament scoring rewrites an unplayed snapshot', async () => {
    const who = await createTournament('rewrite');
    const tournamentId = who.tournamentId!;
    const stage = await db.tournamentStage.create({
      data: { tournamentId, name: 'Final', slug: 'final' },
    });
    const match = await db.match.create({
      data: {
        tournamentId,
        code: '1',
        stageId: stage.id,
        participants: {},
        rules: json(
          matchRulesSchema.parse({
            gameplayScoring: 'SCORE_V2',
            winCondition: {
              metric: 'ACCURACY',
              teamAggregation: 'AVERAGE',
              applyMultipliers: false,
            },
          }),
        ),
      },
    });
    const tournament = await db.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
      include: { settings: true },
    });
    await act(who, {
      ...tournament,
      ...tournament.settings,
      type: 'settings.save',
      baseVersion: tournament.version,
      gameplayScoring: 'SCORE_V1',
    });
    const updated = await db.match.findUniqueOrThrow({ where: { id: match.id } });
    expect(matchRulesSchema.parse(updated.rules)).toMatchObject({
      scoreMode: 'SCORE',
      gameplayScoring: 'SCORE_V1',
      winCondition: { metric: 'ACCURACY' },
    });
  });
});

describe.sequential('qualifier metrics through real actions', () => {
  it('stores accuracy evidence and seeds on it under its own calculation version', async () => {
    const who = await createTournament('qualifier');
    const tournamentId = who.tournamentId!;
    await entrants(tournamentId);
    const policy = qualifierPolicySchema.parse({
      method: 'PERCENT_MAX',
      metric: 'ACCURACY',
      teamAggregation: 'AVERAGE',
      requiredPlayers: 2,
    });
    const { stageId } = await stageWithPool(tournamentId, 'Qualifiers', 'QUALIFIERS', {
      qualifierPolicy: json(policy),
    });
    const lobby = (await act(who, {
      type: 'qualifier.create',
      code: `${prefix}-q`,
      stageId,
      teamIds: [teamA, teamB],
      scheduledAt: new Date().toISOString(),
      refereeIds: [userId],
      notes: '',
    })) as { id: string };
    await act(who, {
      type: 'qualifier.status',
      id: lobby.id,
      baseVersion: 1,
      command: 'START',
      reason: 'Begin the lobby',
    });
    const record = async (slotName: string, values: [number, number, number, number]) => {
      const current = await db.qualifierLobby.findUniqueOrThrow({ where: { id: lobby.id } });
      await act(who, {
        type: 'qualifier.scores',
        id: lobby.id,
        baseVersion: current.version,
        slotName,
        run: 1,
        representation: 'LEGACY',
        reason: 'Record the map',
        scores: osuIds.map((osuId, index) => ({
          osuId,
          raw: 500000 + index,
          accuracy: values[index],
          mods: ['NF'],
        })),
      });
    };
    await record('NM1', [99.5, 98.5, 90.25, 90.75]);
    await record('NM2', [80, 80, 100, 100]);
    await record('TB', [90, 90, 90, 90]);
    const stored = await db.qualifierScore.findFirstOrThrow({
      where: { lobbyId: lobby.id, osuId: osuIds[0], slotName: 'NM1' },
    });
    expect(stored).toMatchObject({ raw: 500000, accuracy: 99.5, adjusted: 99.5 });
    const { calculation } = await loadQualifierCalculation(db, stageId, tournamentId);
    expect(calculation.calculationVersion).toBe('qualifier-seeding/4');
    const alpha = calculation.rows.find((row) => row.name === 'Alpha')!;
    // NM1 99/99, NM2 80/100, TB 90/90 as percentages of each map's best team average.
    expect(alpha.value).toBeCloseTo(100 + 80 + 100, 10);
    expect(alpha.selected.find((map) => map.slotName === 'NM1')?.score).toBe(99);
  });
});
