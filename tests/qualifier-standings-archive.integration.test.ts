import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import { assertTestDatabase } from '../src/lib/instance';
import { ALL_PERMISSIONS, type Actor } from '../src/lib/permissions';
import { inheritedRules } from '../src/lib/gameplay-scoring';
import { DEFAULT_COPY } from '../src/lib/copy';
import { rosterSnapshot } from '../src/lib/matches-service';
import { teamInclude } from '../src/lib/teams-service';
import { qualifierPolicySchema } from '../src/lib/qualifier-policy';
import { competitionActionSchema } from '../src/lib/competition-validation';
import {
  applyCompetitionAction,
  assertCompetitionMatchStart,
} from '../src/lib/competition-service';
import { applyQualifierAction } from '../src/lib/qualifiers-service';
import { qualifierActionSchema } from '../src/lib/qualifiers-validation';
import { exportTournament } from '../src/lib/tournament-export';
import { importTournament, inspectArchive } from '../src/lib/tournament-import';
import {
  applyQualifierStandingsAction,
  assertQualifierMutable,
  finalizedQualifierSeeds,
  publishedQualifierStandings,
  qualifierStandingSnapshot,
  qualifierStandingsData,
} from '../src/lib/qualifier-standings-service';
import { canonicalQualifierJson, qualifierSourceHash } from '../src/lib/qualifier-seeding';

const prefix = `qualifier-transfer-${randomUUID()}`;
const tournamentIds: string[] = [],
  participantIds: number[] = [],
  beatmapIds: number[] = [];
const rules = inheritedRules({ teamSize: 1, bestOf: 1, multiplierMode: 'NONE' }, 'SCORE_V2');
const policy = qualifierPolicySchema.parse({
  runs: 2,
  method: 'RAW_SCORE',
  runSelection: 'BEST_COMPLETE_RUN',
});
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
let owner: Actor;

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL);
  const user = await db.user.create({
    data: {
      osuId: randomInt(1_710_000_000, 1_720_000_000),
      username: prefix,
      avatarUrl: '',
      profileUrl: '',
      platformAdmin: true,
    },
  });
  owner = { ...user, platformAdmin: true, roles: [], permissions: [...ALL_PERMISSIONS] };
});

afterAll(async () => {
  const where = { tournamentId: { in: tournamentIds } };
  // Only records belonging to this file's newly created tournaments are removed.
  await db.bracketSlot.deleteMany({ where });
  await db.bracketNode.deleteMany({ where });
  await db.bracketRound.deleteMany({ where });
  await db.bracketEntry.deleteMany({ where });
  await db.bracket.deleteMany({ where });
  await db.match.deleteMany({ where });
  await db.qualifierStanding.deleteMany({ where });
  await db.qualifierLobby.deleteMany({ where });
  await db.team.deleteMany({ where });
  await db.mappool.updateMany({
    where,
    data: { draftRevisionId: null, publishedRevisionId: null },
  });
  await db.mappoolSlot.deleteMany({ where: { revision: where } });
  await db.mappoolRevision.deleteMany({ where });
  await db.mappool.deleteMany({ where });
  await db.tournamentStage.deleteMany({ where });
  await db.auditLog.deleteMany({ where });
  await db.role.deleteMany({ where });
  if (owner) await db.tournamentTransfer.deleteMany({ where: { initiatedBy: owner.id } });
  await db.tournament.deleteMany({ where: { id: { in: tournamentIds } } });
  await db.participant.deleteMany({ where: { osuId: { in: participantIds } } });
  await db.beatmap.deleteMany({ where: { id: { in: beatmapIds } } });
  if (owner) await db.user.deleteMany({ where: { id: owner.id } });
  await db.$disconnect();
});

