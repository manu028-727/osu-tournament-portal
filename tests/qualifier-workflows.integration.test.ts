import { randomInt, randomUUID, createHash } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { db } from '../src/lib/db';
import { assertTestDatabase } from '../src/lib/instance';
import { ALL_PERMISSIONS, AppError, type Actor } from '../src/lib/permissions';
import { registrationData, applyRegistration } from '../src/lib/registration-service';
import { qualifierBookingData, applyQualifierBooking } from '../src/lib/qualifier-booking-service';
import { qualifierBookingSchema } from '../src/lib/qualifier-booking-contract';
import { qualifierCorrectionSchema } from '../src/lib/qualifier-corrections-contract';
import { reviewQualifierCorrections } from '../src/lib/qualifier-corrections-service';
import { registrationActionSchema, registrationPolicySchema } from '../src/lib/registration-policy';
import { inheritedRules } from '../src/lib/gameplay-scoring';
import { qualifierPolicySchema } from '../src/lib/qualifier-policy';
import { applyQualifierAction, qualifierData } from '../src/lib/qualifiers-service';
import { qualifierActionSchema } from '../src/lib/qualifiers-validation';
import { publicTeamSelect, applyTeamAction } from '../src/lib/teams-service';
import { teamActionSchema } from '../src/lib/teams-validation';
import { executeGateway } from '../src/lib/irc-service';
import {
  syncQualifier,
  captureQualifierGame,
  ignoreQualifierGame,
} from '../src/lib/qualifier-capture-service';
import { qualifierGameProposals } from '../src/lib/qualifier-multiplayer';
import { previewQualifierImport, applyQualifierImport } from '../src/lib/qualifier-import-service';
import { qualifierImportSchema } from '../src/lib/qualifier-import-contract';
import { loadQualifierCalculation } from '../src/lib/qualifier-standings-sources';
import {
  applyQualifierStandingsAction,
  finalizedQualifierSeeds,
} from '../src/lib/qualifier-standings-service';
import { applyCompetitionAction } from '../src/lib/competition-service';
import { competitionActionSchema } from '../src/lib/competition-validation';
const mock = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../src/lib/osu', async (original) => ({
  ...(await original<typeof import('../src/lib/osu')>()),
  osuGet: mock.load,
}));
assertTestDatabase(process.env.DATABASE_URL);
const tournamentId = `qworkflow-${randomUUID()}`;
const users: Actor[] = [];
const extraTournaments: string[] = [],
  extraPlayers: number[] = [];
let organizer: Actor, stageId: string, externalStageId: string, beatmapId: number, lobbyId: string;
const teamIds: string[] = [];
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const policy = qualifierPolicySchema.parse({ runs: 2, requiredPlayers: 1 });
const rules = inheritedRules({ teamSize: 1, multiplierMode: 'NONE' }, 'SCORE_V2');
const action = (input: unknown) =>
  db.$transaction((tx) => applyQualifierAction(tx, organizer, qualifierActionSchema.parse(input)));
