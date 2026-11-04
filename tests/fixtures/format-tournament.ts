import { vi } from 'vitest';
import path from 'node:path';
import { executeAction } from '../../src/lib/admin-service';
import { actorForTournament } from '../../src/lib/auth';
import { db } from '../../src/lib/db';
import type { FormatPlan } from '../../src/lib/format-plan';
import { formatPlanSchema } from '../../src/lib/format-plan';
import { loadFormatPlan } from '../../src/lib/format-plan-service';
import { inheritedRules } from '../../src/lib/gameplay-scoring';
import { ALL_PERMISSIONS, type Actor } from '../../src/lib/permissions';
import { qualifierPolicySchema } from '../../src/lib/qualifier-policy';
import { applyQualifierStandingsAction } from '../../src/lib/qualifier-standings-service';
import { qualifierStandingsData } from '../../src/lib/qualifier-standings-sources';
import { tournamentAction } from '../../src/lib/tournaments-service';
import { actionSchema } from '../../src/lib/validation';
import { COMPATIBILITY_PLANS } from './format-plans';

export type Fixture = {
  actor: Actor;
  tournamentId: string;
  stages: Record<string, string>;
  teams: { id: string; name: string; osuId: number }[];
};
export type Preview = {
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
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
export const act = async (actor: Actor, input: unknown) =>
  executeAction(actor, actionSchema.parse(input));

// Real records through real services, shared so each suite tracks and removes its own.
export function formatFixtures(name: string, osuBase: number) {
  const prefix = `${name}-${Date.now()}`;
  const offset = Date.now() % 1_000_000;
  const tournamentIds: string[] = [];
  const osuIds: number[] = [];
  const beatmapIds: number[] = [];
  let owner: Actor;
  let nextOsuId = osuBase + 10_000_000 + offset;
  let nextBeatmap = osuBase + 20_000_000 + offset;
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
    const revision = await db.mappoolRevision.create({
      data: { tournamentId, mappoolId: pool.id },
    });
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

  return {
    prefix,
    tournamentIds,
    owner: () => owner,
    newPlayerId: () => {
      const osuId = nextOsuId++;
      osuIds.push(osuId);
      return osuId;
    },
    publishedStage,
    fixture,
    finalizedQualifier,
    planFor,
    lock,
    previewOf,
    advance,
    playGroups,
    setup: async () => {
      if (new URL(process.env.DATABASE_URL!).pathname !== '/tournament_platform_test')
        throw Error('Test database only.');
      vi.stubEnv('STORAGE_DRIVER', 'filesystem');
      vi.stubEnv('STORAGE_LOCAL_DIR', path.resolve('.data/transfer-test-uploads'));
      const user = await db.user.create({
        data: {
          osuId: osuBase + offset,
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
    },
    cleanup: async () => {
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
      await db.formationSession.deleteMany({ where });
      await db.resourcePurchase.deleteMany({ where });
      await db.resourceAdjustment.deleteMany({ where });
      await db.resourceItem.deleteMany({ where });
      await db.tournamentPhase.deleteMany({ where });
      await db.mappool.updateMany({
        where,
        data: { publishedRevisionId: null, draftRevisionId: null },
      });
      await db.mappoolSlot.deleteMany({ where: { revision: where } });
      await db.mappoolRevision.deleteMany({ where });
      await db.mappool.deleteMany({ where });
      await db.poolPlan.deleteMany({ where });
      await db.modCategory.deleteMany({ where });
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
    },
  };
}
