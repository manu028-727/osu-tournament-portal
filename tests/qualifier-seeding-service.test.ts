import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../src/generated/prisma/client';
import { matchRulesSchema } from '../src/lib/match-rules';
import type { Actor } from '../src/lib/permissions';
import { qualifierPolicySchema } from '../src/lib/qualifier-policy';
import { qualifierSourceHash } from '../src/lib/qualifier-seeding';
import {
  qualifierStandingSnapshot,
  type QualifierStandingSnapshot,
} from '../src/lib/qualifier-standings-contract';
import { rebindImportedQualifierStandings } from '../src/lib/qualifier-standings-restoration';
import {
  applyQualifierStandingsAction,
  assertQualifierMutable,
  finalizedQualifierSeeds,
} from '../src/lib/qualifier-standings-service';
import {
  loadQualifierCalculation,
  publishedQualifierStandings,
  qualifierStandingsData,
} from '../src/lib/qualifier-standings-sources';

const { root } = vi.hoisted(() => ({ root: {} as Record<string, unknown> }));
vi.mock('../src/lib/db', () => ({ db: root }));

const actor: Actor = {
  id: 'organizer',
  tournamentId: 'tournament',
  osuId: 99,
  username: 'Host',
  avatarUrl: '',
  roles: [],
  permissions: ['matches.manage'],
};
const policy = qualifierPolicySchema.parse({});
type Version = {
  id: string;
  tournamentId: string;
  stageId: string;
  version: number;
  published: boolean;
  sourceHash: string;
  snapshot: QualifierStandingSnapshot;
  createdAt: Date;
};

