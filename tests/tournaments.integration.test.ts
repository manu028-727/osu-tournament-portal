import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db';
import { scopedDb } from '../src/lib/scoped-db';
import { tournamentAction, tournamentList } from '../src/lib/tournaments-service';
import { actorForTournament } from '../src/lib/auth';
import { executeAction } from '../src/lib/admin-service';
import { actionSchema } from '../src/lib/validation';
import type { Actor } from '../src/lib/permissions';
import { matchRulesSchema } from '../src/lib/match-rules';
import { matchData } from '../src/lib/matches-service';
import { getTournament } from '../src/lib/queries';
const prefix = `tenant-${Date.now()}`;
let platform: Actor, a: string, b: string, staffId: string, platformId: string;
const ids: string[] = [];
async function actor(id: string, tournamentId: string) {
  return actorForTournament(
    await db.user.findUniqueOrThrow({
      where: { id },
      include: { roles: { include: { role: { include: { permissions: true } } } } },
    }),
    tournamentId,
  );
}
const act = (who: Actor, value: unknown) => executeAction(who, actionSchema.parse(value));
beforeAll(async () => {
  if (new URL(process.env.DATABASE_URL!).pathname !== '/tournament_platform_test')
    throw Error('Test database only.');
  platformId = (
    await db.user.create({
      data: {
        osuId: 989000001,
        username: prefix,
        avatarUrl: '',
        profileUrl: '',
        platformAdmin: true,
      },
    })
  ).id;
  platform = await actor(platformId, 'main');
  for (const label of ['a', 'b'])
    ids.push(
      (
        await tournamentAction(platform, {
          type: 'create',
          name: `${prefix}-${label}`,
          acronym: label,
          slug: `${prefix}-${label}`,
          gameMode: 'osu',
          description: '',
          timezone: 'Europe/Rome',
          format: 'TEAMS',
        })
      ).id,
    );
  [a, b] = ids;
  const role = await db.role.findFirstOrThrow({ where: { tournamentId: a, templateKey: 'Admin' } });
  staffId = (
    await db.user.create({
      data: {
        osuId: 989000002,
        username: `${prefix}-staff`,
        avatarUrl: '',
        profileUrl: '',
        roles: { create: { tournamentId: a, roleId: role.id } },
      },
    })
  ).id;
});
afterAll(async () => {
  for (const id of ids) {
    await db.match.deleteMany({ where: { tournamentId: id } });
    await db.team.deleteMany({ where: { tournamentId: id } });
    await db.page.updateMany({
      where: { tournamentId: id },
      data: { draftRevisionId: null, publishedRevisionId: null },
    });
    await db.role.deleteMany({ where: { tournamentId: id } });
    await db.auditLog.deleteMany({ where: { tournamentId: id } });
    await db.mediaAsset.deleteMany({ where: { tournamentId: id } });
    await db.tournament.delete({ where: { id } });
  }
  await db.user.deleteMany({ where: { id: { in: [staffId, platformId].filter(Boolean) } } });
  await db.participant.deleteMany({ where: { osuId: { in: [989100001, 989100002] } } });
  await db.beatmap.deleteMany({ where: { id: { in: [989200001, 989200002, 989200003] } } });
});
describe('multi-tournament isolation', () => {
  it('uses one grouped match count for the workspace tournament list', async () => {
    const group = vi.spyOn(db.match, 'groupBy');
    const count = vi.spyOn(db.match, 'count');
    try {
      const list = await tournamentList(platform);
      expect(list.filter((t) => ids.includes(t.id)).map((t) => t.matchCount)).toEqual([0, 0]);
      expect(group).toHaveBeenCalledOnce();
      expect(count).not.toHaveBeenCalled();
      group.mockClear();
      await tournamentList(null, true);
      expect(group).not.toHaveBeenCalled();
    } finally {
      group.mockRestore();
      count.mockRestore();
    }
  });
  it('creates independent private CMS records, local roles and categories', async () => {
    for (const id of ids) {
      expect(await db.page.count({ where: { tournamentId: id } })).toBe(2);
      expect(await db.pageRevision.count({ where: { tournamentId: id } })).toBe(0);
      expect(
        await db.page.count({
          where: {
            tournamentId: id,
            draftRevisionId: null,
            publishedRevisionId: null,
          },
        }),
      ).toBe(2);
      expect(await db.role.count({ where: { tournamentId: id } })).toBe(9);
      expect((await db.tournament.findUniqueOrThrow({ where: { id } })).published).toBe(false);
      const settings = await db.tournamentSettings.findUniqueOrThrow({
        where: { tournamentId: id },
      });
      expect(settings.copy).toMatchObject({ competitionLabel: '', formatLabel: '' });
      expect(settings.importantDates).toEqual([]);
      expect(settings.registrationUrl).toBe('');
      expect((await tournamentList(null, true)).some((t) => t.id === id)).toBe(false);
    }
  });
  it('does not grant platform rights to a tournament administrator', async () => {
    const admin = await actor(staffId, a);
    expect(admin.permissions).not.toContain('tournaments.create');
    expect((await actor(staffId, b)).permissions).toEqual([]);
    expect((await tournamentList(admin)).map((t) => t.id)).toEqual([a]);
    await expect(
      tournamentAction(admin, {
        type: 'lifecycle',
        id: b,
        published: true,
        archived: false,
        baseVersion: 1,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      act(await actor(staffId, b), {
        type: 'page.save',
        slug: 'home',
        title: 'Leak',
        html: '',
        blocks: [],
        baseRevisionId: null,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('rejects old settings forms across subsections and preserves fields omitted from a patch', async () => {
    const manager = await actor(platformId, a);
    const initial = await getTournament(a);
    await act(manager, {
      type: 'settings.save',
      baseVersion: initial.version,
      primaryColor: '#123456',
    });
    await expect(
      act(manager, { type: 'settings.save', baseVersion: initial.version, footer: 'Old form' }),
    ).rejects.toMatchObject({ status: 409 });
    const latest = await getTournament(a);
    await act(manager, {
      type: 'settings.save',
      baseVersion: latest.version,
      footer: 'Reviewed footer',
    });
    const saved = await getTournament(a);
    expect(saved.settings).toMatchObject({ primaryColor: '#123456', footer: 'Reviewed footer' });
    expect(saved.name).toBe(initial.name);
    expect(saved.settings?.navigation).toEqual(initial.settings?.navigation);
    const results = await Promise.allSettled(
      ['One', 'Two'].map((description) =>
        act(manager, { type: 'settings.save', baseVersion: saved.version, description }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected').map((r) => r.reason.status)).toEqual([
      409,
    ]);
    expect(actionSchema.safeParse({ type: 'settings.save', footer: 'No witness' }).success).toBe(
      false,
    );
  });
  it('allows overlapping stage slugs but scopes reads, ID mutations and nested transactions', async () => {
    const stageA = await scopedDb(db, a).tournamentStage.create({
      data: { name: 'Finals', slug: 'finals', mappool: { create: {} } },
      include: { mappool: true },
    });
    const stageB = await scopedDb(db, b).tournamentStage.create({
      data: { name: 'Finals', slug: 'finals', mappool: { create: {} } },
      include: { mappool: true },
    });
    expect(stageA.mappool?.tournamentId).toBe(a);
    await expect(
      act(await actor(platformId, a), {
        type: 'stage.save',
        id: stageA.id,
        name: 'Missing review witness',
        slug: stageA.slug,
        description: '',
        position: 0,
        startsAt: null,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(stageB.mappool?.tournamentId).toBe(b);
    expect(
      await scopedDb(db, a).tournamentStage.findUnique({ where: { id: stageB.id } }),
    ).toBeNull();
    await expect(
      scopedDb(db, a).tournamentStage.update({ where: { id: stageB.id }, data: { name: 'Leak' } }),
    ).rejects.toThrow();
    expect(() =>
      scopedDb(db, a).tournamentStage.create({
        data: { tournamentId: b, name: 'Leak', slug: 'leak' },
      }),
    ).toThrow('Cross-tournament');
    await expect(
      scopedDb(db, a).$transaction((tx) =>
        tx.tournamentStage.update({ where: { id: stageA.id }, data: { nextStageId: stageB.id } }),
      ),
    ).rejects.toThrow();
  });
  it('saves one homepage draft without changing another tournament', async () => {
    const pageA = await scopedDb(db, a).page.findFirstOrThrow({ where: { slug: 'home' } });
    const pageB = await scopedDb(db, b).page.findFirstOrThrow({ where: { slug: 'home' } });
    await act(await actor(staffId, a), {
      type: 'page.save',
      slug: 'home',
      title: 'A only',
      html: '',
      blocks: [],
      baseRevisionId: pageA.draftRevisionId,
    });
    expect(
      (await scopedDb(db, b).page.findFirstOrThrow({ where: { slug: 'home' } })).draftRevisionId,
    ).toBe(pageB.draftRevisionId);
  });
  it('rejects foreign media and roles, and keeps archives non-destructive', async () => {
    const asset = await scopedDb(db, b).mediaAsset.create({
      data: {
        key: `${prefix}.webp`,
        name: 'Private',
        mimeType: 'image/webp',
        size: 1,
        width: 1,
        height: 1,
      },
    });
    const page = await scopedDb(db, a).page.findFirstOrThrow({ where: { slug: 'home' } });
    await expect(
      act(await actor(staffId, a), {
        type: 'page.save',
        slug: 'home',
        title: 'Leak',
        html: `<img src="/api/media/${asset.id}">`,
        blocks: [],
        baseRevisionId: page.draftRevisionId,
      }),
    ).rejects.toMatchObject({ status: 403 });
    const foreignRole = await scopedDb(db, b).role.findFirstOrThrow();
    await expect(
      act(await actor(platformId, a), {
        type: 'user.roles',
        userId: staffId,
        roleIds: [foreignRole.id],
      }),
    ).rejects.toThrow();
    const before = await db.pageRevision.count({ where: { tournamentId: b } });
    await tournamentAction(platform, {
      type: 'lifecycle',
      id: b,
      baseVersion: 1,
      published: true,
      archived: true,
    });
    expect(await db.pageRevision.count({ where: { tournamentId: b } })).toBe(before);
  });
  it('shares identities but isolates rosters, pools, match codes and inherited stage formats', async () => {
    for (const osuId of [989100001, 989100002])
      await db.participant.create({ data: { osuId, username: String(osuId), avatarUrl: '' } });
    for (const [index, id] of ids.entries()) {
      const scoped = scopedDb(db, id),
        manager = await actor(platformId, id);
      const stage = await scoped.tournamentStage.findFirstOrThrow({
        where: { slug: 'finals' },
        include: { mappool: true },
      });
      await scoped.tournamentStage.update({
        where: { id: stage.id },
        data: {
          matchRules: matchRulesSchema.parse({
            bestOf: index ? 3 : 1,
            teamSize: 1,
            bansPerTeam: 0,
            enableTiebreaker: false,
          }),
        },
      });
      const slots = [];
      for (let i = 1; i <= (index ? 3 : 1); i++) {
        const beatmapId = 989200000 + i;
        await db.beatmap.upsert({
          where: { id: beatmapId },
          create: { id: beatmapId, mode: 'osu', metadata: {} },
          update: {},
        });
        slots.push({
          name: `NM${i}`,
          category: 'NM',
          categoryName: 'NM',
          color: '#ffffff',
          position: i,
          beatmapId,
          metadata: {},
        });
      }
      const revision = await scoped.mappoolRevision.create({
        data: { mappoolId: stage.mappool!.id, slots: { create: slots } },
      });
      await scoped.mappool.update({
        where: { id: stage.mappool!.id },
        data: { publishedRevisionId: revision.id, state: 'PUBLISHED' },
      });
      const teams = [];
      for (const [i, osuId] of [989100001, 989100002].entries())
        teams.push(
          await scoped.team.create({
            data: {
              slug: `team-${i}`,
              name: `Team ${i}`,
              status: 'APPROVED',
              members: { create: { osuId, captain: true, position: 0 } },
            },
          }),
        );
      const created = (await act(manager, {
        type: 'match.create',
        code: 'MATCH1',
        stageId: stage.id,
        teamAId: teams[0].id,
        teamBId: teams[1].id,
        refereeIds: [],
        scheduledAt: '2090-01-01T12:00:00Z',
      })) as { id: string };
      const m = await scoped.match.findUniqueOrThrow({ where: { id: created.id } });
      expect((m.rules as { bestOf: number }).bestOf).toBe(index ? 3 : 1);
      expect(m.poolRevisionId).toBe(revision.id);
      if (index)
        await expect(
          matchData(await actor(staffId, a), new URL(`https://test/?id=${m.id}`), 'match'),
        ).rejects.toMatchObject({ status: 404 });
      else {
        const update = async (type: string, fields = {}) =>
          act(manager, {
            type,
            id: m.id,
            baseVersion: (await scoped.match.findUniqueOrThrow({ where: { id: m.id } })).version,
            ...fields,
          });
        await update('match.start');
        await update('match.roll', { rollA: 90, rollB: 1, firstPickSide: 'A', firstBanSide: 'B' });
        await update('match.draft', { kind: 'PICK', side: 'A', slotName: 'NM1' });
        const picked = await scoped.matchMapAction.findFirstOrThrow({ where: { matchId: m.id } });
        await update('match.winner', {
          actionId: picked.id,
          winnerSide: 'A',
          reason: 'Winner confirmed',
          notes: '',
        });
        expect(
          await scoped.matchMapResult.findFirstOrThrow({ where: { matchId: m.id } }),
        ).toMatchObject({ scoreA: null, scoreB: null, entryMode: 'WINNER_ONLY', winnerSide: 'A' });
        expect(await scoped.match.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({
          scoreA: 1,
          scoreB: 0,
          winnerSide: 'A',
        });
        await update('match.undo', { reason: 'Correct wrong pick' });
        expect((await scoped.match.findUniqueOrThrow({ where: { id: m.id } })).scoreA).toBe(0);
        await update('match.lobby', { multiplayerId: 987654321, lobbyUrl: '' });
        await update('match.draft', { kind: 'PICK', side: 'A', slotName: 'NM1' });
        const proposal = await scoped.multiplayerGame.create({
          data: {
            matchId: m.id,
            multiplayerId: 987654321,
            gameId: '123456789',
            beatmapId: 989200001,
            slotName: 'NM1',
            proposal: {
              startTime: new Date(Date.now() + 1000).toISOString(),
              scoreA: 100,
              scoreB: 50,
              players: [
                { osuId: 989100001, side: 'A', score: 100, accuracy: 99, mods: ['NF'] },
                { osuId: 989100002, side: 'B', score: 50, accuracy: 98, mods: ['NF'] },
              ],
            },
          },
        });
        await update('match.import', {
          proposalId: proposal.id,
          reason: 'Reviewed official lobby scores',
        });
        expect((await scoped.match.findUniqueOrThrow({ where: { id: m.id } })).scoreA).toBe(1);
        await expect(
          update('match.import', { proposalId: proposal.id, reason: 'Repeated confirmation' }),
        ).rejects.toMatchObject({ status: 409 });
        expect((await scoped.match.findUniqueOrThrow({ where: { id: m.id } })).scoreA).toBe(1);
      }
    }
    expect(
      await db.teamMember.count({ where: { osuId: 989100001, tournamentId: { in: ids } } }),
    ).toBe(2);
    const foreign = await scopedDb(db, b).match.findFirstOrThrow({ where: { code: 'MATCH1' } });
    await expect(
      act(await actor(staffId, a), {
        type: 'match.delete',
        id: foreign.id,
        baseVersion: foreign.version,
        confirmCode: foreign.code,
        reason: 'Attempt foreign deletion',
      }),
    ).rejects.toThrow();
    expect(await scopedDb(db, b).match.findUnique({ where: { id: foreign.id } })).not.toBeNull();
  });
});
