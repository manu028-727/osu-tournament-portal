import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { executeAction } from '../src/lib/admin-service';
import { actorForTournament } from '../src/lib/auth';
import { competitionEligibility } from '../src/lib/competition-service';
import { competitionData, publicCompetitionData } from '../src/lib/competition-queries';
import { db } from '../src/lib/db';
import { formatStatus } from '../src/lib/format-lifecycle-service';
import { assertPhaseSourcesCurrent } from '../src/lib/format-guards';
import type { FormatPlan } from '../src/lib/format-plan';
import { formatPlanSchema } from '../src/lib/format-plan';
import { loadFormatPlan } from '../src/lib/format-plan-service';
import { inheritedRules } from '../src/lib/gameplay-scoring';
import { ALL_PERMISSIONS, type Actor } from '../src/lib/permissions';
import { qualifierPolicySchema } from '../src/lib/qualifier-policy';
import { applyQualifierStandingsAction } from '../src/lib/qualifier-standings-service';
import { qualifierStandingsData } from '../src/lib/qualifier-standings-sources';
import { exportTournament } from '../src/lib/tournament-export';
import { importTournament, inspectArchive } from '../src/lib/tournament-import';
import { tournamentAction } from '../src/lib/tournaments-service';
import { actionSchema } from '../src/lib/validation';
import { COMPATIBILITY_PLANS } from './fixtures/format-plans';

const prefix = `lifecycle-${Date.now()}`;
const offset = Date.now() % 1_000_000;
const tournamentIds: string[] = [];
const osuIds: number[] = [];
const beatmapIds: number[] = [];
let owner: Actor;
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const act = (actor: Actor, input: unknown) => executeAction(actor, actionSchema.parse(input));

type Fixture = {
  actor: Actor;
  tournamentId: string;
  stages: Record<string, string>;
  teams: { id: string; name: string; osuId: number }[];
};

let nextOsuId = 1_720_000_000 + offset;
let nextBeatmap = 1_730_000_000 + offset;

