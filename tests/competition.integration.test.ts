import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { Prisma } from '../src/generated/prisma/client';
import { groupStandings } from '../src/lib/competition-engine';
import {
  rebindImportedCompetition,
  rebindLocalizedCompetition,
  validateCompetitionArchive,
  type CompetitionArchiveWitness,
} from '../src/lib/competition-restoration';
import {
  advanceConfirmedCompetitionResult,
  applyCompetitionAction,
  assertCompetitionEligibility,
  assertCompetitionMatchStart,
  assertCompetitionResultCorrection,
  competitionEligibility,
  finalizedGroupSeeds,
  previewCompetitionCorrection,
  synchronizeCompetitionResults,
} from '../src/lib/competition-service';
import { competitionActionSchema, type CompetitionCreate } from '../src/lib/competition-validation';
import { DEFAULT_COPY } from '../src/lib/copy';
import { db } from '../src/lib/db';
import { assertTestDatabase } from '../src/lib/instance';
import { DEFAULT_MATCH_RULES } from '../src/lib/match-rules';
import { ALL_PERMISSIONS, type Actor } from '../src/lib/permissions';
import { exportTournament } from '../src/lib/tournament-export';
import { importTournament, inspectArchive } from '../src/lib/tournament-import';
import { applyMatchAction } from '../src/lib/matches-service';
import { matchActionSchema } from '../src/lib/matches-validation';
import { signMatchResultReview } from '../src/lib/match-result-review';
import type { MultiplayerImportGame } from '../src/lib/match-results-contract';
import type {
  CompetitionLifecyclePreview,
  CompetitionGenerationPreview,
} from '../src/lib/competition-types';