const current = (id: string) => db.qualifierLobby.findUniqueOrThrow({ where: { id } });
async function register(actor: Actor, extra: object = {}) {
  const data = await registrationData(actor, tournamentId);
  return db.$transaction((tx) =>
    applyRegistration(
      tx,
      actor,
      registrationActionSchema.parse({
        type: 'registration.save',
        policyToken: data.policyToken,
        baseVersion: data.team?.version || 0,
        name: `Entrant ${actor.osuId}`,
        format: 'INDIVIDUAL',
        members: [{ osuId: actor.osuId, substitute: false }],
        answers: { contact: 'private contact' },
        ...extra,
      }),
      [
        {
          id: actor.osuId,
          username: actor.username,
          avatar_url: '',
          country_code: 'IT',
          statistics: { global_rank: 5000 },
        },
      ],
    ),
  );
}
async function book(actor: Actor, id: string | null, sourceVersion?: number) {
  const data = await registrationData(actor, tournamentId);
  return db.$transaction(async (tx) =>
    applyRegistration(
      tx,
      actor,
      registrationActionSchema.parse({
        type: 'registration.booking',
        policyToken: data.policyToken,
        teamVersion: data.team!.version,
        stageId,
        lobbyId: id,
        baseVersion: id ? (await current(id)).version : undefined,
        sourceVersion,
      }),
      [],
    ),
  );
}
async function stage(name: string, scope = tournamentId, scoringRules = rules, runPolicy = policy) {
  const stage = await db.tournamentStage.create({
    data: {
      tournamentId: scope,
      name,
      slug: name.toLowerCase().replace(/ /g, '-'),
      kind: 'QUALIFIERS',
      qualifierPolicy: json(runPolicy),
      matchRules: json(scoringRules),
    },
  });
  const pool = await db.mappool.create({ data: { tournamentId: scope, stageId: stage.id } });
  const revision = await db.mappoolRevision.create({
    data: { tournamentId: scope, mappoolId: pool.id },
  });
  const beatmap = await db.beatmap.findUniqueOrThrow({ where: { id: beatmapId } });
  await db.mappoolSlot.create({
    data: {
      revisionId: revision.id,
      name: 'NM1',
      category: 'NM',
      categoryName: 'No Mod',
      color: '#90bdf4',
      position: 0,
      beatmapId,
      metadata: beatmap.metadata!,
    },
  });
  await db.mappool.update({
    where: { id: pool.id },
    data: { state: 'PUBLISHED', publishedRevisionId: revision.id },
  });
  return stage.id;
}
const game = (id: number, raw: number[]) => ({
  id,
  beatmap_id: beatmapId,
  start_time: new Date(Date.now() + id * 10000).toISOString(),
  end_time: new Date(Date.now() + id * 10000 + 1000).toISOString(),
  mode: 'osu',
  scoring_type: 'scorev2',
  mods: ['NF'],
  scores: raw.map((score, index) => ({
    user_id: users[index].osuId,
    score,
    mods: [],
    match: { team: index % 2 ? 'red' : 'blue' },
  })),
});
beforeAll(async () => {
  vi.stubEnv('IRC_ENABLED', 'true');
  vi.stubEnv('IRC_GATEWAY_SECRET', 'd'.repeat(96));
  await db.tournament.create({
    data: {
      id: tournamentId,
      slug: tournamentId,
      name: tournamentId,
      acronym: 'QW',
      description: '',
      published: true,
      status: 'REGISTRATIONS_OPEN',
      format: 'SOLO',
      settings: {
        create: {
          gameplayScoring: 'SCORE_V2',
          matchRules: json(rules),
          socialLinks: [],
          importantDates: [],
          navigation: [],
          footer: '',
          registrationPolicy: json(
            registrationPolicySchema.parse({
              minRank: 1000,
              maxRank: 10000,
              countries: ['IT'],
              fields: [{ key: 'contact', label: 'Contact', type: 'text', required: true }],
            }),
          ),
        },
      },
    },
  });
  for (let i = 0; i < 4; i++) {
    const user = await db.user.create({
      data: {
        osuId: randomInt(1_810_000_000, 1_820_000_000),
        username: `QW ${i}`,
        avatarUrl: '',
        profileUrl: '',
        platformAdmin: i === 3,
      },
    });
    users.push({
      ...user,
      tournamentId,
      roles: [],
      permissions: i === 3 ? [...ALL_PERMISSIONS] : [],
    });
  }
  organizer = users.pop()!;
  await db.role.create({
    data: {
      tournamentId,
      name: 'Workflow referee',
      permissions: {
        create: ['matches.view', 'matches.manage'].map((permissionKey) => ({ permissionKey })),
      },
      users: { create: { userId: organizer.id } },
    },
  });
  beatmapId = (await db.beatmap.findFirstOrThrow()).id;
  stageId = await stage('Qualifiers');
  externalStageId = await stage('External');
});
afterAll(async () => {
  const where = { tournamentId: { in: [tournamentId, ...extraTournaments] } };
  await db.bracketSlot.deleteMany({ where });
  await db.bracketNode.deleteMany({ where });
  await db.bracketRound.deleteMany({ where });
  await db.bracketEntry.deleteMany({ where });
  await db.bracket.deleteMany({ where });
  await db.match.deleteMany({ where });
  await db.qualifierStanding.deleteMany({ where });
  await db.qualifierLobby.deleteMany({ where });
  await db.refereeImport.deleteMany({ where });
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
  await db.tournament.deleteMany({ where: { id: { in: [tournamentId, ...extraTournaments] } } });
  await db.user.deleteMany({ where: { id: { in: [...users, organizer].map((user) => user.id) } } });
  await db.participant.deleteMany({
    where: { osuId: { in: [...users.map((user) => user.osuId), ...extraPlayers] } },
  });
  vi.unstubAllEnvs();
  await db.$disconnect();
});
describe.sequential('complete native qualifier workflows', () => {
  it('automatically approves native registrations without granting roles and keeps answers private', async () => {
    for (const user of users) teamIds.push((await register(user)).id);
    const team = await db.team.findUniqueOrThrow({
      where: { id: teamIds[0] },
      select: publicTeamSelect,
    });
    expect(team).toMatchObject({ status: 'APPROVED' });
    expect((await db.team.findUniqueOrThrow({ where: { id: teamIds[0] } })).published).toBe(true);
    expect(team).not.toHaveProperty('registrationAnswers');
    expect(team).not.toHaveProperty('adminNotes');
    expect(
      await db.userRole.count({ where: { userId: { in: users.map((user) => user.id) } } }),
    ).toBe(0);
    await expect(register(users[0], { answers: {} })).rejects.toThrow(
      'required registration field',
    );
    await expect(
      register(users[1], {
        members: [
          { osuId: users[0].osuId, substitute: false },
          { osuId: users[1].osuId, substitute: false },
        ],
      }),
    ).rejects.toThrow();
  });
  it('opens empty sessions and serializes competing captain bookings without overcapacity', async () => {
    lobbyId = (
      await action({
        type: 'qualifier.create',
        code: 'Empty',
        stageId,
        teamIds: [],
        refereeIds: [organizer.id],
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
        capacity: 1,
      })
    ).id;
    const data = await qualifierData(organizer, new URL(`https://local/?id=${lobbyId}`));
    expect(data.lobbies[0].participants).toEqual([]);
    expect(data.lobbies[0].rules.teamSize).toBe(1);
    const bookings = await Promise.allSettled([book(users[0], lobbyId), book(users[1], lobbyId)]);
    expect(bookings.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect(await db.qualifierEntry.count({ where: { lobbyId } })).toBe(1);
    const owner = (await qualifierBookingData(users[0], tournamentId)).sessions.find(
      (session) => session.booked,
    )
      ? users[0]
      : users[1];
    await expect(book(users[2], null)).resolves.toBeDefined();
    await book(owner, null, (await current(lobbyId)).version);
    expect(await db.qualifierEntry.count({ where: { lobbyId } })).toBe(0);
    await action({
      type: 'qualifier.booking',
      id: lobbyId,
      baseVersion: (await current(lobbyId)).version,
      capacity: 3,
      bookingOpen: true,
      bookingClosesAt: null,
    });
    for (const user of users) await book(user, lobbyId);
  });
  it('enforces reviewed registration policy, deadlines, captain ownership and eligibility', async () => {
    const settings = await db.tournamentSettings.findUniqueOrThrow({ where: { tournamentId } });
    const original = settings.registrationPolicy!;
    await db.tournamentSettings.update({
      where: { tournamentId },
      data: { registrationPolicy: json({ ...json(original), rosterLocked: true }) },
    });
    await expect(register(users[0])).rejects.toThrow('closed');
    await db.tournamentSettings.update({
      where: { tournamentId },
      data: { registrationPolicy: json({ ...json(original), minRank: 6000 }) },
    });
    await expect(register(users[0])).rejects.toThrow('outside the allowed range');
    await db.tournamentSettings.update({
      where: { tournamentId },
      data: { registrationPolicy: json({ ...json(original), countries: ['FR'] }) },
    });
    await expect(register(users[0])).rejects.toThrow('not from an eligible country');
    await db.tournamentSettings.update({
      where: { tournamentId },
      data: {
        registrationPolicy: json({
          ...json(original),
          bookingClosesAt: new Date(Date.now() - 60000).toISOString(),
        }),
      },
    });
    await expect(book(users[0], null, (await current(lobbyId)).version)).rejects.toThrow('closed');
    await db.tournamentSettings.update({
      where: { tournamentId },
      data: { registrationPolicy: original },
    });
    const data = await registrationData(users[0], tournamentId);
    await expect(register(users[0], { baseVersion: 0 })).rejects.toThrow('registration changed');
    await expect(
      db.$transaction((tx) =>
        applyRegistration(
          tx,
          users[1],
          registrationActionSchema.parse({
            type: 'registration.booking',
            policyToken: data.policyToken,
            teamVersion: data.team!.version + 1,
            stageId,
            lobbyId,
            baseVersion: 1,
          }),
          [],
        ),
      ),
    ).rejects.toThrow();
  });
  it('authorizes qualifier IRC independently of head-to-head matches and preserves uncertain creation guards', async () => {
    const token = createHash('sha256').update(tournamentId).digest('hex');
    await db.session.create({
      data: { id: token, userId: organizer.id, expiresAt: new Date(Date.now() + 3600000) },
    });
    const identity = {
      kind: 'qualifier' as const,
      userId: organizer.id,
      sessionHash: token,
      tournamentId,
      matchId: lobbyId,
    };
    expect(await executeGateway({ operation: 'authorize', identity })).toMatchObject({
      operate: true,
    });
    const request = await executeGateway({
      operation: 'create',
      identity,
      baseVersion: (await current(lobbyId)).version,
      name: 'QW shared qualifier',
    });
    expect(request).toHaveProperty('requestId');
    await expect(
      executeGateway({
        operation: 'create',
        identity,
        baseVersion: (await current(lobbyId)).version,
        name: 'Duplicate',
      }),
    ).rejects.toThrow();
    await executeGateway({
      operation: 'complete',
      identity,
      requestId: request.requestId!,
      status: 'CREATED',
      url: 'https://osu.ppy.sh/community/matches/99440',
    });
    await action({
      type: 'qualifier.lobby',
      id: lobbyId,
      baseVersion: (await current(lobbyId)).version,
      lobbyUrl: 'https://osu.ppy.sh/community/matches/99440',
    });
    await action({
      type: 'qualifier.status',
      id: lobbyId,
      baseVersion: (await current(lobbyId)).version,
      command: 'START',
      reason: 'Externally verified session start',
    });
  });
  it('automatically synchronizes simultaneous scores for all rosters and both runs, preserving genuine zeros', async () => {
    mock.load.mockResolvedValue({
      match: { id: 99440 },
      first_event_id: 1,
      events: [
        { id: 1, game: game(101, [0, 200, 300]) },
        { id: 2, game: game(102, [400, 500, 600]) },
      ],
    });
    const result = await syncQualifier(organizer, lobbyId, { apply: true });
    expect(result).toMatchObject({ complete: true, imported: 6 });
    const scores = await db.qualifierScore.findMany({ where: { lobbyId } });
    expect(scores.filter((row) => row.run === 1)).toHaveLength(3);
    expect(scores.filter((row) => row.run === 2)).toHaveLength(3);
    expect(scores.find((row) => row.osuId === users[0].osuId && row.run === 1)?.raw).toBe(0);
    await expect(book(users[0], null, (await current(lobbyId)).version)).rejects.toThrow(
      'has started',
    );
    await expect(register(users[0])).rejects.toThrow('locked this roster');
    expect((await syncQualifier(organizer, lobbyId, { apply: true })).imported).toBe(0);
  });
  it('imports external shared histories with stage snapshots, explicit warmups, review and duplicate-safe corrections', async () => {
    mock.load.mockResolvedValue({
      match: { id: 99441, name: 'External shared qualifier' },
      first_event_id: 1,
      events: [
        { id: 1, game: { ...game(201, [10, 20, 30]), beatmap_id: 99999999 } },
        { id: 2, game: game(202, [100, 200, 300]) },
        { id: 3, game: game(203, [400, 500, 600]) },
      ],
    });
    const input = qualifierImportSchema.parse({
      stageId: externalStageId,
      links: ['https://osu.ppy.sh/mp/99441'],
      decisions: [{ multiplayerId: 99441, warmups: 1 }],
    });
    const preview = await previewQualifierImport(organizer, input);
    expect(preview.sources[0].issues).toEqual([]);
    expect(
      preview.sources[0].games.filter((game) => !game.ignored).map((game) => game.run),
    ).toEqual([1, 2]);
    const result = await applyQualifierImport(organizer, {
      ...input,
      jobId: preview.jobId,
      fingerprint: preview.fingerprint,
      apply: true,
    });
    expect(result).toMatchObject({ imported: 6, errors: [] });
    const id = result.sessions[0];
    await action({
      type: 'qualifier.score',
      id,
      baseVersion: (await current(id)).version,
      osuId: users[0].osuId,
      slotName: 'NM1',
      run: 1,
      raw: 150,
      mods: ['NF'],
      reason: 'Audited score correction',
    });
    const again = await previewQualifierImport(organizer, { ...input, jobId: preview.jobId });
    expect(
      await applyQualifierImport(organizer, {
        ...input,
        jobId: again.jobId,
        fingerprint: again.fingerprint,
        apply: true,
      }),
    ).toMatchObject({ imported: 0, skipped: 6, errors: [] });
    expect(
      (
        await db.qualifierScore.findFirstOrThrow({
          where: { lobbyId: id, osuId: users[0].osuId, run: 1 },
        })
      ).raw,
    ).toBe(150);
    expect(await current(id)).toMatchObject({ status: 'COMPLETED', autoCompleted: true });
    const calculation = await loadQualifierCalculation(db, externalStageId, tournamentId);
    expect(calculation.calculation.rows).toHaveLength(3);
    expect(calculation.calculation.issues.filter((issue) => issue.severity === 'ERROR')).toEqual(
      [],
    );
    await db.$transaction((tx) =>
      applyQualifierStandingsAction(tx, organizer, {
        type: 'qualifier.standings.calculate',
        stageId: externalStageId,
        baseVersion: 0,
        sourceHash: calculation.calculation.sourceHash,
      }),
    );
    const final = await db.$transaction((tx) =>
      applyQualifierStandingsAction(tx, organizer, {
        type: 'qualifier.standings.finalize',
        stageId: externalStageId,
        baseVersion: 1,
        sourceHash: calculation.calculation.sourceHash,
        tieOrder: [],
        reason: '',
      }),
    );
    if (!('id' in final)) throw Error('Expected finalized standings');
    const seeds = await finalizedQualifierSeeds(db, tournamentId, final.id);
    expect(seeds.map((seed) => seed.teamId)).toEqual([...teamIds].reverse());
    const elimination = await db.tournamentStage.create({
      data: {
        tournamentId,
        name: 'Elimination',
        slug: 'elimination',
        kind: 'CUSTOM',
        matchRules: json(rules),
      },
    });
    const bracketInput = competitionActionSchema.parse({
      type: 'competition.create',
      name: 'Qualified entrants',
      format: 'SINGLE_ELIMINATION',
      stageId: elimination.id,
      teamIds: seeds.map((seed) => seed.teamId),
      sourceStandingId: final.id,
      generationKey: randomUUID(),
    });
    const bracket = (await db.$transaction((tx) =>
      applyCompetitionAction(tx, organizer, bracketInput),
    )) as { id: string };
    expect(await db.bracket.findUniqueOrThrow({ where: { id: bracket.id } })).toMatchObject({
      sourceStandingId: final.id,
      seedOrder: seeds.map((seed) => seed.teamId),
    });
  });
  it('loads complete paginated multiplayer histories before allowing any score writes', async () => {
    const paginatedStage = await stage('Paginated');
    mock.load.mockImplementation(async (path: string) => {
      const before = Number(new URL(`https://local/${path}`).searchParams.get('before') || 701);
      const events = Array.from({ length: 100 }, (_, index) => before - 100 + index).map((id) => ({
        id,
        ...(id === 1
          ? { game: game(301, [100, 200, 300]) }
          : id === 601
            ? { game: game(302, [400, 500, 600]) }
            : {}),
      }));
      return { match: { id: 99442 }, first_event_id: 1, events };
    });
    const input = qualifierImportSchema.parse({
      stageId: paginatedStage,
      links: ['https://osu.ppy.sh/mp/99442'],
    });
    const first = await previewQualifierImport(organizer, input);
    expect(first.complete).toBe(false);
    await expect(
      applyQualifierImport(organizer, {
        ...input,
        jobId: first.jobId,
        fingerprint: first.fingerprint,
        apply: true,
      }),
    ).rejects.toThrow('complete');
    expect(await db.qualifierLobby.count({ where: { stageId: paginatedStage } })).toBe(0);
    const complete = await previewQualifierImport(organizer, { ...input, jobId: first.jobId });
    expect(complete.complete).toBe(true);
    expect(complete.sources[0].games.map((game) => game.run)).toEqual([1, 2]);
    expect(
      (
        await applyQualifierImport(organizer, {
          ...input,
          jobId: complete.jobId,
          fingerprint: complete.fingerprint,
          apply: true,
        })
      ).imported,
    ).toBe(6);
  });
  it('combines links for a shared session and preserves missing scores without inventing zero', async () => {
    const split = await stage('Split');
    mock.load.mockImplementation(async (path: string) => {
      const id = Number(path.match(/matches\/(\d+)/)![1]);
      return {
        match: { id },
        first_event_id: 1,
        events: [
          { id: 1, game: id === 99443 ? game(401, [100, 200, 300]) : game(402, [400, 500]) },
        ],
      };
    });
    const input = qualifierImportSchema.parse({
      stageId: split,
      links: ['https://osu.ppy.sh/mp/99443', 'https://osu.ppy.sh/mp/99444'],
    });
    const preview = await previewQualifierImport(organizer, input);
    expect(preview.sources.every((source) => source.issues.length === 0)).toBe(true);
    expect(preview.sources.map((source) => source.games[0].run)).toEqual([1, 2]);
    expect(
      preview.sources[1].games[0].teams.find((team) => team.name.includes(String(users[2].osuId)))
        ?.value,
    ).toBeNull();
    const result = await applyQualifierImport(organizer, {
      ...input,
      jobId: preview.jobId,
      fingerprint: preview.fingerprint,
      apply: true,
    });
    expect(result).toMatchObject({ imported: 5, errors: [] });
    expect(result.sessions).toHaveLength(1);
    expect(
      await db.qualifierScore.count({
        where: { lobbyId: result.sessions[0], osuId: users[2].osuId, run: 2 },
      }),
    ).toBe(0);
    expect(await current(result.sessions[0])).toMatchObject({
      status: 'COMPLETED',
      autoCompleted: true,
    });
    expect((await loadQualifierCalculation(db, split, tournamentId)).calculation.canFinalize).toBe(
      true,
    );
  });
  it('attributes simultaneous teammates by permanent IDs, regardless of multiplayer colors', async () => {
    const scope = `${tournamentId}-teams`;
    extraTournaments.push(scope);
    const teamRules = inheritedRules({ teamSize: 2, multiplierMode: 'NONE' }, 'SCORE_V2');
    const teamPolicy = qualifierPolicySchema.parse({ requiredPlayers: 2, runs: 2 });
    await db.tournament.create({
      data: {
        id: scope,
        slug: scope,
        name: 'Team qualifier fixture',
        acronym: 'QT',
        description: '',
        format: 'TEAMS',
        settings: {
          create: {
            gameplayScoring: 'SCORE_V2',
            matchRules: json(teamRules),
            socialLinks: [],
            importantDates: [],
            navigation: [],
            footer: '',
          },
        },
      },
    });
    for (let team = 0; team < 2; team++) {
      const roster: number[] = [];
      for (let player = 0; player < 2; player++) {
        const osuId = randomInt(1_850_000_000, 1_860_000_000);
        extraPlayers.push(osuId);
        roster.push(osuId);
        await db.participant.create({
          data: { osuId, username: `Team ${team} player ${player}`, avatarUrl: '' },
        });
      }
      await db.team.create({
        data: {
          tournamentId: scope,
          name: `Team ${team}`,
          slug: `team-${team}`,
          format: 'TEAM',
          status: 'APPROVED',
          members: {
            create: roster.map((osuId, index) => ({ osuId, captain: !index, position: index })),
          },
        },
      });
    }
    const stageId = await stage('Shared teams', scope, teamRules, teamPolicy);
    mock.load.mockResolvedValue({
      match: { id: 99445 },
      first_event_id: 1,
      events: [1, 2].map((run) => ({
        id: run,
        game: {
          ...game(500 + run, []),
          scores: extraPlayers.map((user_id, index) => ({
            user_id,
            score: ((run - 1) * 4 + index + 1) * 100000,
            mods: [],
            match: { team: index % 2 ? 'red' : 'blue' },
          })),
        },
      })),
    });
    const actor = { ...organizer, tournamentId: scope };
    const input = qualifierImportSchema.parse({ stageId, links: ['https://osu.ppy.sh/mp/99445'] });
    const preview = await previewQualifierImport(actor, input);
    expect(preview.sources[0].games[0].teams.map((team) => [team.name, team.value]).sort()).toEqual(
      [
        ['Team 0', 300000],
        ['Team 1', 700000],
      ],
    );
    const result = await applyQualifierImport(actor, {
      ...input,
      jobId: preview.jobId,
      fingerprint: preview.fingerprint,
      apply: true,
    });
    expect(result).toMatchObject({ imported: 8, errors: [] });
    const calculation = await loadQualifierCalculation(db, stageId, scope);
    expect(calculation.calculation.rows.map((row) => [row.name, row.value])).toEqual([
      ['Team 1', 1500000],
      ['Team 0', 1100000],
    ]);
  });
  it('retains completed source histories when another provider request fails and resumes without re-fetching them', async () => {
    const stageId = await stage('Provider retry');
    let firstRequests = 0;
    mock.load.mockImplementation(async (path: string) => {
      const id = Number(path.match(/matches\/(\d+)/)![1]);
      if (id === 99447)
        throw new AppError('osu! could not return data. Please try again shortly.', 502);
      firstRequests++;
      return {
        match: { id },
        first_event_id: 1,
        events: [{ id: 1, game: game(701, [100, 200, 300]) }],
      };
    });
    const input = qualifierImportSchema.parse({
      stageId,
      links: ['https://osu.ppy.sh/mp/99446', 'https://osu.ppy.sh/mp/99447'],
    });
    const partial = await previewQualifierImport(organizer, input);
    expect(partial.complete).toBe(false);
    expect(partial.sources[0].complete).toBe(true);
    expect(partial.sources[1].issues).toContain(
      'osu! could not return data. Please try again shortly.',
    );
    mock.load.mockImplementation(async (path: string) => {
      const id = Number(path.match(/matches\/(\d+)/)![1]);
      if (id === 99446) firstRequests++;
      return {
        match: { id },
        first_event_id: 1,
        events: [{ id: 1, game: game(702, [400, 500, 600]) }],
      };
    });
    const complete = await previewQualifierImport(organizer, { ...input, jobId: partial.jobId });
    expect(complete.complete).toBe(true);
    expect(firstRequests).toBe(1);
    expect(complete.sources[1].issues).toEqual([]);
    expect(
      (
        await applyQualifierImport(organizer, {
          ...input,
          jobId: complete.jobId,
          fingerprint: complete.fingerprint,
          apply: true,
        })
      ).imported,
    ).toBe(6);
  });
  it('resumes historical imported runs without applying the website start boundary or reviving explicit exclusions', async () => {
    const historicalStage = await stage(
      'Historical synchronization',
      tournamentId,
      inheritedRules(
        { teamSize: 1, multiplierMode: 'NONE', freeModRequiredHD: 0, freeModRequiredHR: 0 },
        'SCORE_V2',
      ),
    );
    await db.mappoolSlot.updateMany({
      where: { revision: { mappool: { stageId: historicalStage } } },
      data: { name: 'FM1', category: 'FM' },
    });
    const historical = [1101, 1102].map((id, index) => ({
      ...game(id, [100 + index, 200 + index]),
      start_time: new Date(Date.now() - 86400000 + index * 300000).toISOString(),
      end_time: new Date(Date.now() - 86400000 + index * 300000 + 120000).toISOString(),
      mods: [],
      scores: [
        { user_id: users[0].osuId, score: 100 + index, mods: index ? ['NF', 'HD'] : ['HD'] },
        { user_id: users[1].osuId, score: 200 + index, mods: ['NF', 'HR'] },
      ],
    }));
    const response = {
      match: { id: 99670 },
      first_event_id: 1,
      events: historical.map((game, index) => ({ id: index + 1, game })),
    };
    mock.load.mockResolvedValue(response);
    const input = qualifierImportSchema.parse({
      stageId: historicalStage,
      links: ['https://osu.ppy.sh/mp/99670'],
    });
    const preview = await previewQualifierImport(organizer, input);
    const imported = await applyQualifierImport(organizer, {
      ...input,
      jobId: preview.jobId,
      fingerprint: preview.fingerprint,
      apply: true,
    });
    expect(imported).toMatchObject({ imported: 4, errors: [] });
    const id = imported.sessions[0];
    // Isolated fixtures reproduce old retained receipts without removal tombstones.
    await db.qualifierScore.deleteMany({ where: { lobbyId: id } });
    await db.qualifierGame.updateMany({
      where: { lobbyId: id },
      data: { status: 'PENDING', run: null, slotName: null },
    });
    await db.qualifierLobby.update({
      where: { id },
      data: { status: 'IN_PROGRESS', autoCompleted: false, version: { increment: 1 } },
    });
    const resumed = await syncQualifier(organizer, id, { apply: true });
    expect(resumed).toMatchObject({ complete: true, imported: 4, rejected: [] });
    expect(resumed.proposals.map((proposal) => proposal.run)).toEqual([1, 2]);
    expect(await db.qualifierScore.count({ where: { lobbyId: id } })).toBe(4);
    expect(
      await db.qualifierScore.findFirstOrThrow({ where: { lobbyId: id, eligible: false } }),
    ).toMatchObject({ run: 1, eligibilityReason: 'NoFail is required.' });
    expect(await current(id)).toMatchObject({ status: 'COMPLETED', autoCompleted: true });
    expect((await syncQualifier(organizer, id, { apply: true })).imported).toBe(0);
    const first = await db.qualifierGame.findFirstOrThrow({
      where: { lobbyId: id, gameId: '1101' },
    });
    await db.qualifierGame.update({
      where: { id: first.id },
      data: { status: 'IGNORED', reason: 'Game before the website qualifier start' },
    });
    expect((await syncQualifier(organizer, id, { apply: true })).imported).toBe(0);
    expect(await db.qualifierGame.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({
      status: 'ACCEPTED',
    });
    expect(
      await db.qualifierEvent.findFirst({
        where: { lobbyId: id, kind: 'qualifier.source.received' },
        orderBy: { version: 'desc' },
      }),
    ).toMatchObject({
      data: {
        updates: expect.arrayContaining([
          expect.objectContaining({ classification: { before: 'IGNORED', after: 'PENDING' } }),
        ]),
      },
    });
    await ignoreQualifierGame(
      organizer,
      id,
      first.id,
      (await current(id)).version,
      'Game before the website qualifier start',
      true,
    );
    mock.load.mockResolvedValue({
      ...response,
      events: [...response.events, { id: 3, game: { ...historical[1], id: 1103 } }],
    });
    expect((await syncQualifier(organizer, id, { apply: true })).imported).toBe(0);
    expect(await db.qualifierGame.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({
      status: 'IGNORED',
    });
    expect(await db.qualifierScore.count({ where: { lobbyId: id } })).toBe(4);
    expect(await db.qualifierScore.count({ where: { lobbyId: id, eligible: false } })).toBe(2);
    expect(
      await db.qualifierGame.findFirstOrThrow({ where: { lobbyId: id, gameId: '1103' } }),
    ).toMatchObject({ status: 'IGNORED', reason: 'Game before the website qualifier start' });
  });
  it('preserves individual invalid FreeMod scores, resolves exceptions in bulk and resumes optional runs', async () => {
    const fmRules = inheritedRules(
      { teamSize: 1, multiplierMode: 'NONE', freeModRequiredHD: 0, freeModRequiredHR: 0 },
      'SCORE_V2',
    );
    const fmStage = await stage('Freemod exceptions', tournamentId, fmRules);
    await db.mappoolSlot.updateMany({
      where: { revision: { mappool: { stageId: fmStage } } },
      data: { name: 'FM1', category: 'FM' },
    });
    const source = {
      ...game(801, [100, 200]),
      scores: [
        { user_id: users[0].osuId, score: 100, mods: ['HD'] },
        { user_id: users[1].osuId, score: 200, mods: ['DT'] },
        { user_id: 2147000001, score: 900000, mods: [] },
      ],
    };
    mock.load.mockResolvedValue({
      match: { id: 99501 },
      first_event_id: 1,
      events: [{ id: 1, game: source }],
    });
    const input = qualifierImportSchema.parse({
      stageId: fmStage,
      links: ['https://osu.ppy.sh/mp/99501'],
    });
    const preview = await previewQualifierImport(organizer, input);
    expect(preview.sources[0].issues).toEqual([]);
    expect(preview.sources[0].unknownPlayers).toContain(2147000001);
    const imported = await applyQualifierImport(organizer, {
      ...input,
      jobId: preview.jobId,
      fingerprint: preview.fingerprint,
      apply: true,
    });
    expect(imported.imported).toBe(2);
    const id = imported.sessions[0];
    expect(await current(id)).toMatchObject({ status: 'COMPLETED', autoCompleted: true });
    const scores = await db.qualifierScore.findMany({ where: { lobbyId: id } });
    expect(scores.find((s) => s.osuId === users[0].osuId)).toMatchObject({
      raw: 100,
      eligible: true,
    });
    const invalid = scores.find((s) => s.osuId === users[1].osuId)!;
    expect(invalid).toMatchObject({
      raw: 200,
      eligible: false,
      eligibilityReason: 'This mod is not allowed in FreeMod.',
    });
    const evidence = await db.qualifierGame.findFirstOrThrow({ where: { lobbyId: id } });
    expect((evidence.evidence as { game: { scores: unknown[] } }).game.scores).toHaveLength(3);
    expect(
      (await loadQualifierCalculation(db, fmStage, tournamentId)).calculation.canFinalize,
    ).toBe(false);
    const version = (await current(id)).version;
    await expect(
      db.$transaction((tx) =>
        applyQualifierAction(
          tx,
          users[0],
          qualifierActionSchema.parse({
            type: 'qualifier.scores.resolve',
            id,
            baseVersion: version,
            scoreIds: [invalid.id],
            eligible: true,
            reason: 'Unauthorized override',
          }),
        ),
      ),
    ).rejects.toThrow();
    await action({
      type: 'qualifier.scores.resolve',
      id,
      baseVersion: version,
      scoreIds: [invalid.id],
      eligible: true,
      reason: 'Organizer approved exception after evidence review',
    });
    expect(await current(id)).toMatchObject({ status: 'COMPLETED', autoCompleted: true });
    expect(
      (await loadQualifierCalculation(db, fmStage, tournamentId)).calculation.canFinalize,
    ).toBe(true);
    await action({
      type: 'qualifier.map',
      id,
      baseVersion: (await current(id)).version,
      slotName: 'FM1',
      run: 2,
      warmup: false,
      reason: 'Optional second run',
    });
    mock.load.mockResolvedValue({
      match: { id: 99501 },
      first_event_id: 1,
      events: [
        { id: 1, game: source },
        {
          id: 2,
          game: {
            ...game(802, [300, 400]),
            scores: [
              { user_id: users[0].osuId, score: 300, mods: ['HD'] },
              { user_id: users[1].osuId, score: 400, mods: ['HR'] },
            ],
          },
        },
      ],
    });
    expect((await syncQualifier(organizer, id, { apply: true })).imported).toBe(2);
    expect(await db.qualifierScore.count({ where: { lobbyId: id } })).toBe(4);
    expect((await syncQualifier(organizer, id, { apply: true })).imported).toBe(0);
    expect(await db.qualifierScore.findUniqueOrThrow({ where: { id: invalid.id } })).toMatchObject({
      eligible: true,
      eligibilityReason: 'Organizer approved exception after evidence review',
    });
    const lobbyView = JSON.parse(
      JSON.stringify(
        (await qualifierData(organizer, new URL(`https://local.invalid/?id=${id}`))).lobbies[0],
      ),
    );
    const secondGame = lobbyView.games.find((g: { gameId: string }) => g.gameId === '802');
    const proposal = qualifierGameProposals([secondGame.evidence], lobbyView, { historical: true })
      .proposals[0];
    await expect(
      captureQualifierGame(organizer, id, proposal, 1, {
        multiplayerId: 99501,
        historical: true,
        baseVersion: (await current(id)).version,
        reason: 'Unapproved run relocation',
      }),
    ).rejects.toThrow('another run');
    await captureQualifierGame(organizer, id, proposal, 1, {
      multiplayerId: 99501,
      historical: true,
      baseVersion: (await current(id)).version,
      replace: true,
      reason: 'Reviewed run correction',
    });
    expect(await db.qualifierScore.count({ where: { lobbyId: id } })).toBe(2);
    expect(await db.qualifierScore.count({ where: { lobbyId: id, run: 2 } })).toBe(0);
    expect((await current(id)).autoCompleted).toBe(true);
  });
  it('edits sessions and deletes single/bulk reservations transactionally while retaining completed histories', async () => {
    const deletionStage = await stage('Deletion');
    const create = async (code: string) =>
      (
        await action({
          type: 'qualifier.create',
          code,
          stageId: deletionStage,
          teamIds: [],
          refereeIds: [],
          scheduledAt: null,
        })
      ).id;
    const first = await create('DELETE-A'),
      second = await create('DELETE-B');
    await action({
      type: 'qualifier.edit',
      id: first,
      baseVersion: 1,
      code: 'EDITED-A',
      notes: 'Updated in place',
    });
    await expect(
      action({
        type: 'qualifier.delete',
        lobbies: [
          { id: first, baseVersion: 1 },
          { id: second, baseVersion: 1 },
        ],
        confirm: true,
        reason: 'Stale batch deletion',
      }),
    ).rejects.toThrow('changed');
    expect((await current(second)).deletedAt).toBeNull();
    await action({
      type: 'qualifier.delete',
      lobbies: [
        { id: first, baseVersion: 2 },
        { id: second, baseVersion: 1 },
      ],
      confirm: true,
      reason: 'Remove unused reservations',
    });
    expect(await current(first)).toMatchObject({
      code: 'EDITED-A',
      notes: 'Updated in place',
      status: 'CANCELLED',
    });
    expect((await current(first)).deletedAt).not.toBeNull();
    expect(
      (await qualifierData(organizer, new URL('https://local.invalid/'))).lobbies.some(
        (l) => l.id === first,
      ),
    ).toBe(false);
    expect(
      (await qualifierData(organizer, new URL(`https://local.invalid/?id=${first}`))).lobbies[0]
        .access.editable,
    ).toBe(false);
    const active = await create('ACTIVE');
    await db.qualifierLobby.update({ where: { id: active }, data: { status: 'IN_PROGRESS' } });
    await expect(
      action({
        type: 'qualifier.delete',
        lobbies: [{ id: active, baseVersion: 1 }],
        confirm: true,
        reason: 'Unsafe active deletion',
      }),
    ).rejects.toThrow('active');
    await expect(
      db.$transaction((tx) =>
        applyQualifierAction(
          tx,
          users[0],
          qualifierActionSchema.parse({
            type: 'qualifier.delete',
            lobbies: [{ id: active, baseVersion: 1 }],
            confirm: true,
            reason: 'Unauthorized deletion',
          }),
        ),
      ),
    ).rejects.toThrow();
    const completed = await create('HISTORY');
    await db.qualifierLobby.update({ where: { id: completed }, data: { status: 'COMPLETED' } });
    const pending = await db.qualifierGame.create({
      data: {
        lobbyId: completed,
        multiplayerId: 99504,
        gameId: '1',
        evidence: { game: { end_time: null } },
      },
    });
    const unused = await create('BLOCKED-BATCH');
    await expect(
      action({
        type: 'qualifier.delete',
        lobbies: [
          { id: unused, baseVersion: 1 },
          { id: completed, baseVersion: 1 },
        ],
        confirm: true,
        reason: 'Cannot strand pending optional-run history',
      }),
    ).rejects.toThrow('pending');
    expect((await current(unused)).deletedAt).toBeNull();
    await db.qualifierGame.update({
      where: { id: pending.id },
      data: { status: 'IGNORED', reason: 'Reviewed unfinished fixture game' },
    });
    await db.qualifierLobby.update({
      where: { id: completed },
      data: { multiplayerSync: { complete: false } },
    });
    await expect(
      action({
        type: 'qualifier.delete',
        lobbies: [{ id: completed, baseVersion: 1 }],
        confirm: true,
        reason: 'Cannot strand incomplete provider history',
      }),
    ).rejects.toThrow('complete history');
    await db.qualifierLobby.update({
      where: { id: completed },
      data: { multiplayerSync: { complete: true } },
    });
    const count = await db.qualifierEvent.count({ where: { lobbyId: completed } });
    await action({
      type: 'qualifier.delete',
      lobbies: [{ id: completed, baseVersion: 1 }],
      confirm: true,
      reason: 'Remove completed session from operations',
    });
    expect((await current(completed)).status).toBe('COMPLETED');
    expect(await db.qualifierEvent.count({ where: { lobbyId: completed } })).toBe(count + 1);
    await expect(
      action({ type: 'qualifier.edit', id: completed, baseVersion: 2, code: 'CHANGED', notes: '' }),
    ).rejects.toThrow('read-only');
  });
  it('fills late API scores in accepted partial games without reviving intentional removals or replacing corrections', async () => {
    const partialStage = await stage('Late scores');
    const id = (
      await action({
        type: 'qualifier.create',
        code: 'LATE',
        stageId: partialStage,
        teamIds: teamIds.slice(0, 2),
        refereeIds: [organizer.id],
        scheduledAt: new Date().toISOString(),
      })
    ).id;
    await action({
      type: 'qualifier.lobby',
      id,
      baseVersion: 1,
      lobbyUrl: 'https://osu.ppy.sh/mp/99502',
    });
    await action({
      type: 'qualifier.status',
      id,
      baseVersion: 2,
      command: 'START',
      reason: 'Start shared partial-score session',
    });
    let played = game(901, [100]),
      multiplayer = 99502;
    mock.load.mockImplementation(async () => ({
      match: { id: multiplayer },
      first_event_id: 1,
      events: [{ id: 1, game: played }],
    }));
    expect((await syncQualifier(organizer, id, { apply: true })).imported).toBe(1);
    expect((await current(id)).status).toBe('IN_PROGRESS');
    played = {
      ...played,
      scores: [
        ...played.scores,
        { user_id: users[1].osuId, score: 200, mods: [], match: { team: 'red' } },
      ],
    };
    expect((await syncQualifier(organizer, id, { apply: true })).imported).toBe(1);
    expect(await current(id)).toMatchObject({ status: 'COMPLETED', autoCompleted: true });
    const stableVersion = (await current(id)).version;
    expect((await syncQualifier(organizer, id, { apply: true })).imported).toBe(0);
    expect((await current(id)).version).toBe(stableVersion);
    const removed = await db.qualifierScore.findFirstOrThrow({
      where: { lobbyId: id, osuId: users[1].osuId },
    });
    await action({
      type: 'qualifier.score.remove',
      id,
      baseVersion: stableVersion,
      scoreId: removed.id,
      reason: 'Intentional removal after evidence review',
    });
    expect((await current(id)).status).toBe('IN_PROGRESS');
    expect((await syncQualifier(organizer, id, { apply: true })).imported).toBe(0);
    expect(await db.qualifierScore.count({ where: { lobbyId: id } })).toBe(1);
    const source = (await qualifierData(organizer, new URL(`https://local.invalid/?id=${id}`)))
      .lobbies[0];
    const proposal = qualifierGameProposals(
      [{ game: played }],
      JSON.parse(JSON.stringify(source)),
      { historical: true },
    ).proposals[0];
    await captureQualifierGame(organizer, id, proposal, 1, {
      multiplayerId: 99502,
      baseVersion: (await current(id)).version,
      replace: true,
      reason: 'Explicitly restore reviewed missing score',
    });
    expect((await current(id)).status).toBe('COMPLETED');
    played = {
      ...played,
      scores: played.scores.map((s, index) => (index ? s : { ...s, score: 999 })),
    };
    expect((await syncQualifier(organizer, id, { apply: true })).imported).toBe(0);
    expect(
      (await db.qualifierScore.findFirstOrThrow({ where: { lobbyId: id, osuId: users[0].osuId } }))
        .raw,
    ).toBe(100);
    expect(
      (
        await db.qualifierEvent.findFirstOrThrow({
          where: { lobbyId: id, kind: 'qualifier.source.received' },
          orderBy: { version: 'desc' },
        })
      ).data,
    ).toHaveProperty('updates');
    const bulkStage = await stage('Late bulk scores');
    multiplayer = 99503;
    played = game(902, [100]);
    const bulkId = (
      await action({
        type: 'qualifier.create',
        code: 'LATE-BULK',
        stageId: bulkStage,
        teamIds: teamIds.slice(0, 2),
        refereeIds: [organizer.id],
        scheduledAt: new Date().toISOString(),
      })
    ).id;
    await action({
      type: 'qualifier.lobby',
      id: bulkId,
      baseVersion: 1,
      lobbyUrl: 'https://osu.ppy.sh/mp/99503',
    });
    await action({
      type: 'qualifier.status',
      id: bulkId,
      baseVersion: 2,
      command: 'START',
      reason: 'Start bulk continuation session',
    });
    expect((await syncQualifier(organizer, bulkId, { apply: true })).imported).toBe(1);
    const input = qualifierImportSchema.parse({
      stageId: bulkStage,
      links: ['https://osu.ppy.sh/mp/99503'],
    });
    const cached = await previewQualifierImport(organizer, input);
    expect(cached.sources[0].games[0].proposal!.players).toHaveLength(1);
    played = {
      ...played,
      scores: [
        ...played.scores,
        { user_id: users[1].osuId, score: 200, mods: [], match: { team: 'red' } },
      ],
    };
    const refreshed = await previewQualifierImport(organizer, { ...input, jobId: cached.jobId });
    expect(refreshed.sources[0].games[0].proposal!.players).toHaveLength(2);
    expect(
      (
        await applyQualifierImport(organizer, {
          ...input,
          jobId: refreshed.jobId,
          fingerprint: refreshed.fingerprint,
          apply: true,
        })
      ).imported,
    ).toBe(1);
    expect((await current(bulkId)).status).toBe('COMPLETED');
    const exclude = qualifierImportSchema.parse({
      ...input,
      jobId: refreshed.jobId,
      decisions: [{ multiplayerId: 99503, excludePlayers: [users[1].osuId] }],
    });
    const reviewed = await previewQualifierImport(organizer, exclude);
    await applyQualifierImport(organizer, {
      ...exclude,
      fingerprint: reviewed.fingerprint,
      apply: true,
    });
    expect(await db.qualifierScore.count({ where: { lobbyId: bulkId } })).toBe(2);
    expect(
      await db.qualifierScore.findFirstOrThrow({
        where: { lobbyId: bulkId, osuId: users[1].osuId },
      }),
    ).toMatchObject({ raw: 200, eligible: false });
    expect((await syncQualifier(organizer, bulkId, { apply: true })).imported).toBe(0);
    expect((await current(bulkId)).status).toBe('COMPLETED');
  });
  it('separates booking policy, data and cancellation from tournament registration', async () => {
    const bookingStage = await stage('Independent booking');
    const created = await action({
      type: 'qualifier.create',
      code: 'Independent reservation',
      stageId: bookingStage,
      teamIds: [],
      refereeIds: [],
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const id = created.id!;
    const initial = await qualifierBookingData(users[0], tournamentId);
    const team = await db.team.findUniqueOrThrow({ where: { id: initial.team!.id } });
    const settings = await db.tournamentSettings.findUniqueOrThrow({ where: { tournamentId } });
    await db.tournamentSettings.update({
      where: { tournamentId },
      data: {
        registrationPolicy: json({
          ...registrationPolicySchema.parse(settings.registrationPolicy),
          closesAt: new Date(Date.now() - 1000).toISOString(),
          fields: [],
        }),
      },
    });
    const currentBooking = await qualifierBookingData(users[0], tournamentId);
    expect(currentBooking.policyToken).toBe(initial.policyToken);
    expect(await registrationData(users[0], tournamentId)).not.toHaveProperty('sessions');
    expect(currentBooking.team).not.toHaveProperty('registrationAnswers');
    const reserve = async (lobbyId: string | null, sourceVersion?: number) =>
      db.$transaction((tx) =>
        applyQualifierBooking(
          tx,
          users[0],
          qualifierBookingSchema.parse({
            type: 'qualifier.booking.reserve',
            policyToken: currentBooking.policyToken,
            teamVersion: team.version,
            stageId: bookingStage,
            lobbyId,
            baseVersion: lobbyId ? 1 : undefined,
            sourceVersion,
          }),
        ),
      );
    await reserve(id);
    expect(await db.qualifierEntry.count({ where: { lobbyId: id } })).toBe(1);
    await reserve(null, (await current(id)).version);
    expect(await db.qualifierEntry.count({ where: { lobbyId: id } })).toBe(0);
    expect(await db.team.findUniqueOrThrow({ where: { id: team.id } })).toEqual(team);
    await db.tournamentSettings.update({
      where: { tournamentId },
      data: { registrationPolicy: settings.registrationPolicy! },
    });
  });
  it('previews canonical cohort corrections, rejects stale or unauthorized changes, and reprocesses raw evidence', async () => {
    const fmRules = inheritedRules(
      { teamSize: 1, multiplierMode: 'NONE', freeModRequiredHD: 0, freeModRequiredHR: 0 },
      'SCORE_V2',
    );
    const correctionStage = await stage('Correction preview', tournamentId, fmRules);
    await db.mappoolSlot.updateMany({
      where: { revision: { mappool: { stageId: correctionStage } } },
      data: { name: 'FM1', category: 'FM' },
    });
    mock.load.mockResolvedValue({
      match: { id: 99951 },
      first_event_id: 1,
      events: [
        {
          id: 1,
          game: {
            ...game(9951, [106000, 220000]),
            scores: [
              { user_id: users[0].osuId, score: 106000, mods: ['HD'], passed: true },
              { user_id: users[1].osuId, score: 220000, mods: ['HR'], passed: true },
            ],
          },
        },
      ],
    });
    const input = qualifierImportSchema.parse({
      stageId: correctionStage,
      links: ['https://osu.ppy.sh/mp/99951'],
    });
    const importedPreview = await previewQualifierImport(organizer, input);
    const imported = await applyQualifierImport(organizer, {
      ...input,
      jobId: importedPreview.jobId,
      fingerprint: importedPreview.fingerprint,
      apply: true,
    });
    const id = imported.sessions[0],
      score = await db.qualifierScore.findFirstOrThrow({
        where: { lobbyId: id, osuId: users[0].osuId },
      });
    const review = (value: unknown, actor = organizer) =>
      db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
        return reviewQualifierCorrections(tx, actor, qualifierCorrectionSchema.parse(value));
      });
    const edit = {
      stageId: correctionStage,
      operation: 'EDIT',
      lobbies: [{ id, baseVersion: (await current(id)).version, scoreIds: [score.id] }],
      patch: { raw: 159000 },
      reason: 'Reviewed score evidence',
    };
    await expect(review(edit, users[0])).rejects.toThrow('permission');
    await expect(review({ ...edit, stageId: stageId })).rejects.toThrow();
    const preview = await review(edit);
    expect(preview.changed).toBe(1);
    expect(await db.qualifierScore.findUniqueOrThrow({ where: { id: score.id } })).toMatchObject({
      raw: 106000,
    });
    await expect(review({ ...edit, apply: true, reviewHash: 'a'.repeat(64) })).rejects.toThrow(
      'preview',
    );
    await review({ ...edit, apply: true, reviewHash: preview.reviewHash });
    expect(await db.qualifierScore.findUniqueOrThrow({ where: { id: score.id } })).toMatchObject({
      raw: 159000,
      source: 'MANUAL',
    });
    await expect(review(edit)).rejects.toThrow('changed');
    const reprocess = {
      stageId: correctionStage,
      operation: 'REPROCESS',
      lobbies: [{ id, baseVersion: (await current(id)).version, scoreIds: [] }],
      policy: qualifierPolicySchema.parse({
        ...policy,
        normalization: 'BUILT_IN',
        multiplierPolicy: 'NONE',
        rounding: 'FLOOR',
      }),
      reason: 'Apply reviewed normalization',
    };
    const impact = await review(reprocess);
    expect(impact.affected.find((s) => s.id === score.id)?.adjusted).toBe(150000);
    await review({ ...reprocess, apply: true, reviewHash: impact.reviewHash });
    const calculation = (await loadQualifierCalculation(db, correctionStage, tournamentId))
      .calculation;
    expect(calculation.rows.map((r) => r.value)).toEqual(impact.rows.map((r) => r.after));
    expect(await db.qualifierScore.findUniqueOrThrow({ where: { id: score.id } })).toMatchObject({
      raw: 159000,
      adjusted: 150000,
    });
    const receipt = await db.qualifierGame.findFirstOrThrow({ where: { lobbyId: id } });
    expect(JSON.stringify(receipt.evidence)).toContain('106000');
    expect(
      await db.qualifierEvent.count({ where: { lobbyId: id, kind: 'qualifier.scores.correct' } }),
    ).toBe(2);
    const decide = async (operation: string, scoreIds = [score.id], extra: object = {}) => {
      const input = {
        stageId: correctionStage,
        operation,
        lobbies: [{ id, baseVersion: (await current(id)).version, scoreIds }],
        reason: 'Reviewed eligibility and attribution',
        ...extra,
      };
      const impact = await review(input);
      await review({ ...input, apply: true, reviewHash: impact.reviewHash });
      return impact;
    };
    await decide('EXCLUDE');
    expect(await current(id)).toMatchObject({ status: 'COMPLETED', autoCompleted: true });
    expect(
      (await loadQualifierCalculation(db, correctionStage, tournamentId)).calculation.rows.find(
        (r) => r.participantId === teamIds[0],
      )?.value,
    ).toBeNull();
    await decide('REVALIDATE');
    expect((await db.qualifierScore.findUniqueOrThrow({ where: { id: score.id } })).eligible).toBe(
      false,
    );
    await decide('RESTORE');
    expect(await db.qualifierScore.findUniqueOrThrow({ where: { id: score.id } })).toMatchObject({
      eligible: true,
      eligibilityOverride: null,
    });
    const all = await db.qualifierScore.findMany({ where: { lobbyId: id } });
    await expect(decide('REMAP', [score.id], { destination: { run: 2 } })).rejects.toThrow(
      'every player',
    );
    await decide(
      'REMAP',
      all.map((s) => s.id),
      { destination: { run: 2 } },
    );
    expect(await db.qualifierScore.count({ where: { lobbyId: id, run: 2 } })).toBe(2);
    expect((await syncQualifier(organizer, id, { apply: true })).imported).toBe(0);
    expect(await db.qualifierScore.findUniqueOrThrow({ where: { id: score.id } })).toMatchObject({
      raw: 159000,
      run: 2,
    });
    const finalCalculation = (await loadQualifierCalculation(db, correctionStage, tournamentId))
      .calculation;
    expect(finalCalculation.canFinalize).toBe(true);
    await db.$transaction((tx) =>
      applyQualifierStandingsAction(tx, organizer, {
        type: 'qualifier.standings.calculate',
        stageId: correctionStage,
        baseVersion: 0,
        sourceHash: finalCalculation.sourceHash,
      }),
    );
    await db.$transaction((tx) =>
      applyQualifierStandingsAction(tx, organizer, {
        type: 'qualifier.standings.finalize',
        stageId: correctionStage,
        baseVersion: 1,
        sourceHash: finalCalculation.sourceHash,
        tieOrder: [],
        reason: '',
      }),
    );
    const blocked = {
      stageId: correctionStage,
      operation: 'EXCLUDE',
      lobbies: [{ id, baseVersion: (await current(id)).version, scoreIds: [score.id] }],
    };
    const lockedPreview = await review(blocked);
    expect(lockedPreview.locked).toBe(true);
    await expect(
      review({ ...blocked, apply: true, reviewHash: lockedPreview.reviewHash }),
    ).rejects.toThrow('locked');
  });
  it('publishes a rejection reason while keeping private administrative notes separate', async () => {
    const team = await db.team.findUniqueOrThrow({ where: { id: teamIds[2] } });
    await db.$transaction((tx) =>
      applyTeamAction(
        tx,
        organizer,
        teamActionSchema.parse({
          type: 'team.status',
          id: team.id,
          baseVersion: team.version,
          status: 'REJECTED',
          published: true,
          rejectionReason: 'Eligibility review failed',
        }),
        { profiles: [] },
      ),
    );
    await db.team.update({ where: { id: team.id }, data: { adminNotes: 'Private investigation' } });
    const publicTeam = await db.team.findUniqueOrThrow({
      where: { id: team.id },
      select: publicTeamSelect,
    });
    expect(publicTeam).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'Eligibility review failed',
    });
    expect(publicTeam).not.toHaveProperty('adminNotes');
  });
});
