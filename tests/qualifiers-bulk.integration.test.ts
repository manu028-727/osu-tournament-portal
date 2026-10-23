import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import { assertTestDatabase } from '../src/lib/instance';
import { ALL_PERMISSIONS, type Actor } from '../src/lib/permissions';
import { qualifierPolicySchema } from '../src/lib/qualifier-policy';
import { qualifierActionSchema } from '../src/lib/qualifiers-validation';
import { applyQualifierAction, qualifierData } from '../src/lib/qualifiers-service';
import { qualifierSessionPlan } from '../src/lib/qualifier-scheduling';
import type { QualifierRoster } from '../src/lib/qualifiers-bulk';
import { inheritedRules } from '../src/lib/gameplay-scoring';

assertTestDatabase(process.env.DATABASE_URL);
const prefix = `qbulk-${randomUUID()}`;
const tournamentId = prefix,
  outsideId = `${prefix}-outside`;
const participantIds: number[] = [],
  userIds: string[] = [];
const teams: { id: string; osuId: number }[] = [];
const stages: string[] = [];
const policy = qualifierPolicySchema.parse({
  runs: 2,
  requiredPlayers: 1,
  runSelection: 'BEST_COMPLETE_RUN',
  method: 'Z_SUM',
});
const rules = inheritedRules({ teamSize: 1, multiplierMode: 'NONE' }, 'SCORE_V2');
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
let actor: Actor,
  referee: Actor,
  otherRefereeId: string,
  outsiderTeamId: string,
  outsideLobbyId: string;
let revisionId: string;
const at = (hour: number) => new Date(Date.UTC(2030, 5, 12, hour)).toISOString();
const apply = (input: unknown, who = actor) =>
  db.$transaction((tx) => applyQualifierAction(tx, who, qualifierActionSchema.parse(input)), {
    timeout: 20000,
  });
const session = (code: string, teamIds: string[] = [], extra: object = {}) => ({
  code,
  stageId: stages[0],
  teamIds,
  refereeIds: [],
  scheduledAt: null,
  notes: '',
  ...extra,
});
const create = (code: string, teamIds: string[] = [], extra: object = {}) =>
  apply({ type: 'qualifier.create', ...session(code, teamIds, extra) });
const record = (id: string) =>
  db.qualifierLobby.findUniqueOrThrow({
    where: { id },
    include: {
      entries: true,
      scores: true,
      assignments: true,
      events: { orderBy: { version: 'asc' } },
    },
  });

