import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import type { Prisma } from '../src/generated/prisma/client';
import { assertTestDatabase } from '../src/lib/instance';
import { ALL_PERMISSIONS, type Actor } from '../src/lib/permissions';
import { inheritedRules } from '../src/lib/gameplay-scoring';
import { qualifierPolicySchema } from '../src/lib/qualifier-policy';
import { matchesSchedulingActionSchema } from '../src/lib/matches-bulk-validation';
import { applyBulkScheduleAction } from '../src/lib/matches-bulk-service';
import { parseMatchSchedulePaste } from '../src/lib/matches-schedule-paste';
import type { MatchParticipants } from '../src/lib/matches-service';
import { applyMatchAction } from '../src/lib/matches-service';
import { matchActionSchema } from '../src/lib/matches-validation';

assertTestDatabase(process.env.DATABASE_URL);
const tournamentId = `match-bulk-${randomUUID()}`,
  outsideId = `${tournamentId}-outside`;
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const at = (hour: number) => new Date(Date.UTC(2030, 5, 12, hour)).toISOString();
const rules = inheritedRules(
  {
    teamSize: 1,
    bestOf: 3,
    bansPerTeam: 0,
    enableTiebreaker: false,
    freeModRequiredHD: 0,
    freeModRequiredHR: 0,
  },
  'SCORE_V2',
);
const teams: { id: string; osuId: number; snapshot: MatchParticipants['A'] }[] = [];
const users: string[] = [],
  stages: { id: string; revisionId: string }[] = [];
let actor: Actor,
  count = 0,
  outsideStageId: string;
const patch = (matches: { id: string; version: number }[], fields: object) => ({
  type: 'matches.bulk.schedule',
  matches: matches.map((match) => ({ id: match.id, baseVersion: match.version })),
  ...fields,
});
const apply = (input: unknown, who = actor) =>
  db.$transaction(
    (tx) =>
      applyBulkScheduleAction(tx, who, tournamentId, matchesSchedulingActionSchema.parse(input)),
    { timeout: 20000 },
  );
const read = (id: string) =>
  db.match.findUniqueOrThrow({
    where: { id },
    include: {
      assignments: true,
      actions: true,
      results: true,
      events: { orderBy: { version: 'asc' } },
    },
  });
function create(
  a = 0,
  b = 1,
  scheduledAt: string | null = at(8),
  refs: string[] = [],
  extra: Partial<Prisma.MatchUncheckedCreateInput> = {},
) {
  return db.match.create({
    data: {
      tournamentId,
      code: String(++count),
      stageId: stages[0].id,
      poolRevisionId: stages[0].revisionId,
      teamAId: teams[a].id,
      teamBId: teams[b].id,
      participants: json({ A: teams[a].snapshot, B: teams[b].snapshot }),
      rules: json(rules),
      scheduledAt,
      source: {
        worksheet: 'Archived match',
        importedAt: '2030-01-01',
        nested: { keep: true },
        referee: 'Original referee',
        red: 'Original red',
        blue: 'Original blue',
      },
      notes: 'Original note',
      assignments: { create: refs.map((userId, index) => ({ userId, primary: index === 0 })) },
      events: {
        create: {
          version: 1,
          actorId: actor.id,
          kind: 'match.create',
          data: { origin: 'Isolated QA' },
        },
      },
      ...extra,
    },
  });
}
function qualifier(code: string, teamIndexes: number[], hour: number, refereeId?: string) {
  return db.qualifierLobby.create({
    data: {
      tournamentId,
      code,
      stageId: stages[2].id,
      poolRevisionId: stages[2].revisionId,
      participants: json(teamIndexes.map((index) => teams[index].snapshot)),
      rules: json(rules),
      policy: json(qualifierPolicySchema.parse({})),
      scheduledAt: at(hour),
      assignments: { create: refereeId ? [{ userId: refereeId }] : [] },
    },
  });
}

