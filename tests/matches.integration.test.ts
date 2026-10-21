import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { db } from '../src/lib/db';
import { executeAction } from '../src/lib/admin-service';
import { actionSchema } from '../src/lib/validation';
import {
  assertMatchActionPermission,
  matchData,
  matchOptions,
  rulesHash,
} from '../src/lib/matches-service';
import { matchRulesSchema } from '../src/lib/match-rules';
import { qualifierData } from '../src/lib/qualifiers-service';
import { matchDiscordResult } from '../src/lib/discord-result';
import type { MatchView } from '../src/lib/matches-types';
import { type Actor, type PermissionKey } from '../src/lib/permissions';
const prefix = `ref-${Date.now()}`;
let owner: Actor,
  referee: Actor,
  outsider: Actor,
  guest: Actor,
  stageId: string,
  poolId: string,
  revisionId: string,
  matchId: string,
  teamAId: string,
  teamBId: string;
const userIds: string[] = [];
const qualifierStageIds: string[] = [];
const act = (actor: Actor | null, input: unknown) =>
  executeAction(actor, actionSchema.parse(input));
async function account(osuId: number, systemKey: string): Promise<Actor> {
  const role = await db.role.findUniqueOrThrow({
    where: { systemKey },
    include: { permissions: true },
  });
  const user = await db.user.create({
    data: {
      osuId,
      username: `${prefix}-${systemKey}-${osuId}`,
      avatarUrl: 'https://a.ppy.sh/1',
      profileUrl: `https://osu.ppy.sh/users/${osuId}`,
      roles: { create: { roleId: role.id } },
    },
  });
  userIds.push(user.id);
  return {
    ...user,
    roles: [role],
    permissions: role.permissions.map((p) => p.permissionKey as PermissionKey),
  };
}
async function change(actor: Actor, type: string, fields: object = {}) {
  const m = await db.match.findUniqueOrThrow({ where: { id: matchId } });
  return act(actor, { type, id: matchId, baseVersion: m.version, ...fields });
}
beforeAll(async () => {
  if (new URL(process.env.DATABASE_URL!).pathname !== '/tournament_platform_test')
    throw Error('Test database only.');
  owner = await account(941000001, 'Owner');
  referee = await account(941000002, 'Referee');
  outsider = await account(941000003, 'Referee');
  guest = await account(941000004, 'Guest');
  for (const osuId of [951000001, 951000002, 951000003])
    await db.participant.create({
      data: { osuId, username: `${prefix}-${osuId}`, avatarUrl: 'https://a.ppy.sh/1' },
    });
  const createTeam = async (side: string, osuId: number) =>
    (
      await db.team.create({
        data: {
          name: `${prefix}-${side}`,
          slug: `${prefix}-${side.toLowerCase()}`,
          status: 'APPROVED',
          members: { create: { osuId, captain: true, position: 0 } },
        },
      })
    ).id;
  teamAId = await createTeam('A', 951000001);
  teamBId = await createTeam('B', 951000002);
  const stage = await db.tournamentStage.create({
    data: { name: prefix, slug: prefix, mappool: { create: {} } },
    include: { mappool: true },
  });
  stageId = stage.id;
  poolId = stage.mappool!.id;
  const slots = [];
  for (const [position, name] of ['NM1', 'NM2', 'NM3', 'HD1', 'HR1', 'DT1', 'TB'].entries()) {
    const id = 952000000 + position,
      category = name.replace(/\d+$/, '');
    const metadata = {
      id,
      mode: 'osu',
      title: `Map ${name}`,
      artist: 'Fixture',
      mapper: 'Fixture',
      difficulty: 'Test',
      stars: 5,
      bpm: 180,
      length: 120,
      ar: 9,
      cs: 4,
      od: 8,
      hp: 6,
      cover: '',
      url: `https://osu.ppy.sh/beatmaps/${id}`,
    };
    await db.beatmap.upsert({
      where: { id },
      create: { id, mode: 'osu', metadata },
      update: { metadata, fetchedAt: new Date() },
    });
    slots.push({
      name,
      category,
      categoryName: category,
      color: '#90bdf4',
      position,
      beatmapId: id,
      metadata,
    });
  }
  const rev = await db.mappoolRevision.create({
    data: { mappoolId: poolId, slots: { create: slots } },
  });
  revisionId = rev.id;
  await db.mappool.update({
    where: { id: poolId },
    data: { state: 'PUBLISHED', publishedRevisionId: rev.id, draftRevisionId: rev.id },
  });
  await act(owner, {
    type: 'match.rules.save',
    stageId,
    rules: matchRulesSchema.parse({
      teamSize: 1,
      bestOf: 3,
      bansPerTeam: 1,
      freeModRequiredHD: 0,
      freeModRequiredHR: 0,
    }),
    baseHash: rulesHash(null),
  });
});
afterAll(async () => {
  await db.qualifierLobby.deleteMany({ where: { code: { startsWith: prefix } } });
  await db.match.deleteMany({ where: { code: { startsWith: prefix } } });
  if (stageId)
    await db.tournamentStage.deleteMany({ where: { id: { in: [stageId, ...qualifierStageIds] } } });
  await db.team.deleteMany({ where: { id: { in: [teamAId, teamBId].filter(Boolean) } } });
  await db.participant.deleteMany({ where: { osuId: { in: [951000001, 951000002, 951000003] } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
});
describe.sequential('assigned referee and persistent match workflows', () => {
  it('permanently removes an explicitly confirmed match and cascades history while preserving its audit record', async () => {
    const code = `${prefix}-delete`;
    const created = (await act(owner, {
      type: 'match.create',
      code,
      stageId,
      teamAId,
      teamBId,
      refereeIds: [referee.id],
      scheduledAt: '2099-01-01T12:00:00Z',
    })) as { id: string };
    const m = await db.match.findUniqueOrThrow({ where: { id: created.id } });
    const deletion = {
      type: 'match.delete',
      id: m.id,
      baseVersion: m.version,
      confirmCode: code,
      reason: 'Remove test fixture',
    };
    for (const permissions of [['matches.manage'], ['matches.manage_all']] as const)
      expect(() =>
        assertMatchActionPermission(
          { ...owner, permissions: [...permissions] },
          actionSchema.parse(deletion) as import('../src/lib/matches-validation').MatchAction,
        ),
      ).toThrow('permission');
    await expect(act(referee, deletion)).rejects.toMatchObject({ status: 403 });
    await expect(act(owner, { ...deletion, confirmCode: 'wrong match' })).rejects.toThrow(
      'exact match code',
    );
    await expect(act(owner, { ...deletion, baseVersion: m.version + 1 })).rejects.toMatchObject({
      status: 409,
    });
    const dependency = await db.match.create({
      data: {
        stageId,
        code: `${prefix}-dependent`,
        rules: JSON.parse(JSON.stringify(m.rules)),
        participants: { A: { name: `W${code}` }, B: { name: 'TBD' } },
      },
    });
    await expect(act(owner, deletion)).rejects.toThrow('depends on');
    await db.match.update({
      where: { id: dependency.id },
      data: {
        participants: { A: { name: 'Resolved winner' }, B: { name: 'TBD' } },
        events: { create: { version: 1, kind: 'match.resolve', data: { sourceMatchId: m.id } } },
      },
    });
    await expect(act(owner, deletion)).rejects.toThrow('depends on');
    await db.match.delete({ where: { id: dependency.id } });
    await act(owner, { type: 'match.start', id: m.id, baseVersion: 1 });
    await act(owner, {
      type: 'match.roll',
      id: m.id,
      baseVersion: 2,
      rollA: 90,
      rollB: 1,
      firstPickSide: 'A',
      firstBanSide: 'B',
    });
    await act(owner, {
      type: 'match.draft',
      id: m.id,
      baseVersion: 3,
      kind: 'BAN',
      side: 'B',
      slotName: 'HD1',
    });
    await act(owner, {
      type: 'match.draft',
      id: m.id,
      baseVersion: 4,
      kind: 'BAN',
      side: 'A',
      slotName: 'HR1',
    });
    await act(owner, {
      type: 'match.draft',
      id: m.id,
      baseVersion: 5,
      kind: 'PICK',
      side: 'A',
      slotName: 'NM1',
    });
    const picked = await db.matchMapAction.findFirstOrThrow({
      where: { matchId: m.id, kind: 'PICK' },
    });
    await act(owner, {
      type: 'match.score',
      id: m.id,
      baseVersion: 6,
      actionId: picked.id,
      scoreA: 100,
      scoreB: 50,
      reason: 'Test score entry',
      players: [
        { osuId: 951000001, side: 'A', score: 100, mods: ['NF'] },
        { osuId: 951000002, side: 'B', score: 50, mods: ['NF'] },
      ],
    });
    await db.multiplayerGame.create({
      data: {
        matchId: m.id,
        multiplayerId: 123,
        gameId: '456',
        slotName: 'NM1',
        beatmapId: 952000000,
        proposal: {},
      },
    });
    await act(owner, {
      type: 'match.cancel',
      id: m.id,
      baseVersion: 7,
      reason: 'Test match cancelled',
    });
    await act(owner, { ...deletion, baseVersion: 8 });
    expect(await db.match.findUnique({ where: { id: m.id } })).toBeNull();
    for (const count of [
      db.matchAssignment.count({ where: { matchId: m.id } }),
      db.matchEvent.count({ where: { matchId: m.id } }),
      db.matchMapAction.count({ where: { matchId: m.id } }),
      db.matchMapResult.count({ where: { matchId: m.id } }),
      db.matchResultRevision.count({ where: { matchId: m.id } }),
      db.multiplayerGame.count({ where: { matchId: m.id } }),
    ])
      expect(await count).toBe(0);
    expect(
      await db.matchPlayerScore.count({ where: { osuId: { in: [951000001, 951000002] } } }),
    ).toBe(0);
    expect(
      await db.auditLog.findFirst({ where: { entityId: m.id, action: 'match.delete' } }),
    ).toMatchObject({ actorId: owner.id, details: { code, reason: 'Remove test fixture' } });
    expect(await db.team.count({ where: { id: { in: [teamAId, teamBId] } } })).toBe(2);
    expect(
      await db.mappoolRevision.findUnique({ where: { id: m.poolRevisionId! } }),
    ).not.toBeNull();
  });
  it('completes a best-of-nine with independent protects, interleaved pairs, a tiebreaker and confirmed Discord history', async () => {
    const oldStage = await db.tournamentStage.findUniqueOrThrow({ where: { id: stageId } });
    const oldPool = await db.mappool.findUniqueOrThrow({ where: { id: poolId } });
    const map = await db.mappoolSlot.findFirstOrThrow({ where: { revisionId } });
    const names = [...Array.from({ length: 10 }, (_, i) => `NM${i + 1}`), 'TB'];
    const revision = await db.mappoolRevision.create({
      data: {
        mappoolId: poolId,
        slots: {
          create: names.map((name, position) => ({
            name,
            category: name === 'TB' ? 'TB' : 'NM',
            categoryName: name === 'TB' ? 'Tiebreaker' : 'No Mod',
            color: '#ffffff',
            position,
            beatmapId: map.beatmapId,
            metadata: map.metadata!,
          })),
        },
      },
    });
    await db.mappool.update({ where: { id: poolId }, data: { publishedRevisionId: revision.id } });
    const rules = matchRulesSchema.parse({
      teamSize: 1,
      bestOf: 9,
      bansPerTeam: 1,
      protectsPerTeam: 1,
      protectOrder: 'ABAB',
      banOrder: 'ABAB',
      pickOrder: 'ABAB',
      draftSequence: ['PROTECT', 'PICK', 'BAN', 'PICK', 'PICK', 'PICK'],
      freeModRequiredHD: 0,
      freeModRequiredHR: 0,
    });
    await act(owner, {
      type: 'match.rules.save',
      stageId,
      baseHash: rulesHash(oldStage.matchRules),
      rules,
    });
    const created = (await act(owner, {
      type: 'match.create',
      code: `${prefix}-BO9`,
      stageId,
      teamAId,
      teamBId,
      refereeIds: [referee.id],
      bestOf: 9,
      scheduledAt: '2080-01-01T12:00:00.000Z',
    })) as { id: string };
    await db.mappool.update({
      where: { id: poolId },
      data: { publishedRevisionId: oldPool.publishedRevisionId },
    });
    await act(owner, {
      type: 'match.rules.save',
      stageId,
      baseHash: rulesHash(
        (await db.tournamentStage.findUniqueOrThrow({ where: { id: stageId } })).matchRules,
      ),
      rules: oldStage.matchRules,
    });
    const update = async (actor: Actor, type: string, fields: object = {}) =>
      act(actor, {
        type,
        id: created.id,
        baseVersion: (await db.match.findUniqueOrThrow({ where: { id: created.id } })).version,
        ...fields,
      });
    await update(referee, 'match.start');
    await update(referee, 'match.lobby', {
      lobbyUrl: 'https://osu.ppy.sh/community/matches/123456',
    });
    await update(referee, 'match.roll', {
      rollA: 90,
      rollB: 10,
      firstProtectSide: 'B',
      firstBanSide: 'A',
      firstPickSide: 'A',
    });
    await update(referee, 'match.draft', { kind: 'PROTECT', side: 'B', slotName: 'NM1' });
    await update(referee, 'match.draft', { kind: 'PROTECT', side: 'A', slotName: 'NM2' });
    const picks = ['NM1', 'NM2', 'NM5', 'NM6', 'NM7', 'NM8', 'NM9', 'NM10', 'TB'];
    for (const [i, slotName] of picks.entries()) {
      if (i === 2) {
        await update(referee, 'match.draft', { kind: 'BAN', side: 'A', slotName: 'NM3' });
        await update(referee, 'match.draft', { kind: 'BAN', side: 'B', slotName: 'NM4' });
      }
      await update(referee, 'match.draft', { kind: 'PICK', side: i % 2 ? 'B' : 'A', slotName });
      const pick = await db.matchMapAction.findFirstOrThrow({
        where: { matchId: created.id, slotName, kind: 'PICK' },
      });
      await update(referee, 'match.score', {
        actionId: pick.id,
        scoreA: i % 2 === 0 && i < 8 ? 1000 : 900,
        scoreB: i % 2 === 0 && i < 8 ? 900 : 1000,
        reason: 'Verified multiplayer scores',
      });
    }
    const view = async () =>
      (
        (await matchData(
          outsider,
          new URL(`http://test?id=${created.id}`),
          'match',
        )) as unknown as { match: MatchView }
      ).match;
    expect((await view()).poolRevision?.id).toBe(revision.id);
    expect(matchDiscordResult(await view())).toBe('Match in Progress');
    await update(referee, 'match.submit');
    await update(owner, 'match.confirm', { reason: 'Full match verified' });
    const final = await view();
    expect(final).toMatchObject({
      scoreA: 4,
      scoreB: 5,
      status: 'COMPLETED',
      firstProtectSide: 'B',
    });
    expect(final.actions).toHaveLength(13);
    expect(matchDiscordResult(final)).toContain(':purple_circle: ``TB`` ↳ :blue_circle: wins!');
    expect(matchDiscordResult(final)).toContain(':red_circle: protects ``NM2``');
    const fixture = await db.match.create({
      data: {
        code: `${prefix}-next`,
        stageId,
        rules: matchRulesSchema.parse({ teamSize: 1 }),
        participants: {
          A: { ...final.participants.A, id: null, name: `W${final.code}`, members: [] },
          B: { ...final.participants.B, id: null, name: `L${final.code}`, members: [] },
        },
      },
    });
    const dependencies = (await matchData(
      outsider,
      new URL(`http://test?id=${fixture.id}`),
      'match',
    )) as unknown as { dependencies: { team: string }[] };
    expect(dependencies.dependencies.map((d) => d.team)).toEqual([
      final.participants.B.name,
      final.participants.A.name,
    ]);
    await expect(
      act(outsider, {
        type: 'match.resolve',
        id: fixture.id,
        baseVersion: 1,
        side: 'A',
        dependencyVersion: final.version,
        reason: 'Unassigned resolution',
      }),
    ).rejects.toThrow('permission');
    await expect(
      act(owner, {
        type: 'match.resolve',
        id: fixture.id,
        baseVersion: 1,
        side: 'A',
        dependencyVersion: final.version - 1,
        reason: 'Stale result reference',
      }),
    ).rejects.toThrow('source result');
    await act(owner, {
      type: 'match.resolve',
      id: fixture.id,
      baseVersion: 1,
      side: 'A',
      dependencyVersion: final.version,
      reason: 'Verified winner advancement',
    });
    await act(owner, {
      type: 'match.resolve',
      id: fixture.id,
      baseVersion: 2,
      side: 'B',
      dependencyVersion: final.version,
      reason: 'Verified loser advancement',
    });
    expect(await db.match.findUniqueOrThrow({ where: { id: fixture.id } })).toMatchObject({
      teamAId: teamBId,
      teamBId: teamAId,
      version: 3,
    });
  });
  it('runs an independent qualifier workflow with snapshot scores, read-all access and immutable corrections', async () => {
    const stage = await db.tournamentStage.findUniqueOrThrow({ where: { id: stageId } });
    await act(owner, {
      type: 'match.rules.save',
      stageId,
      baseHash: rulesHash(stage.matchRules),
      rules: matchRulesSchema.parse({
        ...(stage.matchRules as object),
        multiplierMode: 'UNIVERSAL',
        modMultipliers: { NM: 1 / 1.06 },
      }),
    });
    const input = {
      type: 'qualifier.create',
      code: `${prefix}-Q1`,
      stageId,
      teamIds: [teamAId, teamBId],
      refereeIds: [referee.id],
      scheduledAt: '2078-01-01T12:00:00.000Z',
    };
    const source = await db.tournamentStage.findUniqueOrThrow({
      where: { id: stageId },
      include: { mappool: { include: { publishedRevision: { include: { slots: true } } } } },
    });
    const qualifierStage = await db.tournamentStage.create({
      data: {
        name: `${prefix} qualifiers`,
        slug: `${prefix}-qualifiers`,
        kind: 'QUALIFIERS',
        matchRules: source.matchRules!,
        mappool: { create: {} },
      },
      include: { mappool: true },
    });
    qualifierStageIds.push(qualifierStage.id);
    const qualifierRevision = await db.mappoolRevision.create({
      data: {
        mappoolId: qualifierStage.mappool!.id,
        slots: {
          create: source.mappool!.publishedRevision!.slots.map(({ id, revisionId, ...slot }) => {
            void id;
            void revisionId;
            return { ...slot, metadata: JSON.parse(JSON.stringify(slot.metadata)) };
          }),
        },
      },
    });
    await db.mappool.update({
      where: { id: qualifierStage.mappool!.id },
      data: {
        state: 'PUBLISHED',
        publishedRevisionId: qualifierRevision.id,
        draftRevisionId: qualifierRevision.id,
      },
    });
    input.stageId = qualifierStage.id;
    await expect(act(referee, input)).rejects.toThrow('permission');
    const lobby = (await act(owner, input)) as { id: string; version: number };
    await expect(
      act(owner, {
        type: 'team.delete',
        id: teamAId,
        baseVersion: (await db.team.findUniqueOrThrow({ where: { id: teamAId } })).version,
      }),
    ).rejects.toThrow('qualifier history');
    const overridden = await db.tournamentStage.findUniqueOrThrow({ where: { id: stageId } });
    await act(owner, {
      type: 'match.rules.save',
      stageId,
      baseHash: rulesHash(overridden.matchRules),
      rules: stage.matchRules,
    });
    const current = () => db.qualifierLobby.findUniqueOrThrow({ where: { id: lobby.id } });
    const update = async (actor: Actor, type: string, fields: object = {}) =>
      act(actor, { type, id: lobby.id, baseVersion: (await current()).version, ...fields });
    const visible = await qualifierData(outsider, new URL(`http://test?id=${lobby.id}`));
    expect(visible.lobbies[0].access.editable).toBe(false);
    await expect(qualifierData(guest, new URL('http://test'))).rejects.toThrow('Forbidden');
    await expect(
      update(outsider, 'qualifier.status', { command: 'START', reason: 'Unauthorized start' }),
    ).rejects.toThrow('assigned');
    await update(referee, 'qualifier.status', { command: 'START', reason: 'Players ready' });
    await expect(
      act(referee, { type: 'qualifier.lobby', id: lobby.id, baseVersion: 1, lobbyUrl: '' }),
    ).rejects.toThrow('Another referee');
    await expect(
      update(referee, 'qualifier.lobby', { lobbyUrl: 'https://example.com/matches/1' }),
    ).rejects.toThrow('osu!');
    await update(referee, 'qualifier.lobby', {
      lobbyUrl: 'https://osu.ppy.sh/community/matches/123456',
    });
    await expect(
      update(referee, 'qualifier.status', { command: 'SUBMIT', reason: 'Incomplete submission' }),
    ).rejects.toThrow('scores');
    await expect(
      update(referee, 'qualifier.score', {
        osuId: 951000003,
        slotName: 'NM1',
        raw: 1,
        mods: ['NF'],
        reason: 'Wrong player',
      }),
    ).rejects.toThrow('snapshotted');
    const slots = await db.mappoolSlot.findMany({ where: { revisionId } });
    for (const slot of slots)
      for (const [i, osuId] of [951000001, 951000002].entries())
        await update(referee, 'qualifier.score', {
          osuId,
          slotName: slot.name,
          raw: 1000 + i,
          mods: ['NF'],
          reason: 'Recorded multiplayer score',
        });
    const first = await db.qualifierScore.findFirstOrThrow({
      where: { lobbyId: lobby.id, osuId: 951000001, slotName: 'NM1' },
    });
    expect(first.adjusted).toBe(1000 / 1.06);
    expect(first.adjusted).not.toBe(Math.round(first.adjusted));
    await update(referee, 'qualifier.score.remove', {
      scoreId: first.id,
      reason: 'Incorrect player entry',
    });
    await update(referee, 'qualifier.score', {
      osuId: 951000001,
      slotName: 'NM1',
      raw: 1200,
      mods: ['NF'],
      reason: 'Corrected raw score',
    });
    await update(referee, 'qualifier.status', { command: 'SUBMIT', reason: 'All maps recorded' });
    await expect(
      update(referee, 'qualifier.status', { command: 'CONFIRM', reason: 'Self confirmation' }),
    ).rejects.toThrow('permission');
    await update(owner, 'qualifier.status', { command: 'CONFIRM', reason: 'Results reviewed' });
    expect(await current()).toMatchObject({
      status: 'COMPLETED',
      poolRevisionId: qualifierRevision.id,
    });
    const history = await qualifierData(outsider, new URL(`http://test?id=${lobby.id}`));
    expect(history.lobbies[0].scores).toHaveLength(14);
    expect(
      history.lobbies[0].events.some(
        (event) =>
          event.kind === 'qualifier.score.remove' && JSON.stringify(event.data).includes('1000'),
      ),
    ).toBe(true);
    expect(
      await db.auditLog.count({ where: { entityId: lobby.id, action: 'qualifier.status' } }),
    ).toBe(3);
  });
  it('grants Referee only operational permissions and prevents unrelated administration', async () => {
    expect(referee.permissions).toContain('matches.update_scores');
    expect(referee.permissions).not.toContain('users.manage');
    expect(referee.permissions).not.toContain('homepage.edit');
    await expect(
      act(referee, { type: 'user.roles', userId: guest.id, roleIds: [] }),
    ).rejects.toThrow('permission');
    await expect(
      matchData(guest, new URL('http://test/api?section=referee'), 'referee'),
    ).rejects.toThrow('access');
  });
  it('creates a scheduled match from approved teams, a published pool and eligible referees', async () => {
    const input = {
      type: 'match.create',
      code: prefix,
      stageId,
      teamAId,
      teamBId,
      scheduledAt: '2070-01-01T15:00:00.000Z',
      refereeIds: [referee.id],
      bestOf: 3,
    };
    await expect(act(referee, input)).rejects.toThrow('permission');
    await expect(act(owner, { ...input, refereeIds: [guest.id] })).rejects.toThrow('operational');
    matchId = ((await act(owner, input)) as { id: string }).id;
    expect(
      await db.auditLog.count({
        where: { actorId: owner.id, action: 'match.create', entityId: matchId },
      }),
    ).toBe(1);
    const list = (await matchData(
      referee,
      new URL('http://test/api?status=SCHEDULED&assigned=me'),
      'referee',
    )) as { matches: { id: string }[] };
    expect(list.matches.map((m) => m.id)).toContain(matchId);
    const observed = (await matchData(
      outsider,
      new URL(`http://test/api?id=${matchId}`),
      'match',
    )) as { match: { id: string }; access: { editable: boolean } };
    expect(observed.match.id).toBe(matchId);
    expect(observed.access.editable).toBe(false);
    const all = (await matchData(outsider, new URL('http://test/api'), 'referee')) as {
      matches: { id: string }[];
    };
    expect(all.matches.map((m) => m.id)).toContain(matchId);
    await expect(
      act(owner, { ...input, code: prefix + '-duplicate', teamAId: teamBId, teamBId: teamAId }),
    ).rejects.toThrow('already scheduled');
  });
  it('lets every referee observe all assignments and history while rejecting cross-match writes', async () => {
    expect(referee.permissions).toContain('matches.view_all');
    expect(referee.permissions).not.toContain('matches.manage_all');
    const create = async (code: string, refereeIds: string[], scheduledAt: string) =>
      (await act(owner, {
        type: 'match.create',
        code: prefix + code,
        stageId,
        teamAId,
        teamBId,
        scheduledAt,
        refereeIds,
        bestOf: 3,
      })) as { id: string };
    const second = await create('-other', [outsider.id], '2070-01-08T13:00:00.000Z');
    const unassigned = await create('-unassigned', [], '2070-01-09T13:00:00.000Z');
    const list = async (actor: Actor, suffix = '') =>
      (await matchData(actor, new URL('http://test/api?' + suffix), 'referee')) as {
        matches: { id: string }[];
      };
    for (const ref of [referee, outsider]) {
      expect((await list(ref)).matches.map((m) => m.id)).toEqual(
        expect.arrayContaining([matchId, second.id, unassigned.id]),
      );
      const observed = (await matchData(
        ref,
        new URL('http://test/api?id=' + unassigned.id),
        'match',
      )) as { access: { editable: boolean } };
      expect(observed.access.editable).toBe(false);
    }
    expect((await list(referee, 'assigned=me')).matches.map((m) => m.id)).not.toContain(second.id);
    expect((await list(referee, 'assigned=unassigned')).matches.map((m) => m.id)).toContain(
      unassigned.id,
    );
    const m = await db.match.findUniqueOrThrow({ where: { id: second.id } });
    const schedule = {
      type: 'match.schedule',
      id: m.id,
      baseVersion: m.version,
      scheduledAt: '2070-01-08T14:00:00.000Z',
      refereeIds: [outsider.id],
      notes: 'Saved referee note',
    };
    await expect(act(referee, schedule)).rejects.toThrow('assigned');
    await expect(
      act({ ...referee, permissions: [...referee.permissions, 'matches.manage_all'] }, schedule),
    ).rejects.toThrow('assigned');
    await expect(act(outsider, { ...schedule, published: true })).rejects.toThrow(
      'Only match managers',
    );
    await act(outsider, schedule);
    const observer = (await matchData(referee, new URL('http://test/api?id=' + m.id), 'match')) as {
      match: { version: number; notes: string };
      access: { editable: boolean };
    };
    expect(observer.match).toMatchObject({ version: m.version + 1, notes: 'Saved referee note' });
    expect(observer.access.editable).toBe(false);
    expect(
      await matchData(referee, new URL(`http://test/api?id=${m.id}&before=999`), 'match-events'),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'match.schedule' })]));
    await expect(
      act(referee, { type: 'match.start', id: m.id, baseVersion: m.version + 1 }),
    ).rejects.toThrow('assigned');
  });
  it('records forfeits without fabricated map scores and safely reopens them', async () => {
    const id = (
      (await act(owner, {
        type: 'match.create',
        code: prefix + '-forfeit',
        stageId,
        teamAId,
        teamBId,
        scheduledAt: '2070-01-02T15:00:00.000Z',
        refereeIds: [referee.id],
        bestOf: 3,
      })) as { id: string }
    ).id;
    const update = async (actor: Actor, type: string, fields: object = {}) => {
      const current = await db.match.findUniqueOrThrow({ where: { id } });
      return act(actor, { type, id, baseVersion: current.version, ...fields });
    };
    await expect(
      update(outsider, 'match.forfeit', { winnerSide: 'A', reason: 'No show' }),
    ).rejects.toThrow('assigned');
    await update(referee, 'match.forfeit', {
      winnerSide: 'A',
      reason: 'Team B did not arrive within the allowed time',
    });
    expect(await db.match.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'AWAITING_CONFIRMATION',
      winnerSide: 'A',
      forfeitSide: 'B',
      scoreA: 2,
      scoreB: 0,
    });
    expect(await db.matchMapResult.count({ where: { matchId: id } })).toBe(0);
    await update(owner, 'match.confirm', { reason: 'No-show verified' });
    await update(owner, 'match.reopen', { reason: 'Organizers approved a replay' });
    expect(await db.match.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'IN_PROGRESS',
      winnerSide: null,
      forfeitSide: null,
      scoreA: 0,
      scoreB: 0,
    });
    expect(await db.matchResultRevision.count({ where: { matchId: id } })).toBe(3);
    await update(owner, 'match.cancel', { reason: 'Replay rescheduled separately' });
  });
  it('preserves roster, pool and rule snapshots after source edits', async () => {
    const team = await db.team.findUniqueOrThrow({ where: { id: teamAId } });
    await act(owner, {
      type: 'team.save',
      id: team.id,
      baseVersion: team.version,
      name: 'Changed current team',
      slug: team.slug,
      members: [{ osuId: 951000003, captain: true, substitute: false }],
    });
    const stage = await db.tournamentStage.findUniqueOrThrow({ where: { id: stageId } });
    await act(owner, {
      type: 'match.rules.save',
      stageId,
      baseHash: rulesHash(stage.matchRules),
      rules: matchRulesSchema.parse({ ...(stage.matchRules as object), timeoutSeconds: 30 }),
    });
    const newer = await db.mappoolRevision.create({
      data: { mappoolId: poolId, notes: 'New public version' },
    });
    await db.mappool.update({
      where: { id: poolId },
      data: { publishedRevisionId: newer.id, draftRevisionId: newer.id },
    });
    const saved = await db.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(saved.poolRevisionId).toBe(revisionId);
    expect(saved.rules).toMatchObject({ timeoutSeconds: 120 });
    expect(saved.participants).toMatchObject({
      A: { name: prefix + '-A', members: [{ osuId: 951000001 }] },
    });
    await expect(
      act(owner, { type: 'team.delete', id: team.id, baseVersion: team.version + 1 }),
    ).rejects.toThrow('history');
  });
  it('requires assignment, rejects tied rolls and enforces turn order and duplicate map rules', async () => {
    await expect(change(outsider, 'match.start')).rejects.toThrow('assigned');
    await change(referee, 'match.start');
    await expect(
      change(referee, 'match.roll', {
        rollA: 50,
        rollB: 50,
        firstPickSide: 'A',
        firstBanSide: 'A',
      }),
    ).rejects.toThrow('Tied');
    await change(referee, 'match.roll', {
      rollA: 80,
      rollB: 20,
      firstPickSide: 'A',
      firstBanSide: 'A',
    });
    await expect(
      change(referee, 'match.draft', { kind: 'BAN', side: 'B', slotName: 'NM1' }),
    ).rejects.toThrow('turn');
    await change(referee, 'match.draft', { kind: 'BAN', side: 'A', slotName: 'NM1' });
    await expect(
      change(referee, 'match.draft', { kind: 'BAN', side: 'B', slotName: 'NM1' }),
    ).rejects.toThrow('already');
    await change(referee, 'match.draft', { kind: 'BAN', side: 'B', slotName: 'NM2' });
    await expect(
      change(referee, 'match.draft', { kind: 'PICK', side: 'A', slotName: 'TB' }),
    ).rejects.toThrow('not available');
    await change(referee, 'match.draft', { kind: 'PICK', side: 'A', slotName: 'HD1' });
  });
  it('records timed incidents, validates lobby IDs and rejects stale concurrent writes', async () => {
    await expect(
      change(referee, 'match.incident', {
        kind: 'TIMEOUT',
        side: 'B',
        notes: 'Wrong team timeout',
      }),
    ).rejects.toThrow('own pick');
    await change(referee, 'match.incident', {
      kind: 'TIMEOUT',
      side: 'A',
      notes: 'Tactical timeout',
    });
    await expect(
      change(referee, 'match.incident', { kind: 'TIMEOUT', side: 'A', notes: 'Second timeout' }),
    ).rejects.toThrow('allowance');
    await change(referee, 'match.timer', { command: 'PAUSE', kind: 'TIMEOUT' });
    const match = await db.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(match.timerStartedAt).toBeNull();
    expect(match.timerRemainingSeconds).toBeLessThanOrEqual(120);
    const input = {
      type: 'match.timer',
      id: matchId,
      baseVersion: match.version,
      command: 'START',
      kind: 'PICK',
    };
    const races = await Promise.allSettled([act(referee, input), act(referee, input)]);
    expect(races.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(races.filter((r) => r.status === 'rejected')).toHaveLength(1);
    await expect(
      change(referee, 'match.lobby', {
        lobbyUrl: 'https://evil.example/community/matches/123',
        multiplayerId: 123,
      }),
    ).rejects.toThrow('osu!');
    await change(referee, 'match.lobby', {
      lobbyUrl: 'https://osu.ppy.sh/community/matches/123',
      multiplayerId: 123,
    });
    expect((await db.match.findUniqueOrThrow({ where: { id: matchId } })).multiplayerId).toBe(123);
  });
  it('scores manual maps, unlocks the tiebreaker and calculates the match winner', async () => {
    let pick = await db.matchMapAction.findFirstOrThrow({
      where: { matchId, slotName: 'HD1', voided: false },
    });
    await expect(
      change(referee, 'match.score', {
        actionId: pick.id,
        scoreA: 10,
        scoreB: 10,
        reason: 'Initial entry',
      }),
    ).rejects.toThrow('Tied');
    await change(referee, 'match.score', {
      actionId: pick.id,
      scoreA: 100,
      scoreB: 50,
      reason: 'Manual score entry',
    });
    await change(referee, 'match.draft', { kind: 'PICK', side: 'B', slotName: 'HR1' });
    pick = await db.matchMapAction.findFirstOrThrow({
      where: { matchId, slotName: 'HR1', voided: false },
    });
    await change(referee, 'match.score', {
      actionId: pick.id,
      scoreA: 50,
      scoreB: 100,
      reason: 'Manual score entry',
    });
    await expect(
      change(referee, 'match.draft', { kind: 'PICK', side: 'B', slotName: 'NM3' }),
    ).rejects.toThrow('tiebreaker');
    await change(referee, 'match.draft', { kind: 'PICK', side: 'B', slotName: 'TB' });
    pick = await db.matchMapAction.findFirstOrThrow({
      where: { matchId, slotName: 'TB', voided: false },
    });
    await change(referee, 'match.score', {
      actionId: pick.id,
      scoreA: 120,
      scoreB: 110,
      reason: 'Tiebreaker result',
    });
    expect(await db.match.findUniqueOrThrow({ where: { id: matchId } })).toMatchObject({
      scoreA: 2,
      scoreB: 1,
      winnerSide: 'A',
    });
    await expect(
      change(referee, 'match.draft', { kind: 'PICK', side: 'A', slotName: 'DT1' }),
    ).rejects.toThrow('turn');
  });
  it('requires administrator confirmation and preserves correction revisions', async () => {
    await change(referee, 'match.submit', { notes: 'Final result checked' });
    await expect(
      change(referee, 'match.confirm', { reason: 'Ref cannot confirm' }),
    ).rejects.toThrow('permission');
    await change(owner, 'match.confirm', { reason: 'Result verified' });
    let match = await db.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(match.status).toBe('COMPLETED');
    expect(match.completedAt).not.toBeNull();
    const pick = await db.matchMapAction.findFirstOrThrow({
      where: { matchId, slotName: 'TB', voided: false },
    });
    await expect(
      change(referee, 'match.score', {
        actionId: pick.id,
        scoreA: 90,
        scoreB: 110,
        reason: 'Attempted silent edit',
      }),
    ).rejects.toThrow('reopen');
    await change(owner, 'match.reopen', { reason: 'Fix a transcribed tiebreaker score' });
    await change(owner, 'match.score', {
      actionId: pick.id,
      scoreA: 90,
      scoreB: 110,
      reason: 'Corrected raw scores',
    });
    match = await db.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(match).toMatchObject({ scoreA: 1, scoreB: 2, winnerSide: 'B' });
    const revisions = await db.matchResultRevision.findMany({
      where: { matchId },
      orderBy: { version: 'asc' },
    });
    expect(
      revisions.some(
        (r) =>
          r.kind === 'match.confirm' && (r.snapshot as { winnerSide: string }).winnerSide === 'A',
      ),
    ).toBe(true);
    expect(
      await db.auditLog.count({
        where: { actorId: owner.id, action: 'match.reopen', entityId: matchId },
      }),
    ).toBe(1);
    await change(referee, 'match.submit', { notes: 'Corrected result' });
    await change(owner, 'match.confirm', { reason: 'Correction verified' });
    const options = await matchOptions(owner);
    expect(options.referees.map((r) => r.id)).not.toContain(guest.id);
    const history = (await matchData(
      referee,
      new URL(`http://test/api?id=${matchId}`),
      'match',
    )) as { match: { revisions: { id: string }[] } };
    expect(history.match.revisions.length).toBeGreaterThan(4);
    await expect(
      matchData(
        outsider,
        new URL(`http://test/api?id=${matchId}&revision=${history.match.revisions[0].id}`),
        'match-revision',
      ),
    ).resolves.toMatchObject({ matchId, id: history.match.revisions[0].id });
  });
  it('preserves disputed results and audits an explicit undo/cancellation', async () => {
    await change(referee, 'match.dispute', { reason: 'Opponent requests a review' });
    expect((await db.match.findUniqueOrThrow({ where: { id: matchId } })).status).toBe('DISPUTED');
    await change(owner, 'match.reopen', { reason: 'Review the final map' });
    await change(owner, 'match.undo', { reason: 'Void the tiebreaker pending review' });
    expect(await db.match.findUniqueOrThrow({ where: { id: matchId } })).toMatchObject({
      scoreA: 1,
      scoreB: 1,
      winnerSide: null,
    });
    await change(owner, 'match.cancel', { reason: 'Match cancelled by organizers' });
    expect((await db.match.findUniqueOrThrow({ where: { id: matchId } })).status).toBe('CANCELLED');
  });
});
