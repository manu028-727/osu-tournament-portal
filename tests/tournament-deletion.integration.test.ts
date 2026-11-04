import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { db } from '../src/lib/db';
import { ALL_PERMISSIONS, type Actor } from '../src/lib/permissions';
import * as storage from '../src/lib/storage';
import { tournamentAction } from '../src/lib/tournaments-service';
import { tournamentRows } from './helpers/tournament-rows';

// Media cleanup keeps its own reference to this function, so the failure has to be set up here.
vi.mock('../src/lib/storage', async (original) => {
  const actual = await original<typeof import('../src/lib/storage')>();
  return { ...actual, deleteObject: vi.fn(actual.deleteObject) };
});

const prefix = `del-${randomUUID().slice(0, 8)}`;
const ids: string[] = [];
const userIds: string[] = [];
const osuIds = [988800001, 988800002, 988800003];
let owner: Actor, image: Buffer;

async function account(osuId: number, platformAdmin = false) {
  const user = await db.user.create({
    data: { osuId, username: `${prefix}-${osuId}`, avatarUrl: '', profileUrl: '', platformAdmin },
  });
  userIds.push(user.id);
  return user;
}
function actorFor(user: { id: string; osuId: number; username: string }): Actor {
  return { ...user, avatarUrl: '', tournamentId: 'main', permissions: [], roles: [] };
}
async function tournament(acronym = 'DEL') {
  const { id } = await tournamentAction(owner, {
    type: 'create',
    name: `${prefix} ${randomUUID().slice(0, 6)}`,
    acronym,
    slug: `${prefix}-${randomUUID().slice(0, 6)}`,
    gameMode: 'osu',
    description: '',
    format: 'TEAMS',
    timezone: 'UTC',
  });
  ids.push(id);
  return db.tournament.findUniqueOrThrow({ where: { id } });
}
type Target = { id: string; version: number; acronym: string };
const destroy = (actor: Actor, t: Target, confirmation = t.acronym) =>
  tournamentAction(actor, { type: 'delete', id: t.id, baseVersion: t.version, confirmation });
const stageOf = (tournamentId: string) =>
  db.tournamentStage.create({
    data: { tournamentId, name: 'Finals', slug: `finals-${randomUUID().slice(0, 6)}`, position: 0 },
  });
async function upload(tournamentId: string) {
  const key = `${randomUUID()}.webp`;
  await storage.putObject(key, image);
  return db.mediaAsset.create({
    data: {
      tournamentId,
      key,
      name: 'Banner',
      size: image.length,
      width: 8,
      height: 8,
      mimeType: 'image/webp',
    },
  });
}

