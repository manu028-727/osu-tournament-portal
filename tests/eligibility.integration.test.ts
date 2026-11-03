import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { executeAction } from '../src/lib/admin-service';
import { actorForTournament } from '../src/lib/auth';
import { db } from '../src/lib/db';
import { assertTestDatabase } from '../src/lib/instance';
import { ALL_PERMISSIONS, type Actor, type PermissionKey } from '../src/lib/permissions';
import { qualifierBookingData, applyQualifierBooking } from '../src/lib/qualifier-booking-service';
import { inheritedRules } from '../src/lib/gameplay-scoring';
import { qualifierPolicySchema } from '../src/lib/qualifier-policy';
import { registrationActionSchema } from '../src/lib/registration-policy';
import { applyRegistration, registrationData } from '../src/lib/registration-service';
import { setupWorkspaceData } from '../src/lib/setup-queries';
import { exportTournament } from '../src/lib/tournament-export';
import { importTournament, inspectArchive } from '../src/lib/tournament-import';
import { tournamentAction } from '../src/lib/tournaments-service';
import { actionSchema } from '../src/lib/validation';

const mock = vi.hoisted(() => ({
  ranks: new Map<number, number | null>(),
  countries: new Map<number, string>(),
}));
vi.mock('../src/lib/osu', async (original) => ({
  ...(await original<typeof import('../src/lib/osu')>()),
  osuGet: async (path: string) => {
    const id = Number(path.split('/')[1]);
    return {
      id,
      username: `Player${id}`,
      avatar_url: 'https://a.ppy.sh/1',
      country_code: mock.countries.get(id) ?? 'IT',
      statistics: { global_rank: mock.ranks.get(id) ?? 1000 },
    };
  },
  osuProfile: async (id: number) => ({
    id,
    username: `Player${id}`,
    avatar_url: 'https://a.ppy.sh/1',
  }),
}));

assertTestDatabase(process.env.DATABASE_URL);
const prefix = `eligibility-${randomUUID().slice(0, 8)}`;
const tournamentIds: string[] = [];
const userIds: string[] = [];
const osuIds: number[] = [];
let nextOsuId = 1_740_000_000 + (Date.now() % 1_000_000);
let owner: Actor;

const act = (actor: Actor, input: unknown) => executeAction(actor, actionSchema.parse(input));
const newPlayer = (rank: number | null = 1000, country = 'IT') => {
  const osuId = nextOsuId++;
  osuIds.push(osuId);
  mock.ranks.set(osuId, rank);
  mock.countries.set(osuId, country);
  return osuId;
};
const profile = (osuId: number) => ({
  id: osuId,
  username: `Player${osuId}`,
  avatar_url: '',
  country_code: mock.countries.get(osuId) ?? 'IT',
  statistics: { global_rank: mock.ranks.get(osuId) ?? null },
});

async function fixture(slug: string, policy: object) {
  const { id: tournamentId } = await tournamentAction(owner, {
    type: 'create',
    name: prefix,
    acronym: 'ELI',
    slug: `${prefix}-${slug}`,
    description: '',
    gameMode: 'osu',
    format: 'TEAMS',
    gameplayScoring: 'SCORE_V2',
  });
  tournamentIds.push(tournamentId);
  await db.tournament.update({
    where: { id: tournamentId },
    data: { status: 'REGISTRATIONS_OPEN', published: true },
  });
  await db.tournamentSettings.update({
    where: { tournamentId },
    data: {
      registrationPolicy: { minPlayers: 1, ...policy },
      matchRules: { teamSize: 2, multiplierMode: 'NONE' },
    },
  });
  return { tournamentId, actor: { ...owner, tournamentId } };
}

async function captain(tournamentId: string, osuId: number): Promise<Actor> {
  const user = await db.user.create({
    data: { osuId, username: `Player${osuId}`, avatarUrl: '', profileUrl: '' },
  });
  userIds.push(user.id);
  return {
    id: user.id,
    osuId,
    username: user.username,
    avatarUrl: '',
    tournamentId,
    permissions: [],
    roles: [],
  };
}

async function register(actor: Actor, roster: number[], substitutes: number[] = []) {
  const data = await registrationData(actor, actor.tournamentId!);
  return db.$transaction((tx) =>
    applyRegistration(
      tx,
      actor,
      registrationActionSchema.parse({
        type: 'registration.save',
        policyToken: data.policyToken,
        baseVersion: data.team?.version || 0,
        name: `Team ${actor.osuId}`,
        format: 'TEAM',
        members: [
          ...roster.map((osuId) => ({ osuId, substitute: false })),
          ...substitutes.map((osuId) => ({ osuId, substitute: true })),
        ],
        answers: {},
      }),
      [...roster, ...substitutes].map(profile),
    ),
  );
}

