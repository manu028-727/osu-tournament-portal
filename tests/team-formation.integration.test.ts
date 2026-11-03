import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { competitionData, competitionEligibilityOptions } from '../src/lib/competition-queries';
import { db } from '../src/lib/db';
import { formatPlanSchema } from '../src/lib/format-plan';
import { loadFormatPlan } from '../src/lib/format-plan-service';
import { matchOptions } from '../src/lib/match-queries';
import { ALL_PERMISSIONS, type Actor, type PermissionKey } from '../src/lib/permissions';
import { applyQualifierStandingsAction } from '../src/lib/qualifier-standings-service';
import {
  qualifierCorrectionImpact,
  qualifierStandingsData,
} from '../src/lib/qualifier-standings-sources';
import { applyRegistration, registrationData } from '../src/lib/registration-service';
import { registrationActionSchema } from '../src/lib/registration-policy';
import { publicResources } from '../src/lib/resource-service';
import { setupWorkspaceData } from '../src/lib/setup-queries';
import { publicTeamFormation } from '../src/lib/team-formation-service';
import { exportTournament } from '../src/lib/tournament-export';
import { importTournament, inspectArchive } from '../src/lib/tournament-import';
import { act, formatFixtures, type Fixture } from './fixtures/format-tournament';

const fx = formatFixtures('formation', 1_750_000_000);
beforeAll(fx.setup);
afterAll(fx.cleanup);

const STAGES = ['Semifinals', 'Finals', 'Grand Finals'];

const plan = (f: Fixture, formation: object, entries?: object[]) =>
  formatPlanSchema.parse({
    version: 1,
    phases: [
      {
        kind: 'QUALIFIER',
        key: 'qualifiers',
        name: 'Qualifiers',
        stageId: f.stages.Qualifiers,
        entrantUnit: 'INDIVIDUAL_PLAYER',
        advance: null,
      },
      {
        kind: 'TEAM_FORMATION',
        key: 'formation',
        name: 'Captain auction',
        entries: [{ source: { kind: 'ALL', phase: 'qualifiers' }, seedFrom: 1 }],
        teamCount: 2,
        rosterSize: 3,
        ...formation,
      },
      {
        kind: 'SINGLE_ELIMINATION',
        key: 'main',
        name: 'Main bracket',
        stageId: f.stages.Finals,
        size: 2,
        entries: entries ?? [{ source: { kind: 'ALL', phase: 'formation' }, seedFrom: 1 }],
      },
    ],
  });
const auction = {
  method: 'AUCTION',
  captains: 'MANUAL',
  auction: { budget: 1000, minimumRaise: 100, lotOrder: 'SEED', reserveFillPrice: 200 },
};

async function board(f: Fixture) {
  return (await setupWorkspaceData(f.actor)).formation[0];
}
type Session = NonNullable<Awaited<ReturnType<typeof board>>['session']>;
async function session(f: Fixture): Promise<Session> {
  return (await board(f)).session!;
}
const lotFor = (s: Session, index: number) => s.lots.filter((lot) => !lot.captain)[index];
const step = async (f: Fixture, input: object) => {
  const s = await session(f);
  return act(f.actor, { sessionId: s.id, baseVersion: s.version, ...input });
};

// Six players and two captains chosen by hand, ready for a board to start.
async function ready(slug: string, formation: object = auction, entrants = 8) {
  const f = await fx.fixture(slug, entrants, STAGES);
  await fx.finalizedQualifier(f, entrants);
  await fx.lock(f, plan(f, formation));
  return f;
}
const start = (f: Fixture, captains: number[] = [0, 1]) =>
  act(f.actor, {
    type: 'formation.start',
    phaseKey: 'formation',
    captainTeamIds: captains.map((index) => f.teams[index].id),
  });
const sell = async (f: Fixture, index: number, teamIndex: number, price: number) => {
  const s = await session(f);
  return step(f, {
    type: 'formation.assign',
    lotId: lotFor(s, index).id,
    formationTeamId: s.teams[teamIndex].id,
    price,
  });
};

