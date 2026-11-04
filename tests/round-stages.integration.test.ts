import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import { formatPlanSchema } from '../src/lib/format-plan';
import { loadFormatPlan } from '../src/lib/format-plan-service';
import { matchRulesSchema } from '../src/lib/match-rules';
import { newMapTypeOperations, stageGridOperations, stageRows } from '../src/lib/setup-operations';
import { setupWorkspaceData } from '../src/lib/setup-queries';
import { act, formatFixtures, type Fixture } from './fixtures/format-tournament';

const fx = formatFixtures('round-stages', 1_760_000_000);
beforeAll(fx.setup);
afterAll(fx.cleanup);

const STAGES = ['Quarterfinals', 'Semifinals', 'Finals'];
const BEST_OF: Record<string, number> = { Quarterfinals: 5, Semifinals: 7, Finals: 9 };

const bracketPlan = (f: Fixture, roundStages: Record<string, string> = {}) =>
  formatPlanSchema.parse({
    version: 1,
    phases: [
      {
        kind: 'SINGLE_ELIMINATION',
        key: 'main',
        name: 'Main bracket',
        // Deliberately the last stage: automatic mapping must not depend on this choice.
        stageId: f.stages.Finals,
        roundStages,
        size: 8,
        entries: [{ source: { kind: 'REGISTRATION', count: 8 }, seedFrom: 1 }],
      },
    ],
  });

// A different match length per stage, so a match shows which stage it really took its rules from.
async function ready(slug: string) {
  const f = await fx.fixture(slug, 8, STAGES);
  for (const name of STAGES)
    await db.tournamentStage.update({
      where: { id: f.stages[name] },
      data: {
        matchRules: JSON.parse(
          JSON.stringify(
            matchRulesSchema.parse({ teamSize: 1, bestOf: BEST_OF[name], bansPerTeam: 1 }),
          ),
        ),
      },
    });
  return f;
}
const save = async (f: Fixture, plan: unknown) =>
  act(f.actor, {
    type: 'format.plan.save',
    baseToken: (await loadFormatPlan(db, f.tournamentId)).token,
    plan,
  });
const stageOfRound = async (f: Fixture) => {
  const rounds = await db.bracketRound.findMany({ where: { tournamentId: f.tournamentId } });
  return Object.fromEntries(rounds.map((round) => [round.key, round.stageId]));
};
async function finish(f: Fixture, id: string) {
  const match = await db.match.findUniqueOrThrow({ where: { id } });
  const rules = matchRulesSchema.parse(match.rules);
  await act(f.actor, {
    type: 'match.result.set',
    id,
    baseVersion: match.version,
    scoreA: (rules.bestOf + 1) / 2,
    scoreB: 0,
    winnerSide: 'A',
    forfeitSide: null,
    externalReferee: '',
    reason: 'Played',
    confirm: true,
    approveProgression: true,
  });
}