async function publishedStage(
  tournamentId: string,
  name: string,
  kind: string,
  position: number,
  extra: object = {},
) {
  const stage = await db.tournamentStage.create({
    data: {
      tournamentId,
      name,
      slug: name.toLowerCase().replace(/\s/g, '-'),
      kind,
      position,
      ...extra,
    },
  });
  const pool = await db.mappool.create({ data: { tournamentId, stageId: stage.id } });
  const revision = await db.mappoolRevision.create({ data: { tournamentId, mappoolId: pool.id } });
  const beatmapId = nextBeatmap++;
  beatmapIds.push(beatmapId);
  const metadata = {
    id: beatmapId,
    mode: 'osu',
    title: 'Map',
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
  await db.mappoolSlot.create({
    data: {
      revisionId: revision.id,
      name: 'NM1',
      category: 'NM',
      categoryName: 'NM',
      color: '#ffffff',
      position: 0,
      beatmapId,
      metadata,
    },
  });
  await db.mappool.update({
    where: { id: pool.id },
    data: { state: 'PUBLISHED', publishedRevisionId: revision.id, draftRevisionId: revision.id },
  });
  return { id: stage.id, revisionId: revision.id };
}

async function fixture(slug: string, entrants: number, stageNames: string[]): Promise<Fixture> {
  const { id: tournamentId } = await tournamentAction(owner, {
    type: 'create',
    name: prefix,
    acronym: 'LIF',
    slug: `${prefix}-${slug}`,
    description: '',
    gameMode: 'osu',
    format: 'SOLO',
    gameplayScoring: 'SCORE_V2',
  });
  tournamentIds.push(tournamentId);
  const stages: Record<string, string> = {};
  for (const [index, name] of stageNames.entries())
    stages[name] = (
      await publishedStage(
        tournamentId,
        name,
        name === 'Group stage' ? 'GROUPS' : 'ELIMINATION',
        index + 1,
      )
    ).id;
  const teams = [];
  for (let index = 0; index < entrants; index++) {
    const osuId = nextOsuId++;
    osuIds.push(osuId);
    await db.participant.create({
      data: { osuId, username: `${prefix}-${osuId}`, avatarUrl: '' },
    });
    const team = await db.team.create({
      data: {
        tournamentId,
        name: `Entrant ${index + 1}`,
        slug: `entrant-${index + 1}`,
        status: 'APPROVED',
        published: true,
        format: 'INDIVIDUAL',
      },
    });
    await db.teamMember.create({
      data: { tournamentId, teamId: team.id, osuId, position: 0, captain: true },
    });
    teams.push({ id: team.id, name: team.name, osuId });
  }
  return { actor: { ...owner, tournamentId }, tournamentId, stages, teams };
}

// A finalized qualifier where entrant 1 is the best and scores fall in order.
async function finalizedQualifier(f: Fixture, cutoff: number) {
  const rules = inheritedRules({ teamSize: 1, multiplierMode: 'NONE' }, 'SCORE_V2');
  const policy = qualifierPolicySchema.parse({ method: 'RAW_SCORE' });
  const { id: stageId, revisionId } = await publishedStage(
    f.tournamentId,
    'Qualifiers',
    'QUALIFIERS',
    0,
    {
      qualifierPolicy: json(policy),
    },
  );
  f.stages.Qualifiers = stageId;
  // A lobby seats sixteen entrants, so a larger field shares several.
  for (let start = 0; start < f.teams.length; start += 16) {
    const seated = f.teams.slice(start, start + 16);
    const lobby = await db.qualifierLobby.create({
      data: {
        tournamentId: f.tournamentId,
        code: `${prefix}-q${start}`,
        stageId,
        poolRevisionId: revisionId,
        status: 'COMPLETED',
        rules: json(rules),
        policy: json(policy),
        gameplayScoring: 'SCORE_V2',
        participants: json(
          seated.map((team) => ({
            id: team.id,
            name: team.name,
            slug: team.name.toLowerCase().replace(' ', '-'),
            format: 'INDIVIDUAL',
            logoImageId: null,
            members: [
              {
                osuId: team.osuId,
                username: `${prefix}-${team.osuId}`,
                avatarUrl: '',
                captain: true,
                substitute: false,
              },
            ],
          })),
        ),
      },
    });
    await db.qualifierEntry.createMany({
      data: seated.map((team, position) => ({
        tournamentId: f.tournamentId,
        lobbyId: lobby.id,
        teamId: team.id,
        position,
      })),
    });
    await db.qualifierScore.createMany({
      data: seated.map((team) => {
        const raw = 900000 - f.teams.indexOf(team) * 1000;
        return {
          lobbyId: lobby.id,
          osuId: team.osuId,
          slotName: 'NM1',
          run: 1,
          raw,
          adjusted: raw,
          mods: ['NF'],
          actualScoring: 'SCORE_V2',
          representation: 'LEGACY',
          source: 'MANUAL',
          verified: true,
        };
      }),
    });
  }
  const base = async () => {
    const current = await qualifierStandingsData(f.actor, stageId);
    return {
      stageId,
      baseVersion: current.latest?.version || 0,
      sourceHash: current.preview.sourceHash,
    };
  };
  await db.$transaction(async (tx) =>
    applyQualifierStandingsAction(tx, f.actor, {
      type: 'qualifier.standings.calculate',
      ...(await base()),
    }),
  );
  const finalBase = await base();
  await db.$transaction((tx) =>
    applyQualifierStandingsAction(tx, f.actor, {
      type: 'qualifier.standings.finalize',
      ...finalBase,
      tieOrder: [],
      reason: '',
      cutoff,
    }),
  );
  return stageId;
}

function planFor(name: keyof typeof COMPATIBILITY_PLANS, f: Fixture): FormatPlan {
  const text = JSON.stringify(COMPATIBILITY_PLANS[name])
    .replaceAll('stage-qualifiers', f.stages.Qualifiers)
    .replaceAll('stage-groups', f.stages['Group stage'] ?? '')
    .replaceAll('stage-qf', f.stages.Quarterfinals ?? '')
    .replaceAll('stage-ro16', f.stages['Round of 16'] ?? '');
  return formatPlanSchema.parse(JSON.parse(text));
}

async function lock(f: Fixture, plan: FormatPlan) {
  await act(f.actor, {
    type: 'format.plan.save',
    baseToken: (await loadFormatPlan(db, f.tournamentId)).token,
    plan,
  });
  await act(f.actor, {
    type: 'format.lock',
    baseToken: (await loadFormatPlan(db, f.tournamentId)).token,
  });
}

type Preview = {
  reviewHash: string;
  randomSeed: string | null;
  issues: { code: string; severity: string }[];
  seats: { seed: number; lane: string; teamId: string | null; detail: string }[];
  groups: {
    group: number;
    label: string;
    teams: { teamId: string; seed: number; pot: number }[];
  }[];
};
const previewOf = (f: Fixture, input: object) =>
  act(f.actor, { type: 'format.advance.preview', ...input }) as Promise<Preview>;
async function advance(f: Fixture, input: Record<string, unknown>) {
  const preview = await previewOf(f, input);
  await act(f.actor, {
    type: 'format.advance',
    ...input,
    ...(preview.randomSeed ? { randomSeed: preview.randomSeed } : {}),
    reviewHash: preview.reviewHash,
  });
  return preview;
}

async function playGroups(f: Fixture, bracketId: string, seedOf: (id: string) => number) {
  const nodes = await db.bracketNode.findMany({
    where: { tournamentId: f.tournamentId, bracketId },
    include: { match: true },
  });
  for (const node of nodes) {
    const a = node.match!.teamAId!;
    const b = node.match!.teamBId!;
    await db.$executeRaw`UPDATE "Match" SET "status" = 'COMPLETED', "winnerSide" = ${seedOf(a) < seedOf(b) ? 'A' : 'B'}::"MatchSide", "scoreA" = ${seedOf(a) < seedOf(b) ? 5 : 1}, "scoreB" = ${seedOf(a) < seedOf(b) ? 1 : 5}, "completedAt" = now() WHERE "id" = ${node.match!.id}`;
  }
}

beforeAll(async () => {
  if (new URL(process.env.DATABASE_URL!).pathname !== '/tournament_platform_test')
    throw Error('Test database only.');
  vi.stubEnv('STORAGE_DRIVER', 'filesystem');
  vi.stubEnv('STORAGE_LOCAL_DIR', path.resolve('.data/transfer-test-uploads'));
  const user = await db.user.create({
    data: {
      osuId: 1_710_000_000 + offset,
      username: prefix,
      avatarUrl: '',
      profileUrl: '',
      platformAdmin: true,
    },
    include: { roles: { include: { role: { include: { permissions: true } } } } },
  });
  owner = {
    ...actorForTournament(user, 'main'),
    platformAdmin: true,
    permissions: [...ALL_PERMISSIONS],
  };
});

afterAll(async () => {
  const where = { tournamentId: { in: tournamentIds } };
  await db.tournamentPhase.updateMany({ where, data: { bracketId: null } });
  await db.bracketSlot.deleteMany({ where });
  await db.bracketNode.deleteMany({ where });
  await db.bracketRound.deleteMany({ where });
  await db.bracketEntry.deleteMany({ where });
  await db.bracket.deleteMany({ where });
  await db.match.deleteMany({ where });
  await db.qualifierStanding.deleteMany({ where });
  await db.qualifierLobby.deleteMany({ where });
  await db.tournamentPhase.deleteMany({ where });
  await db.mappool.updateMany({
    where,
    data: { publishedRevisionId: null, draftRevisionId: null },
  });
  await db.mappoolSlot.deleteMany({ where: { revision: where } });
  await db.mappoolRevision.deleteMany({ where });
  await db.mappool.deleteMany({ where });
  await db.poolPlan.deleteMany({ where });
  await db.tournamentStage.deleteMany({ where });
  await db.team.deleteMany({ where });
  await db.auditLog.deleteMany({ where });
  await db.role.deleteMany({ where });
  await db.page.deleteMany({ where });
  await db.tournament.deleteMany({ where: { id: { in: tournamentIds } } });
  await db.participant.deleteMany({ where: { osuId: { in: osuIds } } });
  await db.beatmap.deleteMany({ where: { id: { in: beatmapIds } } });
  await db.tournamentTransfer.deleteMany({ where: { initiatedBy: owner.id } });
  await db.user.deleteMany({ where: { id: owner.id } });
  vi.unstubAllEnvs();
  await db.$disconnect();
});

const STAGES = ['Group stage', 'Quarterfinals', 'Semifinals', 'Finals', 'Grand Finals'];

describe.sequential('a format running through real records', () => {
  let f: Fixture;
  let groupBracket: string;
  let mainBracket: string;
  const seedOf = (id: string) => f.teams.findIndex((team) => team.id === id) + 1;

  it('locks every phase into a bracket, numbering groups before the main bracket', async () => {
    f = await fixture('italian', 22, STAGES);
    await finalizedQualifier(f, 20);
    await lock(f, planFor('italianCup', f));
    const phases = await db.tournamentPhase.findMany({
      where: { tournamentId: f.tournamentId },
      orderBy: { position: 'asc' },
    });
    expect(phases.map((phase) => phase.state)).toEqual(['LOCKED', 'LOCKED', 'LOCKED']);
    groupBracket = phases[1].bracketId!;
    mainBracket = phases[2].bracketId!;
    const nodes = await db.bracketNode.findMany({ where: { tournamentId: f.tournamentId } });
    expect(nodes).toHaveLength(24 + 23);
    expect(nodes.every((node) => node.matchNumber !== null)).toBe(true);
    const numbers = (id: string) =>
      nodes.filter((node) => node.bracketId === id).map((node) => node.matchNumber!);
    expect(Math.max(...numbers(groupBracket))).toBeLessThan(Math.min(...numbers(mainBracket)));
    // Placeholders wait rather than reading as byes, and no match exists before entrants do.
    expect(nodes.every((node) => node.state === 'WAITING' && !node.matchId)).toBe(true);
    const slot = await db.bracketSlot.findFirstOrThrow({
      where: { tournamentId: f.tournamentId, entryRef: 'seed:1', node: { bracketId: mainBracket } },
    });
    expect(slot.entryLabel).toBe('Qualifiers #1');
    expect(slot.resolved).toBe(false);
  });

  it('refuses replanning a locked format and deleting its brackets', async () => {
    const { token, plan } = await loadFormatPlan(db, f.tournamentId);
    await expect(
      act(f.actor, { type: 'format.plan.save', baseToken: token, plan }),
    ).rejects.toThrow('locked');
    const bracket = await db.bracket.findUniqueOrThrow({ where: { id: mainBracket } });
    const preview = (await act(f.actor, {
      type: 'competition.lifecycle.preview',
      id: bracket.id,
      baseVersion: bracket.version,
      operation: 'delete',
    })) as { blocked: boolean; reasons: string[] };
    expect(preview.blocked).toBe(true);
    expect(preview.reasons.join()).toContain('Unlock the format');
  });

  it('blocks advancing into the main bracket until groups are complete', async () => {
    const preview = await previewOf(f, { phaseKey: 'main' });
    expect(preview.issues.map((issue) => issue.code)).toContain('SOURCE_NOT_READY');
    await expect(
      act(f.actor, { type: 'format.advance', phaseKey: 'main', reviewHash: preview.reviewHash }),
    ).rejects.toThrow();
  });

  it('draws groups from pots reproducibly and creates their matches', async () => {
    const preview = await previewOf(f, { phaseKey: 'groups' });
    expect(preview.randomSeed).toBeTruthy();
    expect(preview.groups).toHaveLength(4);
    for (const group of preview.groups)
      expect(group.teams.map((team) => team.pot)).toEqual([0, 1, 2, 3]);
    const again = await previewOf(f, { phaseKey: 'groups', randomSeed: preview.randomSeed });
    expect(again.groups).toEqual(preview.groups);
    await act(f.actor, {
      type: 'format.advance',
      phaseKey: 'groups',
      randomSeed: preview.randomSeed,
      reviewHash: again.reviewHash,
    });
    const entries = await db.bracketEntry.findMany({ where: { bracketId: groupBracket } });
    expect(entries).toHaveLength(16);
    // Entrants keep their real qualifier seeds, so that tiebreaker stays meaningful.
    expect(Math.min(...entries.map((entry) => entry.seed))).toBe(5);
    expect(Math.max(...entries.map((entry) => entry.seed))).toBe(20);
    expect(entries.every((entry) => entry.groupIndex !== null && entry.pot !== null)).toBe(true);
    const nodes = await db.bracketNode.findMany({
      where: { bracketId: groupBracket },
      include: { match: true },
    });
    expect(nodes.every((node) => node.state === 'READY' && node.match)).toBe(true);
    expect(new Set(nodes.map((node) => node.match!.matchNumber)).size).toBe(24);
    for (const node of nodes) expect(node.match!.matchNumber).toBe(node.matchNumber);
    const history = await db.phaseAdvancement.findFirstOrThrow({
      where: { tournamentId: f.tournamentId, kind: 'ENTRIES' },
    });
    expect((history.assignment as { randomSeed: string }).randomSeed).toBe(preview.randomSeed);
  });

  it('refuses a review made against a different draw', async () => {
    const preview = await previewOf(f, { phaseKey: 'groups' });
    const other = await previewOf(f, { phaseKey: 'groups', randomSeed: 'something-else' });
    await expect(
      act(f.actor, {
        type: 'format.advance',
        phaseKey: 'groups',
        randomSeed: other.randomSeed,
        reviewHash: preview.reviewHash,
      }),
    ).rejects.toThrow('Preview this phase again');
  });

  it('routes group placements into the right lanes with one life in Losers', async () => {
    await playGroups(f, groupBracket, seedOf);
    const preview = await previewOf(f, { phaseKey: 'main' });
    expect(preview.issues.filter((issue) => issue.severity === 'ERROR')).toEqual([]);
    await act(f.actor, {
      type: 'format.advance',
      phaseKey: 'main',
      reviewHash: preview.reviewHash,
    });
    const entries = await db.bracketEntry.findMany({
      where: { bracketId: mainBracket },
      orderBy: { seed: 'asc' },
    });
    expect(entries).toHaveLength(16);
    expect(entries.slice(0, 4).map((entry) => seedOf(entry.teamId))).toEqual([1, 2, 3, 4]);
    expect(entries.filter((entry) => entry.entryLane === 'WINNERS')).toHaveLength(8);
    const losers = entries.filter((entry) => entry.entryLane === 'LOSERS');
    expect(losers).toHaveLength(8);
    expect(losers.every((entry) => entry.lossesAllowed === 1)).toBe(true);
    // Eight matches are ready at once: four in Winners and four in Losers.
    const ready = await db.bracketNode.findMany({
      where: { bracketId: mainBracket, state: 'READY' },
    });
    expect(ready).toHaveLength(8);
    const eliminated = await db.bracketEntry.findMany({ where: { bracketId: mainBracket } });
    expect(eliminated.some((entry) => seedOf(entry.teamId) === 22)).toBe(false);
  });

  it('never pairs entrants who shared a group in the Losers opening round', async () => {
    const groups = await db.bracketEntry.findMany({ where: { bracketId: groupBracket } });
    const groupOf = (teamId: string) => groups.find((entry) => entry.teamId === teamId)?.groupIndex;
    const opening = await db.bracketNode.findMany({
      where: { bracketId: mainBracket, round: { key: 'g2-r1' } },
      include: { slots: true },
    });
    expect(opening).toHaveLength(4);
    for (const node of opening) {
      const [a, b] = node.slots.map((slot) => slot.teamId!);
      expect(groupOf(a)).not.toBe(groupOf(b));
    }
  });

  it('shows named placeholders publicly without exposing configuration', async () => {
    const bracket = await db.bracket.findUniqueOrThrow({ where: { id: mainBracket } });
    await db.bracket.update({ where: { id: bracket.id }, data: { published: true } });
    await db.tournament.update({ where: { id: f.tournamentId }, data: { published: true } });
    const brackets = await publicCompetitionData(f.tournamentId);
    const main = brackets.find((item) => item.id === mainBracket)!;
    expect(JSON.stringify(main)).not.toContain('phaseKey');
    expect(JSON.stringify(main)).not.toContain('sourceStandingIds');
    expect(main).not.toHaveProperty('configuration');
    expect(main.nodes[0].slots[0]).not.toHaveProperty('entryRef');
  });

  it('allows a source correction before downstream play, then requires re-advancing', async () => {
    const node = await db.bracketNode.findFirstOrThrow({
      where: { bracketId: groupBracket },
      include: { match: true },
    });
    await expect(
      assertPhaseSourcesCurrent(db, f.tournamentId, mainBracket),
    ).resolves.toBeUndefined();
    // Keeps the winner but always changes the score, whichever side won.
    await db.match.update({
      where: { id: node.match!.id },
      data: node.match!.scoreA === 5 ? { scoreA: 5, scoreB: 2 } : { scoreA: 2, scoreB: 5 },
    });
    await expect(assertPhaseSourcesCurrent(db, f.tournamentId, mainBracket)).rejects.toThrow(
      'advance its entrants again',
    );
    const status = await formatStatus(db, f.tournamentId);
    expect(status?.phases.find((phase) => phase.key === 'main')?.stale).toBe(true);
    const preview = await previewOf(f, { phaseKey: 'main' });
    await act(f.actor, {
      type: 'format.advance',
      phaseKey: 'main',
      reviewHash: preview.reviewHash,
    });
    await expect(
      assertPhaseSourcesCurrent(db, f.tournamentId, mainBracket),
    ).resolves.toBeUndefined();
    const revisions = await db.phaseAdvancement.findMany({
      where: { phase: { key: 'main', tournamentId: f.tournamentId } },
    });
    expect(revisions.map((row) => row.revision).sort()).toEqual([1, 2]);
    expect(
      (await formatStatus(db, f.tournamentId))?.phases.find((p) => p.key === 'main')?.stale,
    ).toBe(false);
  });

  it('eliminates a Losers-only entrant after one loss', async () => {
    const node = await db.bracketNode.findFirstOrThrow({
      where: { bracketId: mainBracket, round: { key: 'g2-r1' } },
      include: { match: true, slots: true },
    });
    const loser = node.slots.find((slot) => slot.side === 'B')!.teamId!;
    await db.$executeRaw`UPDATE "Match" SET "status" = 'COMPLETED', "winnerSide" = 'A'::"MatchSide", "scoreA" = 5, "scoreB" = 1, "completedAt" = now(), "startedAt" = now() WHERE "id" = ${node.match!.id}`;
    const eligibility = await db.$transaction((tx) =>
      competitionEligibility(tx, f.tournamentId, mainBracket, loser),
    );
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reason).toContain('eliminated');
  });

  it('blocks changing entrants or unlocking once a phase has been played', async () => {
    await expect(previewOf(f, { phaseKey: 'main' })).rejects.toThrow('has started');
    const { token } = await loadFormatPlan(db, f.tournamentId);
    await expect(act(f.actor, { type: 'format.unlock', baseToken: token })).rejects.toThrow(
      'can no longer be unlocked',
    );
  });

  it('round-trips a running format through an archive with sources still current', async () => {
    const { bytes } = await exportTournament(f.actor, 'https://source.example');
    const { archive } = await inspectArchive(bytes);
    const { tournamentId } = await importTournament(owner, archive, `${prefix}-imported`);
    tournamentIds.push(tournamentId);
    const phases = await db.tournamentPhase.findMany({
      where: { tournamentId },
      orderBy: { position: 'asc' },
    });
    expect(phases.map((phase) => phase.key)).toEqual(['qualifiers', 'groups', 'main']);
    expect(phases[2].bracketId).toBeTruthy();
    expect(phases[2].bracketId).not.toBe(mainBracket);
    const copied = await db.phaseAdvancement.count({ where: { tournamentId } });
    expect(copied).toBe(3);
    const slot = await db.bracketSlot.findFirstOrThrow({
      where: { tournamentId, entryRef: 'seed:1', node: { bracketId: phases[2].bracketId! } },
    });
    expect(slot.entryLabel).toBe('Qualifiers #1');
    const entry = await db.bracketEntry.findFirstOrThrow({
      where: { tournamentId, bracketId: phases[2].bracketId!, entryLane: 'LOSERS' },
    });
    expect(entry.lossesAllowed).toBe(1);
    await expect(
      assertPhaseSourcesCurrent(db, tournamentId, phases[2].bracketId!),
    ).resolves.toBeUndefined();
    expect(await db.tournament.findUniqueOrThrow({ where: { id: tournamentId } })).toMatchObject({
      published: false,
    });
  });
});