beforeAll(async () => {
  for (const id of [tournamentId, outsideId])
    await db.tournament.create({
      data: {
        id,
        slug: id,
        name: id,
        acronym: 'QA',
        description: '',
        settings: {
          create: {
            matchRules: json(rules),
            gameplayScoring: 'SCORE_V2',
            socialLinks: [],
            importantDates: [],
            navigation: [],
            footer: '',
          },
        },
      },
    });
  for (let index = 0; index < 3; index++) {
    const user = await db.user.create({
      data: {
        osuId: randomInt(1_650_000_000, 1_660_000_000),
        username: `${tournamentId}-${index}`,
        avatarUrl: '',
        profileUrl: '',
      },
    });
    users.push(user.id);
  }
  actor = {
    id: users[0],
    osuId: 1,
    username: 'Manager',
    avatarUrl: '',
    roles: [],
    permissions: [...ALL_PERMISSIONS],
    tournamentId,
  };
  const role = await db.role.create({
    data: {
      tournamentId,
      name: 'Referee QA',
      permissions: {
        create: ['matches.view_all', 'matches.manage_assigned'].map((permissionKey) => ({
          permissionKey,
        })),
      },
    },
  });
  await db.userRole.createMany({
    data: users.slice(1).map((userId) => ({ tournamentId, roleId: role.id, userId })),
  });
  for (let index = 0; index < 8; index++) {
    const participant = await db.participant.create({
      data: {
        osuId: randomInt(1_670_000_000, 1_680_000_000),
        username: `Entrant ${index}`,
        avatarUrl: '',
      },
    });
    const team = await db.team.create({
      data: {
        tournamentId,
        name: `Entrant ${index}`,
        slug: `entrant-${index}`,
        status: 'APPROVED',
        format: 'INDIVIDUAL',
        members: { create: { osuId: participant.osuId, captain: true, position: 0 } },
      },
    });
    teams.push({
      id: team.id,
      osuId: participant.osuId,
      snapshot: {
        id: team.id,
        name: team.name,
        slug: team.slug,
        format: team.format,
        logoImageId: null,
        members: [
          {
            osuId: participant.osuId,
            username: participant.username,
            avatarUrl: '',
            captain: true,
            substitute: false,
          },
        ],
      },
    });
  }
  const map = await db.beatmap.findFirstOrThrow();
  for (let index = 0; index < 6; index++) {
    const stage = await db.tournamentStage.create({
      data: {
        tournamentId,
        name: `Stage ${index}`,
        slug: `stage-${index}`,
        kind: index === 2 ? 'QUALIFIERS' : 'ELIMINATION',
        matchRules: json({
          ...rules,
          bestOf: index === 1 ? 5 : index === 4 ? 11 : 3,
          teamSize: index === 5 ? 2 : 1,
        }),
        mappool: { create: {} },
      },
      include: { mappool: true },
    });
    const revision = await db.mappoolRevision.create({
      data: {
        tournamentId,
        mappoolId: stage.mappool!.id,
        slots: {
          create: Array.from({ length: 5 }, (_, position) => ({
            name: `NM${position + 1}`,
            category: 'NM',
            categoryName: 'No Mod',
            color: '#90bdf4',
            position,
            beatmapId: map.id,
            metadata: json(map.metadata),
          })),
        },
      },
    });
    await db.mappool.update({
      where: { id: stage.mappool!.id },
      data: {
        state: index === 3 ? 'DRAFT' : 'PUBLISHED',
        publishedRevisionId: index === 3 ? null : revision.id,
      },
    });
    stages.push({ id: stage.id, revisionId: revision.id });
  }
  outsideStageId = (
    await db.tournamentStage.create({
      data: { tournamentId: outsideId, name: 'Outside', slug: 'outside' },
    })
  ).id;
});
afterEach(async () => {
  await db.bracketNode.deleteMany({ where: { tournamentId } });
  await db.bracketRound.deleteMany({ where: { tournamentId } });
  await db.bracket.deleteMany({ where: { tournamentId } });
  await db.match.deleteMany({ where: { tournamentId } });
  await db.qualifierLobby.deleteMany({ where: { tournamentId } });
});
afterAll(async () => {
  await db.tournamentStage.deleteMany({
    where: { tournamentId: { in: [tournamentId, outsideId] } },
  });
  await db.team.deleteMany({ where: { tournamentId } });
  await db.role.deleteMany({ where: { tournamentId } });
  await db.tournament.deleteMany({ where: { id: { in: [tournamentId, outsideId] } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.participant.deleteMany({ where: { osuId: { in: teams.map((team) => team.osuId) } } });
  await db.$disconnect();
});

describe.sequential('atomic match bulk patches and pasted schedules', () => {
  it.each(['team', 'substitute', 'qualifier', 'referee'])(
    'rejects the same %s conflict through single, create and bulk scheduling',
    async (resource) => {
      const a = resource === 'team' || resource === 'qualifier' ? 0 : 2;
      const b = 3;
      const refs = resource === 'referee' ? [users[1]] : [];
      if (resource === 'qualifier') await qualifier('Conflict', [0], 8);
      else {
        const occupied = await create(0, 1, at(8), refs);
        if (resource === 'substitute')
          await db.match.update({
            where: { id: occupied.id },
            data: {
              participants: json({
                A: {
                  ...teams[0].snapshot,
                  members: [
                    ...teams[0].snapshot.members,
                    { ...teams[2].snapshot.members[0], substitute: true },
                  ],
                },
                B: teams[1].snapshot,
              }),
            },
          });
      }
      const candidate = await create(a, b, at(9), refs);
      const single = (input: unknown) =>
        db.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
          return applyMatchAction(tx, actor, matchActionSchema.parse(input));
        });
      await expect(
        single({
          type: 'match.schedule',
          id: candidate.id,
          baseVersion: candidate.version,
          scheduledAt: at(8),
          refereeIds: refs,
          notes: '',
        }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(apply(patch([candidate], { scheduledAt: at(8) }))).rejects.toMatchObject({
        status: 409,
      });
      await expect(
        single({
          type: 'match.create',
          code: `parity-${++count}`,
          stageId: stages[0].id,
          teamAId: teams[a].id,
          teamBId: teams[b].id,
          scheduledAt: at(8),
          refereeIds: refs,
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect((await read(candidate.id)).scheduledAt).toEqual(new Date(at(9)));
      expect((await read(candidate.id)).version).toBe(candidate.version);
    },
  );

  it('rejects tiebreaker-heavy pools consistently when creating a match', async () => {
    const stage = await db.tournamentStage.findUniqueOrThrow({ where: { id: stages[0].id } });
    try {
      await db.tournamentStage.update({
        where: { id: stage.id },
        data: { matchRules: json({ ...rules, enableTiebreaker: true }) },
      });
      await db.mappoolSlot.updateMany({
        where: { revisionId: stages[0].revisionId },
        data: { category: 'TB' },
      });
      await expect(
        db.$transaction((tx) =>
          applyMatchAction(
            tx,
            actor,
            matchActionSchema.parse({
              type: 'match.create',
              code: `pool-${++count}`,
              stageId: stage.id,
              teamAId: teams[0].id,
              teamBId: teams[1].id,
              refereeIds: [],
            }),
          ),
        ),
      ).rejects.toThrow('non-tiebreaker');
    } finally {
      await db.tournamentStage.update({
        where: { id: stage.id },
        data: { matchRules: stage.matchRules! },
      });
      await db.mappoolSlot.updateMany({
        where: { revisionId: stages[0].revisionId },
        data: { category: 'NM' },
      });
    }
  });
  it('validates explicit patches and rejects duplicates, no-ops, and ambiguous time changes', () => {
    const base = { type: 'matches.bulk.schedule', matches: [{ id: 'one', baseVersion: 1 }] };
    expect(matchesSchedulingActionSchema.safeParse(base).success).toBe(false);
    for (const fields of [
      { scheduledAt: null, shiftMinutes: 60 },
      { shiftMinutes: 0 },
      { refereeIds: ['r', 'r'] },
      { commentators: ['same', 'same'] },
    ])
      expect(matchesSchedulingActionSchema.safeParse({ ...base, ...fields }).success).toBe(false);
    expect(
      matchesSchedulingActionSchema.safeParse({
        ...base,
        streamer: '',
        commentators: [],
        notes: '',
        published: false,
      }).success,
    ).toBe(true);
    expect(
      matchesSchedulingActionSchema.safeParse({
        type: 'matches.batch.schedule',
        matches: [{ id: 'one', baseVersion: 1 }],
      }).success,
    ).toBe(false);
  });

  it('correlates each planned match with the correct referee and participant time', async () => {
    const a = await create(0, 1, at(8), [users[1]]),
      b = await create(2, 3, at(9), [users[2]]);
    await create(0, 4, at(12), [users[1]]);
    await create(2, 5, at(11), [users[2]]);
    await expect(apply(patch([a, b], { shiftMinutes: 180 }))).resolves.toEqual({ updated: 2 });
    expect((await read(a.id)).scheduledAt).toEqual(new Date(at(11)));
    expect((await read(b.id)).scheduledAt).toEqual(new Date(at(12)));
    await expect(
      apply(patch([await read(a.id)], { scheduledAt: at(12), refereeIds: [] })),
    ).rejects.toThrow('participant');
    await expect(apply(patch([await read(b.id)], { scheduledAt: at(11) }))).rejects.toThrow(
      'referee',
    );
  });

  it('correlates qualifier conflicts and checks participants even with no referees selected', async () => {
    const a = await create(0, 1, at(8), [users[1]]),
      b = await create(2, 3, at(9), [users[2]]);
    await qualifier('Q1', [0], 12, users[1]);
    await qualifier('Q2', [2], 11, users[2]);
    await expect(apply(patch([a, b], { shiftMinutes: 180 }))).resolves.toEqual({ updated: 2 });
    await expect(
      apply(patch([await read(a.id)], { scheduledAt: at(12), refereeIds: [] })),
    ).rejects.toThrow('participant is already scheduled in qualifier');
    await expect(apply(patch([await read(b.id)], { scheduledAt: at(11) }))).rejects.toThrow(
      'referee is already scheduled in qualifier',
    );
  });

  it('detects internal referee, team, and overlapping-player conflicts without partial updates', async () => {
    const a = await create(0, 1, at(8), [users[1]]),
      b = await create(2, 3, at(9), [users[1]]);
    await expect(apply(patch([a, b], { scheduledAt: at(11) }))).rejects.toThrow('referee');
    await db.match.update({
      where: { id: b.id },
      data: {
        participants: json({
          A: { ...teams[2].snapshot, members: teams[0].snapshot.members },
          B: teams[3].snapshot,
        }),
      },
    });
    await expect(apply(patch([a, b], { scheduledAt: at(11), refereeIds: [] }))).rejects.toThrow(
      'participant',
    );
    expect(await read(a.id)).toMatchObject({ version: 1, scheduledAt: new Date(at(8)) });
    expect((await read(a.id)).events).toHaveLength(1);
  });

  it('patches staff, notes, and publication while preserving provenance and snapshotted state', async () => {
    const a = await create(),
      before = await read(a.id);
    const roleCount = await db.userRole.count({ where: { tournamentId } });
    await apply(
      patch([a], {
        streamer: 'Stream User',
        commentators: ['Commentator One', 'Commentator Two'],
        published: true,
      }),
    );
    const updated = await read(a.id);
    expect(updated).toMatchObject({
      source: {
        ...(before.source as object),
        streamer: 'Stream User',
        commentators: ['Commentator One', 'Commentator Two'],
      },
      notes: before.notes,
      stageId: before.stageId,
      rules: before.rules,
      poolRevisionId: before.poolRevisionId,
      participants: before.participants,
      matchNumber: before.matchNumber,
      code: before.code,
      published: true,
      version: 2,
    });
    await apply(patch([updated], { streamer: '', notes: '', published: false }));
    expect(await read(a.id)).toMatchObject({
      notes: '',
      published: false,
      source: {
        streamer: '',
        commentators: ['Commentator One', 'Commentator Two'],
        nested: { keep: true },
      },
    });
    expect(await db.userRole.count({ where: { tournamentId } })).toBe(roleCount);
    expect(updated.events[1].data).toMatchObject({
      before: { source: before.source },
      after: { source: updated.source },
    });
  });

  it('adopts target stage rules and published pool without changing other fields', async () => {
    const a = await create(),
      b = await create(2, 3, at(9)),
      before = await read(a.id);
    await apply(patch([a, b], { stageId: stages[1].id }));
    expect(await read(a.id)).toMatchObject({
      stageId: stages[1].id,
      poolRevisionId: stages[1].revisionId,
      rules: { bestOf: 5, teamSize: 1, gameplayScoring: 'SCORE_V2' },
      source: before.source,
      participants: before.participants,
      scheduledAt: before.scheduledAt,
      code: before.code,
      matchNumber: before.matchNumber,
      notes: before.notes,
    });
    const current = await read(a.id);
    await db.match.update({ where: { id: current.id }, data: { rules: json(rules) } });
    await apply(
      patch([current], { stageId: stages[1].id, notes: 'Same stage keeps custom snapshot' }),
    );
    expect((await read(a.id)).rules).toMatchObject({ bestOf: 3 });
  });

  it('validates target tournament, qualifier type, publication, pool size, archived state, and team size', async () => {
    const a = await create();
    for (const [id, message] of [
      [outsideStageId, 'does not exist'],
      [stages[2].id, 'Qualifiers'],
      [stages[3].id, 'published mappool'],
      [stages[4].id, 'more maps'],
      [stages[5].id, 'starting player'],
    ] as const)
      await expect(apply(patch([a], { stageId: id }))).rejects.toThrow(message);
    await db.tournamentStage.update({
      where: { id: stages[1].id },
      data: { archivedAt: new Date() },
    });
    try {
      await expect(apply(patch([a], { stageId: stages[1].id }))).rejects.toThrow(
        'active elimination',
      );
    } finally {
      await db.tournamentStage.update({ where: { id: stages[1].id }, data: { archivedAt: null } });
    }
    expect((await read(a.id)).version).toBe(1);
  });

  it('preserves historical actions/results and rejects stage changes across them atomically', async () => {
    const a = await create(),
      b = await create(2, 3, at(9));
    const action = await db.matchMapAction.create({
      data: {
        matchId: b.id,
        sequence: 1,
        kind: 'PICK',
        side: 'A',
        category: 'NM',
        slotName: 'NM1',
        voided: true,
      },
    });
    await db.matchMapResult.create({
      data: {
        matchId: b.id,
        actionId: action.id,
        winnerSide: 'A',
        scoreA: 10,
        scoreB: 5,
        voided: true,
      },
    });
    await expect(
      apply(patch([a, b], { stageId: stages[1].id, notes: 'Must roll back' })),
    ).rejects.toThrow('referee actions or results');
    expect(await read(a.id)).toMatchObject({
      version: 1,
      notes: 'Original note',
      stageId: stages[0].id,
    });
    await apply(patch([b], { notes: 'History retained' }));
    expect((await read(b.id)).actions).toHaveLength(1);
    expect((await read(b.id)).results).toHaveLength(1);
  });

  it('prohibits bracket round/stage mismatches and preserves linked match identifiers', async () => {
    const a = await create();
    const bracket = await db.bracket.create({
      data: {
        tournamentId,
        name: 'Bracket',
        format: 'SINGLE_ELIMINATION',
        generationKey: randomUUID(),
        config: {},
        seedOrder: [],
      },
    });
    const round = await db.bracketRound.create({
      data: {
        tournamentId,
        bracketId: bracket.id,
        stageId: stages[0].id,
        key: 'r1',
        name: 'Round 1',
        lane: 'WINNER',
        position: 0,
      },
    });
    await db.bracketNode.create({
      data: {
        tournamentId,
        bracketId: bracket.id,
        roundId: round.id,
        key: 'm1',
        position: 0,
        matchId: a.id,
      },
    });
    await expect(apply(patch([a], { stageId: stages[1].id }))).rejects.toThrow(
      'linked to a bracket round',
    );
    await apply(patch([a], { notes: 'Safe metadata correction' }));
    expect((await read(a.id)).matchNumber).toBe(a.matchNumber);
  });

  it('rejects stale and started matches, invalid referees, and missing shift times as one transaction', async () => {
    const a = await create(),
      b = await create(2, 3, null);
    await expect(apply(patch([a, { ...b, version: 99 }], { notes: 'Invalid' }))).rejects.toThrow(
      'changed',
    );
    await expect(apply(patch([a, b], { shiftMinutes: 30 }))).rejects.toThrow('no start time');
    await expect(apply(patch([a, b], { refereeIds: [actor.id] }))).rejects.toThrow(
      'operational permissions',
    );
    await db.match.update({ where: { id: b.id }, data: { startedAt: new Date() } });
    await expect(apply(patch([a, b], { notes: 'Invalid' }))).rejects.toThrow('has started');
    expect(await read(a.id)).toMatchObject({ version: 1, notes: 'Original note' });
  });

  it('applies per-row schedule swaps and referee patches atomically', async () => {
    const a = await create(0, 1, at(8), [users[1]]),
      b = await create(2, 3, at(9), [users[2]]);
    await apply({
      type: 'matches.batch.schedule',
      matches: [
        { id: a.id, baseVersion: 1, scheduledAt: at(9), refereeIds: [users[2]] },
        { id: b.id, baseVersion: 1, scheduledAt: at(8), refereeIds: [users[1]] },
      ],
    });
    expect(await read(a.id)).toMatchObject({
      scheduledAt: new Date(at(9)),
      version: 2,
      notes: 'Original note',
    });
    expect((await read(b.id)).scheduledAt).toEqual(new Date(at(8)));
    const input = {
      type: 'matches.batch.schedule',
      matches: [
        { id: a.id, baseVersion: 2, scheduledAt: at(10), refereeIds: [users[1]] },
        { id: b.id, baseVersion: 2, scheduledAt: at(10) },
      ],
    };
    await expect(apply(input)).rejects.toThrow('referee');
    expect((await read(a.id)).version).toBe(2);
    expect((await read(a.id)).events[1].kind).toBe('batch.schedule');
  });

  it('rejects unauthorized and cross-tournament requests', async () => {
    const a = await create();
    await expect(
      apply(patch([a], { notes: 'Bad' }), { ...actor, permissions: [] }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      apply(patch([{ id: 'outside', version: 1 }], { notes: 'Bad' })),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      apply(patch([a], { notes: 'Bad' }), { ...actor, tournamentId: outsideId }),
    ).rejects.toMatchObject({ status: 403 });
    expect((await read(a.id)).version).toBe(1);
  });

  it('serializes concurrent patches without overwriting a newer version', async () => {
    const a = await create();
    const results = await Promise.allSettled(
      ['First', 'Second'].map((notes) => apply(patch([a], { notes }))),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await read(a.id)).version).toBe(2);
    expect((await read(a.id)).events).toHaveLength(2);
  });

  it('parses TSV/CSV with explicit keeps/clears and resolves only visible numeric match IDs', () => {
    const matches = [
      { id: 'a', matchNumber: 1, version: 3, status: 'SCHEDULED', scheduledAt: at(8) },
      { id: 'b', matchNumber: 2, version: 4, status: 'SCHEDULED', scheduledAt: at(9) },
    ];
    const refs = [{ id: 'ref', username: 'Test Ref', osuId: 42 }];
    const parsed = parseMatchSchedulePaste(
      'match_number\tscheduled_at\treferee\n1\t2030-06-12T10:00:00+02:00\tTest_Ref\n2\t\t-',
      matches,
      refs,
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toMatchObject([
      { id: 'a', baseVersion: 3, scheduledAt: at(8), refereeIds: ['ref'] },
      { id: 'b', baseVersion: 4, refereeIds: [] },
    ]);
    expect(parsed.rows[1].scheduledAt).toBeUndefined();
    const csv = parseMatchSchedulePaste(
      'match,date,time,referee\n1,2030-06-12,18:00,#42\n2,-,,',
      matches,
      refs,
    );
    expect(csv.errors).toEqual([]);
    expect(csv.rows[1]).toMatchObject({ scheduledAt: null });
    expect(csv.rows[1].refereeIds).toBeUndefined();
    for (const text of [
      '1\t2030-02-30 18:00\t',
      '1\t2030-06-12T24:00:00Z\t',
      '3\t-\t',
      '1\t-\tUnknown',
      '1\t-\t\n1\t-\t',
      '1\t\t',
    ])
      expect(parseMatchSchedulePaste(text, matches, refs).errors.length).toBeGreaterThan(0);
  });
});