const member = (tournamentId: string, osuId: number) =>
  db.teamMember.findUniqueOrThrow({ where: { tournamentId_osuId: { tournamentId, osuId } } });

beforeAll(async () => {
  const user = await db.user.create({
    data: {
      osuId: nextOsuId++,
      username: `${prefix}-owner`,
      avatarUrl: '',
      profileUrl: '',
      platformAdmin: true,
    },
    include: {
      roles: { include: { role: { include: { permissions: true } } } },
    },
  });
  userIds.push(user.id);
  owner = {
    ...actorForTournament(user, 'main'),
    platformAdmin: true,
    permissions: [...ALL_PERMISSIONS],
  };
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { tournamentId: { in: tournamentIds } } });
  await db.qualifierLobby.deleteMany({ where: { tournamentId: { in: tournamentIds } } });
  await db.mappool.deleteMany({ where: { tournamentId: { in: tournamentIds } } });
  await db.tournamentStage.deleteMany({ where: { tournamentId: { in: tournamentIds } } });
  await db.teamMember.deleteMany({ where: { tournamentId: { in: tournamentIds } } });
  await db.team.deleteMany({ where: { tournamentId: { in: tournamentIds } } });
  await db.tournamentSettings.deleteMany({ where: { tournamentId: { in: tournamentIds } } });
  await db.role.deleteMany({ where: { tournamentId: { in: tournamentIds } } });
  await db.tournament.deleteMany({ where: { id: { in: tournamentIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.participant.deleteMany({ where: { osuId: { in: osuIds } } });
});

describe('eligibility in real registrations', () => {
  it('refuses a player outside the limits, then admits them after a recorded decision', async () => {
    const { tournamentId, actor } = await fixture('reject', { maxRank: 99_999 });
    const a = newPlayer(1000);
    const b = newPlayer(120_000);
    const cap = await captain(tournamentId, a);
    await expect(register(cap, [a, b])).rejects.toThrow('outside the allowed range');
    expect(await db.team.count({ where: { tournamentId } })).toBe(0);

    await act(actor, {
      type: 'eligibility.exception.grant',
      osuId: b,
      kind: 'RANK',
      reason: 'Rank spike reviewed by hosts',
    });
    await register(cap, [a, b]);
    expect(await db.team.count({ where: { tournamentId, status: 'APPROVED' } })).toBe(1);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { tournamentId, action: 'eligibility.exception.grant' },
    });
    expect(JSON.stringify(audit.details)).toContain('Rank spike reviewed by hosts');
  });

  it('checks the same limits again once an exception is removed', async () => {
    const { tournamentId, actor } = await fixture('revoke', { countries: ['IT'] });
    const a = newPlayer(1000);
    const b = newPlayer(1000, 'FR');
    const cap = await captain(tournamentId, a);
    const { id } = (await act(actor, {
      type: 'eligibility.exception.grant',
      osuId: b,
      kind: 'COUNTRY',
      reason: 'Passed the language interview',
    })) as { id: string };
    await register(cap, [a, b]);
    await act(actor, {
      type: 'eligibility.exception.revoke',
      id,
      reason: 'Granted to the wrong player',
    });
    await expect(register(cap, [a, b])).rejects.toThrow('not from an eligible country');
    await expect(
      act(actor, { type: 'eligibility.exception.revoke', id, reason: 'Removed twice' }),
    ).rejects.toThrow('already removed');
    const row = await db.eligibilityException.findUniqueOrThrow({ where: { id } });
    expect(row.revokedReason).toBe('Granted to the wrong player');
    expect(row.revokedById).toBe(owner.id);
  });

  it('keeps a flagged registration for review and requires a decision to approve it', async () => {
    const { tournamentId, actor } = await fixture('review', {
      rankSumMax: 10_000,
      ineligible: 'REVIEW',
    });
    const a = newPlayer(8_000);
    const b = newPlayer(8_000);
    const { id: teamId } = await register(await captain(tournamentId, a), [a, b]);
    const saved = await db.team.findUniqueOrThrow({ where: { id: teamId } });
    expect(saved).toMatchObject({ status: 'PENDING', published: false });

    const review = (await setupWorkspaceData(actor)).eligibility!;
    expect(review.rows).toMatchObject([
      { id: teamId, status: 'PENDING', issues: [{ code: 'RANK_SUM', values: [16_000] }] },
    ]);
    const approve = (baseVersion: number) => ({
      type: 'team.status',
      id: teamId,
      baseVersion,
      status: 'APPROVED',
      published: true,
      rejectionReason: '',
    });
    await expect(act(actor, approve(saved.version))).rejects.toThrow('rank sum of 16000');
    // Bulk approval runs the same policy rather than a shortcut around it.
    await expect(
      act(actor, {
        type: 'team.bulk',
        operation: 'APPROVE',
        entries: [{ id: teamId, baseVersion: saved.version }],
      }),
    ).rejects.toThrow('rank sum of 16000');

    await act(actor, {
      type: 'eligibility.exception.grant',
      osuId: a,
      kind: 'RANK_SUM',
      reason: 'Host ruling on this pair',
    });
    await act(actor, approve(saved.version));
    expect(await db.team.findUniqueOrThrow({ where: { id: teamId } })).toMatchObject({
      status: 'APPROVED',
      published: true,
    });
    expect((await setupWorkspaceData(actor)).eligibility!.rows).toEqual([]);
  });

  it('keeps recorded ranks after the lock, while a new player is read as they join', async () => {
    const { tournamentId } = await fixture('lock', {
      maxRank: 99_999,
      rankLockAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const a = newPlayer(90_000);
    const b = newPlayer(90_000);
    const cap = await captain(tournamentId, a);
    await register(cap, [a, b]);
    await db.tournamentSettings.update({
      where: { tournamentId },
      data: {
        registrationPolicy: {
          minPlayers: 1,
          maxRank: 99_999,
          rankLockAt: new Date(Date.now() - 1000).toISOString(),
        },
      },
    });
    // Their rank falls outside the limit after the lock, which must not matter any more.
    mock.ranks.set(a, 150_000);
    mock.ranks.set(b, 150_000);
    const sub = newPlayer(70_000);
    await register(cap, [a, b], [sub]);
    expect((await member(tournamentId, a)).registrationRank).toBe(90_000);
    expect((await member(tournamentId, b)).registrationRank).toBe(90_000);
    expect((await member(tournamentId, sub)).registrationRank).toBe(70_000);
    // A joining player is not protected by a lock they were not part of.
    const late = newPlayer(150_000);
    await expect(register(cap, [a, b], [late])).rejects.toThrow('outside the allowed range');
  });

  it('reads ranks in batches, and leaves any reading taken after the lock alone', async () => {
    const { tournamentId, actor } = await fixture('capture', {
      rankLockAt: new Date(Date.now() - 1000).toISOString(),
    });
    const a = newPlayer(4_000);
    const b = newPlayer(5_000);
    const team = await db.team.create({
      data: { tournamentId, name: 'Organizer entry', slug: 'organizer-entry', status: 'APPROVED' },
    });
    for (const [position, osuId] of [a, b].entries()) {
      await db.participant.create({
        data: { osuId, username: `Player${osuId}`, avatarUrl: '', country: 'IT' },
      });
      await db.teamMember.create({
        data: { tournamentId, teamId: team.id, osuId, position, captain: position === 0 },
      });
    }
    const before = (await setupWorkspaceData(actor)).eligibility!;
    expect(before.rankTargets.sort()).toEqual([a, b].sort());
    await act(actor, { type: 'eligibility.ranks.capture', osuIds: [a, b] });
    const first = await member(tournamentId, a);
    expect(first.registrationRank).toBe(4_000);
    expect((await setupWorkspaceData(actor)).eligibility!.rankTargets).toEqual([]);

    mock.ranks.set(a, 9_999);
    const result = await act(actor, { type: 'eligibility.ranks.capture', osuIds: [a] });
    expect(result).toEqual({ captured: 0 });
    expect((await member(tournamentId, a)).registrationRank).toBe(4_000);
  });

  it('applies the limits to qualifier booking through the same rules', async () => {
    const { tournamentId, actor } = await fixture('booking', { maxRank: 99_999 });
    const a = newPlayer(1000);
    const b = newPlayer(1000);
    const cap = await captain(tournamentId, a);
    const { id: teamId } = await register(cap, [a, b]);
    await db.teamMember.update({
      where: { teamId_osuId: { teamId, osuId: b } },
      data: { registrationRank: 150_000 },
    });
    const stage = await db.tournamentStage.create({
      data: {
        tournamentId,
        name: 'Qualifiers',
        slug: 'qualifiers',
        kind: 'QUALIFIERS',
        qualifierPolicy: qualifierPolicySchema.parse({ requiredPlayers: 2 }),
      },
    });
    const pool = await db.mappool.create({ data: { tournamentId, stageId: stage.id } });
    const revision = await db.mappoolRevision.create({
      data: { tournamentId, mappoolId: pool.id },
    });
    const lobby = await db.qualifierLobby.create({
      data: {
        tournamentId,
        code: `${prefix}-q`,
        stageId: stage.id,
        poolRevisionId: revision.id,
        rules: JSON.parse(
          JSON.stringify(inheritedRules({ teamSize: 2, multiplierMode: 'NONE' }, 'SCORE_V2')),
        ),
        policy: qualifierPolicySchema.parse({ requiredPlayers: 2 }),
        participants: [],
        gameplayScoring: 'SCORE_V2',
        bookingOpen: true,
        capacity: 4,
        scheduledAt: new Date(Date.now() + 86_400_000),
      },
    });
    const data = await qualifierBookingData(cap, tournamentId);
    const team = await db.team.findUniqueOrThrow({ where: { id: teamId } });
    const book = () =>
      db.$transaction((tx) =>
        applyQualifierBooking(tx, cap, {
          type: 'qualifier.booking.reserve',
          policyToken: data.policyToken,
          teamVersion: team.version,
          stageId: stage.id,
          lobbyId: lobby.id,
          baseVersion: lobby.version,
        }),
      );
    await expect(book()).rejects.toThrow('outside the allowed range');
    await act(actor, {
      type: 'eligibility.exception.grant',
      osuId: b,
      kind: 'RANK',
      reason: 'Host ruling',
    });
    await book();
    expect(await db.qualifierEntry.count({ where: { lobbyId: lobby.id, teamId } })).toBe(1);
  });

  it('keeps exceptions inside their tournament', async () => {
    const one = await fixture('tenant-a', { countries: ['IT'] });
    const two = await fixture('tenant-b', { countries: ['IT'] });
    const a = newPlayer(1000, 'FR');
    const { id } = (await act(one.actor, {
      type: 'eligibility.exception.grant',
      osuId: a,
      kind: 'COUNTRY',
      reason: 'Allowed only in the first event',
    })) as { id: string };
    const cap = await captain(one.tournamentId, a);
    await register(cap, [a]);
    await expect(register({ ...cap, tournamentId: two.tournamentId }, [a])).rejects.toThrow(
      'not from an eligible country',
    );
    await expect(
      act(two.actor, { type: 'eligibility.exception.revoke', id, reason: 'Wrong tournament' }),
    ).rejects.toThrow('already removed');
    expect((await setupWorkspaceData(two.actor)).eligibility!.exceptions).toEqual([]);
  });

  it('requires the approval permission, and hides reasons from staff without roster access', async () => {
    const { tournamentId, actor } = await fixture('permissions', {});
    const without = (...missing: PermissionKey[]): Actor => ({
      ...actor,
      permissions: ALL_PERMISSIONS.filter((key) => !missing.includes(key)),
    });
    const grant = {
      type: 'eligibility.exception.grant',
      osuId: newPlayer(),
      kind: 'COUNTRY',
      reason: 'Should not be saved',
    };
    await expect(act(without('teams.publish'), grant)).rejects.toThrow('permission');
    await expect(
      act(without('teams.edit'), { type: 'eligibility.ranks.capture', osuIds: [grant.osuId] }),
    ).rejects.toThrow('permission');
    expect(await db.eligibilityException.count({ where: { tournamentId } })).toBe(0);
    expect((await setupWorkspaceData(without('teams.view'))).eligibility).toBeNull();
  });

  it('carries exceptions and rank readings through a tournament archive', async () => {
    const { tournamentId, actor } = await fixture('archive', { countries: ['IT'] });
    const a = newPlayer(1000, 'FR');
    await act(actor, {
      type: 'eligibility.exception.grant',
      osuId: a,
      kind: 'COUNTRY',
      reason: 'Interview passed',
    });
    await register(await captain(tournamentId, a), [a]);
    const { bytes } = await exportTournament(actor, 'https://source.example');
    const { archive } = await inspectArchive(bytes);
    const { tournamentId: copied } = await importTournament(owner, archive, `${prefix}-copy`);
    tournamentIds.push(copied);
    expect(
      await db.eligibilityException.findMany({ where: { tournamentId: copied } }),
    ).toMatchObject([{ osuId: a, kind: 'COUNTRY', reason: 'Interview passed' }]);
    const copiedMember = await member(copied, a);
    expect(copiedMember.rankCapturedAt).toEqual((await member(tournamentId, a)).rankCapturedAt);
  });
});