beforeAll(async () => {
  if (new URL(process.env.DATABASE_URL!).pathname !== '/tournament_platform_test')
    throw Error('Test DB only.');
  vi.stubEnv('STORAGE_DRIVER', 'filesystem');
  vi.stubEnv('STORAGE_LOCAL_DIR', path.resolve('.data/deletion-test-uploads'));
  const user = await account(osuIds[0], true);
  owner = { ...actorFor(user), platformAdmin: true, permissions: [...ALL_PERMISSIONS] };
  image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#cc6699' } })
    .webp()
    .toBuffer();
  await db.participant.createMany({
    data: osuIds.map((osuId) => ({ osuId, username: `${prefix}-${osuId}`, avatarUrl: '' })),
  });
});
afterAll(async () => {
  for (const id of ids)
    if (await db.tournament.count({ where: { id } })) {
      await db.match.deleteMany({ where: { tournamentId: id } });
      await db.qualifierLobby.deleteMany({ where: { tournamentId: id } });
      await destroy(owner, await db.tournament.findUniqueOrThrow({ where: { id } }));
    }
  await db.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await db.participant.deleteMany({ where: { osuId: { in: osuIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  vi.unstubAllEnvs();
  await db.$disconnect();
});

describe.sequential('deleting a tournament', () => {
  it('is for platform administrators, not for the tournament Owner or anyone else', async () => {
    const t = await tournament();
    const role = await db.role.findFirstOrThrow({
      where: { tournamentId: t.id, templateKey: 'Owner' },
    });
    const organizer = await account(osuIds[1]);
    await db.userRole.create({
      data: { userId: organizer.id, roleId: role.id, tournamentId: t.id },
    });
    const stranger = await account(osuIds[2]);
    for (const user of [organizer, stranger])
      await expect(destroy(actorFor(user), t)).rejects.toMatchObject({ status: 403 });
    expect(await db.tournament.count({ where: { id: t.id } })).toBe(1);
  });

  it('needs the exact acronym and the version that was reviewed', async () => {
    const t = await tournament('MIR26');
    for (const wrong of ['mir26', 'MIR', '', t.name])
      await expect(destroy(owner, t, wrong)).rejects.toThrow('exact tournament acronym');
    await tournamentAction(owner, {
      type: 'lifecycle',
      id: t.id,
      baseVersion: t.version,
      published: true,
      archived: false,
    });
    await expect(destroy(owner, t)).rejects.toMatchObject({ status: 409 });
    expect(await db.tournament.count({ where: { id: t.id } })).toBe(1);
    // A space left behind by a phone keyboard is not a wrong acronym.
    await destroy(owner, { ...t, version: t.version + 1 }, ' MIR26 ');
    expect(await db.tournament.count({ where: { id: t.id } })).toBe(0);
  });

  it('waits for live play and uncertain lobbies, and says what is in the way', async () => {
    const t = await tournament();
    const stage = await stageOf(t.id);
    const pool = await db.mappool.create({ data: { tournamentId: t.id, stageId: stage.id } });
    const revision = await db.mappoolRevision.create({
      data: { tournamentId: t.id, mappoolId: pool.id },
    });
    const match = await db.match.create({
      data: { tournamentId: t.id, code: 'M1', stageId: stage.id, participants: {}, rules: {} },
    });
    const lobby = await db.qualifierLobby.create({
      data: {
        tournamentId: t.id,
        code: 'Q1',
        stageId: stage.id,
        poolRevisionId: revision.id,
        rules: {},
        participants: [],
      },
    });
    for (const status of ['IN_PROGRESS', 'AWAITING_CONFIRMATION', 'DISPUTED'] as const) {
      await db.match.update({ where: { id: match.id }, data: { status } });
      await expect(destroy(owner, t)).rejects.toThrow(String(match.matchNumber ?? match.code));
      await db.match.update({ where: { id: match.id }, data: { status: 'COMPLETED' } });
      await db.qualifierLobby.update({ where: { id: lobby.id }, data: { status } });
      await expect(destroy(owner, t)).rejects.toThrow('Q1');
      await db.qualifierLobby.update({ where: { id: lobby.id }, data: { status: 'COMPLETED' } });
    }
    const request = await db.ircLobbyRequest.create({
      data: { tournamentId: t.id, matchId: match.id, userId: owner.id, name: 'room' },
    });
    for (const status of ['PENDING', 'UNKNOWN']) {
      await db.ircLobbyRequest.update({ where: { id: request.id }, data: { status } });
      await expect(destroy(owner, t)).rejects.toThrow('uncertain lobby creation');
    }
    expect(await db.match.count({ where: { tournamentId: t.id } })).toBe(1);

    // A deleted fixture and a settled room are not live, and neither is a finished match.
    await db.match.update({
      where: { id: match.id },
      data: { status: 'IN_PROGRESS', deletedAt: new Date() },
    });
    await db.ircLobbyRequest.update({ where: { id: request.id }, data: { status: 'CREATED' } });
    await destroy(owner, t);
    expect(await tournamentRows(db, t.id)).toEqual({});
  });

  it('leaves nothing of the tournament, and everything of every other one', async () => {
    const t = await tournament();
    const other = await tournament('KEEP');
    const stage = await stageOf(t.id);
    const later = await stageOf(t.id);
    await db.tournamentStage.update({ where: { id: stage.id }, data: { nextStageId: later.id } });
    const media = await upload(t.id);
    const otherMedia = await upload(other.id);
    await db.tournamentStage.update({
      where: { id: stage.id },
      data: { bannerImageId: media.id },
    });
    const team = await db.team.create({
      data: {
        tournamentId: t.id,
        name: 'Red',
        slug: 'red',
        logoImageId: media.id,
        members: { create: { osuId: osuIds[1], captain: true, position: 0 } },
      },
    });
    await db.team.create({
      data: {
        tournamentId: other.id,
        name: 'Blue',
        slug: 'blue',
        logoImageId: otherMedia.id,
        members: { create: { osuId: osuIds[1], captain: true, position: 0 } },
      },
    });
    // Rows that refuse a delete of what they point at, in the order a cascade could trip over.
    const phase = await db.tournamentPhase.create({
      data: {
        tournamentId: t.id,
        key: 'draft',
        position: 0,
        kind: 'TEAM_FORMATION',
        name: 'Draft',
        stageId: stage.id,
        config: {},
      },
    });
    const session = await db.formationSession.create({
      data: {
        tournamentId: t.id,
        phaseId: phase.id,
        method: 'MANUAL',
        rosterSize: 2,
        teamSeeding: 'MANUAL',
        settings: {},
      },
    });
    const formed = await db.formationTeam.create({
      data: { tournamentId: t.id, sessionId: session.id, position: 0, name: 'Formed' },
    });
    await db.formationLot.create({
      data: {
        tournamentId: t.id,
        sessionId: session.id,
        sourceTeamId: team.id,
        sourcePublished: false,
        formationTeamId: formed.id,
        state: 'SOLD',
        osuId: osuIds[1],
        username: 'Player',
        position: 0,
      },
    });
    await db.formationEvent.create({
      data: { tournamentId: t.id, sessionId: session.id, sequence: 1, kind: 'OPEN', data: {} },
    });
    const item = await db.resourceItem.create({
      data: { tournamentId: t.id, name: 'Perk', price: 10, unlockStageId: stage.id },
    });
    await db.resourcePurchase.create({
      data: { tournamentId: t.id, itemId: item.id, teamId: team.id, price: 10, stageId: stage.id },
    });
    await db.resourceAdjustment.create({
      data: { tournamentId: t.id, teamId: team.id, amount: 5, reason: 'Prize' },
    });
    await db.tournamentTransfer.create({
      data: {
        id: randomUUID(),
        initiatedBy: owner.id,
        sourceFingerprint: 'a'.repeat(64),
        tournamentId: t.id,
        status: 'COMPLETED',
        objectKeys: [],
        report: {},
      },
    });
    const beforeOther = await tournamentRows(db, other.id);
    expect(Object.keys(await tournamentRows(db, t.id)).length).toBeGreaterThan(10);

    expect(await destroy(owner, t)).toEqual({ id: t.id, filesPendingCleanup: 0 });

    expect(await tournamentRows(db, t.id)).toEqual({});
    expect(await tournamentRows(db, other.id)).toEqual(beforeOther);
    expect(await storage.objectExists(media.key)).toBe(false);
    expect(await storage.objectExists(otherMedia.key)).toBe(true);
    expect(await db.mediaCleanup.count({ where: { key: media.key } })).toBe(0);
    // People are shared between tournaments, so they outlast this one.
    expect(await db.participant.count({ where: { osuId: osuIds[1] } })).toBe(1);
    expect(await db.user.count({ where: { id: owner.id } })).toBe(1);
    // The one thing kept says who deleted what, outside the tournament.
    const receipt = await db.auditLog.findFirstOrThrow({
      where: { action: 'tournament.delete', entityId: t.id },
    });
    expect(receipt).toMatchObject({
      tournamentId: null,
      actorId: owner.id,
      details: { name: t.name, acronym: t.acronym, slug: t.slug, teams: 1, matches: 0, files: 1 },
    });
    // The address is free to start again.
    const { id } = await tournamentAction(owner, {
      type: 'create',
      name: t.name,
      acronym: t.acronym,
      slug: t.slug,
      gameMode: 'osu',
      description: '',
      format: 'TEAMS',
      timezone: 'UTC',
    });
    ids.push(id);
    expect(id).not.toBe(t.id);
    await storage.deleteObject(otherMedia.key);
  });

  it('reports a file storage would not remove and keeps it queued, with the data gone', async () => {
    const t = await tournament();
    const media = await upload(t.id);
    vi.mocked(storage.deleteObject).mockRejectedValueOnce(new Error('Storage offline'));

    expect(await destroy(owner, t)).toEqual({ id: t.id, filesPendingCleanup: 1 });

    expect(await tournamentRows(db, t.id)).toEqual({});
    expect(await storage.objectExists(media.key)).toBe(true);
    expect(await db.mediaCleanup.findUnique({ where: { key: media.key } })).toMatchObject({
      state: 'PENDING',
    });
    await db.mediaCleanup.delete({ where: { key: media.key } });
    await storage.deleteObject(media.key);
  });

  it('stops featuring a deleted tournament instead of pointing at nothing', async () => {
    const t = await tournament();
    const before = await db.platformSettings.findUnique({ where: { id: 'main' } });
    await db.platformSettings.upsert({
      where: { id: 'main' },
      create: { id: 'main', defaultTournamentId: t.id, rootMode: 'FEATURED' },
      update: { defaultTournamentId: t.id, rootMode: 'FEATURED' },
    });
    try {
      await destroy(owner, t);
      expect(await db.platformSettings.findUniqueOrThrow({ where: { id: 'main' } })).toMatchObject({
        defaultTournamentId: null,
        rootMode: 'DIRECTORY',
      });
    } finally {
      if (before)
        await db.platformSettings.update({
          where: { id: 'main' },
          data: { defaultTournamentId: before.defaultTournamentId, rootMode: before.rootMode },
        });
      else await db.platformSettings.delete({ where: { id: 'main' } });
    }
  });
});
