import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import path from 'node:path';
import { db } from '../src/lib/db';
import { tournamentAction } from '../src/lib/tournaments-service';
import { exportTournament, collectTournament, localizeArchive } from '../src/lib/tournament-export';
import {
  importTournament,
  inspectArchive,
  assertImportPermission,
  recoverTransfer,
} from '../src/lib/tournament-import';
import {
  readArchive,
  validateArchiveData,
  archiveHash,
  writeArchive,
} from '../src/lib/tournament-archive-format';
import { ALL_PERMISSIONS, type Actor } from '../src/lib/permissions';
import { matchRulesSchema } from '../src/lib/match-rules';
import * as storage from '../src/lib/storage';
import { tournamentRows } from './helpers/tournament-rows';
const prefix = `transfer-${Date.now()}`;
const ids: string[] = [],
  objects: string[] = [];
let owner: Actor, sourceId: string, bytes: Buffer, originalFingerprint: string;
const osuId = 988700001,
  beatmapId = 988700002;
beforeAll(async () => {
  if (new URL(process.env.DATABASE_URL!).pathname !== '/tournament_platform_test')
    throw Error('Test DB only.');
  vi.stubEnv('STORAGE_DRIVER', 'filesystem');
  vi.stubEnv('STORAGE_LOCAL_DIR', path.resolve('.data/transfer-test-uploads'));
  const user = await db.user.create({
    data: { osuId, username: prefix, avatarUrl: '', profileUrl: '', platformAdmin: true },
  });
  owner = {
    id: user.id,
    osuId,
    username: prefix,
    avatarUrl: '',
    platformAdmin: true,
    tournamentId: 'main',
    permissions: [...ALL_PERMISSIONS],
    roles: [],
  };
  sourceId = (
    await tournamentAction(owner, {
      type: 'create',
      name: prefix,
      acronym: 'QA',
      slug: prefix,
      gameMode: 'osu',
      description: 'main',
      format: 'TEAMS',
      timezone: 'UTC',
    })
  ).id;
  ids.push(sourceId);
  owner.tournamentId = sourceId;
  const image = await sharp({
    create: { width: 48, height: 24, channels: 3, background: '#cc6699' },
  })
    .webp()
    .toBuffer();
  const key = `${randomUUID()}.webp`;
  objects.push(key);
  await storage.putObject(key, image);
  const media = await db.mediaAsset.create({
    data: {
      tournamentId: sourceId,
      key,
      name: 'QA banner',
      size: image.length,
      width: 48,
      height: 24,
      mimeType: 'image/webp',
      createdBy: user.id,
    },
  });
  await db.tournamentSettings.update({
    where: { tournamentId: sourceId },
    data: { banner: `/api/media/${media.id}`, logo: `/api/media/${media.id}` },
  });
  const page = await db.page.findFirstOrThrow({ where: { tournamentId: sourceId, slug: 'home' } });
  const revision = await db.pageRevision.create({
    data: {
      tournamentId: sourceId,
      pageId: page.id,
      title: 'Published home',
      createdBy: user.id,
      html: '<p>Published</p>',
      blocks: {
        create: {
          type: 'hero',
          position: 0,
          content: { title: prefix, image: `/api/media/${media.id}`, text: 'main' },
        },
      },
    },
  });
  await db.page.update({
    where: { id: page.id },
    data: { state: 'PUBLISHED', publishedRevisionId: revision.id },
  });
  const stage = await db.tournamentStage.create({
    data: {
      tournamentId: sourceId,
      name: 'Finals',
      slug: 'finals',
      position: 0,
      bannerImageId: media.id,
    },
  });
  const pool = await db.mappool.create({ data: { tournamentId: sourceId, stageId: stage.id } });
  const metadata = {
    id: beatmapId,
    title: 'QA map',
    artist: 'QA',
    mapper: 'QA',
    difficulty: 'Expert',
    stars: 5,
    bpm: 180,
    length: 120,
    ar: 9,
    cs: 4,
    od: 8,
    hp: 6,
    cover: '',
    url: `https://osu.ppy.sh/beatmaps/${beatmapId}`,
    mode: 'osu',
  };
  await db.beatmap.create({ data: { id: beatmapId, mode: 'osu', metadata } });
  const poolRevision = await db.mappoolRevision.create({
    data: {
      tournamentId: sourceId,
      mappoolId: pool.id,
      slots: {
        create: {
          name: 'NM1',
          category: 'NM',
          categoryName: 'No Mod',
          color: '#8bbdff',
          position: 0,
          beatmapId,
          metadata,
        },
      },
    },
  });
  await db.mappool.update({
    where: { id: pool.id },
    data: { state: 'PUBLISHED', publishedRevisionId: poolRevision.id },
  });
  await db.participant.create({ data: { osuId, username: prefix, avatarUrl: '' } });
  const team = await db.team.create({
    data: {
      tournamentId: sourceId,
      slug: 'red',
      name: 'Red',
      logoImageId: media.id,
      status: 'APPROVED',
      published: true,
      members: {
        create: {
          osuId,
          position: 0,
          captain: true,
          discordId: '123456'.repeat(3),
          discordUsername: 'red_player',
        },
      },
    },
  });
  const category = await db.staffCategory.create({
    data: { tournamentId: sourceId, name: 'Referees' },
  });
  await db.staffMember.create({
    data: {
      tournamentId: sourceId,
      osuId,
      username: prefix,
      avatarUrl: '',
      profileUrl: '',
      customImage: `/api/media/${media.id}`,
      assignments: {
        create: { categoryId: category.id, position: 'Referee' },
      },
    },
  });
  const rules = matchRulesSchema.parse({ bestOf: 9 });
  const match = await db.match.create({
    data: {
      tournamentId: sourceId,
      code: '1',
      stageId: stage.id,
      teamAId: team.id,
      poolRevisionId: poolRevision.id,
      participants: {
        A: {
          teamId: team.id,
          name: 'Red',
          members: [{ osuId, username: prefix, avatarUrl: '', captain: true, substitute: false }],
        },
        B: { name: 'Blue', members: [] },
      },
      rules,
      published: true,
      status: 'COMPLETED',
      resultMode: 'SUMMARY',
      scoreA: 5,
      scoreB: 2,
      winnerSide: 'A',
      lobbyUrl: 'https://osu.ppy.sh/community/matches/12345',
      version: 3,
      completedAt: new Date(),
      assignments: { create: { userId: owner.id, primary: true } },
    },
  });
  for (const [index, kind] of ['PROTECT', 'BAN', 'PICK'].entries()) {
    const action = await db.matchMapAction.create({
      data: {
        matchId: match.id,
        sequence: index + 1,
        kind: kind as 'PICK',
        side: index % 2 ? 'B' : 'A',
        slotName: `NM${index + 1}`,
        category: 'NM',
        actorId: owner.id,
        voided: index === 1,
        provenance: { sheet: '1', row: index + 9 },
      },
    });
    await db.matchEvent.create({
      data: {
        matchId: match.id,
        version: index + 1,
        kind,
        actorId: owner.id,
        data: { actionId: action.id, matchId: match.id },
        notes: index === 1 ? 'Corrected ban retained' : '',
      },
    });
    if (kind === 'PICK')
      await db.matchMapResult.create({
        data: {
          matchId: match.id,
          actionId: action.id,
          winnerSide: 'A',
          scoreA: 123456,
          scoreB: 100000,
          playerScores: { create: { osuId, side: 'A', score: 123456, mods: ['HD'] } },
        },
      });
  }
  await db.matchResultRevision.create({
    data: {
      matchId: match.id,
      version: 3,
      kind: 'CORRECTION',
      reason: 'Historical correction',
      createdBy: owner.id,
      snapshot: { matchId: match.id, scoreA: 5, scoreB: 2 },
    },
  });
  const qualifier = await db.qualifierLobby.create({
    data: {
      tournamentId: sourceId,
      code: 'Q1',
      stageId: stage.id,
      poolRevisionId: poolRevision.id,
      rules,
      participants: [
        {
          teamId: team.id,
          name: team.name,
          members: [{ osuId, username: prefix, avatarUrl: '', captain: true, substitute: false }],
        },
      ],
      entries: { create: { teamId: team.id, position: 0 } },
      assignments: { create: { userId: owner.id } },
      scores: { create: { osuId, slotName: 'NM1', raw: 123, adjusted: 123, mods: [] } },
    },
  });
  await db.qualifierEvent.create({
    data: { lobbyId: qualifier.id, version: 1, kind: 'SCORE', data: { lobbyId: qualifier.id } },
  });
  await db.poolPlan.create({
    data: {
      tournamentId: sourceId,
      stageId: stage.id,
      slots: [{ name: 'NM1', category: 'NM' }],
      minStars: 5,
      maxStars: 6,
      reviewState: 'REVIEW',
    },
  });
  const skillset = await db.poolSkillset.create({
    data: { tournamentId: sourceId, name: 'Custom reading', group: 'Technical' },
  });
  await db.poolArtistWarning.create({
    data: {
      tournamentId: sourceId,
      artist: 'QA',
      artistKey: 'qa',
      severity: 'WARN',
      reason: 'Source-specific review',
      source: '',
    },
  });
  const candidate = await db.poolCandidate.create({
    data: {
      tournamentId: sourceId,
      stageId: stage.id,
      beatmapId,
      metadata,
      category: 'NM',
      status: 'SELECTED',
      selectedSlot: 'NM1',
      submitterId: owner.id,
      notes: 'Preserved suggestion',
    },
  });
  await db.poolCandidateTag.create({
    data: {
      tournamentId: sourceId,
      candidateId: candidate.id,
      skillsetId: skillset.id,
      primary: true,
    },
  });
  await db.poolReview.create({
    data: {
      tournamentId: sourceId,
      candidateId: candidate.id,
      reviewerId: owner.id,
      fit: 4,
      difficulty: 3,
      flags: 'Ending',
      notes: 'Preserved feedback',
      completed: true,
    },
  });
  await db.tournamentPhase.create({
    data: {
      tournamentId: sourceId,
      key: 'main',
      position: 0,
      kind: 'DOUBLE_ELIMINATION',
      name: 'Main bracket',
      stageId: stage.id,
      config: {
        entries: [{ source: { kind: 'REGISTRATION', count: 8 }, lane: 'WINNERS', seedFrom: 1 }],
        winners: { size: 8, pairing: 'STANDARD' },
        losers: null,
        grandFinalReset: true,
        rematch: 'ALLOW',
        roundStages: { 'g1-r1': stage.id },
      },
    },
  });
  await db.tournament.update({ where: { id: sourceId }, data: { published: true } });
  originalFingerprint = archiveHash(
    Buffer.from(JSON.stringify((await collectTournament(db, sourceId)).data)),
  );
  bytes = (await exportTournament(owner, 'https://source.example')).bytes;
});
afterAll(async () => {
  for (const id of ids.reverse()) {
    if (!(await db.tournament.count({ where: { id } }))) continue;
    for (const media of await db.mediaAsset.findMany({ where: { tournamentId: id } }))
      objects.push(media.key);
    await db.match.deleteMany({ where: { tournamentId: id } });
    await db.qualifierLobby.deleteMany({ where: { tournamentId: id } });
    await db.team.deleteMany({ where: { tournamentId: id } });
    await db.poolCandidate.deleteMany({ where: { tournamentId: id } });
    await db.poolSkillset.deleteMany({ where: { tournamentId: id } });
    await db.poolArtistWarning.deleteMany({ where: { tournamentId: id } });
    await db.mappool.updateMany({
      where: { tournamentId: id },
      data: { draftRevisionId: null, publishedRevisionId: null },
    });
    await db.tournamentPhase.deleteMany({ where: { tournamentId: id } });
    await db.tournamentStage.deleteMany({ where: { tournamentId: id } });
    await db.staffMember.deleteMany({ where: { tournamentId: id } });
    await db.page.updateMany({
      where: { tournamentId: id },
      data: { draftRevisionId: null, publishedRevisionId: null },
    });
    await db.page.deleteMany({ where: { tournamentId: id } });
    await db.role.deleteMany({ where: { tournamentId: id } });
    await db.auditLog.deleteMany({ where: { tournamentId: id } });
    await db.mediaAsset.deleteMany({ where: { tournamentId: id } });
    await db.tournament.delete({ where: { id } });
  }
  await db.tournamentTransfer.deleteMany({ where: { initiatedBy: owner.id } });
  await db.participant.deleteMany({ where: { osuId } });
  await db.beatmap.deleteMany({ where: { id: beatmapId } });
  await db.user.delete({ where: { id: owner.id } });
  for (const key of new Set(objects)) await storage.deleteObject(key);
  vi.unstubAllEnvs();
});
describe('portable tournament archives', () => {
  it('exports only scoped records, all histories and media, never account authority', async () => {
    const archive = await readArchive(bytes);
    expect(archive.data.actions).toHaveLength(3);
    expect(archive.data.events).toHaveLength(3);
    expect(archive.data.resultRevisions).toHaveLength(1);
    expect(archive.data.qualifierScores).toHaveLength(1);
    expect(archive.manifest.media).toHaveLength(1);
    expect(archive.data.tournament[0].description).toBe('main');
    expect(JSON.stringify(archive.data)).not.toMatch(
      /platformAdmin|expiresAt|sessionToken|OSU_CLIENT_SECRET|S3_SECRET/,
    );
    expect(archive.data.identities[0]).not.toHaveProperty('roles');
    expect(archive.data.blocks[0].content).toMatchObject({ text: 'main' });
  });
  it('previews without modifying records and identifies slug conflicts', async () => {
    const before = await db.tournament.count();
    const result = await inspectArchive(bytes);
    expect(result.preview.slugConflict).toBe(true);
    expect(result.preview.counts.actions).toBe(3);
    expect(await db.tournament.count()).toBe(before);
  });
  it('brings a deleted tournament back from its copy, at the same address', async () => {
    const { archive } = await inspectArchive(bytes);
    const slug = `${prefix}-deleted`;
    const source = async () =>
      archiveHash(Buffer.from(JSON.stringify((await collectTournament(db, sourceId)).data)));
    const before = await source();
    const { tournamentId } = await importTournament(owner, archive, slug);
    ids.push(tournamentId);
    const t = await db.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    const files = await db.mediaAsset.findMany({ where: { tournamentId } });
    expect(files.length).toBeGreaterThan(0);
    expect(Object.keys(await tournamentRows(db, tournamentId)).length).toBeGreaterThan(10);

    await tournamentAction(owner, {
      type: 'delete',
      id: tournamentId,
      baseVersion: t.version,
      confirmation: t.acronym,
    });

    expect(await tournamentRows(db, tournamentId)).toEqual({});
    for (const file of files) expect(await storage.objectExists(file.key)).toBe(false);
    expect(await db.tournamentTransfer.count({ where: { tournamentId } })).toBe(0);
    // The tournament it was imported from is a different one, and did not move.
    expect(await source()).toBe(before);
    const again = await importTournament(owner, await readArchive(bytes), slug);
    ids.push(again.tournamentId);
    expect(again.tournamentId).not.toBe(tournamentId);
    expect((await tournamentRows(db, again.tournamentId)).Team).toBe(
      (await tournamentRows(db, sourceId)).Team,
    );
  });
  it('round-trips complete relational histories into a separate unpublished tournament', async () => {
    const { archive } = await inspectArchive(bytes);
    const report = await importTournament(owner, archive, `${prefix}-imported`);
    ids.push(report.tournamentId);
    const imported = await db.tournament.findUniqueOrThrow({
      where: { id: report.tournamentId },
      include: { settings: true },
    });
    expect(imported.published).toBe(false);
    expect(
      await db.teamMember.findFirstOrThrow({ where: { tournamentId: imported.id } }),
    ).toMatchObject({ discordId: '123456'.repeat(3), discordUsername: 'red_player' });
    // An archive written before rosters held usernames still reads, with nothing guessed.
    const older = archive.data.rosters.map(({ discordUsername, ...row }) => {
      void discordUsername;
      return row;
    });
    expect(validateArchiveData({ ...archive.data, rosters: older }).rosters[0]).toMatchObject({
      discordId: '123456'.repeat(3),
      discordUsername: '',
    });
    const plan = await db.poolPlan.findFirstOrThrow({ where: { tournamentId: imported.id } });
    expect(plan).toMatchObject({
      minStars: 5,
      maxStars: 6,
      reviewState: 'REVIEW',
      slots: [{ name: 'NM1', category: 'NM' }],
    });
    const candidate = await db.poolCandidate.findFirstOrThrow({
      where: { tournamentId: imported.id },
      include: { tags: { include: { skillset: true } }, reviews: true },
    });
    expect(candidate).toMatchObject({
      notes: 'Preserved suggestion',
      status: 'SELECTED',
      selectedSlot: 'NM1',
      submitterId: owner.id,
    });
    expect(candidate.tags[0].skillset.name).toBe('Custom reading');
    expect(candidate.reviews[0]).toMatchObject({
      completed: true,
      fit: 4,
      difficulty: 3,
      notes: 'Preserved feedback',
      reviewerId: owner.id,
    });
    expect(candidate.stageId).toBe(plan.stageId);
    expect(candidate.stageId).not.toBe(archive.data.stages[0].id);
    expect(imported.settings!.banner).not.toBe(archive.data.settings[0].banner);
    const actual = await db.match.findFirstOrThrow({
      where: { tournamentId: imported.id },
      include: {
        actions: {
          orderBy: { sequence: 'asc' },
          include: { result: { include: { playerScores: true } } },
        },
        events: true,
        revisions: true,
      },
    });
    expect(actual.actions.map((action) => action.kind)).toEqual(['PROTECT', 'BAN', 'PICK']);
    expect(actual.actions[1].voided).toBe(true);
    expect(actual.actions[2].result!.playerScores[0].score).toBe(123456);
    expect(actual.revisions).toHaveLength(1);
    expect(actual.events).toHaveLength(3);
    expect(actual).toMatchObject({
      scoreA: 5,
      scoreB: 2,
      status: 'COMPLETED',
      lobbyUrl: 'https://osu.ppy.sh/community/matches/12345',
    });
    expect(actual.revisions[0].snapshot).toMatchObject({ matchId: actual.id });
    expect(await db.matchAssignment.count({ where: { matchId: actual.id } })).toBe(0);
    expect(await db.userRole.count({ where: { tournamentId: imported.id } })).toBe(1);
    expect(report.review.matchAssignments).toHaveLength(1);
    const media = await db.mediaAsset.findFirstOrThrow({ where: { tournamentId: imported.id } });
    expect(archiveHash(await storage.getObject(media.key))).toBe(archive.manifest.media[0].sha256);
    // Export audit is expected; all original tournament records otherwise remain identical.
    const current = (await collectTournament(db, sourceId)).data;
    current.audits = current.audits.filter((row) => row.action !== 'tournament.export');
    expect(archiveHash(Buffer.from(JSON.stringify(current)))).toBe(originalFingerprint);
  });
  it('carries the format plan with its stages remapped', async () => {
    const report = await importTournament(owner, await readArchive(bytes), `${prefix}-format`);
    ids.push(report.tournamentId);
    const phase = await db.tournamentPhase.findFirstOrThrow({
      where: { tournamentId: report.tournamentId },
    });
    const stage = await db.tournamentStage.findFirstOrThrow({
      where: { tournamentId: report.tournamentId, slug: 'finals' },
    });
    expect(phase).toMatchObject({ key: 'main', stageId: stage.id, state: 'PLANNED' });
    expect((phase.config as { roundStages: Record<string, string> }).roundStages).toEqual({
      'g1-r1': stage.id,
    });
    const source = await db.tournamentStage.findFirstOrThrow({
      where: { tournamentId: sourceId, slug: 'finals' },
    });
    expect(stage.id).not.toBe(source.id);
  });

  it('never overwrites existing slugs and repeat imports are separate private tournaments', async () => {
    const archive = await readArchive(bytes);
    await expect(importTournament(owner, archive, prefix)).rejects.toMatchObject({ status: 409 });
    const repeated = await importTournament(owner, archive, `${prefix}-second`);
    ids.push(repeated.tournamentId);
    expect(repeated.published).toBe(false);
    expect(repeated.imported.actions).toBe(3);
  });
  it('rejects broken references, unknown tables and untrusted secret fields', async () => {
    const archive = await readArchive(bytes);
    const bad = structuredClone(archive.data);
    bad.actions[0].matchId = 'unrelated-match';
    expect(() => validateArchiveData(bad)).toThrow(/relationship/);
    expect(() => validateArchiveData({ ...archive.data, sessions: [] })).toThrow();
    bad.actions[0].matchId = archive.data.actions[0].matchId;
    bad.matches[0].source = { ircPassword: 'must-not-import' };
    expect(() => validateArchiveData(bad)).toThrow(/forbidden/);
  });
  it('rejects modified media and unsupported archive versions', async () => {
    const archive = await readArchive(bytes);
    const badFiles = new Map(archive.files);
    badFiles.set(archive.manifest.media[0].path, Buffer.from('damaged'));
    await expect(
      readArchive(
        await writeArchive(
          archive.manifest,
          archive.data,
          new Map([...badFiles].filter(([name]) => name.startsWith('media/'))),
        ),
      ),
    ).rejects.toThrow(/checksum/);
    const bad = { ...archive.manifest, version: 100 } as unknown as typeof archive.manifest;
    const unsupported = await writeArchive(
      bad,
      archive.data,
      new Map(archive.manifest.media.map((file) => [file.path, archive.files.get(file.path)!])),
    );
    await expect(readArchive(unsupported)).rejects.toThrow();
  });
  it('refuses unauthorized exports and imports', async () => {
    const limited = { ...owner, platformAdmin: false, permissions: [] };
    await expect(exportTournament(limited, 'https://source.example')).rejects.toMatchObject({
      status: 403,
    });
    expect(() => assertImportPermission(limited)).toThrow(/platform administrator/);
    expect(() => assertImportPermission(null)).toThrow(/Sign in/);
  });
  it('rolls back database work and removes staged objects after a storage failure', async () => {
    const before = await db.tournament.count();
    const spy = vi.spyOn(storage, 'putObject').mockRejectedValueOnce(new Error('Storage offline'));
    try {
      await expect(
        importTournament(owner, await readArchive(bytes), `${prefix}-failed`),
      ).rejects.toThrow('Storage offline');
    } finally {
      spy.mockRestore();
    }
    expect(await db.tournament.count()).toBe(before);
    const job = await db.tournamentTransfer.findFirstOrThrow({
      where: { initiatedBy: owner.id, status: 'FAILED' },
    });
    expect((job.report as { remainingObjects: number }).remainingObjects).toBe(0);
  });
  it('recovery cannot delete a committed tournament or its media', async () => {
    const job = await db.tournamentTransfer.findFirstOrThrow({
      where: { initiatedBy: owner.id, status: 'COMPLETED' },
    });
    await expect(recoverTransfer(owner, job.id)).rejects.toMatchObject({ status: 409 });
    expect(await db.tournament.count({ where: { id: job.tournamentId! } })).toBe(1);
  });
  it('localizes only identifiers, not authored text matching a database ID', async () => {
    const data = (await collectTournament(db, sourceId)).data;
    data.tournament[0].description = sourceId;
    const localized = localizeArchive(data);
    expect(localized.data.tournament[0].description).toBe(sourceId);
    expect(localized.data.settings[0].tournamentId).toBe(localized.data.tournament[0].id);
  });
  it('journals failed object cleanup and recovers without creating a tournament', async () => {
    const transactions = vi
      .spyOn(db, '$transaction')
      .mockRejectedValueOnce(new Error('Database transaction failed'));
    const deletion = vi
      .spyOn(storage, 'deleteObject')
      .mockRejectedValueOnce(new Error('Storage cleanup offline'));
    const before = await db.tournament.count();
    try {
      await expect(
        importTournament(owner, await readArchive(bytes), `${prefix}-recovery`),
      ).rejects.toThrow('Database transaction failed');
    } finally {
      transactions.mockRestore();
      deletion.mockRestore();
    }
    expect(await db.tournament.count()).toBe(before);
    const job = await db.tournamentTransfer.findFirstOrThrow({
      where: { initiatedBy: owner.id, status: 'CLEANUP_REQUIRED' },
    });
    const key = (job.objectKeys as string[])[0];
    expect((await storage.getObject(key)).length).toBeGreaterThan(0);
    expect(await recoverTransfer(owner, job.id)).toMatchObject({ remainingObjects: 0 });
    await expect(storage.getObject(key)).rejects.toMatchObject({ status: 404 });
  });
  it('does not delete committed media when transaction acknowledgement is lost', async () => {
    const realTransaction = db.$transaction;
    const transaction = vi.spyOn(db, '$transaction').mockImplementationOnce(async (...args) => {
      await Reflect.apply(realTransaction, db, args);
      throw new Error('Commit acknowledgement lost');
    });
    const slug = `${prefix}-acknowledgement`;
    try {
      await expect(importTournament(owner, await readArchive(bytes), slug)).rejects.toMatchObject({
        status: 409,
      });
    } finally {
      transaction.mockRestore();
    }
    const committed = await db.tournament.findUniqueOrThrow({ where: { slug } });
    ids.push(committed.id);
    expect(committed.published).toBe(false);
    const media = await db.mediaAsset.findFirstOrThrow({ where: { tournamentId: committed.id } });
    expect(archiveHash(await storage.getObject(media.key))).toBe(
      (await readArchive(bytes)).manifest.media[0].sha256,
    );
  });
});
