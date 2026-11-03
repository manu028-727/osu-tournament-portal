import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executeAction } from '../src/lib/admin-service';
import { actorForTournament } from '../src/lib/auth';
import { db } from '../src/lib/db';
import {
  buildTemplate,
  DEFAULT_TEMPLATE_CHOICES,
  poolPlanSlots,
} from '../src/lib/format-templates';
import { loadFormatPlan } from '../src/lib/format-plan-service';
import { rulesHash } from '../src/lib/match-record';
import { matchRulesSchema } from '../src/lib/match-rules';
import type { Actor } from '../src/lib/permissions';
import { stageGridOperations, stageRows } from '../src/lib/setup-operations';
import { setupWorkspaceData } from '../src/lib/setup-queries';
import { tournamentAction } from '../src/lib/tournaments-service';
import { actionSchema } from '../src/lib/validation';

const prefix = `setup-${Date.now()}`;
const tournamentIds: string[] = [];
const userIds: string[] = [];
let owner: Actor;
const act = (actor: Actor, input: unknown) => executeAction(actor, actionSchema.parse(input));

async function createTournament(slug: string) {
  const { id } = await tournamentAction(owner, {
    type: 'create',
    name: prefix,
    acronym: 'SET',
    slug: `${prefix}-${slug}`,
    description: '',
    gameMode: 'osu',
    format: 'TEAMS',
    gameplayScoring: 'SCORE_V2',
  });
  tournamentIds.push(id);
  return { ...owner, tournamentId: id };
}

// The same operations the workspace sends when a template is applied.
function templateOperations(token: string, defaults: unknown) {
  const built = buildTemplate(DEFAULT_TEMPLATE_CHOICES);
  const rules = matchRulesSchema.parse(defaults);
  return [
    ...built.stages.flatMap((stage, position) => [
      {
        type: 'stage.save',
        ref: stage.ref,
        name: stage.name,
        slug: stage.ref,
        description: '',
        position,
        startsAt: null,
        kind: stage.kind,
        ...(stage.kind === 'QUALIFIERS'
          ? { qualifierPolicy: { method: 'Z_SUM', requiredPlayers: 2 } }
          : { matchRules: { ...rules, bestOf: stage.bestOf, bansPerTeam: stage.bansPerTeam } }),
      },
      {
        type: 'pooling.plan.save',
        stageId: `ref:${stage.ref}`,
        slots: poolPlanSlots(stage.pool),
        minStars: stage.minStars,
        maxStars: stage.maxStars,
        baseVersion: null,
      },
    ]),
    { type: 'format.plan.save', baseToken: token, plan: built.plan },
  ];
}

beforeAll(async () => {
  if (new URL(process.env.DATABASE_URL!).pathname !== '/tournament_platform_test')
    throw Error('Test database only.');
  const user = await db.user.create({
    data: {
      osuId: 970000001 + (Date.now() % 1_000_000),
      username: prefix,
      avatarUrl: '',
      profileUrl: '',
      platformAdmin: true,
    },
    include: { roles: { include: { role: { include: { permissions: true } } } } },
  });
  userIds.push(user.id);
  owner = actorForTournament(user, 'main');
});