describe.sequential('an auction run from the board', () => {
  let f: Fixture;

  it('needs closed registration and finalized standings before it can start', async () => {
    const early = await fx.fixture('early', 8, STAGES);
    await fx.finalizedQualifier(early, 8);
    await db.tournament.update({
      where: { id: early.tournamentId },
      data: { status: 'REGISTRATIONS_OPEN' },
    });
    await fx.lock(early, plan(early, auction));
    await expect(start(early)).rejects.toThrow('Close registration');
    await db.tournament.update({ where: { id: early.tournamentId }, data: { status: 'UPCOMING' } });
    await db.qualifierStanding.deleteMany({ where: { tournamentId: early.tournamentId } });
    await expect(start(early)).rejects.toThrow('Finalize Qualifiers');
  });

  it('refuses the wrong number of captains, then seats everyone else on the board', async () => {
    f = await ready('auction');
    await expect(start(f, [0])).rejects.toThrow('exactly 2 captains');
    await start(f);
    const s = await session(f);
    expect(s.state).toBe('OPEN');
    expect(s.teams.map((team) => team.name)).toEqual(
      [0, 1].map((index) => `Team ${fx.prefix}-${f.teams[index].osuId}`),
    );
    expect(s.teams.every((team) => team.moneyLeft === 1000 && team.seatsLeft === 2)).toBe(true);
    expect(s.lots.filter((lot) => lot.captain)).toHaveLength(2);
    expect(s.lots.filter((lot) => !lot.captain)).toHaveLength(6);
    await expect(start(f)).rejects.toThrow('already started');
    const settings = await db.tournamentSettings.findUniqueOrThrow({
      where: { tournamentId: f.tournamentId },
    });
    expect(settings.registrationPolicy).toMatchObject({ rosterLocked: true });
    expect(settings.navigation).toEqual(
      expect.arrayContaining([{ label: 'Team formation', href: '/team-formation' }]),
    );
  });

  it('moves nobody until confirmation', async () => {
    await sell(f, 0, 0, 300);
    const lot = lotFor(await session(f), 0);
    const member = await db.teamMember.findUniqueOrThrow({
      where: { tournamentId_osuId: { tournamentId: f.tournamentId, osuId: lot.osuId } },
    });
    expect(f.teams.some((team) => team.id === member.teamId)).toBe(true);
    expect(await db.team.count({ where: { tournamentId: f.tournamentId, format: 'TEAM' } })).toBe(
      0,
    );
  });

  it('holds a sale to the minimum raise, the budget and the seats left', async () => {
    await expect(sell(f, 1, 0, 50)).rejects.toThrow('minimum raise');
    await expect(sell(f, 1, 0, 800)).rejects.toThrow('cannot afford');
    await expect(sell(f, 0, 1, 300)).rejects.toThrow('already has a team');
    await sell(f, 1, 0, 700);
    expect((await session(f)).teams[0]).toMatchObject({ moneyLeft: 0, seatsLeft: 0 });
    await expect(sell(f, 2, 0, 100)).rejects.toThrow('already full');
  });

  it('refuses a form that went stale while another operator sold a player', async () => {
    const s = await session(f);
    await sell(f, 2, 1, 200);
    await expect(
      act(f.actor, {
        type: 'formation.reserve',
        sessionId: s.id,
        baseVersion: s.version,
        lotId: lotFor(s, 3).id,
      }),
    ).rejects.toThrow('board changed');
  });

  it('can undo a sale, which gives the money back and keeps a record', async () => {
    const before = await session(f);
    const lot = lotFor(before, 2);
    await step(f, { type: 'formation.unassign', lotId: lot.id, reason: 'Wrong player typed' });
    const after = await session(f);
    expect(after.teams[1].moneyLeft).toBe(1000);
    expect(lotFor(after, 2).state).toBe('WAITING');
    const events = await db.formationEvent.findMany({
      where: { sessionId: after.id, kind: 'UNASSIGN' },
    });
    expect(events).toMatchObject([{ reason: 'Wrong player typed' }]);
    expect(events[0].data).toMatchObject({ osuId: lot.osuId, price: 200 });
  });

  it('fills open seats from the reserves only after everyone was offered', async () => {
    await expect(step(f, { type: 'formation.fill' })).rejects.toThrow('Offer every player');
    const s = await session(f);
    for (const lot of s.lots.filter((item) => item.state === 'WAITING'))
      await step(f, { type: 'formation.reserve', lotId: lot.id });
    const filled = await session(f);
    expect(filled.fill).toHaveLength(2);
    await step(f, { type: 'formation.fill' });
    const after = await session(f);
    const fills = after.lots.filter((lot) => lot.filled);
    expect(fills).toHaveLength(2);
    expect(fills.every((lot) => lot.price === 200)).toBe(true);
    // The two best seeds among the reserves went to the only team with seats.
    const reserves = after.lots.filter((lot) => lot.state === 'RESERVE');
    expect(Math.max(...fills.map((lot) => lot.seed!))).toBeLessThan(
      Math.min(...reserves.map((lot) => lot.seed!)),
    );
    expect(after.teams[1]).toMatchObject({ moneyLeft: 600, seatsLeft: 0 });
  });

  it('keeps the draw order and private reasons out of what viewers receive', async () => {
    const [view] = await publicTeamFormation(db, f.tournamentId);
    const text = JSON.stringify(view);
    expect(view.teams[0].moneyLeft).toBe(0);
    expect(view.reserves.length).toBeGreaterThan(0);
    expect(text).not.toContain('Wrong player typed');
    expect(text).not.toContain('position');
    expect(text).not.toContain('randomSeed');
    expect(text).not.toContain('sourceTeamId');
    expect(text).not.toContain((await session(f)).id);
  });

  it('confirms in one step, moving rosters and retiring only the entrants who moved', async () => {
    const s = await session(f);
    await step(f, {
      type: 'formation.rename',
      formationTeamId: s.teams[0].id,
      name: 'The Bombers',
    });
    await step(f, { type: 'formation.confirm' });
    const teams = await db.team.findMany({
      where: { tournamentId: f.tournamentId, format: 'TEAM' },
      include: { members: { orderBy: { position: 'asc' } } },
      orderBy: { seed: 'asc' },
    });
    expect(teams).toHaveLength(2);
    expect(teams.every((team) => team.members.length === 3)).toBe(true);
    expect(teams.every((team) => team.status === 'APPROVED' && team.published)).toBe(true);
    for (const team of teams) {
      expect(team.members.filter((member) => member.captain)).toHaveLength(1);
      expect(team.members[0].captain).toBe(true);
    }
    expect(teams.some((team) => team.name === 'The Bombers')).toBe(true);
    const moved = (await session(f)).lots.filter((lot) => lot.state === 'SOLD');
    const entrants = await db.team.findMany({
      where: { id: { in: f.teams.map((team) => team.id) } },
    });
    for (const entrant of entrants) {
      const went = moved.some(
        (lot) => f.teams.find((t) => t.id === entrant.id)?.osuId === lot.osuId,
      );
      expect(!!entrant.supersededAt).toBe(went);
      // Status stands, so finalized qualifier witnesses read exactly as before.
      expect(entrant.status).toBe('APPROVED');
      if (went) expect(entrant.published).toBe(false);
    }
  });

  it('keeps qualifier results intact after the players have moved', async () => {
    const data = await qualifierStandingsData(f.actor, f.stages.Qualifiers);
    expect(data.preview.sourceHash).toBe(data.latest?.sourceHash);
    expect(data.preview.rows).toHaveLength(8);
    await expect(
      db.$transaction((tx) => qualifierCorrectionImpact(tx, f.tournamentId, f.stages.Qualifiers)),
    ).resolves.toBeTruthy();
  });

  it('freezes the standings the board used', async () => {
    const data = await qualifierStandingsData(f.actor, f.stages.Qualifiers);
    const impact = await db.$transaction((tx) =>
      qualifierCorrectionImpact(tx, f.tournamentId, f.stages.Qualifiers),
    );
    await expect(
      db.$transaction((tx) =>
        applyQualifierStandingsAction(tx, f.actor, {
          type: 'qualifier.standings.reopen',
          stageId: f.stages.Qualifiers,
          baseVersion: data.latest!.version,
          sourceHash: data.preview.sourceHash,
          impactHash: impact.impactHash,
          affectedBracketIds: impact.brackets.map((bracket) => bracket.id),
          acknowledgeImpact: true,
          reason: 'Trying to change seeds',
        }),
      ),
    ).rejects.toThrow('has used these standings');
  });

  it('feeds formed teams into the next phase in their seeded order', async () => {
    const preview = await fx.previewOf(f, { phaseKey: 'main' });
    const teams = await db.team.findMany({
      where: { tournamentId: f.tournamentId, format: 'TEAM' },
      orderBy: { seed: 'asc' },
    });
    expect(preview.issues).toEqual([]);
    expect(preview.seats.map((seat) => seat.teamId)).toEqual(teams.map((team) => team.id));
  });

  it('reopens only while nothing depends on the teams', async () => {
    const before = await db.team.count({ where: { tournamentId: f.tournamentId } });
    await step(f, { type: 'formation.reopen', reason: 'A captain withdrew' });
    expect(await db.team.count({ where: { tournamentId: f.tournamentId, format: 'TEAM' } })).toBe(
      0,
    );
    expect(await db.team.count({ where: { tournamentId: f.tournamentId } })).toBe(before - 2);
    const entrants = await db.team.findMany({
      where: { id: { in: f.teams.map((team) => team.id) } },
      include: { members: true },
    });
    expect(entrants.every((team) => !team.supersededAt && team.published)).toBe(true);
    expect(entrants.every((team) => team.members.length === 1 && team.members[0].captain)).toBe(
      true,
    );
    expect((await session(f)).state).toBe('OPEN');

    await step(f, { type: 'formation.confirm' });
    await fx.advance(f, { phaseKey: 'main' });
    await expect(step(f, { type: 'formation.reopen', reason: 'Too late now' })).rejects.toThrow(
      'entered a later phase',
    );
  });

  it('puts formed teams into real bracket slots', async () => {
    const data = await competitionData(f.actor);
    const main = data.brackets.find((bracket) => bracket.name === 'Main bracket')!;
    const formed = await db.team.findMany({
      where: { tournamentId: f.tournamentId, format: 'TEAM' },
      select: { id: true },
    });
    const seated = main.nodes.flatMap((node) => node.slots.map((slot) => slot.teamId));
    expect(seated.sort()).toEqual(formed.map((team) => team.id).sort());
  });

  it('carries the whole board and its teams through an archive', async () => {
    const { bytes } = await exportTournament(f.actor, 'https://source.example');
    const { archive } = await inspectArchive(bytes);
    const { tournamentId } = await importTournament(fx.owner(), archive, `${f.tournamentId}-copy`);
    fx.tournamentIds.push(tournamentId);
    const copy = await db.formationSession.findFirstOrThrow({
      where: { tournamentId },
      include: { teams: true, lots: true, events: true },
    });
    expect(copy.state).toBe('CONFIRMED');
    expect(copy.lots).toHaveLength(8);
    expect(copy.teams.every((team) => team.teamId)).toBe(true);
    expect(copy.events.length).toBeGreaterThan(5);
    expect(copy.id).not.toBe((await session(f)).id);
    const formed = await db.team.findMany({ where: { tournamentId, format: 'TEAM' } });
    expect(new Set(copy.teams.map((team) => team.teamId))).toEqual(
      new Set(formed.map((team) => team.id)),
    );
    const { plan: copied } = await loadFormatPlan(db, tournamentId);
    expect(copied?.phases.map((phase) => phase.kind)).toContain('TEAM_FORMATION');
  });
});