describe.sequential('other shapes through real records', () => {
  it('runs a registration-only bracket with byes for the best seeds', async () => {
    const f = await fixture('plain', 6, ['Quarterfinals', 'Semifinals', 'Finals']);
    const plan = formatPlanSchema.parse({
      version: 1,
      phases: [
        {
          kind: 'SINGLE_ELIMINATION',
          key: 'main',
          name: 'Bracket',
          stageId: f.stages.Quarterfinals,
          size: 8,
          entries: [{ source: { kind: 'REGISTRATION', count: 8 }, seedFrom: 1 }],
        },
      ],
    });
    for (const [index, team] of f.teams.entries())
      await db.team.update({ where: { id: team.id }, data: { seed: index + 1 } });
    await lock(f, plan);
    const preview = await advance(f, { phaseKey: 'main' });
    expect(preview.issues.map((issue) => issue.code)).toEqual([
      'NOT_ENOUGH_ENTRANTS',
      'NOT_ENOUGH_ENTRANTS',
    ]);
    const row = await db.tournamentPhase.findFirstOrThrow({
      where: { tournamentId: f.tournamentId, key: 'main' },
    });
    const byes = await db.bracketNode.findMany({
      where: { bracketId: row.bracketId!, state: 'BYE' },
      include: { slots: true },
    });
    expect(byes).toHaveLength(2);
    const seeds = byes.map((node) => {
      const team = node.slots.find((slot) => slot.teamId)!.teamId!;
      return f.teams.findIndex((item) => item.id === team) + 1;
    });
    expect(seeds.sort()).toEqual([1, 2]);
  });

  it('settles an impossible case by a recorded staff decision', async () => {
    const f = await fixture('override', 4, ['Quarterfinals', 'Semifinals', 'Finals']);
    const plan = formatPlanSchema.parse({
      version: 1,
      phases: [
        {
          kind: 'SINGLE_ELIMINATION',
          key: 'main',
          name: 'Bracket',
          stageId: f.stages.Quarterfinals,
          size: 4,
          entries: [{ source: { kind: 'REGISTRATION', count: 4 }, seedFrom: 1 }],
        },
      ],
    });
    await lock(f, plan);
    const overrides = { '1': f.teams[3].id, '4': f.teams[0].id };
    const preview = await previewOf(f, { phaseKey: 'main', overrides });
    await expect(
      act(f.actor, {
        type: 'format.advance',
        phaseKey: 'main',
        overrides,
        reviewHash: preview.reviewHash,
      }),
    ).rejects.toThrow('Explain why');
    await act(f.actor, {
      type: 'format.advance',
      phaseKey: 'main',
      overrides,
      reason: 'Seed swap agreed by the hosts',
      reviewHash: preview.reviewHash,
    });
    const history = await db.phaseAdvancement.findFirstOrThrow({
      where: { tournamentId: f.tournamentId },
    });
    expect(history.reason).toBe('Seed swap agreed by the hosts');
    const duplicate = await previewOf(f, {
      phaseKey: 'main',
      overrides: { '1': f.teams[1].id },
    });
    expect(duplicate.issues.map((issue) => issue.code)).toContain('DUPLICATE_ENTRANT');
  });

  it('unlocks an unplayed format, freeing its numbers and letting it be replanned', async () => {
    const f = await fixture('unlock', 4, ['Quarterfinals', 'Semifinals', 'Finals']);
    const plan = formatPlanSchema.parse({
      version: 1,
      phases: [
        {
          kind: 'SINGLE_ELIMINATION',
          key: 'main',
          name: 'Bracket',
          stageId: f.stages.Quarterfinals,
          size: 4,
          entries: [{ source: { kind: 'REGISTRATION', count: 4 }, seedFrom: 1 }],
        },
      ],
    });
    await lock(f, plan);
    await advance(f, { phaseKey: 'main' });
    expect(await db.match.count({ where: { tournamentId: f.tournamentId } })).toBe(2);
    const { token } = await loadFormatPlan(db, f.tournamentId);
    await act(f.actor, { type: 'format.unlock', baseToken: token });
    expect(await db.bracket.count({ where: { tournamentId: f.tournamentId } })).toBe(0);
    expect(await db.match.count({ where: { tournamentId: f.tournamentId } })).toBe(0);
    const tournament = await db.tournament.findUniqueOrThrow({ where: { id: f.tournamentId } });
    expect(tournament.matchNumberSequence).toBe(0);
    const after = await loadFormatPlan(db, f.tournamentId);
    expect(after.locked).toBe(false);
    await act(f.actor, { type: 'format.plan.save', baseToken: after.token, plan });
  });

  it('reseeds playoffs from the surviving seeds, not the original tree', async () => {
    const f = await fixture('reseed', 8, ['Quarterfinals', 'Semifinals', 'Finals']);
    const plan = formatPlanSchema.parse({
      version: 1,
      phases: [
        {
          kind: 'SINGLE_ELIMINATION',
          key: 'main',
          name: 'Bracket',
          stageId: f.stages.Quarterfinals,
          size: 8,
          reseed: 'EACH_ROUND',
          entries: [{ source: { kind: 'REGISTRATION', count: 8 }, seedFrom: 1 }],
        },
      ],
    });
    for (const [index, team] of f.teams.entries())
      await db.team.update({ where: { id: team.id }, data: { seed: index + 1 } });
    await lock(f, plan);
    await advance(f, { phaseKey: 'main' });
    await expect(act(f.actor, { type: 'format.reseed', phaseKey: 'main' })).rejects.toThrow(
      'Complete the previous round',
    );
    const row = await db.tournamentPhase.findFirstOrThrow({
      where: { tournamentId: f.tournamentId, key: 'main' },
    });
    const opening = await db.bracketNode.findMany({
      where: { bracketId: row.bracketId!, round: { key: 'g1-r1' } },
      include: { match: true },
    });
    // Upsets leave seeds 1, 3, 5 and 7. The original tree would pair 1 with 5 and 3 with 7.
    const survivors = new Set([1, 3, 5, 7]);
    const seedOf = (id: string) => f.teams.findIndex((team) => team.id === id) + 1;
    for (const node of opening) {
      const winner = survivors.has(seedOf(node.match!.teamAId!)) ? 'A' : 'B';
      await db.$executeRaw`UPDATE "Match" SET "status" = 'COMPLETED', "winnerSide" = ${winner}::"MatchSide", "scoreA" = ${winner === 'A' ? 5 : 1}, "scoreB" = ${winner === 'B' ? 5 : 1}, "completedAt" = now(), "startedAt" = now() WHERE "id" = ${node.match!.id}`;
    }
    const result = (await act(f.actor, { type: 'format.reseed', phaseKey: 'main' })) as {
      pairs: string[][];
    };
    expect(result.pairs.map((pair) => pair.map(seedOf))).toEqual([
      [1, 7],
      [3, 5],
    ]);
    const semis = await db.bracketNode.findMany({
      where: { bracketId: row.bracketId!, round: { key: 'g1-r2' } },
      include: { match: true },
      orderBy: { position: 'asc' },
    });
    expect(semis.every((node) => node.state === 'READY' && node.match)).toBe(true);
    expect(seedOf(semis[0].match!.teamBId!)).toBe(7);
  });

  it('round-trips a locked format before anyone has entered it', async () => {
    const f = await fixture('locked-archive', 4, ['Quarterfinals', 'Semifinals', 'Finals']);
    await lock(
      f,
      formatPlanSchema.parse({
        version: 1,
        phases: [
          {
            kind: 'SINGLE_ELIMINATION',
            key: 'main',
            name: 'Bracket',
            stageId: f.stages.Quarterfinals,
            size: 4,
            entries: [{ source: { kind: 'REGISTRATION', count: 4 }, seedFrom: 1 }],
          },
        ],
      }),
    );
    const { bytes } = await exportTournament(f.actor, 'https://source.example');
    const { archive } = await inspectArchive(bytes);
    const { tournamentId } = await importTournament(owner, archive, `${f.tournamentId}-copy`);
    tournamentIds.push(tournamentId);
    const nodes = await db.bracketNode.findMany({ where: { tournamentId } });
    expect(nodes).toHaveLength(3);
    expect(nodes.every((node) => node.state === 'WAITING')).toBe(true);
    const copy = { ...f, tournamentId, actor: { ...f.actor, tournamentId } };
    const preview = await previewOf(copy, { phaseKey: 'main' });
    expect(preview.seats).toHaveLength(4);
  });

  it('keeps ordinary brackets working with no phase at all', async () => {
    const f = await fixture('ordinary', 4, ['Quarterfinals']);
    const created = (await act(f.actor, {
      type: 'competition.create',
      name: 'Plain',
      format: 'SINGLE_ELIMINATION',
      stageId: f.stages.Quarterfinals,
      teamIds: f.teams.map((team) => team.id),
      generationKey: `${prefix}-plain`,
      byePlacement: 'TOP_SEEDS',
    })) as { id: string };
    await expect(
      assertPhaseSourcesCurrent(db, f.tournamentId, created.id),
    ).resolves.toBeUndefined();
    const data = await competitionData(f.actor);
    expect(data.brackets[0].configuration).not.toHaveProperty('phaseKey');
    expect(await formatStatus(db, f.tournamentId)).toBeNull();
  });
});
