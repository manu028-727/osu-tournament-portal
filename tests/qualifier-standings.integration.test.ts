import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import { inheritedRules } from '../src/lib/gameplay-scoring';
import { assertTestDatabase } from '../src/lib/instance';
import type { Actor } from '../src/lib/permissions';
import { qualifierPolicySchema, type QualifierPolicy } from '../src/lib/qualifier-policy';
import { qualifierStandingSnapshot } from '../src/lib/qualifier-standings-contract';
import {
  applyQualifierStandingsAction,
  assertQualifierMutable,
  finalizedQualifierSeeds,
} from '../src/lib/qualifier-standings-service';
import {
  publishedQualifierStandings,
  qualifierStandingsData,
} from '../src/lib/qualifier-standings-sources';
import type { QualifierStandingsAction } from '../src/lib/qualifier-standings-validation';

const prefix = `qualifier-db-${randomUUID()}`;
const tournamentIds: string[] = [];
const participantIds: number[] = [];
const beatmapIds: number[] = [];
const teams = new Map<string, { id: string; name: string; osuId: number }[]>();
let userId: string, actor: Actor;
const rules = inheritedRules({ teamSize: 1, multiplierMode: 'NONE' }, 'SCORE_V2');
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL);
  const user = await db.user.create({
    data: {
      osuId: randomInt(1_700_000_000, 1_710_000_000),
      username: prefix,
      avatarUrl: '',
      profileUrl: '',
    },
  });
  userId = user.id;
  for (let tenant = 0; tenant < 2; tenant++) {
    const tournamentId = `${prefix}-${tenant}`;
    await db.tournament.create({
      data: {
        id: tournamentId,
        slug: tournamentId,
        name: prefix,
        acronym: 'QTEST',
        description: '',
        published: true,
        settings: {
          create: {
            gameplayScoring: 'SCORE_V2',
            socialLinks: [],
            importantDates: [],
            navigation: [],
            footer: '',
            matchRules: json(rules),
          },
        },
      },
    });
    tournamentIds.push(tournamentId);
    const roster: { id: string; name: string; osuId: number }[] = [];
    for (let member = 0; member < 2; member++) {
      const osuId = randomInt(1_500_000_000, 1_510_000_000);
      await db.participant.create({
        data: { osuId, username: `${prefix}-${tenant}-${member}`, avatarUrl: '' },
      });
      participantIds.push(osuId);
      const team = await db.team.create({
        data: {
          tournamentId,
          name: `Entrant ${member + 1}`,
          slug: `entrant-${member + 1}`,
          status: 'APPROVED',
          format: 'INDIVIDUAL',
        },
      });
      await db.teamMember.create({
        data: { tournamentId, teamId: team.id, osuId, position: 0, captain: true },
      });
      roster.push({ id: team.id, name: team.name, osuId });
    }
    teams.set(tournamentId, roster);
  }
  actor = {
    id: userId,
    tournamentId: tournamentIds[0],
    osuId: user.osuId,
    username: prefix,
    avatarUrl: '',
    roles: [],
    permissions: ['matches.manage', 'matches.view_all'],
  };
});
afterAll(async () => {
  if (!tournamentIds.length) return;
  const where = { tournamentId: { in: tournamentIds } };
  await db.bracketSlot.deleteMany({ where });
  await db.bracketNode.deleteMany({ where });
  await db.bracketRound.deleteMany({ where });
  await db.bracketEntry.deleteMany({ where });
  await db.bracket.deleteMany({ where });
  await db.match.deleteMany({ where });
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
  await db.auditLog.deleteMany({ where });
  await db.tournament.deleteMany({ where: { id: { in: tournamentIds } } });
  await db.participant.deleteMany({ where: { osuId: { in: participantIds } } });
  await db.beatmap.deleteMany({ where: { id: { in: beatmapIds } } });
  if (userId) await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

async function stage(
  method: QualifierPolicy['method'],
  runSelection: QualifierPolicy['runSelection'] = 'BEST_PER_MAP',
  tournamentId = tournamentIds[0],
) {
  const policy = qualifierPolicySchema.parse({ method, runs: 2, runSelection });
  const entry = await db.tournamentStage.create({
    data: {
      tournamentId,
      name: `${method} qualifiers`,
      slug: `q-${randomUUID()}`,
      kind: 'QUALIFIERS',
      qualifierPolicy: json(policy),
    },
  });
  const pool = await db.mappool.create({ data: { tournamentId, stageId: entry.id } });
  const revision = await db.mappoolRevision.create({ data: { tournamentId, mappoolId: pool.id } });
  for (let i = 0; i < 2; i++) {
    const beatmapId = randomInt(1_600_000_000, 1_610_000_000);
    await db.beatmap.create({ data: { id: beatmapId, mode: 'osu', metadata: {} } });
    beatmapIds.push(beatmapId);
    await db.mappoolSlot.create({
      data: {
        revisionId: revision.id,
        name: `NM${i + 1}`,
        category: 'NM',
        categoryName: 'No Mod',
        color: '#ffffff',
        position: i,
        beatmapId,
        metadata: {},
      },
    });
  }
  await db.mappool.update({
    where: { id: pool.id },
    data: { state: 'PUBLISHED', publishedRevisionId: revision.id },
  });
  const roster = teams.get(tournamentId)!;
  const values = [
    [
      [900000, 500000],
      [800000, 700000],
    ],
    [
      [500000, 300000],
      [600000, 400000],
    ],
  ];
  const lobby = await db.$transaction(async (tx) => {
    const lobby = await tx.qualifierLobby.create({
      data: {
        tournamentId,
        code: `Q-${randomUUID()}`,
        stageId: entry.id,
        poolRevisionId: revision.id,
        status: 'COMPLETED',
        rules: json(rules),
        policy: json(policy),
        gameplayScoring: 'SCORE_V2',
        participants: json(
          roster.map((t) => ({ id: t.id, name: t.name, members: [{ osuId: t.osuId }] })),
        ),
      },
    });
    await tx.qualifierEntry.createMany({
      data: roster.map((t, position) => ({
        tournamentId,
        lobbyId: lobby.id,
        teamId: t.id,
        position,
      })),
    });
    await tx.qualifierScore.createMany({
      data: roster.flatMap((t, index) =>
        values[index].flatMap((maps, run) =>
          maps.map((raw, map) => ({
            lobbyId: lobby.id,
            osuId: t.osuId,
            slotName: `NM${map + 1}`,
            run: run + 1,
            raw,
            adjusted: raw,
            mods: [],
            actualScoring: 'SCORE_V2',
            representation: 'LEGACY',
            source: 'MANUAL',
            verified: true,
          })),
        ),
      ),
    });
    return lobby;
  });
  return { stageId: entry.id, lobbyId: lobby.id, roster, policy };
}
async function apply(action: QualifierStandingsAction, acting = actor) {
  return db.$transaction((tx) => applyQualifierStandingsAction(tx, acting, action));
}
async function base(stageId: string, acting = actor) {
  const current = await qualifierStandingsData(acting, stageId);
  return {
    stageId,
    baseVersion: current.latest?.version || 0,
    sourceHash: current.preview.sourceHash,
  };
}

describe.sequential('native qualifier standings with PostgreSQL', () => {
  for (const method of ['RAW_SCORE', 'Z_SUM', 'TEAM_AVERAGE', 'MATCH_COST'] as const)
    it(`persists, finalizes and publishes two-run ${method} standings`, async () => {
      const fixture = await stage(
        method,
        method === 'Z_SUM' || method === 'MATCH_COST' ? 'BEST_COMPLETE_RUN' : 'BEST_PER_MAP',
      );
      const first = await qualifierStandingsData(actor, fixture.stageId);
      expect(first.preview.canFinalize).toBe(true);
      expect(first.preview.rows[0].participantId).toBe(fixture.roster[0].id);
      await expect(
        publishedQualifierStandings(actor.tournamentId!, fixture.stageId),
      ).resolves.toBeNull();
      await apply({ type: 'qualifier.standings.calculate', ...(await base(fixture.stageId)) });
      await db.$transaction((tx) =>
        assertQualifierMutable(tx, fixture.stageId, actor.tournamentId!),
      );
      await expect(
        apply({
          type: 'qualifier.standings.publish',
          ...(await base(fixture.stageId)),
          published: true,
        }),
      ).rejects.toThrow('finalized');
      const final = await apply({
        type: 'qualifier.standings.finalize',
        ...(await base(fixture.stageId)),
        tieOrder: [],
        reason: '',
        cutoff: 1,
      });
      if (!('snapshot' in final)) throw new Error('Expected persisted standings.');
      const snapshot = qualifierStandingSnapshot(final.snapshot);
      expect(final.version).toBe(2);
      expect(snapshot.seeds).toEqual([
        { teamId: fixture.roster[0].id, seed: 1, qualified: true },
        { teamId: fixture.roster[1].id, seed: 2, qualified: false },
      ]);
      expect(snapshot.calculation.source.scores).toHaveLength(8);
      expect(
        snapshot.calculation.rows.every(
          (r) => r.runs.length === 2 && r.runs.every((run) => run.complete),
        ),
      ).toBe(true);
      await apply({
        type: 'qualifier.standings.publish',
        ...(await base(fixture.stageId)),
        published: true,
      });
      const published = await publishedQualifierStandings(actor.tournamentId!, fixture.stageId);
      expect(published?.rows).toEqual(snapshot.calculation.rows);
      await expect(
        db.$transaction((tx) => finalizedQualifierSeeds(tx, actor.tournamentId!, final.id)),
      ).resolves.toEqual([{ teamId: fixture.roster[0].id, seed: 1 }]);
      await expect(
        db.$transaction((tx) => assertQualifierMutable(tx, fixture.stageId, actor.tournamentId!)),
      ).rejects.toThrow('locked');
      const before = await db.qualifierStanding.findUniqueOrThrow({ where: { id: final.id } });
      await expect(
        apply({ type: 'qualifier.standings.calculate', ...(await base(fixture.stageId)) }),
      ).rejects.toThrow('immutable');
      expect(
        (await db.qualifierStanding.findUniqueOrThrow({ where: { id: final.id } })).snapshot,
      ).toEqual(before.snapshot);
    });
  it('rejects changed score sources and stale reviewed hashes, retaining every version', async () => {
    const fixture = await stage('RAW_SCORE');
    await apply({ type: 'qualifier.standings.calculate', ...(await base(fixture.stageId)) });
    const reviewed = await base(fixture.stageId);
    const score = await db.qualifierScore.findFirstOrThrow({ where: { lobbyId: fixture.lobbyId } });
    await db.qualifierScore.update({
      where: { id: score.id },
      data: { raw: score.raw + 1, adjusted: score.adjusted + 1 },
    });
    await expect(
      apply({ type: 'qualifier.standings.finalize', ...reviewed, tieOrder: [], reason: '' }),
    ).rejects.toThrow('sources changed');
    expect((await qualifierStandingsData(actor, fixture.stageId)).latest?.stale).toBe(true);
    await apply({ type: 'qualifier.standings.calculate', ...(await base(fixture.stageId)) });
    expect(await db.qualifierStanding.count({ where: { stageId: fixture.stageId } })).toBe(2);
  });
  it('isolates stage calculations and finalized seed references across tournaments', async () => {
    const a = await stage('RAW_SCORE'),
      b = await stage('RAW_SCORE', 'FIRST_RUN', tournamentIds[1]);
    const other = { ...actor, tournamentId: tournamentIds[1] };
    await expect(qualifierStandingsData(other, a.stageId)).rejects.toThrow('not found');
    const second = await qualifierStandingsData(other, b.stageId);
    expect(
      second.preview.source.scores.every((s) =>
        teams.get(tournamentIds[1])!.some((t) => t.osuId === s.osuId),
      ),
    ).toBe(true);
    await apply({ type: 'qualifier.standings.calculate', ...(await base(a.stageId)) });
    const final = await apply({
      type: 'qualifier.standings.finalize',
      ...(await base(a.stageId)),
      tieOrder: [],
      reason: '',
    });
    if (!('snapshot' in final)) throw new Error('Expected persisted standings.');
    await expect(
      db.$transaction((tx) => finalizedQualifierSeeds(tx, tournamentIds[1], final.id)),
    ).rejects.toThrow('not found');
  });
  it('reopens only the reviewed version/hash, preserves old finals and requires fresh provisional review', async () => {
    const fixture = await stage('RAW_SCORE');
    await apply({ type: 'qualifier.standings.calculate', ...(await base(fixture.stageId)) });
    const original = await apply({
      type: 'qualifier.standings.finalize',
      ...(await base(fixture.stageId)),
      tieOrder: [],
      reason: '',
    });
    if (!('snapshot' in original)) throw new Error('Expected persisted standings.');
    await apply({
      type: 'qualifier.standings.publish',
      ...(await base(fixture.stageId)),
      published: true,
    });
    const reviewed = await qualifierStandingsData(actor, fixture.stageId);
    const request = {
      type: 'qualifier.standings.reopen' as const,
      ...(await base(fixture.stageId)),
      reason: 'Organizer approved a verified source correction',
      impactHash: reviewed.correctionImpact!.impactHash,
      affectedBracketIds: [],
      acknowledgeImpact: true as const,
    };
    await expect(apply({ ...request, baseVersion: request.baseVersion - 1 })).rejects.toThrow(
      'Standings changed',
    );
    await expect(apply({ ...request, sourceHash: '0'.repeat(64) })).rejects.toThrow(
      'sources changed',
    );
    const reopened = await apply(request);
    if (!('snapshot' in reopened)) throw new Error('Expected persisted reopen version.');
    expect(qualifierStandingSnapshot(reopened.snapshot)).toMatchObject({
      state: 'REOPENED',
      seeds: [],
      correctionReview: { standingId: original.id, reason: request.reason },
    });
    expect(reopened.version).toBe(3);
    expect((await qualifierStandingsData(actor, fixture.stageId)).locked).toBe(false);
    const historical = await db.qualifierStanding.findUniqueOrThrow({ where: { id: original.id } });
    expect(historical.snapshot).toEqual(original.snapshot);
    expect(historical.published).toBe(false);
    await expect(
      db.$transaction((tx) => finalizedQualifierSeeds(tx, actor.tournamentId!, original.id)),
    ).rejects.toThrow('reopened or superseded');
    await expect(
      publishedQualifierStandings(actor.tournamentId!, fixture.stageId),
    ).resolves.toBeNull();
    const score = await db.qualifierScore.findFirstOrThrow({ where: { lobbyId: fixture.lobbyId } });
    await db.$transaction(async (tx) => {
      await assertQualifierMutable(tx, fixture.stageId, actor.tournamentId!);
      await tx.qualifierScore.update({
        where: { id: score.id },
        data: { raw: score.raw + 1, adjusted: score.adjusted + 1 },
      });
    });
    await expect(
      apply({
        type: 'qualifier.standings.finalize',
        ...(await base(fixture.stageId)),
        tieOrder: [],
        reason: '',
      }),
    ).rejects.toThrow('provisional');
    await apply({ type: 'qualifier.standings.calculate', ...(await base(fixture.stageId)) });
    const corrected = await apply({
      type: 'qualifier.standings.finalize',
      ...(await base(fixture.stageId)),
      tieOrder: [],
      reason: '',
    });
    if (!('snapshot' in corrected)) throw new Error('Expected persisted standings.');
    expect(corrected.version).toBe(5);
    await expect(
      db.$transaction((tx) => finalizedQualifierSeeds(tx, actor.tournamentId!, original.id)),
    ).rejects.toThrow('reopened or superseded');
    await expect(
      db.$transaction((tx) => finalizedQualifierSeeds(tx, actor.tournamentId!, corrected.id)),
    ).resolves.toHaveLength(2);
  });
  it('rejects incomplete/stale downstream review and never reopens or rewrites started native matches', async () => {
    const fixture = await stage('RAW_SCORE');
    await apply({ type: 'qualifier.standings.calculate', ...(await base(fixture.stageId)) });
    const final = await apply({
      type: 'qualifier.standings.finalize',
      ...(await base(fixture.stageId)),
      tieOrder: [],
      reason: '',
    });
    if (!('snapshot' in final)) throw new Error('Expected persisted standings.');
    const bracket = await db.bracket.create({
      data: {
        tournamentId: actor.tournamentId!,
        name: 'Correction impact bracket',
        format: 'SINGLE_ELIMINATION',
        generationKey: randomUUID(),
        sourceStandingId: final.id,
        config: {},
        seedOrder: fixture.roster.map((t) => t.id),
      },
    });
    const head = await db.tournamentStage.create({
      data: {
        tournamentId: actor.tournamentId!,
        name: 'Finals',
        slug: `correction-finals-${randomUUID()}`,
        kind: 'CUSTOM',
        matchRules: json(rules),
      },
    });
    const snapshot = (index: number) => ({
      id: fixture.roster[index].id,
      name: fixture.roster[index].name,
      format: 'INDIVIDUAL',
      members: [
        {
          osuId: fixture.roster[index].osuId,
          username: fixture.roster[index].name,
          avatarUrl: '',
          captain: true,
          substitute: false,
        },
      ],
    });
    const match = await db.match.create({
      data: {
        tournamentId: actor.tournamentId!,
        code: `review-${randomUUID()}`,
        stageId: head.id,
        teamAId: fixture.roster[0].id,
        teamBId: fixture.roster[1].id,
        rules: json(rules),
        participants: { A: snapshot(0), B: snapshot(1) },
      },
    });
    const round = await db.bracketRound.create({
      data: {
        tournamentId: actor.tournamentId!,
        bracketId: bracket.id,
        stageId: head.id,
        key: 'final',
        name: 'Finals',
        lane: 'WINNERS',
        position: 0,
      },
    });
    await db.bracketNode.create({
      data: {
        tournamentId: actor.tournamentId!,
        bracketId: bracket.id,
        roundId: round.id,
        key: 'final-1',
        position: 0,
        state: 'READY',
        matchId: match.id,
      },
    });
    const initial = await qualifierStandingsData(actor, fixture.stageId);
    const request = {
      type: 'qualifier.standings.reopen' as const,
      ...(await base(fixture.stageId)),
      reason: 'Review source score correction before competition starts',
      impactHash: initial.correctionImpact!.impactHash,
      affectedBracketIds: [bracket.id],
      acknowledgeImpact: true as const,
    };
    await expect(apply({ ...request, affectedBracketIds: [] })).rejects.toThrow(
      'acknowledge every',
    );
    await db.bracket.update({ where: { id: bracket.id }, data: { version: { increment: 1 } } });
    await expect(apply(request)).rejects.toThrow('Downstream competition changed');
    await db.match.update({
      where: { id: match.id },
      data: { status: 'IN_PROGRESS', startedAt: new Date(), version: { increment: 1 } },
    });
    const current = await qualifierStandingsData(actor, fixture.stageId);
    const before = await db.match.findUniqueOrThrow({ where: { id: match.id } });
    await expect(
      apply({
        ...request,
        ...(await base(fixture.stageId)),
        impactHash: current.correctionImpact!.impactHash,
      }),
    ).rejects.toThrow('manual historical reconciliation');
    expect(await db.match.findUniqueOrThrow({ where: { id: match.id } })).toEqual(before);
    expect(
      (await db.qualifierStanding.findUniqueOrThrow({ where: { id: final.id } })).snapshot,
    ).toEqual(final.snapshot);
    expect(await db.qualifierStanding.count({ where: { stageId: fixture.stageId } })).toBe(2);
  });
});