afterAll(async () => {
  const where = { tournamentId: { in: tournamentIds } };
  await db.tournamentPhase.deleteMany({ where });
  await db.mappool.updateMany({
    where,
    data: { publishedRevisionId: null, draftRevisionId: null },
  });
  await db.poolPlan.deleteMany({ where });
  await db.mappool.deleteMany({ where });
  await db.tournamentStage.deleteMany({ where });
  await db.auditLog.deleteMany({ where });
  await db.role.deleteMany({ where });
  await db.tournament.deleteMany({ where: { id: { in: tournamentIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
});

describe.sequential('one composite setup save', () => {
  it('applies a whole template atomically and resolves new stage references', async () => {
    const actor = await createTournament('apply');
    const before = await setupWorkspaceData(actor);
    const result = (await act(actor, {
      type: 'setup.apply',
      operations: templateOperations(before.planToken, before.rules),
    })) as { refs: Record<string, string> };
    const stages = await db.tournamentStage.findMany({
      where: { tournamentId: actor.tournamentId! },
      orderBy: { position: 'asc' },
    });
    expect(stages.map((stage) => stage.name)).toEqual([
      'Qualifiers',
      'Round of 16',
      'Quarterfinals',
      'Semifinals',
      'Finals',
      'Grand Finals',
    ]);
    const plan = await loadFormatPlan(db, actor.tournamentId!);
    expect(plan.plan?.phases.map((phase) => phase.kind)).toEqual([
      'QUALIFIER',
      'DOUBLE_ELIMINATION',
    ]);
    expect(plan.rows[0].stageId).toBe(result.refs['ref:qualifiers']);
    expect(plan.rows[1].stageId).toBe(result.refs['ref:round-of-16']);
    const after = await setupWorkspaceData(actor);
    expect(after.plan).not.toBeNull();
    expect(after.stages[1].poolPlan?.slots).toHaveLength(13);
    expect(after.readiness.find((item) => item.id === 'stages')?.done).toBe(true);
    expect(after.readiness.find((item) => item.id === 'format')?.done).toBe(true);
    expect(after.readiness.find((item) => item.id === 'pools')?.done).toBe(false);
  });

  it('rolls everything back when one operation fails', async () => {
    const actor = await createTournament('rollback');
    const before = await setupWorkspaceData(actor);
    const operations = templateOperations(before.planToken, before.rules);
    operations[operations.length - 1] = {
      type: 'format.plan.save',
      baseToken: '0'.repeat(64),
      plan: buildTemplate(DEFAULT_TEMPLATE_CHOICES).plan,
    };
    await expect(act(actor, { type: 'setup.apply', operations })).rejects.toThrow('format changed');
    expect(await db.tournamentStage.count({ where: { tournamentId: actor.tournamentId! } })).toBe(
      0,
    );
    expect(await db.tournamentPhase.count({ where: { tournamentId: actor.tournamentId! } })).toBe(
      0,
    );
  });

  it('rejects a stale format plan, but not a plan based on the current token', async () => {
    const actor = await createTournament('stale');
    const before = await setupWorkspaceData(actor);
    await act(actor, {
      type: 'setup.apply',
      operations: templateOperations(before.planToken, before.rules),
    });
    const current = await setupWorkspaceData(actor);
    const change = (baseToken: string) =>
      act(actor, {
        type: 'format.plan.save',
        baseToken,
        plan: current.plan,
      });
    await expect(change(before.planToken)).rejects.toThrow('format changed');
    await change(current.planToken);
  });

  it('refuses a plan reading a stage of the wrong kind or another tournament', async () => {
    const actor = await createTournament('kinds');
    const other = await createTournament('foreign');
    const data = await setupWorkspaceData(actor);
    await act(actor, {
      type: 'setup.apply',
      operations: templateOperations(data.planToken, data.rules),
    });
    const current = await setupWorkspaceData(actor);
    const elimination = current.stages.find((stage) => stage.name === 'Finals')!;
    const qualifier = current.stages.find((stage) => stage.kind === 'QUALIFIERS')!;
    const swap = (plan: unknown, from: string, to: string) =>
      JSON.parse(JSON.stringify(plan).replaceAll(from, to));
    await expect(
      act(actor, {
        type: 'format.plan.save',
        baseToken: current.planToken,
        plan: swap(current.plan, qualifier.id, elimination.id),
      }),
    ).rejects.toThrow('needs a {1} stage'.replace('{1}', 'qualifier'));
    const foreign = await db.tournamentStage.create({
      data: { tournamentId: other.tournamentId!, name: 'X', slug: 'x', kind: 'QUALIFIERS' },
    });
    await expect(
      act(actor, {
        type: 'format.plan.save',
        baseToken: current.planToken,
        plan: swap(current.plan, qualifier.id, foreign.id),
      }),
    ).rejects.toThrow('no longer exists');
  });

  it('protects a stage in the format from deletion', async () => {
    const actor = await createTournament('delete');
    const data = await setupWorkspaceData(actor);
    await act(actor, {
      type: 'setup.apply',
      operations: templateOperations(data.planToken, data.rules),
    });
    const stage = await db.tournamentPhase.findFirstOrThrow({
      where: { tournamentId: actor.tournamentId! },
    });
    await expect(act(actor, { type: 'stage.delete', id: stage.stageId })).rejects.toThrow(
      'part of the tournament format',
    );
  });

  it('checks each operation against its own permission', async () => {
    const actor = await createTournament('permission');
    const limited: Actor = { ...actor, platformAdmin: false, permissions: ['settings.manage'] };
    const data = await setupWorkspaceData(actor);
    await expect(
      executeAction(
        limited,
        actionSchema.parse({
          type: 'setup.apply',
          operations: [
            {
              type: 'format.plan.save',
              baseToken: data.planToken,
              plan: { version: 1, phases: [] },
            },
          ],
        }),
      ),
    ).rejects.toThrow();
    expect(await db.tournamentPhase.count({ where: { tournamentId: actor.tournamentId! } })).toBe(
      0,
    );
  });

  it('refuses a stage reference belonging to another tournament in a pool plan', async () => {
    const actor = await createTournament('cross');
    const other = await createTournament('cross-other');
    const foreign = await db.tournamentStage.create({
      data: { tournamentId: other.tournamentId!, name: 'Y', slug: 'y', kind: 'ELIMINATION' },
    });
    await expect(
      act(actor, {
        type: 'setup.apply',
        operations: [
          {
            type: 'pooling.plan.save',
            stageId: foreign.id,
            slots: [],
            minStars: null,
            maxStars: null,
            baseVersion: null,
          },
        ],
      }),
    ).rejects.toThrow('Stage not found');
  });

  it('saves the stage grid, changing only what was edited', async () => {
    const actor = await createTournament('grid');
    const data = await setupWorkspaceData(actor);
    await act(actor, {
      type: 'setup.apply',
      operations: templateOperations(data.planToken, data.rules),
    });
    const current = await setupWorkspaceData(actor);
    const rows = stageRows(current);
    const finals = rows.find((row) => row.name === 'Finals')!;
    finals.bestOf = 15;
    finals.pool = { ...finals.pool, DT: 7 };
    const operations = stageGridOperations(rows, current);
    await act(actor, { type: 'setup.apply', operations });
    const after = await setupWorkspaceData(actor);
    const saved = after.stages.find((stage) => stage.name === 'Finals')!;
    expect(saved.matchRules?.bestOf).toBe(15);
    expect(saved.poolPlan?.slots.filter((slot) => slot.category === 'DT')).toHaveLength(7);
    // Only the changed row gets a new pool plan version.
    expect(operations.filter((operation) => operation.type === 'pooling.plan.save')).toHaveLength(
      1,
    );
    await expect(act(actor, { type: 'setup.apply', operations })).rejects.toThrow('changed');
  });

  it('remembers dismissed optional checklist items', async () => {
    const actor = await createTournament('dismiss');
    await act(actor, { type: 'setup.state', dismissed: ['staff'] });
    const data = await setupWorkspaceData(actor);
    expect(data.readiness.find((item) => item.id === 'staff')?.done).toBe(true);
    expect(rulesHash(null)).toHaveLength(64);
  });
});
