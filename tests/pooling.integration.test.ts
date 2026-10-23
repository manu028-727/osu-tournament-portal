import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import type { Prisma } from '../src/generated/prisma/client';
import { assertTestDatabase } from '../src/lib/instance';
import { DEFAULT_COPY } from '../src/lib/copy';
import { DEFAULT_MATCH_RULES } from '../src/lib/match-rules';
import { poolingActionSchema } from '../src/lib/pooling-validation';
import { applyPoolingAction, assertPlanComplete, savePoolPlan } from '../src/lib/pooling-service';
import type { Actor } from '../src/lib/permissions';
import type { BeatmapMetadata } from '../src/lib/osu';
import { collectTournament } from '../src/lib/tournament-export';
import { validateArchiveData } from '../src/lib/tournament-archive-format';

assertTestDatabase(process.env.DATABASE_URL);
const rollback = new Error('pooling rollback');
async function fixture(tx: Prisma.TransactionClient) {
  const id = `pooling-${randomUUID()}`,
    base = randomInt(1_000_000_000, 1_300_000_000);
  const tournament = await tx.tournament.create({
    data: {
      id,
      slug: id,
      name: 'Test',
      acronym: 'TEST',
      description: '',
      settings: {
        create: {
          navigation: [],
          socialLinks: [],
          importantDates: [],
          footer: '',
          copy: DEFAULT_COPY,
          matchRules: DEFAULT_MATCH_RULES,
        },
      },
    },
  });
  const stage = await tx.tournamentStage.create({
    data: { tournamentId: id, name: 'Stage', slug: 'stage', mappool: { create: {} } },
    include: { mappool: true },
  });
  await tx.modCategory.create({
    data: { tournamentId: id, acronym: 'NM', name: 'No Mod', color: '#ffffff', position: 1 },
  });
  const user = await tx.user.create({
    data: { osuId: base, username: id, avatarUrl: '', profileUrl: '' },
  });
  await tx.permission.upsert({
    where: { key: 'mappools.view_drafts' },
    create: { key: 'mappools.view_drafts', description: 'View drafts' },
    update: {},
  });
  const role = await tx.role.create({
    data: {
      tournamentId: id,
      name: 'Reviewer',
      permissions: { create: { permissionKey: 'mappools.view_drafts' } },
    },
  });
  await tx.userRole.create({ data: { tournamentId: id, roleId: role.id, userId: user.id } });
  const actor: Actor = {
    id: user.id,
    osuId: user.osuId,
    username: user.username,
    avatarUrl: '',
    tournamentId: id,
    roles: [role],
    permissions: ['mappools.edit', 'mappools.view_drafts', 'mappools.publish'],
  };
  const maps: BeatmapMetadata[] = [1, 2].map((number) => ({
    id: base + number,
    mode: 'osu',
    title: `Map ${number}`,
    artist: 'Artist',
    mapper: 'Mapper',
    difficulty: 'Expert',
    stars: 5 + number / 10,
    bpm: 180,
    length: 120,
    ar: 9,
    cs: 4,
    od: 8,
    hp: 6,
    cover: '',
    url: `https://osu.ppy.sh/beatmaps/${base + number}`,
  }));
  for (const metadata of maps)
    await tx.beatmap.create({ data: { id: metadata.id, mode: 'osu', metadata } });
  const apply = (input: unknown, current = actor) =>
    applyPoolingAction(tx, current, poolingActionSchema.parse(input), maps);
  return { tx, actor, tournament, stage, maps, apply };
}
async function isolated(test: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  try {
    await db.$transaction(
      async (tx) => {
        await test(await fixture(tx));
        throw rollback;
      },
      { timeout: 30000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
}
afterAll(() => db.$disconnect());
describe('persistent pooling workflows', () => {
  it('persists empty plans and rejects stale or incomplete publication', () =>
    isolated(async (f) => {
      const plan = await savePoolPlan(f.tx, f.actor, f.stage.id, {
        baseVersion: null,
        minStars: 5,
        maxStars: 6,
        slots: [{ name: 'NM1', category: 'NM' }],
      });
      expect(plan.slots).toEqual([{ name: 'NM1', category: 'NM' }]);
      expect(
        await f.tx.mappoolSlot.count({ where: { revision: { mappoolId: f.stage.mappool!.id } } }),
      ).toBe(0);
      await expect(
        savePoolPlan(f.tx, f.actor, f.stage.id, {
          baseVersion: null,
          minStars: null,
          maxStars: null,
          slots: [],
        }),
      ).rejects.toThrow('changed');
      await expect(assertPlanComplete(f.tx, f.tournament.id, f.stage.id, [])).rejects.toThrow(
        'NM1',
      );
    }));

  it('keeps suggestions, feedback and tags while selecting maps into independent drafts', () =>
    isolated(async (f) => {
      const skillset = await f.tx.poolSkillset.create({
        data: { tournamentId: f.tournament.id, name: 'Custom reading', group: 'Reading' },
      });
      const input = {
        type: 'pooling.suggest',
        beatmapIds: f.maps.map((map) => map.id),
        stageId: f.stage.id,
        category: 'NM',
        notes: 'Original notes',
        primaryTagIds: [skillset.id],
      };
      expect(await f.apply(input)).toMatchObject({ created: 2, skipped: [] });
      expect(await f.apply(input)).toMatchObject({
        created: 0,
        skipped: f.maps.map((map) => map.id),
      });
      let candidates = await f.tx.poolCandidate.findMany({
        where: { tournamentId: f.tournament.id },
        orderBy: { beatmapId: 'asc' },
      });
      const viewActor: Actor = { ...f.actor, permissions: ['mappools.view_drafts'] };
      await expect(
        f.apply(
          {
            type: 'pooling.review.save',
            candidateId: candidates[0].id,
            baseVersion: null,
            fit: 4,
            difficulty: 3,
            flags: '',
            notes: 'Unassigned',
          },
          viewActor,
        ),
      ).rejects.toThrow('assigned');
      await f.apply({
        type: 'pooling.bulk',
        candidates: candidates.map((candidate) => ({
          id: candidate.id,
          baseVersion: candidate.version,
        })),
        patch: { status: 'ACCEPTED', reviewerIds: [f.actor.id] },
      });
      const review = await f.tx.poolReview.findUniqueOrThrow({
        where: {
          candidateId_reviewerId: { candidateId: candidates[0].id, reviewerId: f.actor.id },
        },
      });
      await f.apply(
        {
          type: 'pooling.review.save',
          candidateId: candidates[0].id,
          baseVersion: review.version,
          fit: 4,
          difficulty: 3,
          flags: 'Check ending',
          notes: 'Good fit',
        },
        viewActor,
      );
      await expect(
        f.apply({
          type: 'pooling.bulk',
          candidates: [{ id: candidates[0].id, baseVersion: 1 }],
          patch: { status: 'REJECTED' },
        }),
      ).rejects.toThrow('changed');
      await savePoolPlan(f.tx, f.actor, f.stage.id, {
        baseVersion: null,
        slots: [
          { name: 'NM1', category: 'NM' },
          { name: 'NM2', category: 'NM' },
        ],
        minStars: 5,
        maxStars: 6,
      });
      candidates = await f.tx.poolCandidate.findMany({
        where: { tournamentId: f.tournament.id },
        orderBy: { beatmapId: 'asc' },
      });
      let revisionId: string | null = null;
      for (const [index, candidate] of candidates.entries()) {
        const result = (await f.apply({
          type: 'pooling.select',
          candidateId: candidate.id,
          baseVersion: candidate.version,
          stageId: f.stage.id,
          slotName: `NM${index + 1}`,
          baseRevisionId: revisionId,
        })) as { revisionId: string };
        revisionId = result.revisionId;
      }
      const pool = await f.tx.mappool.findUniqueOrThrow({
        where: { id: f.stage.mappool!.id },
        include: { draftRevision: { include: { slots: true } } },
      });
      expect(pool.publishedRevisionId).toBeNull();
      expect(pool.draftRevision!.slots.map((slot) => slot.name)).toEqual(['NM1', 'NM2']);
      await assertPlanComplete(f.tx, f.tournament.id, f.stage.id, pool.draftRevision!.slots);
      expect(await f.tx.poolReview.findUnique({ where: { id: review.id } })).toMatchObject({
        completed: true,
        notes: 'Good fit',
        flags: 'Check ending',
      });
      expect(await f.tx.poolCandidateTag.count({ where: { tournamentId: f.tournament.id } })).toBe(
        2,
      );
      const data = validateArchiveData((await collectTournament(f.tx, f.tournament.id)).data);
      expect(data.poolCandidates).toHaveLength(2);
      expect(data.poolReviews).toHaveLength(2);
      expect(data.poolPlans).toHaveLength(1);
      expect(data.beatmaps).toHaveLength(2);
      const destination = await f.tx.tournamentStage.create({
        data: {
          tournamentId: f.tournament.id,
          name: 'Later round',
          slug: 'later',
          mappool: { create: {} },
        },
        include: { mappool: true },
      });
      const copy = (await f.apply({
        type: 'pooling.pool.transfer',
        sourcePoolId: pool.id,
        sourceRevisionId: pool.draftRevisionId,
        targetStageId: destination.id,
        targetBaseRevisionId: null,
        slotNames: ['NM1'],
        mode: 'COPY',
      })) as { revisionId: string };
      await expect(
        f.apply({
          type: 'pooling.pool.transfer',
          sourcePoolId: pool.id,
          sourceRevisionId: pool.draftRevisionId,
          targetStageId: destination.id,
          targetBaseRevisionId: copy.revisionId,
          slotNames: ['NM1'],
          mode: 'COPY',
        }),
      ).rejects.toThrow('Confirm replacement');
      await f.tx.mappool.update({
        where: { id: pool.id },
        data: { state: 'PUBLISHED', publishedRevisionId: pool.draftRevisionId },
      });
      await f.apply({
        type: 'pooling.pool.transfer',
        sourcePoolId: pool.id,
        sourceRevisionId: pool.draftRevisionId,
        targetStageId: destination.id,
        targetBaseRevisionId: copy.revisionId,
        slotNames: ['NM2'],
        mode: 'MOVE',
      });
      const moved = await f.tx.mappool.findUniqueOrThrow({
        where: { id: pool.id },
        include: {
          draftRevision: { include: { slots: true } },
          publishedRevision: { include: { slots: true } },
        },
      });
      expect(moved.draftRevision!.slots.map((slot) => slot.name)).toEqual(['NM1']);
      expect(moved.publishedRevision!.slots).toHaveLength(2);
    }));

  it('requires an artist-specific resolution and preserves it for publication checks', () =>
    isolated(async (f) => {
      await f.apply({
        type: 'pooling.suggest',
        beatmapIds: [f.maps[0].id],
        stageId: f.stage.id,
        category: 'NM',
        notes: '',
      });
      let candidate = await f.tx.poolCandidate.findFirstOrThrow({
        where: { tournamentId: f.tournament.id },
      });
      await f.apply({
        type: 'pooling.bulk',
        candidates: [{ id: candidate.id, baseVersion: candidate.version }],
        patch: { status: 'ACCEPTED' },
      });
      candidate = await f.tx.poolCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
      await f.apply({
        type: 'pooling.warning.save',
        artist: 'Artist',
        severity: 'BANNED',
        reason: 'Review licensing',
        source: '',
      });
      const select = {
        type: 'pooling.select',
        candidateId: candidate.id,
        baseVersion: candidate.version,
        stageId: f.stage.id,
        slotName: 'NM1',
        baseRevisionId: null,
      };
      await expect(f.apply(select)).rejects.toThrow('explicit resolution');
      await f.apply({ ...select, warningResolution: 'Licensed for this event' });
      const pool = await f.tx.mappool.findUniqueOrThrow({
        where: { id: f.stage.mappool!.id },
        include: { draftRevision: { include: { slots: true } } },
      });
      await assertPlanComplete(f.tx, f.tournament.id, f.stage.id, pool.draftRevision!.slots);
      const warning = await f.tx.poolArtistWarning.findFirstOrThrow({
        where: { tournamentId: f.tournament.id },
      });
      await f.tx.poolArtistWarning.update({
        where: { id: warning.id },
        data: { reason: 'Changed restriction' },
      });
      await expect(
        assertPlanComplete(f.tx, f.tournament.id, f.stage.id, pool.draftRevision!.slots),
      ).rejects.toThrow('banned');
    }));

  it('rejects cross-tournament stage references and unauthorized bulk edits', () =>
    isolated(async (f) => {
      const otherId = `foreign-${randomUUID()}`;
      const other = await f.tx.tournament.create({
        data: { id: otherId, slug: otherId, name: 'Other', acronym: 'OTH', description: '' },
      });
      const stage = await f.tx.tournamentStage.create({
        data: { tournamentId: other.id, name: 'Other', slug: 'other' },
      });
      await expect(
        f.apply({
          type: 'pooling.suggest',
          beatmapIds: [f.maps[0].id],
          stageId: stage.id,
          category: 'NM',
          notes: '',
        }),
      ).rejects.toThrow('this tournament');
      await f.apply({
        type: 'pooling.suggest',
        beatmapIds: [f.maps[0].id],
        stageId: f.stage.id,
        category: 'NM',
        notes: '',
      });
      const candidate = await f.tx.poolCandidate.findFirstOrThrow({
        where: { tournamentId: f.tournament.id },
      });
      await expect(
        f.apply(
          {
            type: 'pooling.bulk',
            candidates: [{ id: candidate.id, baseVersion: candidate.version }],
            patch: { status: 'ACCEPTED' },
          },
          { ...f.actor, permissions: ['mappools.view_drafts'] },
        ),
      ).rejects.toThrow();
      expect(
        (await f.tx.poolCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).status,
      ).toBe('SUGGESTED');
    }));

  it('rejects selections and transfers that exceed the editable slot limit', () =>
    isolated(async (f) => {
      const createSlots = (count: number, offset = 0) =>
        Array.from({ length: count }, (_, position) => ({
          name: `NM${position + offset + 1}`,
          category: 'NM',
          categoryName: 'No Mod',
          color: '#ffffff',
          beatmapId: f.maps[0].id,
          metadata: f.maps[0],
          position,
        }));
      const revision = await f.tx.mappoolRevision.create({
        data: {
          tournamentId: f.tournament.id,
          mappoolId: f.stage.mappool!.id,
          slots: { create: createSlots(100) },
        },
      });
      await f.tx.mappool.update({
        where: { id: f.stage.mappool!.id },
        data: { draftRevisionId: revision.id },
      });
      await f.apply({
        type: 'pooling.suggest',
        beatmapIds: [f.maps[1].id],
        stageId: f.stage.id,
        category: 'NM',
        notes: '',
      });
      let candidate = await f.tx.poolCandidate.findFirstOrThrow({
        where: { tournamentId: f.tournament.id },
      });
      await f.apply({
        type: 'pooling.bulk',
        candidates: [{ id: candidate.id, baseVersion: candidate.version }],
        patch: { status: 'ACCEPTED' },
      });
      candidate = await f.tx.poolCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
      await expect(
        f.apply({
          type: 'pooling.select',
          candidateId: candidate.id,
          baseVersion: candidate.version,
          stageId: f.stage.id,
          slotName: 'NM101',
          baseRevisionId: revision.id,
        }),
      ).rejects.toThrow('100 slots');
      const source = await f.tx.tournamentStage.create({
        data: {
          tournamentId: f.tournament.id,
          name: 'Source',
          slug: 'source',
          mappool: { create: {} },
        },
        include: { mappool: true },
      });
      const sourceRevision = await f.tx.mappoolRevision.create({
        data: {
          tournamentId: f.tournament.id,
          mappoolId: source.mappool!.id,
          slots: { create: createSlots(1, 100) },
        },
      });
      await f.tx.mappool.update({
        where: { id: source.mappool!.id },
        data: { draftRevisionId: sourceRevision.id },
      });
      await expect(
        f.apply({
          type: 'pooling.pool.transfer',
          sourcePoolId: source.mappool!.id,
          sourceRevisionId: sourceRevision.id,
          targetStageId: f.stage.id,
          targetBaseRevisionId: revision.id,
          slotNames: ['NM101'],
          mode: 'COPY',
        }),
      ).rejects.toThrow('100 slots');
      expect(
        (await f.tx.mappool.findUniqueOrThrow({ where: { id: f.stage.mappool!.id } }))
          .draftRevisionId,
      ).toBe(revision.id);
    }));
});