async function populatedSource(tied: boolean) {
  const tournamentId = `${prefix}-${tournamentIds.length}`;
  await db.tournament.create({
    data: {
      id: tournamentId,
      slug: tournamentId,
      name: prefix,
      acronym: 'QARCHIVE',
      description: '',
      published: true,
      settings: {
        create: {
          banner: '',
          gameplayScoring: 'SCORE_V2',
          socialLinks: [],
          importantDates: [],
          navigation: [],
          footer: '',
          copy: DEFAULT_COPY,
          matchRules: json(rules),
        },
      },
    },
  });
  tournamentIds.push(tournamentId);
  const actor = { ...owner, tournamentId };
  const teams: { id: string; name: string; osuId: number }[] = [];
  for (let i = 0; i < 2; i++) {
    const osuId = randomInt(1_510_000_000, 1_520_000_000);
    await db.participant.create({ data: { osuId, username: `${prefix}-${i}`, avatarUrl: '' } });
    participantIds.push(osuId);
    const team = await db.team.create({
      data: {
        tournamentId,
        name: i === 0 ? 'Red' : 'Blue',
        slug: i === 0 ? 'red' : 'blue',
        status: 'APPROVED',
        format: 'INDIVIDUAL',
      },
    });
    await db.teamMember.create({
      data: { tournamentId, teamId: team.id, osuId, position: 0, captain: true },
    });
    teams.push({ id: team.id, name: team.name, osuId });
  }
  const qualifierStage = await db.tournamentStage.create({
    data: {
      tournamentId,
      name: 'Qualifiers',
      slug: 'qualifiers',
      kind: 'QUALIFIERS',
      qualifierPolicy: json(policy),
    },
  });
  const finalsStage = await db.tournamentStage.create({
    data: { tournamentId, name: 'Finals', slug: 'finals', kind: 'CUSTOM', matchRules: json(rules) },
  });
  for (const stage of [qualifierStage, finalsStage]) {
    const pool = await db.mappool.create({ data: { tournamentId, stageId: stage.id } });
    const revision = await db.mappoolRevision.create({
      data: { tournamentId, mappoolId: pool.id },
    });
    const beatmapId = randomInt(1_610_000_000, 1_620_000_000);
    const metadata = {
      id: beatmapId,
      mode: 'osu',
      title: 'Qualifier archive fixture',
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
      url: `https://osu.ppy.sh/beatmaps/${beatmapId}`,
    };
    await db.beatmap.create({ data: { id: beatmapId, mode: 'osu', metadata } });
    beatmapIds.push(beatmapId);
    await db.mappoolSlot.create({
      data: {
        revisionId: revision.id,
        name: 'NM1',
        category: 'NM',
        categoryName: 'No Mod',
        color: '#ffffff',
        position: 0,
        beatmapId,
        metadata,
      },
    });
    await db.mappool.update({
      where: { id: pool.id },
      data: { publishedRevisionId: revision.id, state: 'PUBLISHED' },
    });
  }
  const pool = await db.mappool.findUniqueOrThrow({ where: { stageId: qualifierStage.id } });
  const participants = await db.team.findMany({ where: { tournamentId }, include: teamInclude });
  const lobby = await db.qualifierLobby.create({
    data: {
      tournamentId,
      stageId: qualifierStage.id,
      poolRevisionId: pool.publishedRevisionId!,
      code: 'Q1',
      rules: json(rules),
      policy: json(policy),
      gameplayScoring: 'SCORE_V2',
      status: 'COMPLETED',
      participants: json(participants.map(rosterSnapshot)),
    },
  });
  await db.qualifierEntry.createMany({
    data: teams.map((team, position) => ({
      tournamentId,
      lobbyId: lobby.id,
      teamId: team.id,
      position,
    })),
  });
  await db.qualifierAssignment.create({ data: { lobbyId: lobby.id, userId: owner.id } });
  await db.qualifierScore.createMany({
    data: teams.flatMap((team, index) =>
      [1, 2].map((run) => ({
        lobbyId: lobby.id,
        osuId: team.osuId,
        slotName: 'NM1',
        run,
        raw: (tied || index === 0 ? 800000 : 600000) + run,
        adjusted: (tied || index === 0 ? 800000 : 600000) + run,
        mods: ['NF'],
        actualScoring: 'SCORE_V2',
        representation: 'LEGACY',
        source: 'MANUAL',
        verified: true,
      })),
    ),
  });
  const base = async () => {
    const data = await qualifierStandingsData(actor, qualifierStage.id);
    return {
      stageId: qualifierStage.id,
      baseVersion: data.latest?.version || 0,
      sourceHash: data.preview.sourceHash,
    };
  };
  await db.$transaction(async (tx) =>
    applyQualifierStandingsAction(tx, actor, {
      type: 'qualifier.standings.calculate',
      ...(await base()),
    }),
  );
  const finalResult = await db.$transaction(async (tx) =>
    applyQualifierStandingsAction(tx, actor, {
      type: 'qualifier.standings.finalize',
      ...(await base()),
      tieOrder: tied ? [teams[1].id, teams[0].id] : [],
      reason: tied ? 'Approved qualifier tiebreak replay' : '',
      cutoff: 2,
    }),
  );
  if (!('snapshot' in finalResult)) throw new Error('Expected finalized standings.');
  const snapshot = qualifierStandingSnapshot(finalResult.snapshot);
  await db.$transaction(async (tx) =>
    applyQualifierStandingsAction(tx, actor, {
      type: 'qualifier.standings.publish',
      ...(await base()),
      published: true,
    }),
  );
  await db.$transaction((tx) =>
    applyCompetitionAction(
      tx,
      actor,
      competitionActionSchema.parse({
        type: 'competition.create',
        name: 'Main bracket',
        format: 'SINGLE_ELIMINATION',
        stageId: finalsStage.id,
        teamIds: snapshot.seeds.map((seed) => seed.teamId),
        sourceStandingId: finalResult.id,
        generationKey: randomUUID(),
      }),
    ),
  );
  const bracket = await db.bracket.findFirstOrThrow({
    where: { tournamentId },
    include: {
      rounds: true,
      nodes: { include: { slots: true, match: true } },
      entries: { orderBy: { seed: 'asc' } },
    },
  });
  return {
    actor,
    teams,
    lobbyId: lobby.id,
    stageId: qualifierStage.id,
    standing: finalResult,
    snapshot,
    bracket,
  };
}