describe.sequential('the other ways of forming teams', () => {
  it('holds a snake draft to its order, allowing a recorded exception', async () => {
    const f = await ready('snake', { method: 'SNAKE_DRAFT', captains: 'TOP_SEEDS' }, 6);
    await start(f);
    const pick = async (teamIndex: number, index: number, reason?: string) => {
      const s = await session(f);
      return step(f, {
        type: 'formation.assign',
        lotId: lotFor(s, index).id,
        formationTeamId: s.teams[teamIndex].id,
        ...(reason ? { reason } : {}),
      });
    };
    const first = await session(f);
    // Best seeds captain, so the first two seats are theirs.
    expect(first.teams.map((team) => team.position)).toEqual([0, 1]);
    expect(first.onTheClockId).toBe(first.teams[0].id);
    await expect(pick(1, 0)).rejects.toThrow('on the clock');
    await pick(0, 0);
    expect((await session(f)).onTheClockId).toBe(first.teams[1].id);
    await pick(1, 1);
    expect((await session(f)).onTheClockId).toBe(first.teams[1].id);
    await pick(0, 2, 'Captain 2 stepped away, organizers agreed');
    const events = await db.formationEvent.findMany({
      where: { sessionId: first.id, kind: 'ASSIGN' },
      orderBy: { sequence: 'asc' },
    });
    expect(events[2].reason).toContain('organizers agreed');
    await expect(
      step(f, {
        type: 'formation.assign',
        lotId: lotFor(await session(f), 3).id,
        formationTeamId: first.teams[1].id,
        price: 100,
      }),
    ).rejects.toThrow('Only an auction');
  });

  it('lets organizers assign freely, and confirm short teams only with a reason', async () => {
    const f = await ready('manual', { method: 'MANUAL', captains: 'TOP_SEEDS' }, 5);
    await start(f);
    const s = await session(f);
    await step(f, {
      type: 'formation.assign',
      lotId: lotFor(s, 2).id,
      formationTeamId: s.teams[1].id,
    });
    await expect(step(f, { type: 'formation.confirm' })).rejects.toThrow('2 teams are not full');
    await step(f, { type: 'formation.confirm', incompleteReason: 'Two players withdrew' });
    expect(await db.team.count({ where: { tournamentId: f.tournamentId, format: 'TEAM' } })).toBe(
      2,
    );
    const unsold = await db.team.findFirstOrThrow({
      where: { id: f.teams[2].id },
    });
    // A player who never joined a team keeps their entry rather than vanishing.
    expect(unsold.supersededAt).toBeNull();
  });

  it('applies pasted results all together or not at all', async () => {
    const f = await ready('paste');
    await start(f);
    const s = await session(f);
    const players = s.lots.filter((lot) => !lot.captain);
    const good = `${players[0].username}, ${s.teams[0].name}, 300`;
    const reserve = `${players[1].username} - unsold`;
    const pricey = `${players[2].username}, ${s.teams[0].name}, 900`;
    const preview = (await step(f, {
      type: 'formation.paste',
      text: [good, reserve, pricey].join('\n'),
      apply: false,
    })) as { rows: { error: string | null }[] };
    // The third is judged against the board as the first has already left it.
    expect(preview.rows.map((row) => !!row.error)).toEqual([false, false, true]);
    await expect(
      step(f, { type: 'formation.paste', text: [good, pricey].join('\n'), apply: true }),
    ).rejects.toThrow('highlighted lines');
    expect(
      (await session(f)).lots.filter((lot) => !lot.captain && lot.state !== 'WAITING'),
    ).toEqual([]);
    await step(f, { type: 'formation.paste', text: [good, reserve].join('\n'), apply: true });
    const after = await session(f);
    expect(lotFor(after, 0)).toMatchObject({ state: 'SOLD', price: 300 });
    expect(lotFor(after, 1).state).toBe('RESERVE');
    expect(after.teams[0].moneyLeft).toBe(700);
  });

  it('draws lots reproducibly from the stored seed, hiding the order from viewers', async () => {
    const random = {
      ...auction,
      auction: { ...auction.auction, lotOrder: 'RANDOM' },
    };
    const f = await ready('random', random);
    const order = async () =>
      (await session(f)).lots
        .filter((lot) => !lot.captain)
        .sort((a, b) => a.position - b.position)
        .map((lot) => lot.osuId);
    const begin = (randomSeed: string) =>
      act(f.actor, {
        type: 'formation.start',
        phaseKey: 'formation',
        captainTeamIds: [f.teams[0].id, f.teams[1].id],
        randomSeed,
      });
    await begin('seed-one');
    const first = await order();
    const stored = await db.formationSession.findFirstOrThrow({
      where: { tournamentId: f.tournamentId },
    });
    expect(stored.randomSeed).toBe('seed-one');
    const [view] = await publicTeamFormation(db, f.tournamentId);
    expect(JSON.stringify(view)).not.toContain('seed-one');
    // Only the player now on offer is revealed: the rest read in seed order, not draw order.
    const others = view.undecided.map((lot) => lot.seed!);
    expect(others).toEqual([...others].sort((a, b) => a - b));
    expect(view.current?.osuId).toBe(first[0]);

    await step(f, { type: 'formation.restart', reason: 'Checking the draw' });
    await begin('seed-one');
    expect(await order()).toEqual(first);
    await step(f, { type: 'formation.restart', reason: 'Checking the draw' });
    await begin('seed-two');
    expect(await order()).not.toEqual(first);
    expect([...(await order())].sort()).toEqual([...first].sort());
  });

  it('forms teams from registered free agents with no qualifier at all', async () => {
    const f = await fx.fixture('free-agents', 6, STAGES);
    await fx.lock(
      f,
      formatPlanSchema.parse({
        version: 1,
        phases: [
          {
            kind: 'TEAM_FORMATION',
            key: 'pool',
            name: 'Free agent pool',
            entries: [{ source: { kind: 'REGISTRATION', count: 6 }, seedFrom: 1 }],
            method: 'MANUAL',
            teamCount: 2,
            rosterSize: 3,
            captains: 'TOP_SEEDS',
          },
          {
            kind: 'SINGLE_ELIMINATION',
            key: 'main',
            name: 'Main bracket',
            stageId: f.stages.Finals,
            size: 2,
            entries: [{ source: { kind: 'ALL', phase: 'pool' }, seedFrom: 1 }],
          },
        ],
      }),
    );
    await act(f.actor, { type: 'formation.start', phaseKey: 'pool' });
    const s = await session(f);
    for (const [index, teamIndex] of [0, 0, 1, 1].entries())
      await step(f, {
        type: 'formation.assign',
        lotId: lotFor(await session(f), index).id,
        formationTeamId: s.teams[teamIndex].id,
      });
    await step(f, { type: 'formation.confirm' });
    expect(await db.team.count({ where: { tournamentId: f.tournamentId, format: 'TEAM' } })).toBe(
      2,
    );
    const preview = await fx.previewOf(f, { phaseKey: 'main' });
    expect(preview.issues).toEqual([]);
    expect(preview.seats.every((seat) => seat.teamId)).toBe(true);
  });

  it('refuses hand-chosen entrants who were not formed by the source phase', async () => {
    const f = await fx.fixture('explicit', 8, STAGES);
    await fx.finalizedQualifier(f, 8);
    await fx.lock(
      f,
      plan(f, auction, [
        { source: { kind: 'EXPLICIT', phase: 'formation', count: 2 }, seedFrom: 1 },
      ]),
    );
    await start(f);
    for (const [index, teamIndex] of [0, 0, 1, 1].entries()) await sell(f, index, teamIndex, 100);
    await step(f, { type: 'formation.confirm' });
    const formed = await db.team.findMany({
      where: { tournamentId: f.tournamentId, format: 'TEAM' },
      select: { id: true },
    });
    const stranger = await fx.previewOf(f, {
      phaseKey: 'main',
      explicit: { formation: [formed[0].id, f.teams[7].id] },
    });
    expect(stranger.issues.map((issue) => issue.code)).toContain('NOT_IN_SOURCE');
    const chosen = await fx.previewOf(f, {
      phaseKey: 'main',
      explicit: { formation: [formed[1].id, formed[0].id] },
    });
    expect(chosen.issues).toEqual([]);
    expect(chosen.seats.map((seat) => seat.teamId)).toEqual([formed[1].id, formed[0].id]);
  });

  it('can restart an open board, leaving the record in the audit log', async () => {
    const f = await ready('restart');
    await start(f);
    await sell(f, 0, 0, 100);
    await expect(
      act(f.actor, {
        type: 'format.unlock',
        baseToken: (await loadFormatPlan(db, f.tournamentId)).token,
      }),
    ).rejects.toThrow('Restart team formation');
    await step(f, { type: 'formation.restart', reason: 'Wrong captains' });
    expect((await board(f)).session).toBeNull();
    const audit = await db.auditLog.findFirstOrThrow({
      where: { tournamentId: f.tournamentId, action: 'formation.restart' },
    });
    expect(JSON.stringify(audit.details)).toContain('Wrong captains');
    await start(f, [2, 3]);
    expect((await session(f)).lots.filter((lot) => lot.captain)).toHaveLength(2);
  });
});