function database() {
  const brackets = [] as ReturnType<typeof impactBracket>[];
  const rules = matchRulesSchema.parse({
    gameplayScoring: 'SCORE_V2',
    scoreMode: 'SCORE_V2',
    teamSize: 1,
    multiplierMode: 'NONE',
  });
  const versions: Version[] = [];
  const slots = [{ name: 'NM1', beatmapId: 1 }];
  const stage = {
    id: 'stage',
    tournamentId: 'tournament',
    name: 'Qualifiers',
    kind: 'QUALIFIERS',
    qualifierPolicy: policy,
    matchRules: rules,
    mappool: { state: 'PUBLISHED', publishedRevisionId: 'pool', publishedRevision: { slots } },
  };
  const lobby = {
    id: 'lobby',
    code: 'Q1',
    tournamentId: 'tournament',
    stageId: 'stage',
    version: 1,
    status: 'COMPLETED',
    policy,
    gameplayScoring: 'SCORE_V2',
    rules,
    poolRevisionId: 'pool',
    poolRevision: { slots },
    participants: [
      { id: 'a', name: 'A', members: [{ osuId: 1 }] },
      { id: 'b', name: 'B', members: [{ osuId: 2 }] },
    ],
    entries: [
      { teamId: 'a', position: 0, team: { status: 'APPROVED' } },
      { teamId: 'b', position: 1, team: { status: 'APPROVED' } },
    ],
    scores: [100, 50].map((value, index) => ({
      id: `score-${index}`,
      lobbyId: 'lobby',
      osuId: index + 1,
      slotName: 'NM1',
      run: 1,
      raw: value,
      adjusted: value,
      mods: [],
      actualScoring: 'SCORE_V2' as string | null,
      representation: 'LEGACY',
      source: 'MANUAL',
      gameId: null,
      verified: true,
      updatedAt: new Date('2026-10-21T00:00:00Z'),
    })),
  };
  const api = {
    $executeRaw: vi.fn(async () => 0),
    bracket: { findMany: vi.fn(async () => brackets) },
    tournament: { findFirst: vi.fn(async () => ({ id: 'tournament' }) as { id: string } | null) },
    $queryRaw: vi.fn(async (_sql: unknown, id: string, tenant: string) =>
      id === stage.id && tenant === stage.tournamentId ? [{ id }] : [],
    ),
    tournamentStage: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; tournamentId: string } }) =>
        where.id === stage.id && where.tournamentId === stage.tournamentId ? stage : null,
      ),
      update: vi.fn(async ({ data }: { data: { qualifierPolicy: typeof policy } }) => {
        stage.qualifierPolicy = data.qualifierPolicy;
        return stage;
      }),
    },
    tournamentSettings: {
      findUniqueOrThrow: vi.fn(async () => ({ gameplayScoring: 'SCORE_V2', matchRules: rules })),
    },
    qualifierLobby: {
      findMany: vi.fn(async () => [lobby]),
      count: vi.fn(async () => (lobby.status !== 'SCHEDULED' || lobby.scores.length ? 1 : 0)),
      updateMany: vi.fn(async ({ data }: { data: { policy: typeof policy } }) => {
        lobby.policy = data.policy;
        lobby.version++;
        return { count: 1 };
      }),
    },
    qualifierStanding: {
      findMany: vi.fn(async ({ where }: { where: { tournamentId: string } }) =>
        where.tournamentId === stage.tournamentId
          ? [...versions].sort((a, b) => b.version - a.version)
          : [],
      ),
      findFirst: vi.fn(
        async ({ where }: { where: { tournamentId: string; id?: string; published?: boolean } }) =>
          [...versions]
            .reverse()
            .find(
              (v) =>
                v.tournamentId === where.tournamentId &&
                (!where.id || v.id === where.id) &&
                (where.published === undefined || v.published === where.published),
            ) || null,
      ),
      create: vi.fn(async ({ data }: { data: Omit<Version, 'id' | 'createdAt' | 'published'> }) => {
        if (versions.some((v) => v.version === data.version))
          throw new Error('Unique stage version constraint.');
        const version = {
          ...data,
          id: `standing-${data.version}`,
          createdAt: new Date(),
          published: false,
        };
        versions.push(version);
        return version;
      }),
      updateMany: vi.fn(async () => {
        versions.forEach((v) => {
          v.published = false;
        });
        return { count: versions.length };
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<Pick<Version, 'published' | 'sourceHash' | 'snapshot'>>;
        }) => {
          const version = versions.find((v) => v.id === where.id)!;
          Object.assign(version, data);
          return version;
        },
      ),
    },
    auditLog: { create: vi.fn(async (value: unknown) => value) },
  };
  return { api, tx: api as unknown as Prisma.TransactionClient, stage, lobby, versions, brackets };
}
function impactBracket(id: string, sourceStandingId: string | null, sourceBracketId?: string) {
  return {
    id,
    name: id,
    version: 1,
    published: true,
    sourceStandingId,
    config: sourceBracketId ? { sourceBracketId } : {},
    nodes: [
      {
        id: `${id}-node`,
        state: 'READY',
        match: {
          id: `${id}-match`,
          code: `${id}-match`,
          version: 1,
          status: 'SCHEDULED',
          startedAt: null as Date | null,
          submittedAt: null,
          completedAt: null,
          scoreA: 0,
          scoreB: 0,
          winnerSide: null,
          _count: { results: 0, multiplayerGames: 0 },
        },
      },
    ],
  };
}
let data: ReturnType<typeof database>;
beforeEach(() => {
  data = database();
  Object.assign(root, data.api);
});
async function base() {
  const { calculation } = await loadQualifierCalculation(data.tx, 'stage', 'tournament');
  return {
    stageId: 'stage',
    baseVersion: data.versions.length,
    sourceHash: calculation.sourceHash,
  };
}
async function calculate() {
  const result = await applyQualifierStandingsAction(data.tx, actor, {
    type: 'qualifier.standings.calculate',
    ...(await base()),
  });
  if (!('snapshot' in result)) throw new Error('Expected a standings record.');
  return { ...result, snapshot: qualifierStandingSnapshot(result.snapshot) };
}
async function finalize() {
  const result = await applyQualifierStandingsAction(data.tx, actor, {
    type: 'qualifier.standings.finalize',
    ...(await base()),
    tieOrder: [],
    reason: '',
    cutoff: 1,
  });
  if (!('snapshot' in result)) throw new Error('Expected a standings record.');
  return { ...result, snapshot: qualifierStandingSnapshot(result.snapshot) };
}