describe.sequential('a bracket played across its stages', () => {
  let f: Fixture;

  it('assigns each round its own stage, whatever stage the plan started from', async () => {
    f = await ready('automatic');
    await fx.lock(f, bracketPlan(f));
    expect(await stageOfRound(f)).toEqual({
      'g1-r1': f.stages.Quarterfinals,
      'g1-r2': f.stages.Semifinals,
      'g1-r3': f.stages.Finals,
    });
  });

  it('gives every match the Best of and mappool of its own round’s stage', async () => {
    await fx.advance(f, { phaseKey: 'main' });
    const play = async (round: string) => {
      const nodes = await db.bracketNode.findMany({
        where: { tournamentId: f.tournamentId, round: { key: round } },
        include: { match: true },
      });
      return nodes.map((node) => node.match!);
    };
    const revisionOf = async (stageId: string) =>
      (await db.mappool.findFirstOrThrow({ where: { stageId } })).publishedRevisionId;

    const quarterfinals = await play('g1-r1');
    expect(quarterfinals).toHaveLength(4);
    for (const match of quarterfinals) {
      expect(matchRulesSchema.parse(match.rules).bestOf).toBe(5);
      expect(match.stageId).toBe(f.stages.Quarterfinals);
      expect(match.poolRevisionId).toBe(await revisionOf(f.stages.Quarterfinals));
      await finish(f, match.id);
    }
    const semifinals = await play('g1-r2');
    expect(semifinals).toHaveLength(2);
    for (const match of semifinals) {
      expect(matchRulesSchema.parse(match.rules).bestOf).toBe(7);
      expect(match.stageId).toBe(f.stages.Semifinals);
      expect(match.poolRevisionId).toBe(await revisionOf(f.stages.Semifinals));
      await finish(f, match.id);
    }
    const [final] = await play('g1-r3');
    expect(matchRulesSchema.parse(final.rules).bestOf).toBe(9);
    expect(final.stageId).toBe(f.stages.Finals);
    expect(final.poolRevisionId).toBe(await revisionOf(f.stages.Finals));
  });

  it('honours a round pointed at a different stage, keeping the rest automatic', async () => {
    const custom = await ready('override');
    await fx.lock(custom, bracketPlan(custom, { 'g1-r2': custom.stages.Finals }));
    expect(await stageOfRound(custom)).toEqual({
      'g1-r1': custom.stages.Quarterfinals,
      'g1-r2': custom.stages.Finals,
      'g1-r3': custom.stages.Finals,
    });
  });

  it('refuses a later round in an earlier stage', async () => {
    const backwards = await ready('backwards');
    await expect(
      save(backwards, bracketPlan(backwards, { 'g1-r3': backwards.stages.Quarterfinals })),
    ).rejects.toThrow('a later round cannot use an earlier stage');
  });

  it('shows the mapping before anything is locked, from the same builder', async () => {
    const shown = await ready('preview');
    const preview = (await act(shown.actor, {
      type: 'format.plan.preview',
      plan: bracketPlan(shown, { 'g1-r2': shown.stages.Finals }),
    })) as {
      phases: { rounds: { key: string; stageId: string; automaticStageId: string }[] }[];
    };
    expect(
      preview.phases[0].rounds.map((round) => [round.key, round.stageId, round.automaticStageId]),
    ).toEqual([
      ['g1-r1', shown.stages.Quarterfinals, shown.stages.Quarterfinals],
      ['g1-r2', shown.stages.Finals, shown.stages.Semifinals],
      ['g1-r3', shown.stages.Finals, shown.stages.Finals],
    ]);
  });
});

describe.sequential('deleting a stage a bracket uses', () => {
  it('moves an unlocked bracket along and forgets rounds that pointed at it', async () => {
    const f = await ready('delete-open');
    await save(f, bracketPlan(f, { 'g1-r2': f.stages.Finals }));
    await db.tournamentPhase.updateMany({
      where: { tournamentId: f.tournamentId },
      data: { stageId: f.stages.Quarterfinals },
    });
    await act(f.actor, { type: 'stage.delete', id: f.stages.Finals });
    await act(f.actor, { type: 'stage.delete', id: f.stages.Quarterfinals });
    const { plan } = await loadFormatPlan(db, f.tournamentId);
    const phase = plan!.phases[0] as { stageId: string; roundStages: Record<string, string> };
    expect(phase.stageId).toBe(f.stages.Semifinals);
    expect(phase.roundStages).toEqual({});
  });

  it('refuses once the format is locked, and for a phase naming that stage directly', async () => {
    const f = await ready('delete-locked');
    await fx.lock(f, bracketPlan(f));
    await expect(act(f.actor, { type: 'stage.delete', id: f.stages.Finals })).rejects.toThrow(
      'part of the tournament format',
    );
  });
});

describe.sequential('a map type of the tournament’s own', () => {
  it('becomes a saved column, reaching the pool plan and the rules together', async () => {
    const f = await ready('map-type');
    let data = await setupWorkspaceData(f.actor);
    await act(f.actor, { type: 'setup.apply', operations: newMapTypeOperations('RX', data) });
    data = await setupWorkspaceData(f.actor);
    expect(data.categories.at(-1)).toBe('RX');
    expect(data.rules.categoryMods.RX).toBe('RX');

    const rows = stageRows(data);
    const finals = rows.find((row) => row.name === 'Finals')!;
    expect(finals.pool).toMatchObject({ NM: 0, RX: 0 });
    finals.pool = { ...finals.pool, NM: 4, RX: 3 };
    await act(f.actor, { type: 'setup.apply', operations: stageGridOperations(rows, data) });

    const after = await setupWorkspaceData(f.actor);
    const saved = after.stages.find((stage) => stage.name === 'Finals')!;
    expect(saved.poolPlan!.slots.map((slot) => slot.name)).toEqual([
      'NM1',
      'NM2',
      'NM3',
      'NM4',
      'RX1',
      'RX2',
      'RX3',
    ]);
    expect(stageRows(after).find((row) => row.name === 'Finals')!.pool.RX).toBe(3);
  });
});