beforeAll(async () => {
  for (const id of [tournamentId, outsideId]) {
    await db.tournament.create({
      data: {
        id,
        slug: id,
        name: 'Qualifier bulk test',
        acronym: 'QA',
        description: '',
        settings: {
          create: {
            gameplayScoring: 'SCORE_V2',
            matchRules: json(rules),
            socialLinks: [],
            importantDates: [],
            navigation: [],
            footer: '',
          },
        },
      },
    });
  }
  for (let i = 0; i < 3; i++) {
    const user = await db.user.create({
      data: {
        osuId: randomInt(1_600_000_000, 1_610_000_000),
        username: `${prefix}-${i}`,
        avatarUrl: '',
        profileUrl: '',
      },
    });
    userIds.push(user.id);
  }
  actor = {
    id: userIds[0],
    osuId: 1,
    username: prefix,
    avatarUrl: '',
    roles: [],
    tournamentId,
    permissions: [...ALL_PERMISSIONS],
  };
  referee = {
    ...actor,
    id: userIds[1],
    permissions: ['matches.view_all', 'matches.assign_referees', 'matches.manage_assigned'],
  };
  otherRefereeId = userIds[2];
  const role = await db.role.create({
    data: {
      tournamentId,
      name: 'Referee QA',
      permissions: { create: referee.permissions.map((permissionKey) => ({ permissionKey })) },
    },
  });
  await db.userRole.createMany({
    data: [referee.id, otherRefereeId].map((userId) => ({ userId, roleId: role.id, tournamentId })),
  });
  for (let i = 0; i < 20; i++) {
    const osuId = randomInt(1_620_000_000, 1_630_000_000);
    await db.participant.create({ data: { osuId, username: `${prefix}-${i}`, avatarUrl: '' } });
    participantIds.push(osuId);
    const team = await db.team.create({
      data: {
        tournamentId,
        name: `Entrant ${i + 1}`,
        slug: `entrant-${i}`,
        format: 'INDIVIDUAL',
        status: 'APPROVED',
        members: { create: { osuId, captain: true, position: 0 } },
      },
    });
    teams.push({ id: team.id, osuId });
  }
  const outsideTeam = await db.team.create({
    data: {
      tournamentId: outsideId,
      name: 'Outside',
      slug: 'outside',
      format: 'INDIVIDUAL',
      status: 'APPROVED',
    },
  });
  outsiderTeamId = outsideTeam.id;
  const beatmap = await db.beatmap.findFirstOrThrow();
  for (const [i, owner] of [tournamentId, tournamentId, outsideId].entries()) {
    const stage = await db.tournamentStage.create({
      data: {
        tournamentId: owner,
        name: `Qualifiers ${i}`,
        slug: `q-${i}`,
        kind: 'QUALIFIERS',
        qualifierPolicy: json(policy),
        matchRules: json(rules),
        mappool: { create: {} },
      },
      include: { mappool: true },
    });
    const revision = await db.mappoolRevision.create({
      data: {
        tournamentId: owner,
        mappoolId: stage.mappool!.id,
        slots: {
          create: {
            name: 'NM1',
            category: 'NM',
            categoryName: 'No Mod',
            color: '#90bdf4',
            position: 0,
            beatmapId: beatmap.id,
            metadata: json(beatmap.metadata),
          },
        },
      },
    });
    await db.mappool.update({
      where: { id: stage.mappool!.id },
      data: { state: 'PUBLISHED', publishedRevisionId: revision.id },
    });
    stages.push(stage.id);
    if (i === 0) revisionId = revision.id;
    if (i === 2) {
      const lobby = await db.qualifierLobby.create({
        data: {
          tournamentId: outsideId,
          code: 'OUTSIDE',
          stageId: stage.id,
          poolRevisionId: revision.id,
          participants: [],
          rules: json(rules),
          policy: json(policy),
        },
      });
      outsideLobbyId = lobby.id;
    }
  }
});
afterEach(async () => {
  await db.qualifierStanding.deleteMany({ where: { tournamentId } });
  await db.qualifierLobby.deleteMany({ where: { tournamentId } });
  await db.match.deleteMany({ where: { tournamentId } });
});
afterAll(async () => {
  const ids = [tournamentId, outsideId];
  await db.qualifierLobby.deleteMany({ where: { tournamentId: { in: ids } } });
  await db.tournamentStage.deleteMany({ where: { tournamentId: { in: ids } } });
  await db.team.deleteMany({ where: { tournamentId: { in: ids } } });
  await db.role.deleteMany({ where: { tournamentId: { in: ids } } });
  await db.auditLog.deleteMany({ where: { tournamentId: { in: ids } } });
  await db.tournament.deleteMany({ where: { id: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.participant.deleteMany({ where: { osuId: { in: participantIds } } });
  await db.$disconnect();
});

describe.sequential('qualifier bulk scheduling, assignments, and transfers', () => {
  it('previews sequential lobbies and validates patch semantics', () => {
    const plan = qualifierSessionPlan({
      stageId: 'stage',
      prefix: 'Q',
      firstNumber: 3,
      count: 3,
      entrantsPerLobby: 2,
      teamIds: ['a', 'b', 'c'],
      refereeIds: ['ref'],
      startAt: at(10),
      intervalMinutes: 60,
    });
    expect(plan.map((row) => [row.code, row.teamIds, row.scheduledAt])).toEqual([
      ['Q3', ['a', 'b'], at(10)],
      ['Q4', ['c'], at(11)],
      ['Q5', [], at(12)],
    ]);
    expect(() =>
      qualifierSessionPlan({
        stageId: 'stage',
        prefix: 'Q',
        firstNumber: 1,
        count: 1,
        entrantsPerLobby: 1,
        teamIds: ['a', 'b'],
        refereeIds: [],
        startAt: null,
        intervalMinutes: 0,
      }),
    ).toThrow('Add more sessions');
    const base = { type: 'qualifier.bulk.schedule', lobbies: [{ id: 'a', baseVersion: 1 }] };
    expect(qualifierActionSchema.safeParse(base).success).toBe(false);
    expect(
      qualifierActionSchema.safeParse({ ...base, shiftMinutes: 1, scheduledAt: null }).success,
    ).toBe(false);
    expect(qualifierActionSchema.safeParse({ ...base, refereeIds: [] }).success).toBe(true);
    expect(
      qualifierActionSchema.safeParse({
        ...base,
        notes: '',
        lobbies: [base.lobbies[0], base.lobbies[0]],
      }).success,
    ).toBe(false);
  });

  it('creates several sessions using the stage policy and immutable pool snapshots', async () => {
    const result = await apply({
      type: 'qualifier.batch.create',
      sessions: [
        session('Q1', [teams[0].id], {
          scheduledAt: at(10),
          refereeIds: [referee.id],
          notes: 'Keep this',
        }),
        session('Q2', [teams[1].id], { scheduledAt: at(11), refereeIds: [referee.id] }),
        session('Q3'),
      ],
    });
    expect(result.created).toBe(3);
    for (const lobby of await db.qualifierLobby.findMany({
      where: { tournamentId },
      include: { events: true },
    })) {
      expect(lobby).toMatchObject({
        status: 'SCHEDULED',
        version: 1,
        policy,
        poolRevisionId: revisionId,
        gameplayScoring: 'SCORE_V2',
      });
      expect(lobby.events).toHaveLength(1);
    }
    const data = await qualifierData(actor, new URL('http://test'));
    expect(data.lobbies).toHaveLength(3);
    expect(data.options?.qualifierStages[0].policy).toMatchObject(policy);
  });

  it('rolls back the whole batch on duplicate entrants, codes, capacity, or referee conflicts', async () => {
    for (const extra of [
      session('Q2', [teams[0].id]),
      session('Q1', [teams[1].id]),
      session(
        'Q2',
        teams.slice(1, 18).map((team) => team.id),
      ),
      session('Q2', [teams[1].id], { scheduledAt: at(10), refereeIds: [referee.id] }),
    ]) {
      await expect(
        apply({
          type: 'qualifier.batch.create',
          sessions: [
            session('Q1', [teams[0].id], { scheduledAt: at(10), refereeIds: [referee.id] }),
            extra,
          ],
        }),
      ).rejects.toThrow();
      expect(await db.qualifierLobby.count({ where: { tournamentId } })).toBe(0);
    }
  });

  it('shifts times and replaces assignments without changing notes, participants, policies, or scores', async () => {
    const a = await create('Q1', [teams[0].id], {
      scheduledAt: at(10),
      refereeIds: [referee.id],
      notes: 'Keep this',
    });
    const b = await create('Q2', [teams[1].id], { scheduledAt: at(11), refereeIds: [referee.id] });
    const before = await record(a.id);
    const result = await apply(
      {
        type: 'qualifier.bulk.schedule',
        lobbies: [a, b].map((lobby) => ({ id: lobby.id, baseVersion: 1 })),
        shiftMinutes: 60,
        refereeIds: [otherRefereeId],
      },
      referee,
    );
    expect(result.updated).toBe(2);
    const after = await record(a.id);
    expect(after).toMatchObject({
      scheduledAt: new Date(at(11)),
      notes: before.notes,
      participants: before.participants,
      rules: before.rules,
      policy: before.policy,
      version: 2,
    });
    expect(after.assignments.map((ref) => ref.userId)).toEqual([otherRefereeId]);
    expect(after.events[1].data).toMatchObject({
      before: { refereeIds: [referee.id], notes: 'Keep this' },
      after: { refereeIds: [otherRefereeId], notes: 'Keep this' },
    });
    expect((await record(b.id)).scheduledAt).toEqual(new Date(at(12)));
  });

  it('can clear schedule and assignments explicitly while retaining omitted values', async () => {
    const a = await create('Q1', [teams[0].id], {
      scheduledAt: at(10),
      refereeIds: [referee.id],
      notes: 'Keep this',
    });
    await apply({
      type: 'qualifier.bulk.schedule',
      lobbies: [{ id: a.id, baseVersion: 1 }],
      refereeIds: [],
    });
    expect(await record(a.id)).toMatchObject({
      scheduledAt: new Date(at(10)),
      notes: 'Keep this',
      assignments: [],
      version: 2,
    });
    await apply({
      type: 'qualifier.bulk.schedule',
      lobbies: [{ id: a.id, baseVersion: 2 }],
      scheduledAt: null,
      notes: '',
    });
    expect(await record(a.id)).toMatchObject({ scheduledAt: null, notes: '', version: 3 });
  });

  it('rejects stale, started, missing-time, and finalized changes without partial persistence', async () => {
    const a = await create('Q1', [teams[0].id]);
    const b = await create('Q2', [teams[1].id]);
    const input = {
      type: 'qualifier.bulk.schedule',
      lobbies: [
        { id: a.id, baseVersion: 1 },
        { id: b.id, baseVersion: 1 },
      ],
      notes: 'New notes',
    };
    await expect(
      apply({ ...input, lobbies: [input.lobbies[0], { id: b.id, baseVersion: 99 }] }),
    ).rejects.toThrow('changed');
    await expect(apply({ ...input, shiftMinutes: 60 })).rejects.toThrow('no time');
    await db.qualifierLobby.update({ where: { id: b.id }, data: { status: 'IN_PROGRESS' } });
    await expect(apply(input)).rejects.toThrow('already started');
    await db.qualifierLobby.update({ where: { id: b.id }, data: { status: 'SCHEDULED' } });
    await db.qualifierStanding.create({
      data: {
        tournamentId,
        stageId: stages[0],
        version: 1,
        sourceHash: prefix,
        snapshot: { state: 'FINALIZED', calculation: {} },
      },
    });
    await expect(apply(input)).rejects.toThrow('Finalized qualifier');
    expect(await record(a.id)).toMatchObject({ version: 1, notes: '' });
  });

  it('detects individual scheduling conflicts without false positives for different referee/time pairs', async () => {
    const a = await create('Q1', [teams[0].id], { scheduledAt: at(10), refereeIds: [referee.id] });
    const b = await create('Q2', [teams[1].id], {
      scheduledAt: at(11),
      refereeIds: [otherRefereeId],
    });
    await create('Q3', [teams[2].id], { scheduledAt: at(12), refereeIds: [referee.id] });
    await apply({
      type: 'qualifier.bulk.schedule',
      lobbies: [a, b].map((lobby) => ({ id: lobby.id, baseVersion: 1 })),
      shiftMinutes: 60,
    });
    expect((await record(a.id)).scheduledAt).toEqual(new Date(at(11)));
    await expect(
      apply({
        type: 'qualifier.bulk.schedule',
        lobbies: [{ id: a.id, baseVersion: 2 }],
        scheduledAt: at(12),
      }),
    ).rejects.toThrow('referee');
    await expect(
      create('Q4', [teams[0].id], { stageId: stages[1], scheduledAt: at(11) }),
    ).rejects.toThrow('participant');
  });

  it('correlates each proposed time with its own referees and players across qualifier sessions', async () => {
    const a = await create('Q1', [teams[0].id], { scheduledAt: at(8), refereeIds: [referee.id] });
    const b = await create('Q2', [teams[1].id], {
      scheduledAt: at(9),
      refereeIds: [otherRefereeId],
    });
    await create('OTHER1', [teams[0].id], {
      stageId: stages[1],
      scheduledAt: at(12),
      refereeIds: [referee.id],
    });
    await create('OTHER2', [teams[1].id], {
      stageId: stages[1],
      scheduledAt: at(11),
      refereeIds: [otherRefereeId],
    });
    await expect(
      apply({
        type: 'qualifier.bulk.schedule',
        lobbies: [a, b].map((lobby) => ({ id: lobby.id, baseVersion: 1 })),
        shiftMinutes: 180,
      }),
    ).resolves.toMatchObject({ updated: 2 });
    expect((await record(a.id)).scheduledAt).toEqual(new Date(at(11)));
    expect((await record(b.id)).scheduledAt).toEqual(new Date(at(12)));
    await expect(
      apply({
        type: 'qualifier.bulk.schedule',
        lobbies: [{ id: a.id, baseVersion: 2 }],
        scheduledAt: at(12),
        refereeIds: [],
      }),
    ).rejects.toThrow('participant');
    await expect(
      apply({
        type: 'qualifier.bulk.schedule',
        lobbies: [{ id: b.id, baseVersion: 2 }],
        scheduledAt: at(11),
      }),
    ).rejects.toThrow('referee');
  });

  it('correlates each proposed time with its own referees and players across elimination matches', async () => {
    const a = await create('Q1', [teams[0].id], { scheduledAt: at(8), refereeIds: [referee.id] });
    const b = await create('Q2', [teams[1].id], {
      scheduledAt: at(9),
      refereeIds: [otherRefereeId],
    });
    for (const [index, hour] of [12, 11].entries()) {
      const participant = {
        id: teams[index].id,
        name: `Entrant ${index}`,
        members: [{ osuId: teams[index].osuId, username: 'Entrant', captain: true }],
      };
      await db.match.create({
        data: {
          tournamentId,
          code: String(index + 1),
          stageId: stages[1],
          scheduledAt: at(hour),
          participants: { A: participant, B: { ...participant, id: null, members: [] } },
          rules: json(rules),
          assignments: { create: { userId: index ? otherRefereeId : referee.id } },
        },
      });
    }
    await expect(
      apply({
        type: 'qualifier.bulk.schedule',
        lobbies: [a, b].map((lobby) => ({ id: lobby.id, baseVersion: 1 })),
        shiftMinutes: 180,
      }),
    ).resolves.toMatchObject({ updated: 2 });
    await expect(
      apply({
        type: 'qualifier.bulk.schedule',
        lobbies: [{ id: a.id, baseVersion: 2 }],
        scheduledAt: at(12),
        refereeIds: [],
      }),
    ).rejects.toThrow('participant');
    await expect(
      apply({
        type: 'qualifier.bulk.schedule',
        lobbies: [{ id: b.id, baseVersion: 2 }],
        scheduledAt: at(11),
      }),
    ).rejects.toThrow('referee');
  });

  it('detects conflicts against elimination matches', async () => {
    const snapshot = {
      id: teams[0].id,
      name: 'Entrant',
      members: [{ osuId: teams[0].osuId, username: 'Entrant', captain: true }],
    };
    await db.match.create({
      data: {
        tournamentId,
        code: '1',
        stageId: stages[1],
        scheduledAt: at(10),
        participants: { A: snapshot, B: { ...snapshot, id: teams[1].id, members: [] } },
        rules: json(rules),
        assignments: { create: { userId: referee.id } },
      },
    });
    await expect(
      create('Q1', [teams[2].id], { scheduledAt: at(10), refereeIds: [referee.id] }),
    ).rejects.toThrow('referee');
    await expect(create('Q1', [teams[0].id], { scheduledAt: at(10) })).rejects.toThrow(
      'participant',
    );
  });

  it('moves entrants atomically while preserving snapshotted names, pool, policy, and history', async () => {
    const a = await create('Q1', [teams[0].id, teams[1].id], { notes: 'Keep this' });
    const b = await create('Q2', [teams[2].id]);
    const before = await record(a.id);
    await apply({
      type: 'qualifier.participants.move',
      fromLobbyId: a.id,
      sourceVersion: 1,
      toLobbyId: b.id,
      baseVersion: 1,
      teamIds: [teams[0].id],
    });
    const source = await record(a.id),
      target = await record(b.id);
    expect(source.entries.map((entry) => [entry.teamId, entry.position])).toEqual([
      [teams[1].id, 0],
    ]);
    expect(target.entries.map((entry) => entry.teamId)).toEqual([teams[2].id, teams[0].id]);
    expect(target.participants).toContainEqual((before.participants as unknown[])[0]);
    expect(source).toMatchObject({
      policy: before.policy,
      poolRevisionId: before.poolRevisionId,
      notes: 'Keep this',
      version: 2,
    });
    expect(source.events.map((event) => event.kind)).toEqual([
      'qualifier.create',
      'qualifier.participants.move',
    ]);
    expect(target.events).toHaveLength(2);
    const reloaded = await qualifierData(actor, new URL(`http://test?id=${b.id}`));
    expect(
      (reloaded.lobbies[0].participants as unknown as QualifierRoster).map((team) => team.id),
    ).toEqual([teams[2].id, teams[0].id]);
    expect(reloaded.lobbies[0].canTransfer).toBe(true);
  });

  it('assigns unassigned entrants and rejects repeated assignments', async () => {
    const lobby = await create('Q1');
    const input = {
      type: 'qualifier.participants.move',
      fromLobbyId: null,
      toLobbyId: lobby.id,
      baseVersion: 1,
      teamIds: [teams[0].id, teams[1].id],
    };
    await apply(input);
    await expect(apply({ ...input, baseVersion: 2 })).rejects.toThrow('already contains');
    expect((await record(lobby.id)).entries).toHaveLength(2);
  });

  it('rejects transfers with stale versions, historical scores, prior starts, mismatched stages, or capacity overflow', async () => {
    const source = await create('Q1', [teams[0].id]);
    const full = await create(
      'Q2',
      teams.slice(1, 17).map((team) => team.id),
    );
    const target = await create('Q3');
    const otherStage = await create('Q4', [], { stageId: stages[1] });
    const move = {
      type: 'qualifier.participants.move',
      fromLobbyId: source.id,
      sourceVersion: 1,
      toLobbyId: target.id,
      baseVersion: 1,
      teamIds: [teams[0].id],
    };
    await expect(apply({ ...move, sourceVersion: 2 })).rejects.toThrow('changed');
    await expect(apply({ ...move, toLobbyId: full.id })).rejects.toThrow('sixteen');
    await expect(apply({ ...move, toLobbyId: otherStage.id })).rejects.toThrow('same stage');
    await db.qualifierScore.create({
      data: {
        lobbyId: source.id,
        osuId: teams[0].osuId,
        slotName: 'NM1',
        raw: 100,
        adjusted: 100,
        mods: ['NF'],
      },
    });
    await expect(apply(move)).rejects.toThrow('recorded history');
    await db.qualifierScore.deleteMany({ where: { lobbyId: source.id } });
    await db.qualifierEvent.create({
      data: {
        lobbyId: source.id,
        version: 2,
        kind: 'qualifier.status',
        data: { command: 'START' },
        actorId: actor.id,
      },
    });
    await expect(apply(move)).rejects.toThrow('recorded history');
    expect((await record(source.id)).entries).toHaveLength(1);
    expect((await record(target.id)).entries).toHaveLength(0);
  });

  it('enforces tournament and per-operation permissions, including unassigned-lobby scheduling', async () => {
    const own = await create('Q1');
    await expect(
      apply({ type: 'qualifier.batch.create', sessions: [session('Q2')] }, referee),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      apply(
        {
          type: 'qualifier.participants.move',
          fromLobbyId: null,
          toLobbyId: own.id,
          baseVersion: 1,
          teamIds: [teams[0].id],
        },
        referee,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      apply({
        type: 'qualifier.bulk.schedule',
        lobbies: [{ id: outsideLobbyId, baseVersion: 1 }],
        notes: 'Bad',
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(create('BAD', [outsiderTeamId])).rejects.toThrow('approved entrants');
    await apply(
      {
        type: 'qualifier.schedule',
        id: own.id,
        baseVersion: 1,
        scheduledAt: at(10),
        refereeIds: [referee.id],
        notes: 'Assigned by referee',
      },
      referee,
    );
    expect((await record(own.id)).assignments.map((ref) => ref.userId)).toEqual([referee.id]);
    expect((await record(outsideLobbyId)).version).toBe(1);
  });

  it('serializes concurrent edits and duplicate entrant creation safely', async () => {
    const own = await create('Q1');
    const changes = await Promise.allSettled(
      ['One', 'Two'].map((notes) =>
        apply({
          type: 'qualifier.bulk.schedule',
          lobbies: [{ id: own.id, baseVersion: 1 }],
          notes,
        }),
      ),
    );
    expect(changes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await record(own.id)).version).toBe(2);
    const creations = await Promise.allSettled([
      create('Q2', [teams[0].id]),
      create('Q3', [teams[0].id]),
    ]);
    expect(creations.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.qualifierEntry.count({ where: { tournamentId, teamId: teams[0].id } })).toBe(1);
  });

  it.each(['BEST_PER_MAP', 'BEST_COMPLETE_RUN', 'FIRST_RUN', 'SECOND_RUN'] as const)(
    'preserves the %s policy through batch creation and scheduling',
    async (runSelection) => {
      const configured = { ...policy, runSelection };
      await db.tournamentStage.update({
        where: { id: stages[0] },
        data: { qualifierPolicy: json(configured) },
      });
      try {
        const result = await apply({
          type: 'qualifier.batch.create',
          sessions: [session('Q1', [teams[0].id])],
        });
        const lobby = result.lobbies![0];
        await apply({
          type: 'qualifier.bulk.schedule',
          lobbies: [{ id: lobby.id, baseVersion: 1 }],
          scheduledAt: at(10),
        });
        expect((await record(lobby.id)).policy).toMatchObject(configured);
      } finally {
        await db.tournamentStage.update({
          where: { id: stages[0] },
          data: { qualifierPolicy: json(policy) },
        });
      }
    },
  );
});