describe('qualifier standings persistence (transaction delegate integration)', () => {
  it('saves a private provisional version, finalizes a new immutable version, and publishes only that snapshot', async () => {
    const provisional = await calculate();
    expect(provisional).toMatchObject({
      version: 1,
      published: false,
      snapshot: { state: 'PROVISIONAL', seeds: [] },
    });
    await expect(publishedQualifierStandings('tournament', 'stage')).resolves.toBeNull();
    await assertQualifierMutable(data.tx, 'stage', 'tournament');
    const frozen = await finalize();
    expect(frozen).toMatchObject({
      version: 2,
      published: false,
      snapshot: {
        state: 'FINALIZED',
        cutoff: 1,
        seeds: [
          { teamId: 'a', seed: 1, qualified: true },
          { teamId: 'b', seed: 2, qualified: false },
        ],
      },
    });
    expect(data.versions[0].snapshot.state).toBe('PROVISIONAL');
    await applyQualifierStandingsAction(data.tx, actor, {
      type: 'qualifier.standings.publish',
      ...(await base()),
      published: true,
    });
    const published = await publishedQualifierStandings('tournament', 'stage');
    expect(published).toMatchObject({ version: 2, cutoff: 1, stageName: 'Qualifiers' });
    expect(published?.rows).toEqual(frozen.snapshot.calculation.rows);
    await expect(finalizedQualifierSeeds(data.tx, 'tournament', frozen.id)).resolves.toEqual([
      { teamId: 'a', seed: 1 },
    ]);
    expect(data.api.auditLog.create).toHaveBeenCalledTimes(3);
    await expect(assertQualifierMutable(data.tx, 'stage', 'tournament')).rejects.toThrow('locked');
    await expect(calculate()).rejects.toThrow('immutable');
  });
  it('requires a saved provisional review before finalization', async () => {
    await expect(finalize()).rejects.toThrow('provisional');
    expect(data.versions).toHaveLength(0);
  });
  it('rejects stale source hashes and concurrent base versions', async () => {
    const reviewed = await base();
    await calculate();
    await expect(
      applyQualifierStandingsAction(data.tx, actor, {
        type: 'qualifier.standings.calculate',
        ...reviewed,
      }),
    ).rejects.toThrow('Standings changed');
    const current = await base();
    data.lobby.scores[0].raw++;
    data.lobby.scores[0].adjusted++;
    await expect(
      applyQualifierStandingsAction(data.tx, actor, {
        type: 'qualifier.standings.finalize',
        ...current,
        tieOrder: [],
        reason: '',
      }),
    ).rejects.toThrow('sources changed');
  });
  it('never publishes provisional calculations', async () => {
    await calculate();
    await expect(
      applyQualifierStandingsAction(data.tx, actor, {
        type: 'qualifier.standings.publish',
        ...(await base()),
        published: true,
      }),
    ).rejects.toThrow('finalized');
  });
  it('never exposes published standings from a hidden or archived tournament', async () => {
    await calculate();
    await finalize();
    await applyQualifierStandingsAction(data.tx, actor, {
      type: 'qualifier.standings.publish',
      ...(await base()),
      published: true,
    });
    data.api.tournament.findFirst.mockResolvedValue(null);
    await expect(publishedQualifierStandings('tournament', 'stage')).resolves.toBeNull();
    expect(data.api.tournament.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'tournament', published: true, archivedAt: null }),
      }),
    );
  });
  it('hides stale public results and refuses them for new brackets, without rewriting the frozen snapshot', async () => {
    await calculate();
    const final = await finalize();
    await applyQualifierStandingsAction(data.tx, actor, {
      type: 'qualifier.standings.publish',
      ...(await base()),
      published: true,
    });
    const hash = qualifierSourceHash(final.snapshot);
    data.lobby.scores[0].raw++;
    data.lobby.scores[0].adjusted++;
    expect((await qualifierStandingsData(actor, 'stage')).latest?.stale).toBe(true);
    await expect(publishedQualifierStandings('tournament', 'stage')).resolves.toBeNull();
    await expect(finalizedQualifierSeeds(data.tx, 'tournament', final.id)).rejects.toThrow('stale');
    expect(qualifierSourceHash(final.snapshot)).toBe(hash);
    await expect(
      applyQualifierStandingsAction(data.tx, actor, {
        type: 'qualifier.standings.publish',
        ...(await base()),
        published: false,
      }),
    ).resolves.toMatchObject({ published: false });
  });
  it('stores explicit tiebreak decisions and reuses them only with the same source hash', async () => {
    data.lobby.scores[1].raw = 100;
    data.lobby.scores[1].adjusted = 100;
    await calculate();
    await expect(finalize()).rejects.toThrow('tied seeds');
    await applyQualifierStandingsAction(data.tx, actor, {
      type: 'qualifier.standings.resolve',
      ...(await base()),
      tieOrder: ['b', 'a'],
      reason: 'Approved replay result',
    });
    const final = await finalize();
    expect(final.snapshot.seeds).toEqual([
      { teamId: 'b', seed: 1, qualified: true },
      { teamId: 'a', seed: 2, qualified: false },
    ]);
    expect(final.snapshot.tieResolution?.reason).toBe('Approved replay result');
  });
  it('requires confirmed sessions and consistent normalization before finalizing', async () => {
    data.lobby.status = 'AWAITING_CONFIRMATION';
    let preview = (await loadQualifierCalculation(data.tx, 'stage', 'tournament')).calculation;
    expect(preview.issues.some((i) => i.code === 'UNCONFIRMED_LOBBY')).toBe(true);
    data.lobby.status = 'COMPLETED';
    data.lobby.scores[0].adjusted++;
    preview = (await loadQualifierCalculation(data.tx, 'stage', 'tournament')).calculation;
    expect(preview.issues.some((i) => i.code === 'NORMALIZATION_MISMATCH')).toBe(true);
    await calculate();
    await expect(finalize()).rejects.toThrow('incompatible');
  });
  it('allows policy changes only while scheduled and scoreless', async () => {
    await expect(
      applyQualifierStandingsAction(data.tx, actor, {
        type: 'qualifier.policy.save',
        ...(await base()),
        policy,
      }),
    ).rejects.toThrow('locked');
    data.lobby.status = 'SCHEDULED';
    data.lobby.scores = [];
    const next = qualifierPolicySchema.parse({ method: 'Z_SUM' });
    await applyQualifierStandingsAction(data.tx, actor, {
      type: 'qualifier.policy.save',
      ...(await base()),
      policy: next,
    });
    expect(data.stage.qualifierPolicy).toEqual(next);
    expect(data.lobby.policy).toEqual(next);
    expect(data.lobby.version).toBe(2);
  });
  it('preserves null historical scoring metadata while documenting the inherited interpretation', async () => {
    data.lobby.scores[0].actualScoring = null;
    const { calculation } = await loadQualifierCalculation(data.tx, 'stage', 'tournament');
    expect(calculation.source.scores[0].actualScoring).toBe('SCORE_V2');
    expect(data.lobby.scores[0].actualScoring).toBeNull();
    expect(calculation.issues.some((i) => i.code === 'LEGACY_SCORING_PROVENANCE')).toBe(true);
  });
  it('enforces organizer authorization and explicit tournament predicates', async () => {
    const referee = { ...actor, permissions: ['matches.view'] as Actor['permissions'] };
    await expect(qualifierStandingsData(referee, 'stage')).rejects.toThrow('full qualifier cohort');
    await expect(
      applyQualifierStandingsAction(data.tx, referee, {
        type: 'qualifier.standings.calculate',
        ...(await base()),
      }),
    ).rejects.toThrow('permission');
    await expect(loadQualifierCalculation(data.tx, 'stage', 'other-tournament')).rejects.toThrow(
      'not found',
    );
    await expect(assertQualifierMutable(data.tx, 'stage', 'other-tournament')).rejects.toThrow(
      'not found',
    );
    await calculate();
    expect(data.api.qualifierStanding.create.mock.calls[0][0].data.tournamentId).toBe('tournament');
    expect(data.api.$queryRaw).toHaveBeenCalledWith(expect.anything(), 'stage', 'tournament');
  });
  it('fails closed on unknown historical standings snapshot formats', () => {
    expect(() => qualifierStandingSnapshot({ rows: [] })).toThrow('historical review');
  });
  it('appends a reviewed reopen version, preserves the final snapshot and invalidates its seeds immediately', async () => {
    await calculate();
    const final = await finalize();
    await applyQualifierStandingsAction(data.tx, actor, {
      type: 'qualifier.standings.publish',
      ...(await base()),
      published: true,
    });
    const before = structuredClone(final.snapshot);
    const root = impactBracket('root', final.id),
      child = impactBracket('child', null, 'root');
    data.brackets.push(root, child);
    const impact = (await qualifierStandingsData(actor, 'stage')).correctionImpact!;
    expect(impact.brackets.map((b) => b.id)).toEqual(['root', 'child']);
    const reopened = await applyQualifierStandingsAction(data.tx, actor, {
      type: 'qualifier.standings.reopen',
      ...(await base()),
      reason: 'Correct verified score entry',
      affectedBracketIds: impact.brackets.map((b) => b.id),
      impactHash: impact.impactHash,
      acknowledgeImpact: true,
    });
    expect(reopened).toMatchObject({
      snapshot: { state: 'REOPENED', seeds: [], correctionReview: { standingId: final.id } },
    });
    expect(data.versions[1].snapshot).toEqual(before);
    expect(data.versions[1].published).toBe(false);
    expect((await qualifierStandingsData(actor, 'stage')).locked).toBe(false);
    await expect(assertQualifierMutable(data.tx, 'stage', 'tournament')).resolves.toBeUndefined();
    await expect(finalizedQualifierSeeds(data.tx, 'tournament', final.id)).rejects.toThrow(
      'reopened or superseded',
    );
    await expect(publishedQualifierStandings('tournament', 'stage')).resolves.toBeNull();
    data.lobby.scores[0].raw++;
    data.lobby.scores[0].adjusted++;
    await expect(finalize()).rejects.toThrow('provisional');
    await calculate();
    const corrected = await finalize();
    expect(corrected.version).toBe(5);
    await expect(finalizedQualifierSeeds(data.tx, 'tournament', final.id)).rejects.toThrow(
      'reopened or superseded',
    );
    await expect(finalizedQualifierSeeds(data.tx, 'tournament', corrected.id)).resolves.toEqual([
      { teamId: 'a', seed: 1 },
    ]);
    expect(data.brackets[0]).toBe(root);
    expect(root.sourceStandingId).toBe(final.id);
  });
  it('requires a current affected-bracket review, exact IDs and an explicit correction reason', async () => {
    await calculate();
    const final = await finalize();
    data.brackets.push(impactBracket('root', final.id));
    const impact = (await qualifierStandingsData(actor, 'stage')).correctionImpact!;
    const reopen = {
      type: 'qualifier.standings.reopen' as const,
      ...(await base()),
      reason: 'Correct score',
      affectedBracketIds: ['root'],
      impactHash: impact.impactHash,
      acknowledgeImpact: true as const,
    };
    await expect(
      applyQualifierStandingsAction(data.tx, actor, { ...reopen, affectedBracketIds: [] }),
    ).rejects.toThrow('acknowledge every');
    await expect(
      applyQualifierStandingsAction(data.tx, actor, {
        ...reopen,
        affectedBracketIds: ['root', 'root'],
      }),
    ).rejects.toThrow('acknowledge every');
    data.brackets[0].version++;
    await expect(applyQualifierStandingsAction(data.tx, actor, reopen)).rejects.toThrow(
      'Downstream competition changed',
    );
    await expect(
      applyQualifierStandingsAction(data.tx, actor, { ...reopen, reason: '' }),
    ).rejects.toThrow();
    expect(data.versions).toHaveLength(2);
  });
  for (const blocker of ['STARTED', 'RESULTS', 'GAMEPLAY', 'SUMMARY'] as const)
    it(`blocks reopening with ${blocker} in a connected downstream bracket`, async () => {
      await calculate();
      const final = await finalize();
      const child = impactBracket('child', null, 'root');
      if (blocker === 'STARTED') child.nodes[0].match.startedAt = new Date();
      if (blocker === 'RESULTS') child.nodes[0].match._count.results = 1;
      if (blocker === 'GAMEPLAY') child.nodes[0].match._count.multiplayerGames = 1;
      if (blocker === 'SUMMARY') child.nodes[0].match.scoreA = 1;
      data.brackets.push(impactBracket('root', final.id), child);
      const impact = (await qualifierStandingsData(actor, 'stage')).correctionImpact!;
      expect(impact.canReopen).toBe(false);
      await expect(
        applyQualifierStandingsAction(data.tx, actor, {
          type: 'qualifier.standings.reopen',
          ...(await base()),
          reason: 'Correct verified scores',
          affectedBracketIds: impact.brackets.map((b) => b.id),
          impactHash: impact.impactHash,
          acknowledgeImpact: true,
        }),
      ).rejects.toThrow('manual historical reconciliation');
      expect(data.versions).toHaveLength(2);
    });
  it('rebinds imported source identities without changing historical ranks or finalized tie order', async () => {
    data.lobby.scores[1].raw = 100;
    data.lobby.scores[1].adjusted = 100;
    await calculate();
    await applyQualifierStandingsAction(data.tx, actor, {
      type: 'qualifier.standings.resolve',
      ...(await base()),
      tieOrder: ['b', 'a'],
      reason: 'Approved replay result',
    });
    await finalize();
    const originalHash = data.versions[2].sourceHash;
    const remap = (value: unknown): unknown => {
      if (typeof value === 'string')
        return (
          (
            { a: 'z-new-a', b: 'y-new-b', 'score-0': 'z-score', 'score-1': 'y-score' } as Record<
              string,
              string
            >
          )[value] || value
        );
      if (Array.isArray(value)) return value.map(remap);
      if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, remap(child)]));
      return value;
    };
    for (const version of data.versions)
      version.snapshot = remap(version.snapshot) as QualifierStandingSnapshot;
    data.lobby.participants = remap(data.lobby.participants) as typeof data.lobby.participants;
    data.lobby.entries = remap(data.lobby.entries) as typeof data.lobby.entries;
    for (const score of data.lobby.scores)
      score.id = score.id === 'score-0' ? 'z-score' : 'y-score';
    const expectedRows = structuredClone(data.versions[2].snapshot.calculation.rows);
    const expectedSeeds = structuredClone(data.versions[2].snapshot.seeds);
    const expectedOrder = structuredClone(data.versions[2].snapshot.tieResolution);
    const result = await rebindImportedQualifierStandings(data.tx, 'tournament');
    expect(result).toEqual({ rebound: 3, skipped: 0, warnings: [] });
    const frozen = data.versions[2];
    expect(frozen.sourceHash).not.toBe(originalHash);
    expect(frozen.snapshot.importProvenance?.[0].originalSourceHash).toBe(originalHash);
    expect(frozen.snapshot.calculation.rows).toEqual(expectedRows);
    expect(frozen.snapshot.seeds).toEqual(expectedSeeds);
    expect(frozen.snapshot.tieResolution).toEqual(expectedOrder);
    expect(frozen.snapshot.calculation.sourceHash).toBe(frozen.sourceHash);
    expect((await rebindImportedQualifierStandings(data.tx, 'tournament')).rebound).toBe(0);
  });
  it('retains stale imports when formulas are unknown or any numerical source changed', async () => {
    await calculate();
    await finalize();
    data.versions[0].snapshot.calculation.calculationVersion = 'unknown/v0';
    data.lobby.scores[0].raw++;
    data.lobby.scores[0].adjusted++;
    const hashes = data.versions.map((v) => v.sourceHash);
    const result = await rebindImportedQualifierStandings(data.tx, 'tournament');
    expect(result.rebound).toBe(0);
    expect(result.skipped).toBe(2);
    expect(result.warnings.some((warning) => warning.includes('Unknown calculation'))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('differ'))).toBe(true);
    expect(data.versions.map((v) => v.sourceHash)).toEqual(hashes);
  });
});
