import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import { actorForTournament } from '../src/lib/auth';
import { tournamentAction } from '../src/lib/tournaments-service';
import { executeAction } from '../src/lib/admin-service';
import { actionSchema } from '../src/lib/validation';
import { inheritedRules } from '../src/lib/gameplay-scoring';
import { scoringImpact } from '../src/lib/gameplay-scoring-service';
import type { Actor } from '../src/lib/permissions';
import { matchOptions } from '../src/lib/matches-service';
const prefix = `scoring-${Date.now()}`;
const ids: string[] = [];
const users: string[] = [];
let actor: Actor;
beforeAll(async () => {
  if (new URL(process.env.DATABASE_URL!).pathname !== '/tournament_platform_test')
    throw Error('Test database only');
  const user = await db.user.create({
    data: {
      osuId: 978000001,
      username: prefix,
      avatarUrl: '',
      profileUrl: '',
      platformAdmin: true,
    },
    include: { roles: { include: { role: { include: { permissions: true } } } } },
  });
  actor = actorForTournament(user, 'main');
  users.push(user.id);
});
afterAll(async () => {
  await db.match.deleteMany({ where: { tournamentId: { in: ids } } });
  await db.qualifierLobby.deleteMany({ where: { tournamentId: { in: ids } } });
  await db.tournamentStage.deleteMany({ where: { tournamentId: { in: ids } } });
  await db.auditLog.deleteMany({ where: { tournamentId: { in: ids } } });
  await db.role.deleteMany({ where: { tournamentId: { in: ids } } });
  await db.tournament.deleteMany({ where: { id: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});
async function create(mode: 'SCORE_V1' | 'SCORE_V2' | 'LAZER') {
  const r = await tournamentAction(actor, {
    type: 'create',
    name: prefix,
    acronym: 'TEST',
    slug: `${prefix}-${ids.length}`,
    description: '',
    gameMode: 'osu',
    format: 'SOLO',
    gameplayScoring: mode,
  });
  ids.push(r.id);
  return { ...actor, tournamentId: r.id };
}
async function save(
  a: Actor,
  mode: 'SCORE_V1' | 'SCORE_V2' | 'LAZER' | null,
  scoringReview = false,
) {
  const t = await db.tournament.findUniqueOrThrow({
    where: { id: a.tournamentId },
    include: { settings: true },
  });
  return executeAction(
    a,
    actionSchema.parse({
      ...t,
      ...t.settings,
      type: 'settings.save',
      gameplayScoring: mode,
      scoringReview,
    }),
  );
}
describe.sequential('persistent gameplay configuration', () => {
  it('requires explicit review to resolve migrated scoring and never converts historical rules', async () => {
    const a = await create('SCORE_V1');
    const stage = await db.tournamentStage.create({
      data: { tournamentId: a.tournamentId, name: 'Final', slug: 'final' },
    });
    const rules = JSON.parse(JSON.stringify(inheritedRules({}, 'SCORE_V1')));
    const match = await db.match.create({
      data: {
        tournamentId: a.tournamentId,
        code: 'historical',
        stageId: stage.id,
        status: 'COMPLETED',
        participants: {},
        rules,
      },
    });
    await db.tournamentSettings.update({
      where: { tournamentId: a.tournamentId },
      data: { gameplayScoring: null },
    });
    expect((await matchOptions(a)).scoringNeedsReview).toBe(true);
    await save(a, null);
    await expect(save(a, 'SCORE_V1')).rejects.toThrow('locked');
    await expect(save(a, 'SCORE_V2', true)).rejects.toThrow('locked');
    await save(a, 'SCORE_V1', true);
    await expect(save(a, null)).rejects.toThrow('cannot be cleared');
    expect((await db.match.findUniqueOrThrow({ where: { id: match.id } })).rules).toEqual(rules);
    expect(
      (await db.tournamentSettings.findUniqueOrThrow({ where: { tournamentId: a.tournamentId } }))
        .gameplayScoring,
    ).toBe('SCORE_V1');
  });
  it('rejects Best-of rules for qualifiers even through direct API actions', async () => {
    const a = await create('SCORE_V2');
    const stage = await db.tournamentStage.create({
      data: {
        tournamentId: a.tournamentId,
        name: 'Qualifiers',
        slug: 'qualifiers',
        kind: 'QUALIFIERS',
      },
    });
    await expect(
      executeAction(
        a,
        actionSchema.parse({
          type: 'match.rules.save',
          stageId: stage.id,
          baseHash: '0'.repeat(64),
          rules: inheritedRules({}, 'SCORE_V2'),
        }),
      ),
    ).rejects.toThrow('full-pool');
  });
  it('keeps scoring isolated and allows changes before competition starts', async () => {
    const a = await create('SCORE_V1'),
      b = await create('LAZER');
    await save(a, 'SCORE_V2');
    expect(
      (await db.tournamentSettings.findUniqueOrThrow({ where: { tournamentId: a.tournamentId } }))
        .gameplayScoring,
    ).toBe('SCORE_V2');
    expect(
      (await db.tournamentSettings.findUniqueOrThrow({ where: { tournamentId: b.tournamentId } }))
        .gameplayScoring,
    ).toBe('LAZER');
  });
  it('updates only unplayed snapshots and rejects changes after scoring begins', async () => {
    const a = await create('SCORE_V1');
    const stage = await db.tournamentStage.create({
      data: { tournamentId: a.tournamentId, name: 'Final', slug: 'final' },
    });
    const match = await db.match.create({
      data: {
        tournamentId: a.tournamentId,
        code: '1',
        stageId: stage.id,
        participants: {},
        rules: JSON.parse(JSON.stringify(inheritedRules({}, 'SCORE_V1'))),
      },
    });
    await save(a, 'SCORE_V2');
    const updated = await db.match.findUniqueOrThrow({ where: { id: match.id } });
    expect(updated.rules).toMatchObject({ gameplayScoring: 'SCORE_V2', scoreMode: 'SCORE_V2' });
    expect(
      await db.matchEvent.count({ where: { matchId: match.id, kind: 'scoring.configuration' } }),
    ).toBe(1);
    await db.match.update({ where: { id: match.id }, data: { status: 'IN_PROGRESS' } });
    await expect(save(a, 'LAZER')).rejects.toThrow('locked');
    const impact = await scoringImpact(db, a.tournamentId!);
    expect(impact.affected.map((m) => m.id)).toContain(match.id);
    expect((await db.match.findUniqueOrThrow({ where: { id: match.id } })).rules).toEqual(
      updated.rules,
    );
  });
  it('does not allow a tournament administrator to update another tournament', async () => {
    const a = await create('SCORE_V1'),
      b = await create('SCORE_V2');
    const role = await db.role.findFirstOrThrow({
      where: { tournamentId: a.tournamentId, templateKey: 'Owner' },
    });
    const user = await db.user.create({
      data: {
        osuId: 978000002,
        username: `${prefix}-scoped`,
        avatarUrl: '',
        profileUrl: '',
        roles: { create: { tournamentId: a.tournamentId, roleId: role.id } },
      },
      include: { roles: { include: { role: { include: { permissions: true } } } } },
    });
    users.push(user.id);
    const scoped = actorForTournament(user, a.tournamentId!);
    await expect(save({ ...scoped, tournamentId: b.tournamentId }, 'LAZER')).rejects.toThrow();
    expect(
      (await db.tournamentSettings.findUniqueOrThrow({ where: { tournamentId: b.tournamentId } }))
        .gameplayScoring,
    ).toBe('SCORE_V2');
  });
});
