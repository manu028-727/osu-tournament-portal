import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import type { Prisma } from '../src/generated/prisma/client';
import { assertTestDatabase } from '../src/lib/instance';
import { ALL_PERMISSIONS, type Actor } from '../src/lib/permissions';
import { exportTournament } from '../src/lib/tournament-export';
import { importTournament, inspectArchive } from '../src/lib/tournament-import';
import { DEFAULT_COPY } from '../src/lib/copy';
import { competitionActionSchema, type CompetitionCreate } from '../src/lib/competition-validation';
import {
  advanceConfirmedCompetitionResult,
  applyCompetitionAction,
  assertCompetitionEligibility,
  assertCompetitionMatchStart,
  assertCompetitionResultCorrection,
  competitionEligibility,
  previewCompetitionCorrection,
  finalizedGroupSeeds,
  validateCompetitionArchive,
  rebindImportedCompetition,
  rebindLocalizedCompetition,
  type CompetitionArchiveWitness,
} from '../src/lib/competition-service';
import { groupStandings } from '../src/lib/competition-engine';

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
async function isolated(test: (f: Fixture) => Promise<void>) {
  try {
    await db.$transaction(
      async (tx) => {
        await test(await fixture(tx));
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
          return f;
        },
        { timeout: 60000 },
      );
      const exported = await exportTournament(source.actor, 'https://competition.example');
      const inspected = await inspectArchive(exported.bytes);
      expect(inspected.archive.data.brackets).toHaveLength(2);
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
        target = restored.find((row) => row.format === 'SINGLE_ELIMINATION')!;
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