assertTestDatabase(process.env.DATABASE_URL);
const rollback = new Error('competition test rollback');
type Fixture = {
  tx: Prisma.TransactionClient;
  actor: Actor;
  tournamentId: string;
  stageId: string;
  teamIds: string[];
};
async function fixture(tx: Prisma.TransactionClient, count = 12): Promise<Fixture> {
  const id = `competition-${randomUUID()}`,
    osuBase = randomInt(1_600_000_000, 1_900_000_000);
  const tournament = await tx.tournament.create({
    data: {
      id,
      slug: id,
      name: id,
      acronym: 'COMP',
      description: 'Isolated rollback fixture',
      published: true,
      settings: {
        create: {
          gameplayScoring: 'SCORE_V2',
          socialLinks: [],
          importantDates: [],
          navigation: [],
          footer: '',
          copy: DEFAULT_COPY,
          matchRules: {
            teamSize: 1,
            bestOf: 3,
            bansPerTeam: 0,
            enableTiebreaker: false,
            freeModRequiredHD: 0,
            freeModRequiredHR: 0,
          },
        },
      },
    },
  });
  const user = await tx.user.create({
    data: { osuId: osuBase, username: id, avatarUrl: '', profileUrl: '' },
  });
  const actor: Actor = {
    id: user.id,
    osuId: user.osuId,
    username: user.username,
    avatarUrl: '',
    permissions: ['matches.manage', 'matches.view_all'],
    roles: [],
    tournamentId: tournament.id,
  };
  const stage = await tx.tournamentStage.create({
    data: { tournamentId: id, name: 'Elimination', slug: 'elimination', kind: 'ELIMINATION' },
  });
  const teamIds = [];
  for (let index = 0; index < count; index++) {
    const participant = await tx.participant.create({
      data: { osuId: osuBase + index + 1, username: `Seed ${index + 1}`, avatarUrl: '' },
    });
    const team = await tx.team.create({
      data: {
        tournamentId: id,
        name: `Seed ${index + 1}`,
        slug: `seed-${index + 1}`,
        seed: index + 1,
        status: 'APPROVED',
        format: 'INDIVIDUAL',
        members: { create: { osuId: participant.osuId, captain: true, position: 0 } },
      },
    });
    teamIds.push(team.id);
  }
  return { tx, actor, tournamentId: id, stageId: stage.id, teamIds };
}
async function isolated(test: (f: Fixture) => Promise<void>, count = 12) {
  try {
    await db.$transaction(
      async (tx) => {
        await test(await fixture(tx, count));
        throw rollback;
      },
      { timeout: 60000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
}
function create(f: Fixture, count = 8, format = 'SINGLE_ELIMINATION'): CompetitionCreate {
  return competitionActionSchema.options[0].parse({
    type: 'competition.create',
    name: 'Native bracket',
    generationKey: randomUUID(),
    stageId: f.stageId,
    teamIds: f.teamIds.slice(0, count),
    format,
  });
}
async function apply(f: Fixture, input: unknown): Promise<{ id: string; version: number }> {
  return (await applyCompetitionAction(f.tx, f.actor, competitionActionSchema.parse(input))) as {
    id: string;
    version: number;
  };
}
async function bracket(f: Fixture, id: string) {
  return f.tx.bracket.findFirstOrThrow({
    where: { id, tournamentId: f.tournamentId },
    include: {
      rounds: true,
      nodes: { include: { slots: true, match: true }, orderBy: { key: 'asc' } },
      entries: true,
    },
  });
}
async function confirm(f: Fixture, matchId: string, winnerSide: 'A' | 'B' = 'A') {
  await f.tx.match.update({
    where: { id: matchId, tournamentId: f.tournamentId },
    data: {
      status: 'COMPLETED',
      winnerSide,
      scoreA: winnerSide === 'A' ? 2 : 0,
      scoreB: winnerSide === 'B' ? 2 : 0,
      completedAt: new Date(),
      version: { increment: 1 },
    },
  });
  await advanceConfirmedCompetitionResult(f.tx, f.tournamentId, matchId, f.actor.id);
}
async function finish(f: Fixture, id: string, lowerWinsFinal = false) {
  let count = 0;
  while (true) {
    const b = await bracket(f, id),
      ready = b.nodes.find((n) => n.state === 'READY' && n.match?.status === 'SCHEDULED');
    if (!ready) return count;
    if (++count > 100) throw new Error('Nonterminating bracket');
    await assertCompetitionMatchStart(f.tx, f.tournamentId, ready.matchId!);
    const round = b.rounds.find((r) => r.id === ready.roundId)!;
    await confirm(f, ready.matchId!, lowerWinsFinal && round.key === 'g3-r1' ? 'B' : 'A');
  }
}
afterAll(() => db.$disconnect());
describe('native competition PostgreSQL persistence', () => {
  it('previews and persists DE16 progression stages and real number ranges, then retains numbers across edits and retries', () =>
    isolated(async (f) => {
      await f.tx.tournamentStage.update({
        where: { id: f.stageId },
        data: { name: 'RO16', position: 0 },
      });
      const stageIds = [f.stageId];
      for (const [i, name] of ['QF', 'SF', 'F', 'GF'].entries()) {
        const stage = await f.tx.tournamentStage.create({
          data: {
            tournamentId: f.tournamentId,
            name,
            slug: name.toLowerCase(),
            kind: 'ELIMINATION',
            position: i + 1,
          },
        });
        stageIds.push(stage.id);
      }
      const input = create(f, 16, 'DOUBLE_ELIMINATION');
      const preview = (await applyCompetitionAction(
        f.tx,
        f.actor,
        competitionActionSchema.parse({ ...input, type: 'competition.preview' }),
      )) as CompetitionGenerationPreview;
      expect(await f.tx.bracket.count({ where: { tournamentId: f.tournamentId } })).toBe(0);
      expect(
        preview.assignments.map((row) => [
          row.roundKey,
          row.stageName,
          row.firstMatchNumber,
          row.lastMatchNumber,
        ]),
      ).toEqual([
        ['g1-r1', 'RO16', 1, 8],
        ['g2-r1', 'RO16', 9, 12],
        ['g1-r2', 'QF', 13, 16],
        ['g2-r2', 'QF', 17, 20],
        ['g2-r3', 'QF', 21, 22],
        ['g1-r3', 'SF', 23, 24],
        ['g2-r4', 'SF', 25, 26],
        ['g2-r5', 'SF', 27, 27],
        ['g1-r4', 'F', 28, 28],
        ['g2-r6', 'F', 29, 29],
        ['g3-r1', 'GF', 30, 30],
        ['g3-r2', 'GF', 31, 31],
      ]);
      const created = await apply(f, { ...input, reviewHash: preview.reviewHash });
      expect((await apply(f, { ...input, reviewHash: preview.reviewHash })).id).toBe(created.id);
      const initial = await bracket(f, created.id);
      for (const row of preview.assignments) {
        const round = initial.rounds.find((round) => round.key === row.roundKey)!;
        expect(round.stageId).toBe(row.stageId);
        expect(
          initial.nodes
            .filter((node) => node.roundId === round.id)
            .map((node) => node.matchNumber)
            .sort((a, b) => a! - b!),
        ).toEqual(Array.from({ length: row.matchCount }, (_, i) => row.firstMatchNumber! + i));
      }
      expect((initial.config as { reviewHash?: string }).reviewHash).toBeUndefined();
      expect(
        initial.nodes
          .flatMap((node) => (node.match ? [node.match.matchNumber] : []))
          .sort((a, b) => a - b),
      ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      const numbers = initial.nodes.map((node) => [node.id, node.matchNumber, node.matchId]);
      await f.tx.tournamentStage.update({ where: { id: stageIds[1] }, data: { position: 20 } });
      await apply(f, { type: 'competition.sync', id: created.id, baseVersion: initial.version });
      expect(
        (await bracket(f, created.id)).nodes.map((node) => [
          node.id,
          node.matchNumber,
          node.matchId,
        ]),
      ).toEqual(numbers);
      expect(
        (await f.tx.tournament.findUniqueOrThrow({ where: { id: f.tournamentId } }))
          .matchNumberSequence,
      ).toBe(31);
    }, 16));

  it('rejects stale stage/counter previews before writing, validates suggested stages and preserves manual-link numbering', () =>
    isolated(async (f) => {
      const next = await f.tx.tournamentStage.create({
        data: {
          tournamentId: f.tournamentId,
          name: 'Next',
          slug: 'next',
          kind: 'ELIMINATION',
          position: 1,
        },
      });
      const input = create(f, 8, 'DOUBLE_ELIMINATION');
      const preview = async (value = input) =>
        (await applyCompetitionAction(
          f.tx,
          f.actor,
          competitionActionSchema.parse({ ...value, type: 'competition.preview' }),
        )) as CompetitionGenerationPreview;
      const first = await preview();
      await expect(preview({ ...input, roundStages: { 'g2-r3': f.stageId } })).rejects.toThrow(
        'before its feeder round',
      );
      await apply(f, create(f, 2));
      await expect(apply(f, { ...input, reviewHash: first.reviewHash })).rejects.toThrow(
        'Preview the bracket again',
      );
      const second = await preview();
      expect(second.assignments[0].firstMatchNumber).toBe(2);
      await f.tx.tournamentStage.update({ where: { id: next.id }, data: { name: 'Changed' } });
      await expect(apply(f, { ...input, reviewHash: second.reviewHash })).rejects.toThrow(
        'Preview the bracket again',
      );
      const third = await preview();
      const created = await apply(f, { ...input, reviewHash: third.reviewHash });
      expect(
        (await bracket(f, created.id)).nodes
          .map((node) => node.matchNumber)
          .sort((a, b) => a! - b!),
      ).toEqual(Array.from({ length: 15 }, (_, i) => i + 2));
      await expect(preview({ ...input, roundStages: { bogus: f.stageId } })).rejects.toThrow(
        'rounds in this bracket',
      );
      await f.tx.tournamentStage.update({
        where: { id: next.id },
        data: { matchRules: { ...DEFAULT_MATCH_RULES, teamSize: 2 } },
      });
      await expect(preview()).rejects.toThrow('sufficient starting players');
      await expect(apply(f, { ...input, generationKey: randomUUID() })).rejects.toThrow(
        'sufficient starting players',
      );
      await f.tx.tournamentStage.update({
        where: { id: next.id },
        data: { matchRules: Prisma.JsonNull },
      });
      const manual = { ...input, generationKey: randomUUID(), manualMatches: true };
      const manualPreview = await preview(manual);
      expect(
        manualPreview.assignments.every(
          (row) => row.firstMatchNumber === null && row.matchCount === 0,
        ),
      ).toBe(true);
      const linked = await apply(f, { ...manual, reviewHash: manualPreview.reviewHash });
      expect(
        (await bracket(f, linked.id)).nodes.every(
          (node) => node.matchNumber === null && node.matchId === null,
        ),
      ).toBe(true);
    }));
  async function preview(
    f: Fixture,
    id: string,
    operation: 'delete' | 'regenerate' | 'missing',
    nodeId?: string,
  ) {
    const current = await bracket(f, id);
    const review = (await applyCompetitionAction(
      f.tx,
      f.actor,
      competitionActionSchema.parse({
        type: 'competition.lifecycle.preview',
        id,
        baseVersion: current.version,
        operation,
        nodeId,
      }),
    )) as CompetitionLifecyclePreview;
    return { current, review };
  }
  it('explicitly regenerates a deleted fixture with the same number, links, snapshots and history', () =>
    isolated(async (f) => {
      f.actor.permissions.push('matches.delete');
      const created = await apply(f, create(f, 4));
      const initial = await bracket(f, created.id);
      const first = initial.nodes.find((node) => node.match)!;
      const original = first.match!;
      await applyMatchAction(
        f.tx,
        f.actor,
        matchActionSchema.parse({
          type: 'match.delete',
          id: original.id,
          baseVersion: original.version,
          confirmCode: String(original.matchNumber),
          reason: 'Remove unused fixture',
        }),
      );
      await synchronizeCompetitionResults(f.tx, f.tournamentId, f.actor.id);
      const missing = await preview(f, created.id, 'missing');
      await apply(f, {
        type: 'competition.regenerate-missing',
        id: created.id,
        baseVersion: missing.current.version,
        reviewHash: missing.review.hash,
      });
      expect(
        (await f.tx.match.findUniqueOrThrow({ where: { id: original.id } })).deletedAt,
      ).not.toBeNull();
      const restore = await preview(f, created.id, 'regenerate', first.id);
      expect(restore.review.blocked).toBe(false);
      await apply(f, {
        type: 'competition.regenerate',
        id: created.id,
        baseVersion: restore.current.version,
        nodeId: first.id,
        reviewHash: restore.review.hash,
      });
      const regenerated = await bracket(f, created.id);
      expect(regenerated.nodes.find((node) => node.id === first.id)).toMatchObject({
        matchId: original.id,
        matchNumber: original.matchNumber,
        state: 'READY',
        roundId: first.roundId,
        match: {
          deletedAt: null,
          status: 'SCHEDULED',
          rules: original.rules,
          participants: original.participants,
          stageId: original.stageId,
        },
      });
      expect(
        regenerated.nodes.flatMap((node) => node.slots.map((slot) => slot.sourceNodeId)),
      ).toEqual(initial.nodes.flatMap((node) => node.slots.map((slot) => slot.sourceNodeId)));
      expect(await f.tx.match.count({ where: { tournamentId: f.tournamentId } })).toBe(2);
      expect(
        await f.tx.matchEvent.count({ where: { matchId: original.id, kind: 'match.delete' } }),
      ).toBe(1);
      expect(
        await f.tx.matchEvent.count({
          where: { matchId: original.id, kind: 'competition.regenerate' },
        }),
      ).toBe(1);
      const repeat = await preview(f, created.id, 'regenerate', first.id);
      await apply(f, {
        type: 'competition.regenerate',
        id: created.id,
        baseVersion: repeat.current.version,
        nodeId: first.id,
        reviewHash: repeat.review.hash,
      });
      expect(await f.tx.match.count({ where: { tournamentId: f.tournamentId } })).toBe(2);
    }));
  it('repairs absent ready fixtures using their reserved numbers without duplicating unaffected matches', () =>
    isolated(async (f) => {
      const created = await apply(f, create(f, 4));
      const current = await bracket(f, created.id);
      const missing = current.nodes.find((node) => node.match)!;
      const unaffected = current.nodes.find((node) => node.match && node.id !== missing.id)!;
      await f.tx.bracketNode.update({ where: { id: missing.id }, data: { matchId: null } });
      await f.tx.match.delete({ where: { id: missing.matchId! } });
      const repair = await preview(f, created.id, 'missing');
      await apply(f, {
        type: 'competition.regenerate-missing',
        id: created.id,
        baseVersion: repair.current.version,
        reviewHash: repair.review.hash,
      });
      const result = await bracket(f, created.id);
      expect(result.nodes.find((node) => node.id === missing.id)?.match).toMatchObject({
        matchNumber: missing.matchNumber,
        teamAId: missing.match!.teamAId,
        teamBId: missing.match!.teamBId,
        stageId: missing.match!.stageId,
      });
      expect(result.nodes.find((node) => node.id === unaffected.id)?.match).toMatchObject({
        id: unaffected.matchId,
        matchNumber: unaffected.matchNumber,
      });
      expect(await f.tx.match.count({ where: { tournamentId: f.tournamentId } })).toBe(2);
    }));
  it('restores a completed fixture with reviewed downstream changes while protecting played downstream history', () =>
    isolated(async (f) => {
      f.actor.permissions.push('matches.delete');
      const created = await apply(f, create(f, 4));
      const ready = (await bracket(f, created.id)).nodes.filter((node) => node.match);
      for (const node of ready) await confirm(f, node.matchId!);
      const original = await f.tx.match.findUniqueOrThrow({ where: { id: ready[0].matchId! } });
      const impact = await previewCompetitionCorrection(f.tx, f.tournamentId, original.id, null);
      await applyMatchAction(
        f.tx,
        f.actor,
        matchActionSchema.parse({
          type: 'match.delete',
          id: original.id,
          baseVersion: original.version,
          confirmCode: String(original.matchNumber),
          reason: 'Reviewed removal',
          approveProgression: true,
          correctionHash: impact.hash,
        }),
      );
      let restoration = await preview(f, created.id, 'regenerate', ready[0].id);
      expect(restoration.review.affected).toHaveLength(1);
      await expect(
        apply(f, {
          type: 'competition.regenerate',
          id: created.id,
          baseVersion: restoration.current.version,
          nodeId: ready[0].id,
          reviewHash: restoration.review.hash,
        }),
      ).rejects.toThrow(/approve/i);
      const final = restoration.current.nodes.find((node) => node.matchNumber === 3)!;
      await f.tx.match.update({
        where: { id: final.matchId! },
        data: { status: 'IN_PROGRESS', startedAt: new Date(), version: { increment: 1 } },
      });
      restoration = await preview(f, created.id, 'regenerate', ready[0].id);
      expect(restoration.review.blocked).toBe(true);
      await expect(
        apply(f, {
          type: 'competition.regenerate',
          id: created.id,
          baseVersion: restoration.current.version,
          nodeId: ready[0].id,
          reviewHash: restoration.review.hash,
          approveCorrections: true,
        }),
      ).rejects.toThrow(/started/i);
      await f.tx.match.update({
        where: { id: final.matchId! },
        data: { status: 'SCHEDULED', startedAt: null, version: { increment: 1 } },
      });
      restoration = await preview(f, created.id, 'regenerate', ready[0].id);
      await apply(f, {
        type: 'competition.regenerate',
        id: created.id,
        baseVersion: restoration.current.version,
        nodeId: ready[0].id,
        reviewHash: restoration.review.hash,
        approveCorrections: true,
      });
      expect(await f.tx.match.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({
        status: 'COMPLETED',
        deletedAt: null,
        winnerSide: 'A',
        matchNumber: original.matchNumber,
      });
      expect(
        (await bracket(f, created.id)).nodes
          .find((node) => node.id === final.id)
          ?.slots.every((slot) => !!slot.teamId),
      ).toBe(true);
    }));
  it('permanently purges a whole bracket and its histories, then restarts match numbering at one', () =>
    isolated(async (f) => {
      f.actor.permissions.push('matches.delete');
      const config = create(f, 4);
      const created = await apply(f, config);
      await finish(f, created.id);
      const old = await bracket(f, created.id);
      const match = old.nodes.find((node) => node.match)!.match!;
      const action = await f.tx.matchMapAction.create({
        data: {
          matchId: match.id,
          sequence: 1,
          kind: 'PICK',
          side: 'A',
          slotName: 'NM1',
          category: 'NM',
          actorId: f.actor.id,
        },
      });
      const result = await f.tx.matchMapResult.create({
        data: {
          matchId: match.id,
          actionId: action.id,
          entryMode: 'SCORES',
          winnerSide: 'A',
          scoreA: 10,
          scoreB: 5,
        },
      });
      await f.tx.matchPlayerScore.create({
        data: { resultId: result.id, osuId: f.actor.osuId + 1, side: 'A', score: 10, mods: [] },
      });
      await f.tx.multiplayerGame.create({
        data: {
          matchId: match.id,
          multiplayerId: 1,
          gameId: 'purged-game',
          beatmapId: 1,
          slotName: 'NM1',
          actionId: action.id,
        },
      });
      await f.tx.auditLog.create({
        data: {
          tournamentId: f.tournamentId,
          actorId: f.actor.id,
          action: 'match.history',
          entityType: 'Match',
          entityId: match.id,
          details: { scoreA: 10 },
        },
      });
      const bulk = await f.tx.auditLog.create({
        data: {
          tournamentId: f.tournamentId,
          actorId: f.actor.id,
          action: 'matches.bulk.schedule',
          entityType: 'matches',
          entityId: 'bulk',
          details: {
            matches: [
              { id: match.id, notes: 'Purged note' },
              { id: 'other-audit-record', notes: 'Keep unrelated receipt' },
            ],
          },
        },
      });
      const deletion = await preview(f, created.id, 'delete');
      const request = {
        type: 'competition.delete',
        id: created.id,
        baseVersion: deletion.current.version,
        reviewHash: deletion.review.hash,
        confirmation: deletion.current.name,
      };
      await expect(apply(f, request)).rejects.toThrow(/permanent/i);
      expect(deletion.review.numberingRestarts).toBe(true);
      await apply(f, { ...request, acknowledgeHistory: true });
      const where = { tournamentId: f.tournamentId };
      expect(await f.tx.bracket.count({ where })).toBe(0);
      expect(await f.tx.bracketNode.count({ where })).toBe(0);
      expect(await f.tx.bracketSlot.count({ where })).toBe(0);
      expect(await f.tx.bracketRound.count({ where })).toBe(0);
      expect(await f.tx.bracketEntry.count({ where })).toBe(0);
      const ids = old.nodes.flatMap((node) => (node.matchId ? [node.matchId] : []));
      expect(await f.tx.matchEvent.count({ where: { matchId: { in: ids } } })).toBe(0);
      expect(await f.tx.matchResultRevision.count({ where: { matchId: { in: ids } } })).toBe(0);
      expect(await f.tx.matchMapAction.count({ where: { matchId: { in: ids } } })).toBe(0);
      expect(await f.tx.matchMapResult.count({ where: { matchId: { in: ids } } })).toBe(0);
      expect(await f.tx.multiplayerGame.count({ where: { matchId: { in: ids } } })).toBe(0);
      expect(await f.tx.matchPlayerScore.count({ where: { resultId: result.id } })).toBe(0);
      expect(await f.tx.auditLog.count({ where: { ...where, entityId: { in: ids } } })).toBe(0);
      expect((await f.tx.auditLog.findUniqueOrThrow({ where: { id: bulk.id } })).details).toEqual({
        matches: [{ id: 'other-audit-record', notes: 'Keep unrelated receipt' }],
      });
      await synchronizeCompetitionResults(f.tx, f.tournamentId, f.actor.id);
      expect(await f.tx.match.count({ where })).toBe(0);
      expect(
        (await f.tx.tournament.findUniqueOrThrow({ where: { id: f.tournamentId } }))
          .matchNumberSequence,
      ).toBe(0);
      const rebuilt = await apply(f, { ...config, generationKey: randomUUID() });
      const fresh = await bracket(f, rebuilt.id);
      expect(
        fresh.nodes
          .filter((node) => node.match)
          .every((node) => !ids.includes(node.match!.id) && !node.match!.deletedAt),
      ).toBe(true);
      expect(fresh.nodes.map((node) => node.matchNumber).sort()).toEqual([1, 2, 3]);
      expect(
        await apply(f, {
          ...config,
          generationKey: (fresh.config as { generationKey: string }).generationKey,
        }),
      ).toMatchObject({ id: rebuilt.id });
    }));
  it('preserves unrelated matches and number reservations when deleting another bracket', () =>
    isolated(async (f) => {
      f.actor.permissions.push('matches.delete');
      const created = await apply(f, create(f, 4));
      const unrelated = await apply(f, create(f, 2));
      const unchanged = await bracket(f, unrelated.id);
      const deletion = await preview(f, created.id, 'delete');
      expect(deletion.review.numberingRestarts).toBe(false);
      await apply(f, {
        type: 'competition.delete',
        id: created.id,
        baseVersion: deletion.current.version,
        reviewHash: deletion.review.hash,
        confirmation: deletion.current.name,
      });
      expect((await bracket(f, unrelated.id)).nodes).toEqual(unchanged.nodes);
      const rebuilt = await apply(f, create(f, 4));
      expect((await bracket(f, rebuilt.id)).nodes.every((node) => node.matchNumber! > 4)).toBe(
        true,
      );
    }));
  it('rejects unauthorized, stale, foreign and dependent whole-bracket removals', () =>
    isolated(async (f) => {
      const created = await apply(f, create(f, 2));
      await expect(preview(f, created.id, 'delete')).rejects.toThrow(/permission/i);
      await expect(
        applyCompetitionAction(
          f.tx,
          { ...f.actor, permissions: ['matches.delete'] },
          competitionActionSchema.parse({
            type: 'competition.lifecycle.preview',
            id: created.id,
            baseVersion: (await bracket(f, created.id)).version,
            operation: 'delete',
          }),
        ),
      ).rejects.toThrow(/permission/i);
      f.actor.permissions.push('matches.delete');
      const deletion = await preview(f, created.id, 'delete');
      const m = deletion.current.nodes.find((node) => node.match)!.match!;
      await f.tx.match.update({
        where: { id: m.id },
        data: { version: { increment: 1 }, notes: 'Changed after review' },
      });
      await expect(
        apply(f, {
          type: 'competition.delete',
          id: created.id,
          baseVersion: deletion.current.version,
          reviewHash: deletion.review.hash,
          confirmation: deletion.current.name,
        }),
      ).rejects.toThrow(/changed/i);
      const other = await apply(f, create(f, 2));
      const target = (await bracket(f, other.id)).nodes[0];
      await apply(f, {
        type: 'competition.route',
        id: other.id,
        baseVersion: (await bracket(f, other.id)).version,
        nodeId: target.id,
        side: 'A',
        sourceNodeId: deletion.current.nodes[0].id,
        outcome: 'WINNER',
      });
      expect((await preview(f, created.id, 'delete')).review.blocked).toBe(true);
      await expect(
        applyCompetitionAction(
          f.tx,
          { ...f.actor, tournamentId: 'foreign-tournament' },
          competitionActionSchema.parse({
            type: 'competition.lifecycle.preview',
            id: created.id,
            baseVersion: 1,
            operation: 'delete',
          }),
        ),
      ).rejects.toThrow(/not found/i);
    }));
  it('blocks deletion with active gameplay or uncertain lobby creation and frees the purged schedule', () =>
    isolated(async (f) => {
      f.actor.permissions.push('matches.delete');
      const config = create(f, 2);
      const created = await apply(f, config);
      const node = (await bracket(f, created.id)).nodes[0],
        match = node.match!;
      const scheduledAt = new Date('2030-01-01T12:00:00Z');
      await f.tx.match.update({
        where: { id: match.id },
        data: { scheduledAt, status: 'IN_PROGRESS', startedAt: new Date() },
      });
      expect((await preview(f, created.id, 'delete')).review.blocked).toBe(true);
      await f.tx.match.update({
        where: { id: match.id },
        data: { status: 'SCHEDULED', startedAt: null },
      });
      const lobby = await f.tx.ircLobbyRequest.create({
        data: {
          tournamentId: f.tournamentId,
          matchId: match.id,
          userId: f.actor.id,
          status: 'UNKNOWN',
          name: 'Uncertain test room',
        },
      });
      expect((await preview(f, created.id, 'delete')).review.blocked).toBe(true);
      await f.tx.ircLobbyRequest.delete({ where: { id: lobby.id } });
      const deletion = await preview(f, created.id, 'delete');
      await apply(f, {
        type: 'competition.delete',
        id: created.id,
        baseVersion: deletion.current.version,
        reviewHash: deletion.review.hash,
        confirmation: deletion.current.name,
      });
      const fresh = await apply(f, { ...config, generationKey: randomUUID() });
      const freshMatch = (await bracket(f, fresh.id)).nodes[0].match!;
      await f.tx.match.update({ where: { id: freshMatch.id }, data: { scheduledAt } });
      expect(await f.tx.match.count({ where: { tournamentId: f.tournamentId, scheduledAt } })).toBe(
        1,
      );
    }));
  it('deletes generated fixtures without losing history, reservations or recreating the fixture', () =>
    isolated(async (f) => {
      f.actor = { ...f.actor, permissions: [...f.actor.permissions, 'matches.delete'] };
      const created = await apply(f, create(f, 4)),
        initial = await bracket(f, created.id);
      const ready = initial.nodes.filter((node) => node.match).map((node) => node.match!);
      for (const match of ready)
        await applyMatchAction(
          f.tx,
          f.actor,
          matchActionSchema.parse({
            type: 'match.result.set',
            id: match.id,
            baseVersion: match.version,
            scoreA: 2,
            scoreB: 0,
            winnerSide: 'A',
            forfeitSide: null,
            reason: 'Organizer result',
          }),
        );
      const first = await f.tx.match.findUniqueOrThrow({ where: { id: ready[0].id } });
      const input = {
        type: 'match.delete',
        id: first.id,
        baseVersion: first.version,
        confirmCode: String(first.matchNumber),
        reason: 'Remove the duplicate fixture',
      };
      const preview = await previewCompetitionCorrection(f.tx, f.tournamentId, first.id, null);
      expect(preview.affected).toHaveLength(1);
      await expect(applyMatchAction(f.tx, f.actor, matchActionSchema.parse(input))).rejects.toThrow(
        /approve/i,
      );
      await expect(
        applyMatchAction(
          f.tx,
          f.actor,
          matchActionSchema.parse({
            ...input,
            approveProgression: true,
            correctionHash: '0'.repeat(64),
          }),
        ),
      ).rejects.toThrow(/changed since/);
      await applyMatchAction(
        f.tx,
        f.actor,
        matchActionSchema.parse({
          ...input,
          approveProgression: true,
          correctionHash: preview.hash,
        }),
      );
      expect(await f.tx.match.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({
        deletedAt: expect.any(Date),
        status: 'CANCELLED',
        scoreA: 2,
        winnerSide: 'A',
        matchNumber: first.matchNumber,
        published: false,
      });
      expect(await f.tx.matchResultRevision.count({ where: { matchId: first.id } })).toBe(2);
      expect(
        await f.tx.matchEvent.count({ where: { matchId: first.id, kind: 'match.result.set' } }),
      ).toBe(1);
      await synchronizeCompetitionResults(f.tx, f.tournamentId, f.actor.id);
      const after = await bracket(f, created.id);
      expect(after.nodes.find((node) => node.matchId === first.id)).toMatchObject({
        state: 'DELETED',
        matchNumber: first.matchNumber,
      });
      expect(await f.tx.match.count({ where: { tournamentId: f.tournamentId } })).toBe(3);
      expect(
        after.nodes.find((node) => node.matchNumber === 3)?.slots.some((slot) => !slot.resolved),
      ).toBe(true);
      await expect(
        applyMatchAction(
          f.tx,
          f.actor,
          matchActionSchema.parse({
            type: 'match.result.set',
            id: first.id,
            baseVersion: first.version + 1,
            scoreA: 0,
            scoreB: 2,
            winnerSide: 'B',
            forfeitSide: null,
            reason: 'Old browser mutation',
          }),
        ),
      ).rejects.toThrow(/deleted/i);
      await applyMatchAction(
        f.tx,
        f.actor,
        matchActionSchema.parse({
          type: 'match.reopen',
          id: first.id,
          baseVersion: first.version + 1,
          reason: 'Restore retained fixture',
        }),
      );
      expect(await f.tx.match.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({
        deletedAt: null,
        matchNumber: first.matchNumber,
        scoreA: 2,
      });
    }));
  it('protects generated deletion from stale forms, foreign actors and started downstream history', () =>
    isolated(async (f) => {
      f.actor = { ...f.actor, permissions: [...f.actor.permissions, 'matches.delete'] };
      const created = await apply(f, create(f, 4)),
        initial = await bracket(f, created.id);
      const ready = initial.nodes.filter((node) => node.match).map((node) => node.match!);
      const request = await f.tx.ircLobbyRequest.create({
        data: {
          tournamentId: f.tournamentId,
          matchId: ready[0].id,
          userId: f.actor.id,
          status: 'UNKNOWN',
          name: 'Synthetic uncertain room',
        },
      });
      await expect(
        applyMatchAction(
          f.tx,
          f.actor,
          matchActionSchema.parse({
            type: 'match.delete',
            id: ready[0].id,
            baseVersion: ready[0].version,
            confirmCode: String(ready[0].matchNumber),
            reason: 'Remove unused fixture',
          }),
        ),
      ).rejects.toThrow(/pending lobby/);
      await f.tx.ircLobbyRequest.delete({ where: { id: request.id } });
      for (const match of ready) await confirm(f, match.id);
      const after = await bracket(f, created.id),
        final = after.nodes.find((node) => node.matchNumber === 3)!.match!;
      await f.tx.match.update({
        where: { id: final.id },
        data: { status: 'IN_PROGRESS', startedAt: new Date() },
      });
      const first = await f.tx.match.findUniqueOrThrow({ where: { id: ready[0].id } });
      const input = {
        type: 'match.delete',
        id: first.id,
        baseVersion: first.version,
        confirmCode: String(first.matchNumber),
        reason: 'Reviewed removal',
        approveProgression: true,
      };
      await expect(
        applyMatchAction(
          f.tx,
          f.actor,
          matchActionSchema.parse({ ...input, baseVersion: first.version + 1 }),
        ),
      ).rejects.toThrow(/changed/i);
      await expect(
        applyMatchAction(
          f.tx,
          { ...f.actor, permissions: ['matches.manage'] },
          matchActionSchema.parse(input),
        ),
      ).rejects.toThrow();
      await expect(
        applyMatchAction(
          f.tx,
          { ...f.actor, tournamentId: 'foreign' },
          matchActionSchema.parse(input),
        ),
      ).rejects.toThrow();
      await expect(applyMatchAction(f.tx, f.actor, matchActionSchema.parse(input))).rejects.toThrow(
        /started|completed downstream/,
      );
      expect(
        (await f.tx.match.findUniqueOrThrow({ where: { id: first.id } })).deletedAt,
      ).toBeNull();
    }));
  it('saves inline partial scores without advancing until a winner is recorded', () =>
    isolated(async (f) => {
      const created = await apply(f, create(f, 4)),
        initial = await bracket(f, created.id),
        match = initial.nodes.find((node) => node.match)!.match!;
      await applyMatchAction(
        f.tx,
        f.actor,
        matchActionSchema.parse({
          type: 'match.result.set',
          id: match.id,
          baseVersion: match.version,
          scoreA: 1,
          scoreB: 0,
          winnerSide: null,
          forfeitSide: null,
          reason: 'Organizer entered partial score',
        }),
      );
      expect(await f.tx.match.findUniqueOrThrow({ where: { id: match.id } })).toMatchObject({
        scoreA: 1,
        scoreB: 0,
        winnerSide: null,
        status: 'IN_PROGRESS',
        completedAt: null,
      });
      expect(
        (await bracket(f, created.id)).nodes
          .find((node) => node.matchNumber === 3)
          ?.slots.every((slot) => !slot.resolved),
      ).toBe(true);
    }));
  it('records organizer results and forfeits, preserves referee records and advances reserved numeric bracket positions', () =>
    isolated(async (f) => {
      const created = await apply(f, create(f, 4)),
        initial = await bracket(f, created.id);
      expect(
        initial.nodes
          .flatMap((node) => (node.matchNumber ? [node.matchNumber] : []))
          .sort((a, b) => a - b),
      ).toEqual([1, 2, 3]);
      const ready = initial.nodes.filter((node) => node.matchId);
      const first = ready[0].match!;
      expect(first.code).toBe(String(first.matchNumber));
      const action = await f.tx.matchMapAction.create({
        data: {
          matchId: first.id,
          sequence: 1,
          side: 'A',
          kind: 'PICK',
          slotName: 'NM1',
          category: 'NM',
          actorId: f.actor.id,
        },
      });
      await f.tx.matchMapResult.create({
        data: { matchId: first.id, actionId: action.id, winnerSide: 'B', scoreA: 100, scoreB: 200 },
      });
      await applyMatchAction(
        f.tx,
        f.actor,
        matchActionSchema.parse({
          type: 'match.result.set',
          id: first.id,
          baseVersion: first.version,
          scoreA: 2,
          scoreB: 1,
          winnerSide: 'A',
          forfeitSide: null,
          externalReferee: 'External referee',
          reason: 'Reviewed external result',
        }),
      );
      expect(await f.tx.matchMapAction.count({ where: { matchId: first.id, voided: false } })).toBe(
        1,
      );
      expect(
        await f.tx.matchMapResult.findUniqueOrThrow({ where: { actionId: action.id } }),
      ).toMatchObject({ winnerSide: 'B', scoreA: 100, scoreB: 200 });
      expect(await f.tx.matchResultRevision.count({ where: { matchId: first.id } })).toBe(1);
      const second = ready[1].match!;
      await applyMatchAction(
        f.tx,
        f.actor,
        matchActionSchema.parse({
          type: 'match.result.set',
          id: second.id,
          baseVersion: second.version,
          scoreA: 0,
          scoreB: 2,
          winnerSide: 'B',
          forfeitSide: 'A',
          reason: 'Opponent forfeited externally',
        }),
      );
      const next = await bracket(f, created.id),
        final = next.nodes.find((node) => node.matchNumber === 3)!;
      expect(final.match).toMatchObject({
        matchNumber: 3,
        code: '3',
        status: 'SCHEDULED',
        teamAId: first.teamAId,
        teamBId: second.teamBId,
      });
    }));
  it('requires a reviewed downstream witness and blocks corrections after downstream play starts', () =>
    isolated(async (f) => {
      const created = await apply(f, create(f, 4)),
        initial = await bracket(f, created.id),
        ready = initial.nodes.filter((node) => node.matchId);
      await confirm(f, ready[0].matchId!);
      await confirm(f, ready[1].matchId!);
      const m = await f.tx.match.findUniqueOrThrow({ where: { id: ready[0].matchId! } });
      const input = {
        type: 'match.result.set',
        id: m.id,
        baseVersion: m.version,
        scoreA: 1,
        scoreB: 2,
        winnerSide: 'B',
        forfeitSide: null,
        reason: 'Corrected reviewed result',
      };
      await expect(applyMatchAction(f.tx, f.actor, matchActionSchema.parse(input))).rejects.toThrow(
        /approve/,
      );
      await expect(
        applyMatchAction(
          f.tx,
          f.actor,
          matchActionSchema.parse({
            ...input,
            approveProgression: true,
            correctionHash: '0'.repeat(64),
          }),
        ),
      ).rejects.toThrow(/changed since/);
      const impact = await previewCompetitionCorrection(f.tx, f.tournamentId, m.id, 'B');
      await applyMatchAction(
        f.tx,
        f.actor,
        matchActionSchema.parse({
          ...input,
          approveProgression: true,
          correctionHash: impact.hash,
        }),
      );
      const current = await bracket(f, created.id),
        final = current.nodes.find((node) => node.matchNumber === 3)!;
      await f.tx.match.update({
        where: { id: final.matchId! },
        data: { status: 'IN_PROGRESS', startedAt: new Date() },
      });
      await expect(
        applyMatchAction(
          f.tx,
          f.actor,
          matchActionSchema.parse({
            ...input,
            baseVersion: m.version + 1,
            scoreA: 2,
            scoreB: 1,
            winnerSide: 'A',
            approveProgression: true,
          }),
        ),
      ).rejects.toThrow(/started/);
    }));
  it('denies referee-only, stale and cross-tournament result mutations and invalid outcomes', () =>
    isolated(async (f) => {
      const created = await apply(f, create(f, 2)),
        initial = await bracket(f, created.id),
        m = initial.nodes.find((node) => node.match)!.match!;
      const input = {
        type: 'match.result.set',
        id: m.id,
        baseVersion: m.version,
        scoreA: 2,
        scoreB: 1,
        winnerSide: 'A',
        forfeitSide: null,
        reason: 'Reviewed result',
      };
      await expect(
        applyMatchAction(
          f.tx,
          { ...f.actor, permissions: ['matches.manage_all', 'matches.update_scores'] },
          matchActionSchema.parse(input),
        ),
      ).rejects.toThrow(/permission/i);
      await expect(
        applyMatchAction(
          f.tx,
          f.actor,
          matchActionSchema.parse({ ...input, baseVersion: m.version + 1 }),
        ),
      ).rejects.toThrow(/updated/);
      await expect(
        applyMatchAction(
          f.tx,
          { ...f.actor, tournamentId: 'another-tournament' },
          matchActionSchema.parse(input),
        ),
      ).rejects.toThrow();
      for (const patch of [{ scoreB: 2 }, { winnerSide: 'B' }, { forfeitSide: 'A' }])
        await expect(
          applyMatchAction(f.tx, f.actor, matchActionSchema.parse({ ...input, ...patch })),
        ).rejects.toThrow(/exactly one/);
      expect((await f.tx.match.findUniqueOrThrow({ where: { id: m.id } })).version).toBe(m.version);
    }));
  it('imports reviewed map evidence without fabricating picks and re-imports without duplicate games or revisions', () =>
    isolated(async (f) => {
      const oldSecret = process.env.OSU_CLIENT_SECRET;
      process.env.OSU_CLIENT_SECRET = 'synthetic-import-signing-secret';
      try {
        const created = await apply(f, create(f, 2)),
          initial = await bracket(f, created.id),
          m = initial.nodes.find((node) => node.match)!.match!;
        await f.tx.match.update({
          where: { id: m.id },
          data: {
            source: {
              referee: 'External referee',
              organizerResult: { origin: 'MANUAL', externalReferee: 'External referee' },
            },
          },
        });
        const games: MultiplayerImportGame[] = [1, 2, 3].map((n) => ({
          evidence: {
            eventId: n,
            gameId: String(n),
            beatmapId: n,
            slotName: `NM${n}`,
            startTime: `2026-10-01T12:0${n}:00Z`,
            endTime: `2026-10-01T12:0${n}:30Z`,
            mode: 'osu',
            scoringType: 'scorev2',
            teamType: 'team-vs',
            mods: [],
            scores: [],
            issue: 'Manual review required',
          },
          proposal: null,
        }));
        const decisions = games.map((game, i) => ({
          gameId: game.evidence.gameId,
          included: true,
          winnerSide: i === 1 ? 'B' : 'A',
          reason: 'Verified from external referee records',
        }));
        const review = (version: number) =>
          signMatchResultReview({
            actorId: f.actor.id,
            tournamentId: f.tournamentId,
            matchId: m.id,
            version,
            complete: true,
            metadata: { id: 123, name: 'External tournament lobby' },
            games,
          });
        const input = {
          type: 'match.result.import',
          id: m.id,
          baseVersion: m.version,
          token: review(m.version),
          decisions,
          reason: 'Reviewed external lobby',
        };
        const first = await applyMatchAction(f.tx, f.actor, matchActionSchema.parse(input));
        expect(await f.tx.multiplayerGame.count({ where: { matchId: m.id } })).toBe(3);
        expect(await f.tx.matchMapAction.count({ where: { matchId: m.id } })).toBe(0);
        expect(await f.tx.matchMapResult.count({ where: { matchId: m.id } })).toBe(0);
        expect(await f.tx.match.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({
          status: 'COMPLETED',
          scoreA: 2,
          scoreB: 1,
          winnerSide: 'A',
          resultMode: 'SUMMARY',
          source: { organizerResult: { externalReferee: 'External referee' } },
        });
        const second = await applyMatchAction(
          f.tx,
          f.actor,
          matchActionSchema.parse({
            ...input,
            baseVersion: first.version,
            token: review(first.version!),
            decisions: [...decisions].reverse(),
          }),
        );
        expect(second.version).toBe(first.version);
        expect(await f.tx.matchResultRevision.count({ where: { matchId: m.id } })).toBe(1);
        expect(await f.tx.multiplayerGame.count({ where: { matchId: m.id } })).toBe(3);
        await applyMatchAction(
          f.tx,
          f.actor,
          matchActionSchema.parse({
            ...input,
            baseVersion: second.version,
            token: review(second.version!),
            decisions: decisions.map((row, i) =>
              i === 2
                ? { ...row, winnerSide: 'B', reason: 'Reviewed correction to last game' }
                : row,
            ),
          }),
        );
        expect(await f.tx.match.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({
          scoreA: 1,
          scoreB: 2,
          winnerSide: 'B',
        });
        expect(await f.tx.multiplayerGame.count({ where: { matchId: m.id } })).toBe(3);
        expect(await f.tx.matchResultRevision.count({ where: { matchId: m.id } })).toBe(2);
      } finally {
        if (oldSecret === undefined) delete process.env.OSU_CLIENT_SECRET;
        else process.env.OSU_CLIENT_SECRET = oldSecret;
      }
    }));
  it('changes gameplay stage for a complete unstarted round and protects operational history', () =>
    isolated(async (f) => {
      const created = await apply(f, create(f, 4));
      const initial = await bracket(f, created.id);
      const stage = await f.tx.tournamentStage.create({
        data: {
          tournamentId: f.tournamentId,
          name: 'Later gameplay',
          slug: 'later',
          kind: 'ELIMINATION',
        },
      });
      const round = initial.rounds.find((item) =>
        initial.nodes.some((node) => node.roundId === item.id && node.matchId),
      )!;
      const originals = initial.nodes.flatMap((node) => (node.match ? [node.match] : []));
      const changed = await apply(f, {
        type: 'competition.rounds.stage',
        id: created.id,
        baseVersion: initial.version,
        roundIds: [round.id],
        stageId: stage.id,
      });
      const updated = await bracket(f, created.id);
      expect(updated.rounds.find((item) => item.id === round.id)!.stageId).toBe(stage.id);
      for (const original of originals)
        expect(await f.tx.match.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({
          id: original.id,
          matchNumber: original.matchNumber,
          stageId: stage.id,
          version: original.version + 1,
        });
      await confirm(f, originals[0].id);
      await expect(
        apply(f, {
          type: 'competition.rounds.stage',
          id: created.id,
          baseVersion: (await bracket(f, changed.id)).version,
          roundIds: [round.id],
          stageId: f.stageId,
        }),
      ).rejects.toThrow('operational history');
      expect((await f.tx.match.findUniqueOrThrow({ where: { id: originals[0].id } })).stageId).toBe(
        stage.id,
      );
    }));
  it('links an existing completed match without replacing its result or identifier', () =>
    isolated(async (f) => {
      const input = { ...create(f, 2), manualMatches: true },
        created = await apply(f, input),
        initial = await bracket(f, created.id);
      expect(initial.nodes.filter((node) => node.matchId)).toHaveLength(0);
      const node = initial.nodes.find((item) => item.state === 'READY')!;
      const sideA = node.slots.find((slot) => slot.side === 'A')!.teamId!;
      const sideB = node.slots.find((slot) => slot.side === 'B')!.teamId!;
      const existing = await f.tx.match.create({
        data: {
          tournamentId: f.tournamentId,
          matchNumber: 77,
          code: 'historic-final',
          stageId: f.stageId,
          teamAId: sideA,
          teamBId: sideB,
          participants: { A: { id: sideA }, B: { id: sideB } },
          rules: DEFAULT_MATCH_RULES,
          status: 'COMPLETED',
          scoreA: 2,
          scoreB: 1,
          winnerSide: 'A',
          completedAt: new Date(),
        },
      });
      await apply(f, {
        type: 'competition.link-match',
        id: created.id,
        baseVersion: created.version,
        nodeId: node.id,
        matchId: existing.id,
        matchVersion: existing.version,
      });
      const linked = await bracket(f, created.id),
        final = linked.nodes.find((item) => item.id === node.id)!;
      expect(final.matchId).toBe(existing.id);
      expect(final.match?.matchNumber).toBe(77);
      expect(final.match?.code).toBe('historic-final');
      expect(final.match?.scoreA).toBe(2);
      expect(final.match?.scoreB).toBe(1);
      expect(final.match?.winnerSide).toBe('A');
      expect(await f.tx.match.count({ where: { tournamentId: f.tournamentId } })).toBe(1);
    }));

  it('persists SE8, advances only confirmation, and creates exactly seven native matches', () =>
    isolated(async (f) => {
      const input = create(f),
        result = await apply(f, input);
      expect((await bracket(f, result.id)).nodes.filter((n) => n.matchId)).toHaveLength(4);
      const first = (await bracket(f, result.id)).nodes.find((n) => n.matchId)!;
      await f.tx.match.update({
        where: { id: first.matchId! },
        data: { status: 'AWAITING_CONFIRMATION', winnerSide: 'A' },
      });
      await advanceConfirmedCompetitionResult(f.tx, f.tournamentId, first.matchId!, f.actor.id);
      expect((await bracket(f, result.id)).nodes.filter((n) => n.matchId)).toHaveLength(4);
      await f.tx.match.update({
        where: { id: first.matchId! },
        data: { status: 'SCHEDULED', winnerSide: null },
      });
      expect(await finish(f, result.id)).toBe(7);
      const finished = await bracket(f, result.id);
      expect(finished.nodes.every((n) => n.state === 'COMPLETED')).toBe(true);
      expect(await f.tx.match.count({ where: { tournamentId: f.tournamentId } })).toBe(7);
      const loser = first.slots.find((s) => s.side === 'B')!.teamId!;
      expect((await competitionEligibility(f.tx, f.tournamentId, result.id, loser)).eligible).toBe(
        false,
      );
      const second = await apply(f, {
        ...input,
        generationKey: randomUUID(),
        name: 'Independent division',
      });
      expect((await competitionEligibility(f.tx, f.tournamentId, second.id, loser)).eligible).toBe(
        true,
      );
    }));
  it('persists twelve-team byes without generating bye matches', () =>
    isolated(async (f) => {
      const result = await apply(f, create(f, 12));
      expect((await bracket(f, result.id)).nodes.filter((n) => n.state === 'BYE')).toHaveLength(4);
      expect(await finish(f, result.id)).toBe(11);
      expect(await f.tx.match.count({ where: { tournamentId: f.tournamentId } })).toBe(11);
    }));
  it('persists complete DE8 loser routing and the Grand Finals reset', () =>
    isolated(async (f) => {
      const result = await apply(f, create(f, 8, 'DOUBLE_ELIMINATION'));
      const initial = await bracket(f, result.id),
        first = initial.nodes.find((n) => n.matchId)!;
      await confirm(f, first.matchId!);
      const loser = first.slots.find((s) => s.side === 'B')!.teamId!;
      expect((await competitionEligibility(f.tx, f.tournamentId, result.id, loser)).eligible).toBe(
        true,
      );
      expect(1 + (await finish(f, result.id, true))).toBe(15);
      const finished = await bracket(f, result.id);
      expect(finished.nodes.filter((n) => n.matchId)).toHaveLength(15);
      expect(finished.nodes.every((n) => ['COMPLETED', 'SKIPPED', 'BYE'].includes(n.state))).toBe(
        true,
      );
      const losses = new Map<string, number>();
      for (const node of finished.nodes)
        if (node.match?.status === 'COMPLETED') {
          const losing = node.match.winnerSide === 'A' ? node.match.teamBId! : node.match.teamAId!;
          losses.set(losing, (losses.get(losing) || 0) + 1);
        }
      expect([...losses.values()].filter((n) => n === 2)).toHaveLength(7);
    }));
  it('retries generation idempotently and rejects stale versions and unauthorized mutations', () =>
    isolated(async (f) => {
      const input = create(f),
        result = await apply(f, input),
        retry = await apply(f, input);
      expect(retry.id).toBe(result.id);
      expect(await f.tx.bracket.count({ where: { tournamentId: f.tournamentId } })).toBe(1);
      await expect(apply(f, { ...input, name: 'Different generation' })).rejects.toThrow(
        /different bracket/,
      );
      await expect(
        apply(f, {
          type: 'competition.publish',
          id: result.id,
          baseVersion: result.version - 1,
          published: true,
        }),
      ).rejects.toThrow(/changed/);
      await expect(
        applyCompetitionAction(f.tx, { ...f.actor, permissions: [] }, input),
      ).rejects.toThrow(/permission/);
      expect(await f.tx.match.count({ where: { tournamentId: f.tournamentId } })).toBe(4);
    }));
  it('preserves locked placements and audits explicit cutoff/eligibility overrides', () =>
    isolated(async (f) => {
      let result = await apply(f, create(f, 4));
      const first = (await bracket(f, result.id)).nodes.find((n) => n.matchId)!;
      const outside = f.teamIds[8];
      await expect(
        apply(f, {
          type: 'competition.slot',
          id: result.id,
          baseVersion: result.version,
          nodeId: first.id,
          side: 'A',
          teamId: outside,
          mode: 'LOCKED',
        }),
      ).rejects.toThrow(/outside/);
      // The service is designed for caller-owned transactions: a rejected action rolls back the CAS in production.
      result = { ...result, version: (await bracket(f, result.id)).version };
      result = await apply(f, {
        type: 'competition.slot',
        id: result.id,
        baseVersion: result.version,
        nodeId: first.id,
        side: 'A',
        teamId: outside,
        mode: 'LOCKED',
        allowIneligible: true,
        reason: 'Approved exhibition placement',
      });
      await confirm(f, first.matchId!, 'B');
      const locked = (await bracket(f, result.id)).nodes
        .find((n) => n.id === first.id)!
        .slots.find((s) => s.side === 'A')!;
      expect(locked.teamId).toBe(outside);
      expect(locked.mode).toBe('LOCKED');
      expect(
        await f.tx.auditLog.count({
          where: { tournamentId: f.tournamentId, action: 'competition.eligibility.override' },
        }),
      ).toBe(1);
      await expect(
        assertCompetitionEligibility(f.tx, f.actor, { bracketId: result.id, teamId: f.teamIds[9] }),
      ).rejects.toThrow(/outside/);
    }));
  it('previews correction impact, preserves scheduling, and blocks already-started downstream replacements', () =>
    isolated(async (f) => {
      const result = await apply(f, create(f, 4)),
        initial = await bracket(f, result.id);
      const firstRound = initial.nodes.filter((n) => n.matchId);
      await confirm(f, firstRound[0].matchId!);
      await confirm(f, firstRound[1].matchId!);
      let current = await bracket(f, result.id),
        final = current.nodes.find((n) => n.key === 'g1-r2-m1')!;
      const scheduledAt = new Date('2030-01-01T12:00:00Z');
      await f.tx.match.update({
        where: { id: final.matchId! },
        data: { scheduledAt, notes: 'Preserve this referee note' },
      });
      const preview = await previewCompetitionCorrection(
        f.tx,
        f.tournamentId,
        firstRound[0].matchId!,
        'B',
      );
      expect(preview.affected).toHaveLength(1);
      expect(preview.blocked).toBe(false);
      await expect(
        assertCompetitionResultCorrection(f.tx, f.tournamentId, firstRound[0].matchId!, 'B'),
      ).rejects.toThrow(/approve/);
      await assertCompetitionResultCorrection(
        f.tx,
        f.tournamentId,
        firstRound[0].matchId!,
        'B',
        true,
      );
      await confirm(f, firstRound[0].matchId!, 'B');
      const updated = await f.tx.match.findUniqueOrThrow({ where: { id: final.matchId! } });
      expect(updated.scheduledAt).toEqual(scheduledAt);
      expect(updated.notes).toBe('Preserve this referee note');
      expect(updated.teamAId).toBe(firstRound[0].slots.find((s) => s.side === 'B')!.teamId);
      await f.tx.match.update({
        where: { id: final.matchId! },
        data: { status: 'IN_PROGRESS', startedAt: new Date() },
      });
      await expect(
        assertCompetitionResultCorrection(f.tx, f.tournamentId, firstRound[0].matchId!, 'A', true),
      ).rejects.toThrow(/started/);
      current = await bracket(f, result.id);
      final = current.nodes.find((n) => n.id === final.id)!;
      expect(final.match!.teamAId).toBe(updated.teamAId);
      expect(await f.tx.matchEvent.count({ where: { matchId: final.matchId! } })).toBeGreaterThan(
        1,
      );
    }));
  it('rejects cross-tenant stages, source nodes, bracket IDs and team references', () =>
    isolated(async (f) => {
      const other = await fixture(f.tx, 4),
        own = await apply(f, create(f, 4)),
        foreign = await apply(other, create(other, 4));
      await expect(apply(f, { ...create(f, 4), stageId: other.stageId })).rejects.toThrow(/valid/);
      await expect(apply(f, { ...create(f, 4), teamIds: other.teamIds })).rejects.toThrow(
        /approved/,
      );
      await expect(
        apply(f, {
          type: 'competition.publish',
          id: foreign.id,
          baseVersion: foreign.version,
          published: true,
        }),
      ).rejects.toThrow(/not found/);
      const current = await bracket(f, own.id),
        source = (await bracket(other, foreign.id)).nodes[0];
      await expect(
        apply(f, {
          type: 'competition.route',
          id: own.id,
          baseVersion: current.version,
          nodeId: current.nodes[0].id,
          side: 'A',
          sourceNodeId: source.id,
          outcome: 'WINNER',
        }),
      ).rejects.toThrow(/not found/);
      expect(await f.tx.bracket.count({ where: { tournamentId: f.tournamentId } })).toBe(1);
    }));
  it('requires reviewed group ties and freezes qualified source seeds without silently reseeding', () =>
    isolated(async (f) => {
      const source = await apply(f, create(f, 3, 'GROUPS'));
      await expect(finalizedGroupSeeds(f.tx, f.tournamentId, source.id)).rejects.toThrow(
        /Complete/,
      );
      const initial = await bracket(f, source.id);
      const beats = new Map([
        [f.teamIds[0], f.teamIds[1]],
        [f.teamIds[1], f.teamIds[2]],
        [f.teamIds[2], f.teamIds[0]],
      ]);
      for (const node of initial.nodes) {
        const a = node.slots.find((slot) => slot.side === 'A')!.teamId!,
          b = node.slots.find((slot) => slot.side === 'B')!.teamId!;
        await confirm(f, node.matchId!, beats.get(a) === b ? 'A' : 'B');
      }
      let current = await bracket(f, source.id);
      const unresolved = groupStandings(current.nodes, current.rounds, current.entries, 2);
      expect(unresolved.every((row) => row.tied && !row.qualified)).toBe(true);
      await expect(finalizedGroupSeeds(f.tx, f.tournamentId, source.id)).rejects.toThrow(/tied/);
      const tieOrder = [f.teamIds[1], f.teamIds[2], f.teamIds[0]];
      await apply(f, {
        type: 'competition.group.resolve',
        id: source.id,
        baseVersion: current.version,
        tieOrder,
        reason: 'Approved three-way playoff tiebreak result',
      });
      const qualified = await finalizedGroupSeeds(f.tx, f.tournamentId, source.id);
      expect(qualified.seeds.map((seed) => seed.teamId)).toEqual(tieOrder.slice(0, 2));
      expect(
        await f.tx.auditLog.count({
          where: { tournamentId: f.tournamentId, action: 'competition.group.resolve' },
        }),
      ).toBe(1);
      const input = {
        ...create(f, 2),
        sourceBracketId: source.id,
        teamIds: qualified.seeds.map((seed) => seed.teamId),
      };
      await expect(apply(f, { ...input, teamIds: [...input.teamIds].reverse() })).rejects.toThrow(
        /order/,
      );
      await expect(apply(f, { ...input, teamIds: [f.teamIds[0], f.teamIds[1]] })).rejects.toThrow(
        /qualified/,
      );
      const target = await apply(f, input);
      expect((await apply(f, input)).id).toBe(target.id);
      const downstream = await bracket(f, target.id),
        match = downstream.nodes.find((node) => node.matchId)!;
      expect(downstream.seedOrder).toEqual(input.teamIds);
      expect(
        (downstream.config as { groupSource: { sourceHash: string } }).groupSource.sourceHash,
      ).toBe(qualified.sourceHash);
      await assertCompetitionMatchStart(f.tx, f.tournamentId, match.matchId!);
      const witness = {
        brackets: await f.tx.bracket.findMany({ where: { tournamentId: f.tournamentId } }),
        bracketRounds: await f.tx.bracketRound.findMany({
          where: { tournamentId: f.tournamentId },
        }),
        bracketNodes: await f.tx.bracketNode.findMany({ where: { tournamentId: f.tournamentId } }),
        bracketSlots: await f.tx.bracketSlot.findMany({ where: { tournamentId: f.tournamentId } }),
        bracketEntries: await f.tx.bracketEntry.findMany({
          where: { tournamentId: f.tournamentId },
        }),
        matches: await f.tx.match.findMany({ where: { tournamentId: f.tournamentId } }),
      };
      validateCompetitionArchive(witness);
      const identities = new Map<string, string>([
        [f.stageId, f.stageId],
        ...f.teamIds.map((id) => [id, id] as [string, string]),
      ]);
      for (const table of [
        witness.brackets,
        witness.bracketRounds,
        witness.bracketNodes,
        witness.bracketSlots,
        witness.matches,
      ])
        for (const row of table) identities.set(row.id, row.id);
      identities.set(f.tournamentId, f.tournamentId);
      const localIds = new Map(
        [...identities.keys()].map((id, index) => [id, `archive_${index + 1}`]),
      );
      const localized = JSON.parse(JSON.stringify(witness), (_key, value: unknown) =>
        typeof value === 'string' && localIds.has(value) ? localIds.get(value) : value,
      ) as CompetitionArchiveWitness;
      expect(() => validateCompetitionArchive(localized)).toThrow(/tiebreak approval|tied group/);
      const localizedResults = JSON.stringify(localized.matches);
      const originalBefore = JSON.stringify(witness);
      expect(rebindLocalizedCompetition(witness, localized, localIds)).toEqual({
        reboundGroups: 1,
        reboundSources: 1,
      });
      validateCompetitionArchive(localized);
      expect(JSON.stringify(localized.matches)).toBe(localizedResults);
      expect(JSON.stringify(witness)).toBe(originalBefore);
      const nextIds = new Map(
        [...localIds.values()].map((id, index) => [id, `restored_${index + 1}`]),
      );
      const restored = JSON.parse(JSON.stringify(localized), (_key, value: unknown) =>
        typeof value === 'string' && nextIds.has(value) ? nextIds.get(value) : value,
      ) as CompetitionArchiveWitness;
      expect(rebindLocalizedCompetition(localized, restored, nextIds)).toEqual({
        reboundGroups: 1,
        reboundSources: 1,
      });
      validateCompetitionArchive(restored);
      const forged = JSON.parse(JSON.stringify(witness), (_key, value: unknown) =>
        typeof value === 'string' && localIds.has(value) ? localIds.get(value) : value,
      ) as CompetitionArchiveWitness;
      forged.matches.find((row) => row.id === localIds.get(initial.nodes[0].matchId!))!.scoreA =
        123;
      expect(() => rebindLocalizedCompetition(witness, forged, localIds)).toThrow(
        /differ from the original witness/,
      );
      expect(await rebindImportedCompetition(f.tx, f.tournamentId, witness, identities)).toEqual({
        reboundGroups: 1,
        reboundSources: 1,
      });
      expect((await bracket(f, target.id)).seedOrder).toEqual(input.teamIds);
      const tampered = structuredClone(witness);
      tampered.matches.find((row) => row.id === initial.nodes[0].matchId)!.scoreA++;
      expect(() => validateCompetitionArchive(tampered)).toThrow(
        /tiebreak approval|tied group|frozen group seeds/,
      );
      await expect(
        assertCompetitionResultCorrection(
          f.tx,
          f.tournamentId,
          initial.nodes[0].matchId!,
          null,
          true,
        ),
      ).rejects.toThrow(/frozen downstream/);
      await f.tx.match.update({
        where: { id: initial.nodes[0].matchId! },
        data: { scoreA: { increment: 1 } },
      });
      await expect(
        assertCompetitionMatchStart(f.tx, f.tournamentId, match.matchId!),
      ).rejects.toThrow(/tied|Source|source/);
      expect((await bracket(f, target.id)).seedOrder).toEqual(input.teamIds);
      current = await bracket(f, source.id);
      expect(
        groupStandings(current.nodes, current.rounds, current.entries, 2)
          .filter((row) => row.tied)
          .every((row) => !row.qualified),
      ).toBe(true);
    }));
  it('rejects unreviewed tie permutations and foreign group sources', () =>
    isolated(async (f) => {
      const source = await apply(f, create(f, 4, 'GROUPS'));
      await finish(f, source.id);
      const current = await bracket(f, source.id);
      await expect(
        apply(f, {
          type: 'competition.group.resolve',
          id: source.id,
          baseVersion: current.version,
          tieOrder: [f.teamIds[0], f.teamIds[0], f.teamIds[2], f.teamIds[3]],
          reason: 'Invalid duplicate placement',
        }),
      ).rejects.toThrow(/exactly once/);
      const other = await fixture(f.tx, 4),
        foreign = await apply(other, create(other, 4, 'GROUPS'));
      await expect(apply(f, { ...create(f, 2), sourceBracketId: foreign.id })).rejects.toThrow(
        /not found/,
      );
      await expect(finalizedGroupSeeds(f.tx, other.tournamentId, source.id)).rejects.toThrow(
        /not found/,
      );
    }));
  it('blocks bracket starts when the linked qualifier seed snapshot has been reopened', () =>
    isolated(async (f) => {
      const target = await apply(f, create(f, 2)),
        current = await bracket(f, target.id),
        match = current.nodes.find((node) => node.matchId)!;
      const stage = await f.tx.tournamentStage.create({
        data: {
          tournamentId: f.tournamentId,
          name: 'Qualifier',
          slug: 'qualifier',
          kind: 'QUALIFIER',
        },
      });
      const standing = await f.tx.qualifierStanding.create({
        data: {
          tournamentId: f.tournamentId,
          stageId: stage.id,
          version: 1,
          sourceHash: '0'.repeat(64),
          snapshot: { state: 'REOPENED', calculation: { canFinalize: false }, seeds: [] },
        },
      });
      await f.tx.bracket.update({
        where: { id: target.id },
        data: { sourceStandingId: standing.id },
      });
      await expect(
        assertCompetitionMatchStart(f.tx, f.tournamentId, match.matchId!),
      ).rejects.toThrow(/reopen|finalized|historical|review|stale/i);
    }));
  it('round-trips reviewed groups and a frozen downstream bracket through the real archive services', async () => {
    let source: Fixture | undefined, importedId: string | undefined;
    try {
      source = await db.$transaction(
        async (tx) => {
          const f = await fixture(tx, 3);
          await tx.user.update({ where: { id: f.actor.id }, data: { platformAdmin: true } });
          f.actor = { ...f.actor, platformAdmin: true, permissions: [...ALL_PERMISSIONS] };
          await tx.tournamentSettings.update({
            where: { tournamentId: f.tournamentId },
            data: { banner: '' },
          });
          const groups = await apply(f, create(f, 3, 'GROUPS')),
            initial = await bracket(f, groups.id);
          const beats = new Map([
            [f.teamIds[0], f.teamIds[1]],
            [f.teamIds[1], f.teamIds[2]],
            [f.teamIds[2], f.teamIds[0]],
          ]);
          for (const node of initial.nodes) {
            const a = node.slots.find((slot) => slot.side === 'A')!.teamId!,
              b = node.slots.find((slot) => slot.side === 'B')!.teamId!;
            await confirm(f, node.matchId!, beats.get(a) === b ? 'A' : 'B');
          }
          const current = await bracket(f, groups.id);
          await apply(f, {
            type: 'competition.group.resolve',
            id: groups.id,
            baseVersion: current.version,
            tieOrder: [f.teamIds[1], f.teamIds[2], f.teamIds[0]],
            reason: 'Approved archive round-trip playoff result',
          });
          const seeds = await finalizedGroupSeeds(tx, f.tournamentId, groups.id);
          await apply(f, {
            ...create(f, 2),
            name: 'Final bracket',
            sourceBracketId: groups.id,
            teamIds: seeds.seeds.map((seed) => seed.teamId),
          });
          const removed = await apply(f, { ...create(f, 2), name: 'Removed fixture' });
          const removedMatch = (await bracket(f, removed.id)).nodes.find(
            (node) => node.match,
          )!.match!;
          await applyMatchAction(
            tx,
            f.actor,
            matchActionSchema.parse({
              type: 'match.delete',
              id: removedMatch.id,
              baseVersion: removedMatch.version,
              confirmCode: String(removedMatch.matchNumber),
              reason: 'Retain deleted fixture in archive',
            }),
          );
          const retired = await apply(f, { ...create(f, 2), name: 'Retired bracket' });
          await finish(f, retired.id);
          const retirement = await preview(f, retired.id, 'delete');
          await apply(f, {
            type: 'competition.delete',
            id: retired.id,
            baseVersion: retirement.current.version,
            reviewHash: retirement.review.hash,
            confirmation: retirement.current.name,
            acknowledgeHistory: true,
          });
          const retiredGroups = await apply(f, {
            ...create(f, 2, 'GROUPS'),
            name: 'Historical source groups',
          });
          await finish(f, retiredGroups.id);
          const historicalSeeds = await finalizedGroupSeeds(tx, f.tournamentId, retiredGroups.id);
          const retiredFinal = await apply(f, {
            ...create(f, 2),
            name: 'Historical seeded bracket',
            sourceBracketId: retiredGroups.id,
            teamIds: historicalSeeds.seeds.map((seed) => seed.teamId),
          });
          for (const id of [retiredFinal.id, retiredGroups.id]) {
            const retirement = await preview(f, id, 'delete');
            await apply(f, {
              type: 'competition.delete',
              id,
              baseVersion: retirement.current.version,
              reviewHash: retirement.review.hash,
              confirmation: retirement.current.name,
              acknowledgeHistory: true,
            });
          }
          return f;
        },
        { timeout: 60000 },
      );
      const exported = await exportTournament(source.actor, 'https://competition.example');
      const inspected = await inspectArchive(exported.bytes);
      expect(inspected.archive.data.brackets).toHaveLength(3);
      validateCompetitionArchive(inspected.archive.data);
      const report = await importTournament(
        source.actor,
        inspected.archive,
        `competition-restored-${randomUUID()}`,
      );
      importedId = report.tournamentId;
      expect(report.competitionRestore).toEqual({ reboundGroups: 1, reboundSources: 1 });
      const restored = await db.bracket.findMany({
        where: { tournamentId: importedId },
        include: { entries: { include: { team: true } }, nodes: { include: { match: true } } },
      });
      const groups = restored.find((row) => row.format === 'GROUPS')!,
        target = restored.find((row) => row.name === 'Final bracket')!;
      expect(
        restored.some((row) =>
          ['Retired bracket', 'Historical source groups', 'Historical seeded bracket'].includes(
            row.name,
          ),
        ),
      ).toBe(false);
      const removed = restored
        .find((row) => row.name === 'Removed fixture')!
        .nodes.find((node) => node.match)!;
      expect(removed.match!.deletedAt).toBeInstanceOf(Date);
      await expect(
        db.$transaction((tx) => assertCompetitionMatchStart(tx, importedId!, removed.matchId!)),
      ).rejects.toThrow();
      expect((target.config as { sourceBracketId: string }).sourceBracketId).toBe(groups.id);
      const seeds = await db.$transaction((tx) => finalizedGroupSeeds(tx, importedId!, groups.id));
      expect(
        seeds.seeds.map(
          (seed) => groups.entries.find((entry) => entry.teamId === seed.teamId)!.team.name,
        ),
      ).toEqual(['Seed 2', 'Seed 3']);
      expect(target.seedOrder).toEqual(seeds.seeds.map((seed) => seed.teamId));
      const match = target.nodes.find((node) => node.matchId)!;
      await db.$transaction((tx) => assertCompetitionMatchStart(tx, importedId!, match.matchId!));
      const projection = {
        code: true,
        scoreA: true,
        scoreB: true,
        winnerSide: true,
        status: true,
        deletedAt: true,
      } as const;
      expect(
        await db.match.findMany({
          where: { tournamentId: importedId },
          select: projection,
          orderBy: { code: 'asc' },
        }),
      ).toEqual(
        await db.match.findMany({
          where: { tournamentId: source.tournamentId },
          select: projection,
          orderBy: { code: 'asc' },
        }),
      );
      const reexported = await exportTournament(
        { ...source.actor, tournamentId: importedId },
        'https://competition.example',
      );
      validateCompetitionArchive((await inspectArchive(reexported.bytes)).archive.data);
    } finally {
      for (const tournamentId of [importedId, source?.tournamentId].filter(
        (id): id is string => !!id,
      )) {
        await db.bracketSlot.deleteMany({ where: { tournamentId } });
        await db.bracketEntry.deleteMany({ where: { tournamentId } });
        await db.bracketNode.deleteMany({ where: { tournamentId } });
        await db.bracketRound.deleteMany({ where: { tournamentId } });
        await db.bracket.deleteMany({ where: { tournamentId } });
        await db.match.deleteMany({ where: { tournamentId } });
        await db.team.deleteMany({ where: { tournamentId } });
        await db.tournamentStage.deleteMany({ where: { tournamentId } });
        await db.role.deleteMany({ where: { tournamentId } });
        await db.auditLog.deleteMany({ where: { tournamentId } });
        await db.tournament.deleteMany({ where: { id: tournamentId } });
      }
      if (source) {
        await db.tournamentTransfer.deleteMany({ where: { initiatedBy: source.actor.id } });
        await db.participant.deleteMany({
          where: { osuId: { in: [1, 2, 3].map((offset) => source!.actor.osuId + offset) } },
        });
        await db.user.deleteMany({ where: { id: source.actor.id } });
      }
    }
  }, 60000);
});