describe.sequential('populated qualifier standings and bracket archive roundtrip', () => {
  for (const tied of [false, true])
    it(`restores published finalized standings and a usable bracket${tied ? ' with explicit tie order' : ''}`, async () => {
      const source = await populatedSource(tied);
      const originalRows = source.snapshot.calculation.rows.map((row) => ({
        name: row.name,
        rank: row.rank,
        seed: row.seed,
        value: row.value,
        selectedRun: row.selectedRun,
        tied: row.tied,
      }));
      const originalSnapshot = canonicalQualifierJson(source.standing.snapshot);
      const exported = await exportTournament(source.actor, 'https://qualifier-source.example');
      const { archive } = await inspectArchive(exported.bytes);
      expect(archive.data.qualifierStandings).toHaveLength(2);
      expect(archive.data.qualifierScores).toHaveLength(4);
      expect(archive.data.brackets).toHaveLength(1);
      expect(archive.data.bracketNodes).toHaveLength(1);
      const report = await importTournament(
        owner,
        archive,
        `${prefix}-copy-${tied ? 'tie' : 'raw'}`,
      );
      tournamentIds.push(report.tournamentId);
      const importedActor = { ...owner, tournamentId: report.tournamentId };
      const importedStage = await db.tournamentStage.findFirstOrThrow({
        where: { tournamentId: report.tournamentId, slug: 'qualifiers' },
      });
      const imported = await qualifierStandingsData(importedActor, importedStage.id);
      const standing = imported.latest!;
      expect(report.standingsRestore.warnings).toEqual([]);
      expect(report.standingsRestore.rebound).toBe(2);
      expect(standing.snapshot.state).toBe('FINALIZED');
      expect(standing.stale).toBe(false);
      expect(standing.published).toBe(true);
      expect(standing.sourceHash).not.toBe(source.standing.sourceHash);
      expect(standing.snapshot.importProvenance?.[0].originalSourceHash).toBe(
        source.standing.sourceHash,
      );
      expect(
        standing.snapshot.calculation.rows.map((row) => ({
          name: row.name,
          rank: row.rank,
          seed: row.seed,
          value: row.value,
          selectedRun: row.selectedRun,
          tied: row.tied,
        })),
      ).toEqual(originalRows);
      expect(standing.snapshot.calculation.sourceHash).toBe(
        qualifierSourceHash({
          calculationVersion: standing.snapshot.calculation.calculationVersion,
          source: standing.snapshot.calculation.source,
        }),
      );
      const bracket = await db.bracket.findFirstOrThrow({
        where: { tournamentId: report.tournamentId },
        include: {
          rounds: true,
          nodes: { include: { slots: true, match: true } },
          entries: { orderBy: { seed: 'asc' } },
        },
      });
      const seeds = await db.$transaction((tx) =>
        finalizedQualifierSeeds(tx, report.tournamentId, standing.id),
      );
      expect(bracket.sourceStandingId).toBe(standing.id);
      expect(bracket.seedOrder).toEqual(seeds.map((seed) => seed.teamId));
      expect(bracket.entries.map((entry) => ({ teamId: entry.teamId, seed: entry.seed }))).toEqual(
        seeds,
      );
      expect(bracket.rounds).toHaveLength(source.bracket.rounds.length);
      expect(bracket.nodes).toHaveLength(source.bracket.nodes.length);
      expect(bracket.nodes[0].match?.teamAId).toBe(
        bracket.nodes[0].slots.find((slot) => slot.side === 'A')?.teamId,
      );
      expect(bracket.nodes[0].match?.teamBId).toBe(
        bracket.nodes[0].slots.find((slot) => slot.side === 'B')?.teamId,
      );
      expect(bracket.nodes[0].match?.id).not.toBe(source.bracket.nodes[0].match?.id);
      expect(
        await db.qualifierAssignment.count({
          where: { lobby: { tournamentId: report.tournamentId } },
        }),
      ).toBe(0);
      if (tied)
        expect(standing.snapshot.tieResolution?.order).toEqual(seeds.map((seed) => seed.teamId));
      await expect(
        db.$transaction((tx) => assertQualifierMutable(tx, importedStage.id, report.tournamentId)),
      ).rejects.toThrow('locked');
      await expect(
        publishedQualifierStandings(report.tournamentId, importedStage.id),
      ).resolves.toBeNull();
      await db.tournament.update({ where: { id: report.tournamentId }, data: { published: true } });
      expect(
        (await publishedQualifierStandings(report.tournamentId, importedStage.id))?.rows,
      ).toEqual(standing.snapshot.calculation.rows);
      expect(
        canonicalQualifierJson(
          (await db.qualifierStanding.findUniqueOrThrow({ where: { id: source.standing.id } }))
            .snapshot,
        ),
      ).toBe(originalSnapshot);
    });
  it('reviews a native correction after bracket generation without changing frozen participants or old finals', async () => {
    const source = await populatedSource(false);
    const originalSnapshot = canonicalQualifierJson(source.standing.snapshot);
    const originalBracket = canonicalQualifierJson(source.bracket);
    const read = () => qualifierStandingsData(source.actor, source.stageId);
    const initial = await read(),
      impact = initial.correctionImpact!;
    expect(impact.brackets.map((b) => b.id)).toEqual([source.bracket.id]);
    expect(impact.canReopen).toBe(true);
    const reopen = {
      type: 'qualifier.standings.reopen' as const,
      stageId: source.stageId,
      baseVersion: initial.latest!.version,
      sourceHash: initial.preview.sourceHash,
      reason: 'Verified score correction after organizer review',
      affectedBracketIds: [source.bracket.id],
      impactHash: impact.impactHash,
      acknowledgeImpact: true as const,
    };
    await expect(
      db.$transaction((tx) =>
        applyQualifierStandingsAction(tx, source.actor, { ...reopen, affectedBracketIds: [] }),
      ),
    ).rejects.toThrow('acknowledge every');
    await db.$transaction((tx) => applyQualifierStandingsAction(tx, source.actor, reopen));
    const after = await read();
    expect(after.latest?.snapshot.state).toBe('REOPENED');
    expect(after.locked).toBe(false);
    expect(after.versions.find((v) => v.id === source.standing.id)?.stale).toBe(true);
    expect(
      (await db.qualifierStanding.findUniqueOrThrow({ where: { id: source.standing.id } }))
        .published,
    ).toBe(false);
    await expect(
      publishedQualifierStandings(source.actor.tournamentId!, source.stageId),
    ).resolves.toBeNull();
    await expect(
      db.$transaction((tx) =>
        finalizedQualifierSeeds(tx, source.actor.tournamentId!, source.standing.id),
      ),
    ).rejects.toThrow('reopened or superseded');
    const matchId = source.bracket.nodes[0].match!.id;
    await expect(
      db.$transaction((tx) => assertCompetitionMatchStart(tx, source.actor.tournamentId!, matchId)),
    ).rejects.toThrow('reopened or superseded');
    const lobby = await db.qualifierLobby.findUniqueOrThrow({ where: { id: source.lobbyId } });
    await db.$transaction((tx) =>
      applyQualifierAction(
        tx,
        source.actor,
        qualifierActionSchema.parse({
          type: 'qualifier.status',
          id: lobby.id,
          baseVersion: lobby.version,
          command: 'REOPEN',
          reason: 'Approved qualifier standings correction',
        }),
      ),
    );
    const currentLobby = await db.qualifierLobby.findUniqueOrThrow({ where: { id: lobby.id } });
    await db.$transaction((tx) =>
      applyQualifierAction(
        tx,
        source.actor,
        qualifierActionSchema.parse({
          type: 'qualifier.score',
          id: lobby.id,
          baseVersion: currentLobby.version,
          osuId: source.teams[0].osuId,
          slotName: 'NM1',
          run: 2,
          raw: 900000,
          mods: ['NF'],
          representation: 'LEGACY',
          reason: 'Corrected against verified original game score',
        }),
      ),
    );
    expect(
      (
        await db.qualifierScore.findUniqueOrThrow({
          where: {
            lobbyId_osuId_slotName_run: {
              lobbyId: lobby.id,
              osuId: source.teams[0].osuId,
              slotName: 'NM1',
              run: 2,
            },
          },
        })
      ).raw,
    ).toBe(900000);
    expect((await read()).preview.issues.some((i) => i.code === 'UNCONFIRMED_LOBBY')).toBe(true);
    expect(
      canonicalQualifierJson(
        (await db.qualifierStanding.findUniqueOrThrow({ where: { id: source.standing.id } }))
          .snapshot,
      ),
    ).toBe(originalSnapshot);
    const bracket = await db.bracket.findUniqueOrThrow({
      where: { id: source.bracket.id },
      include: {
        rounds: true,
        nodes: { include: { slots: true, match: true } },
        entries: { orderBy: { seed: 'asc' } },
      },
    });
    expect(canonicalQualifierJson(bracket)).toBe(originalBracket);
  });
  it('blocks reopening once a downstream native match starts or records a result', async () => {
    const source = await populatedSource(false);
    const match = source.bracket.nodes[0].match!;
    await db.match.update({
      where: { id: match.id },
      data: { status: 'IN_PROGRESS', startedAt: new Date(), version: { increment: 1 } },
    });
    let data = await qualifierStandingsData(source.actor, source.stageId);
    expect(data.correctionImpact?.canReopen).toBe(false);
    await expect(
      db.$transaction((tx) =>
        applyQualifierStandingsAction(tx, source.actor, {
          type: 'qualifier.standings.reopen',
          stageId: source.stageId,
          baseVersion: data.latest!.version,
          sourceHash: data.preview.sourceHash,
          reason: 'Unsafe correction must not apply',
          affectedBracketIds: data.correctionImpact!.brackets.map((b) => b.id),
          impactHash: data.correctionImpact!.impactHash,
          acknowledgeImpact: true,
        }),
      ),
    ).rejects.toThrow('manual historical reconciliation');
    await db.match.update({
      where: { id: match.id },
      data: { status: 'SCHEDULED', startedAt: null, scoreA: 1, version: { increment: 1 } },
    });
    data = await qualifierStandingsData(source.actor, source.stageId);
    expect(data.correctionImpact?.blockingMatches[0].reason).toContain(
      'Recorded competitive results',
    );
    await expect(
      db.$transaction((tx) =>
        applyQualifierStandingsAction(tx, source.actor, {
          type: 'qualifier.standings.reopen',
          stageId: source.stageId,
          baseVersion: data.latest!.version,
          sourceHash: data.preview.sourceHash,
          reason: 'Unsafe result correction must not apply',
          affectedBracketIds: data.correctionImpact!.brackets.map((b) => b.id),
          impactHash: data.correctionImpact!.impactHash,
          acknowledgeImpact: true,
        }),
      ),
    ).rejects.toThrow('manual historical reconciliation');
    expect(
      await db.qualifierStanding.count({
        where: { tournamentId: source.actor.tournamentId, stageId: source.stageId },
      }),
    ).toBe(2);
    await expect(
      db.$transaction((tx) =>
        assertQualifierMutable(tx, source.stageId, source.actor.tournamentId!),
      ),
    ).rejects.toThrow('locked');
  });
});