describe.sequential('budgets and items', () => {
  let f: Fixture;
  let formed: { id: string; name: string }[];
  let items: Record<string, string>;
  const earlyStage = () => f.stages.Semifinals;
  const lateStage = () => f.stages.Finals;
  const balance = async (teamId: string) =>
    (await setupWorkspaceData(f.actor)).resources!.teams.find((team) => team.id === teamId)!;

  beforeAll(async () => {
    f = await ready('budgets');
    await start(f);
    await sell(f, 0, 0, 300);
    await sell(f, 1, 0, 100);
    await sell(f, 2, 1, 100);
    await sell(f, 3, 1, 100);
    await step(f, { type: 'formation.confirm' });
    formed = await db.team.findMany({
      where: { tournamentId: f.tournamentId, format: 'TEAM' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    const tournament = await db.tournament.findUniqueOrThrow({ where: { id: f.tournamentId } });
    await act(f.actor, {
      type: 'settings.save',
      baseVersion: tournament.version,
      resourcePolicy: {
        enabled: true,
        maxPerStage: 2,
        earnings: { mapWin: 200 },
      },
    });
    items = {};
    for (const [name, price, unlockStageId] of [
      ['Cheap', 100, earlyStage()],
      ['Dear', 900, null],
      ['Late', 50, lateStage()],
    ] as const)
      items[name] = (
        (await act(f.actor, {
          type: 'resource.item.save',
          name,
          price,
          unlockStageId,
          published: name !== 'Late',
        })) as { id: string }
      ).id;
  });

  const buy = (teamId: string, item: string, stageId: string | null, expectedPrice?: number) =>
    act(f.actor, {
      type: 'resource.purchase',
      teamId,
      itemId: items[item],
      stageId,
      expectedPrice:
        expectedPrice ?? { Cheap: 100, Dear: 900, Late: 50 }[item as 'Cheap' | 'Dear' | 'Late'],
    });

  it('starts each team from what the auction left it', async () => {
    const data = (await setupWorkspaceData(f.actor)).resources!;
    expect(data.teams).toHaveLength(2);
    const spent = data.teams.map((team) => team.spentAtAuction).sort((a, b) => a - b);
    expect(spent).toEqual([200, 400]);
    expect(data.teams.every((team) => team.balance === 1000 - team.spentAtAuction)).toBe(true);
  });

  it('holds a purchase to its price, unlock stage, stage limit and balance', async () => {
    const team = (await setupWorkspaceData(f.actor)).resources!.teams.find(
      (row) => row.spentAtAuction === 400,
    )!;
    await expect(buy(team.id, 'Cheap', earlyStage(), 75)).rejects.toThrow('price of this item');
    await expect(buy(team.id, 'Late', earlyStage())).rejects.toThrow('only unlocks at');
    await expect(buy(team.id, 'Cheap', null)).rejects.toThrow('Choose the stage');
    await expect(buy(team.id, 'Dear', earlyStage())).rejects.toThrow('costs 900');
    await buy(team.id, 'Cheap', earlyStage());
    await buy(team.id, 'Cheap', earlyStage());
    await expect(buy(team.id, 'Cheap', earlyStage())).rejects.toThrow('already bought 2');
    await buy(team.id, 'Late', lateStage());
    expect((await balance(team.id)).balance).toBe(1000 - 400 - 100 - 100 - 50);
  });

  it('refunds a reversed purchase and keeps the record', async () => {
    const team = (await setupWorkspaceData(f.actor)).resources!.teams.find(
      (row) => row.spentAtAuction === 400,
    )!;
    const before = team.balance;
    const purchase = team.purchases[0];
    await act(f.actor, {
      type: 'resource.purchase.reverse',
      id: purchase.id,
      reason: 'Bought by mistake',
    });
    const after = await balance(team.id);
    expect(after.balance).toBe(before + purchase.price);
    expect(after.purchases.find((row) => row.id === purchase.id)).toMatchObject({
      reversed: true,
      reversedReason: 'Bought by mistake',
    });
    await expect(
      act(f.actor, { type: 'resource.purchase.reverse', id: purchase.id, reason: 'Twice over' }),
    ).rejects.toThrow('already reversed');
  });

  it('earns from confirmed results only, and a correction takes the money back', async () => {
    const [teamA, teamB] = formed;
    const created = await db.match.create({
      data: {
        tournamentId: f.tournamentId,
        code: '9000',
        stageId: lateStage(),
        teamAId: teamA.id,
        teamBId: teamB.id,
        status: 'IN_PROGRESS',
        rules: {},
        participants: {},
      },
    });
    const before = (await balance(teamA.id)).balance;
    // Still in progress, so nothing is earned even with a score on the board.
    await db.match.update({ where: { id: created.id }, data: { scoreA: 2 } });
    expect((await balance(teamA.id)).earned).toBe(0);
    await db.match.update({
      where: { id: created.id },
      data: { status: 'COMPLETED', winnerSide: 'A', scoreA: 2, scoreB: 1 },
    });
    expect((await balance(teamA.id)).earned).toBe(400);
    expect((await balance(teamA.id)).balance).toBe(before + 400);
    expect((await balance(teamB.id)).earned).toBe(200);
    // A correction moves the money with no ledger entry having to be written.
    await db.match.update({
      where: { id: created.id },
      data: { winnerSide: 'B', scoreA: 0, scoreB: 2 },
    });
    expect((await balance(teamA.id)).earned).toBe(0);
    expect((await balance(teamB.id)).earned).toBe(400);
    // A forfeit records the target score without a map being played.
    await db.match.update({
      where: { id: created.id },
      data: { forfeitSide: 'A', winnerSide: 'B', scoreA: 0, scoreB: 2 },
    });
    expect((await balance(teamB.id)).earned).toBe(0);
    await db.match.delete({ where: { id: created.id } });
  });

  it('records manual adjustments and refuses an empty one', async () => {
    const before = (await balance(formed[0].id)).balance;
    await act(f.actor, {
      type: 'resource.adjust',
      teamId: formed[0].id,
      amount: -150,
      reason: 'Host ruling on a late report',
    });
    expect((await balance(formed[0].id)).balance).toBe(before - 150);
    await expect(
      act(f.actor, { type: 'resource.adjust', teamId: formed[0].id, amount: 0, reason: 'Nothing' }),
    ).rejects.toThrow();
  });

  it('blocks reopening the board once a team has a budget history', async () => {
    await expect(step(f, { type: 'formation.reopen', reason: 'Too late' })).rejects.toThrow(
      'entered a later phase',
    );
  });

  it('shows the public only revealed items, and no notes or reasons', async () => {
    const view = (await publicResources(db, f.tournamentId))!;
    expect(view.items.map((item) => item.name).sort()).toEqual(['Cheap', 'Dear']);
    const text = JSON.stringify(view);
    expect(text).not.toContain('Bought by mistake');
    expect(text).not.toContain('Host ruling');
    expect(view.teams.every((team) => typeof team.balance === 'number')).toBe(true);
    const tournament = await db.tournament.findUniqueOrThrow({ where: { id: f.tournamentId } });
    await act(f.actor, {
      type: 'settings.save',
      baseVersion: tournament.version,
      resourcePolicy: { enabled: true, public: false },
    });
    expect(await publicResources(db, f.tournamentId)).toBeNull();
  });

  it('removes an item from sale while its purchases stay on record', async () => {
    const data = (await setupWorkspaceData(f.actor)).resources!;
    const item = data.items.find((row) => row.name === 'Cheap')!;
    await act(f.actor, { type: 'resource.item.archive', id: item.id, baseVersion: item.version });
    const after = (await setupWorkspaceData(f.actor)).resources!;
    expect(after.items.map((row) => row.name)).not.toContain('Cheap');
    expect(after.teams.flatMap((team) => team.purchases).some((row) => row.item === 'Cheap')).toBe(
      true,
    );
    await expect(
      act(f.actor, { type: 'resource.item.archive', id: item.id, baseVersion: item.version }),
    ).rejects.toThrow('changed in another session');
  });

  it('needs roster rights, stays inside its tournament and survives an archive', async () => {
    const team = formed[0];
    const noRights: Actor = {
      ...f.actor,
      permissions: ALL_PERMISSIONS.filter((key) => key !== 'teams.edit'),
    };
    await expect(
      act(noRights, { type: 'resource.adjust', teamId: team.id, amount: 5, reason: 'No rights' }),
    ).rejects.toThrow('permission');
    const other = await fx.fixture('budget-tenant', 2, STAGES);
    await expect(
      act(other.actor, {
        type: 'resource.adjust',
        teamId: team.id,
        amount: 5,
        reason: 'Elsewhere',
      }),
    ).rejects.toThrow();
    const { bytes } = await exportTournament(f.actor, 'https://source.example');
    const { archive } = await inspectArchive(bytes);
    const { tournamentId } = await importTournament(fx.owner(), archive, `${f.tournamentId}-copy`);
    fx.tournamentIds.push(tournamentId);
    expect(await db.resourceItem.count({ where: { tournamentId } })).toBe(3);
    expect(await db.resourcePurchase.count({ where: { tournamentId } })).toBe(3);
    expect(await db.resourceAdjustment.count({ where: { tournamentId } })).toBe(1);
    const settings = await db.tournamentSettings.findUniqueOrThrow({ where: { tournamentId } });
    expect(settings.resourcePolicy).toMatchObject({ enabled: true, public: false });
  });
});

describe.sequential('boundaries around a formed roster', () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await ready('boundaries', { method: 'MANUAL', captains: 'TOP_SEEDS' }, 6);
    await start(f);
    const s = await session(f);
    for (const [index, teamIndex] of [0, 0, 1, 1].entries())
      await step(f, {
        type: 'formation.assign',
        lotId: lotFor(await session(f), index).id,
        formationTeamId: s.teams[teamIndex].id,
      });
    await step(f, { type: 'formation.confirm' });
  });

  it('stops a captain re-registering a roster the board holds', async () => {
    const osuId = f.teams[0].osuId;
    const user = await db.user.create({
      data: { osuId, username: `${fx.prefix}-${osuId}`, avatarUrl: '', profileUrl: '' },
    });
    const actor: Actor = {
      id: user.id,
      osuId,
      username: user.username,
      avatarUrl: '',
      tournamentId: f.tournamentId,
      permissions: [],
      roles: [],
    };
    await db.tournament.update({ where: { id: f.tournamentId }, data: { published: true } });
    await db.tournamentSettings.update({
      where: { tournamentId: f.tournamentId },
      data: { registrationPolicy: { minPlayers: 1, rosterLocked: false } },
    });
    const data = await registrationData(actor, f.tournamentId);
    await expect(
      db.$transaction((tx) =>
        applyRegistration(
          tx,
          actor,
          registrationActionSchema.parse({
            type: 'registration.save',
            policyToken: data.policyToken,
            baseVersion: data.team?.version ?? 0,
            name: 'Renamed',
            format: 'TEAM',
            members: [{ osuId, substitute: false }],
            answers: {},
          }),
          [{ id: osuId, username: user.username, avatar_url: '', country_code: 'IT' }],
        ),
      ),
    ).rejects.toThrow('Team formation holds this roster');
    await db.user.delete({ where: { id: user.id } });
    await db.tournament.update({ where: { id: f.tournamentId }, data: { published: false } });
  });

  it('removes retired entrants from every place a team can be chosen', async () => {
    const retired = f.teams[0].id;
    expect(JSON.stringify(await competitionEligibilityOptions(f.actor))).not.toContain(retired);
    expect(JSON.stringify(await matchOptions(f.actor))).not.toContain(retired);
    await expect(
      act(f.actor, {
        type: 'team.patch',
        id: retired,
        baseVersion: (await db.team.findUniqueOrThrow({ where: { id: retired } })).version,
        name: 'Should not save',
        seed: null,
      }),
    ).rejects.toThrow('moved to a formed team');
    await expect(
      act(f.actor, {
        type: 'competition.create',
        name: 'Sneaky',
        format: 'SINGLE_ELIMINATION',
        stageId: f.stages.Finals,
        teamIds: [retired, f.teams[1].id],
        generationKey: `${fx.prefix}-sneaky`,
        byePlacement: 'TOP_SEEDS',
      }),
    ).rejects.toThrow();
  });

  it('refuses to seat a retired entrant in a new qualifier lobby', async () => {
    await expect(
      act(f.actor, {
        type: 'qualifier.create',
        code: `${fx.prefix}-late`,
        stageId: f.stages.Qualifiers,
        teamIds: [f.teams[0].id],
        refereeIds: [],
        scheduledAt: null,
        notes: '',
      }),
    ).rejects.toThrow();
  });

  it('refuses to delete anything the board refers to', async () => {
    const formed = await db.team.findFirstOrThrow({
      where: { tournamentId: f.tournamentId, format: 'TEAM' },
    });
    await expect(
      act(f.actor, { type: 'team.delete', id: formed.id, baseVersion: formed.version }),
    ).rejects.toThrow('part of team formation');
  });

  it('requires the roster permission and stays inside its tournament', async () => {
    const s = await session(f);
    const without = (...missing: PermissionKey[]): Actor => ({
      ...f.actor,
      permissions: ALL_PERMISSIONS.filter((key) => !missing.includes(key)),
    });
    const reopen = {
      type: 'formation.reopen',
      sessionId: s.id,
      baseVersion: s.version,
      reason: 'Not allowed',
    };
    await expect(act(without('teams.edit'), reopen)).rejects.toThrow('permission');
    expect((await setupWorkspaceData(without('teams.view'))).formation).toEqual([]);
    const other = await fx.fixture('other-tenant', 2, STAGES);
    await expect(act(other.actor, reopen)).rejects.toThrow('not found');
  });
});
