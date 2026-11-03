import { describe, expect, it } from 'vitest';
import {
  bracketPresentation,
  bracketRoundDetails,
  bracketSlotLabel,
  BRACKET_CARD_WIDTH,
} from '../src/lib/bracket-presentation';
import { generateCompetition, recalculateCompetition } from '../src/lib/competition-engine';
import { numberBracketNodes } from '../src/lib/match-numbering';
import { competitionActionSchema } from '../src/lib/competition-validation';
import type { CompetitionBracketData, CompetitionNode } from '../src/lib/competition-types';
import { translator } from '../src/lib/i18n';

const tr = translator('en');
async function fixture(
  count = 8,
  reset = true,
  format = 'DOUBLE_ELIMINATION',
): Promise<CompetitionBracketData> {
  const input = competitionActionSchema.options[0].parse({
    type: 'competition.create',
    name: 'Display fixture',
    generationKey: 'display-key',
    stageId: 'configured-stage',
    teamIds: Array.from({ length: count }, (_, i) => `team-${i + 1}`),
    format,
    grandFinalReset: reset,
    thirdPlace: format === 'SINGLE_ELIMINATION',
  });
  const plan = await generateCompetition(input);
  const rounds = plan.rounds.map((round) => ({
    ...round,
    id: round.key,
    stageName: `Configured stage / ${round.key}`,
  }));
  const nodes = recalculateCompetition(
    plan.nodes.map((node) => ({
      id: node.key,
      key: node.key,
      bracketId: 'bracket',
      roundId: node.roundKey,
      position: node.position,
      state: 'WAITING',
      matchNumber: null,
      matchId: null,
      match: null,
      slots: node.slots.map(({ sourceKey, ...slot }) => ({ ...slot, sourceNodeId: sourceKey })),
    })),
  );
  const numbers = numberBracketNodes(
    nodes.filter((node) => !['BYE', 'SKIPPED'].includes(node.state)),
    rounds.map((round) => ({ ...round, stagePosition: 0 })),
    1,
  );
  nodes.forEach((node) => {
    node.matchNumber = numbers.get(node.id) || null;
  });
  return {
    id: 'bracket',
    name: input.name,
    format: input.format,
    version: 1,
    published: true,
    rounds,
    nodes,
    entries: input.teamIds.map((teamId, i) => ({
      teamId,
      seed: i + 1,
      status: 'ACTIVE',
      team: { id: teamId, name: `Entrant ${i + 1}`, slug: teamId },
    })),
  };
}
function complete(node: CompetitionNode, winnerSide: 'A' | 'B') {
  node.matchId = `record-${node.id}`;
  node.match = {
    id: node.matchId,
    code: 'internal-code',
    matchNumber: node.matchNumber!,
    version: 1,
    status: 'COMPLETED',
    winnerSide,
    scoreA: winnerSide === 'A' ? 4 : 1,
    scoreB: winnerSide === 'B' ? 4 : 1,
    teamAId: node.slots[0].teamId,
    teamBId: node.slots[1].teamId,
  };
}
describe('bracket presentation without progression changes', () => {
  it.each([2, 4, 8, 16, 32, 128])(
    'lays out DE%i as two paths and one shared conclusion without crossing lines',
    async (count) => {
      const bracket = await fixture(count);
      const before = JSON.stringify(bracket);
      const layout = bracketPresentation(bracket);
      expect(layout.sections.map((section) => section.lane)).toEqual(['WINNERS', 'LOSERS']);
      expect(layout.positions.size).toBe(bracket.nodes.length);
      expect(layout.headers).toHaveLength(bracket.rounds.length);
      for (const connector of layout.connectors) {
        const source = bracket.nodes.find((node) => node.id === connector.sourceId)!;
        const target = bracket.nodes.find((node) => node.id === connector.targetId)!;
        expect(bracket.rounds.find((round) => round.id === source.roundId)!.lane).toBe(
          connector.lane,
        );
        expect(bracket.rounds.find((round) => round.id === target.roundId)!.lane).toBe(
          connector.lane,
        );
        expect(['WINNERS', 'LOSERS']).toContain(connector.lane);
      }
      const laneLast = (lane: string) => {
        const round = bracket.rounds.filter((round) => round.lane === lane).at(-1);
        return bracket.nodes.find((node) => node.roundId === round?.id);
      };
      const winner = laneLast('WINNERS')!,
        loser = laneLast('LOSERS');
      const finals = bracket.nodes.filter(
        (node) => bracket.rounds.find((round) => round.id === node.roundId)?.lane === 'FINALS',
      );
      const gf = layout.positions.get(finals[0].id)!;
      expect(gf.x).toBeGreaterThan(layout.positions.get(winner.id)!.x);
      if (loser) {
        expect(layout.positions.get(loser.id)!.x).toBe(layout.positions.get(winner.id)!.x);
        expect(gf.y).toBeGreaterThan(layout.positions.get(winner.id)!.y);
        expect(gf.y).toBeLessThan(layout.positions.get(loser.id)!.y);
      }
      expect(layout.positions.get(finals[1].id)!.x).toBeGreaterThan(gf.x);
      expect(layout.positions.get(finals[1].id)!.y).toBe(gf.y);
      for (const position of layout.positions.values()) {
        expect(position.x).toBeGreaterThanOrEqual(0);
        expect(position.y).toBeGreaterThanOrEqual(0);
        expect(position.x + BRACKET_CARD_WIDTH).toBeLessThanOrEqual(layout.width);
        expect(position.y + 140).toBeLessThanOrEqual(layout.height);
      }
      for (const round of bracket.rounds)
        expect(bracketRoundDetails(bracket, round, tr).stage).toBe(round.stageName);
      expect(JSON.stringify(bracket)).toBe(before);
    },
  );
  it.each([false, true])(
    'keeps a full DE8 completion and conditional reset unchanged (reset played: %s)',
    async (resetPlayed) => {
      const bracket = await fixture();
      let completed = 0;
      while (true) {
        const next = bracket.nodes.find((node) => node.state === 'READY' && !node.match);
        if (!next) break;
        expect(++completed).toBeLessThanOrEqual(15);
        complete(next, next.key === 'g3-r1-m1' && resetPlayed ? 'B' : 'A');
        bracket.nodes = recalculateCompetition(bracket.nodes);
        const witness = JSON.stringify(bracket);
        bracketPresentation(bracket);
        expect(JSON.stringify(bracket)).toBe(witness);
      }
      expect(completed).toBe(resetPlayed ? 15 : 14);
      const reset = bracket.nodes.find((node) => node.key === 'g3-r2-m1')!;
      expect(reset.state).toBe(resetPlayed ? 'COMPLETED' : 'SKIPPED');
      expect(bracketSlotLabel(bracket, reset, 'A', tr)).toBe(
        resetPlayed ? 'Entrant 1' : 'Not required',
      );
    },
  );
  it('shows numbered winner/loser placeholders and replaces them only with resolved participants', async () => {
    const bracket = await fixture();
    const target = bracket.nodes.find((node) =>
      node.slots.some((slot) => slot.outcome === 'LOSER'),
    )!;
    const slot = target.slots.find((slot) => slot.outcome === 'LOSER')!;
    const source = bracket.nodes.find((node) => node.id === slot.sourceNodeId)!;
    expect(bracketSlotLabel(bracket, target, slot.side, tr)).toBe(
      `Loser of Match #${source.matchNumber}`,
    );
    complete(source, 'A');
    bracket.nodes = recalculateCompetition(bracket.nodes);
    expect(
      bracketSlotLabel(
        bracket,
        bracket.nodes.find((node) => node.id === target.id)!,
        slot.side,
        tr,
      ),
    ).toBe(bracket.entries.find((entry) => entry.teamId === source.slots[1].teamId)!.team.name);
    const gf = bracket.nodes.find((node) => node.key === 'g3-r1-m1')!;
    const gfSlot = gf.slots[0],
      wf = bracket.nodes.find((node) => node.id === gfSlot.sourceNodeId)!;
    expect(bracketSlotLabel(bracket, gf, gfSlot.side, tr)).toBe(
      `Winner of Match #${wf.matchNumber}`,
    );
    const reset = bracket.nodes.find((node) => node.key === 'g3-r2-m1')!;
    expect(bracketSlotLabel(bracket, reset, 'A', tr)).toBe(`Loser of Match #${gf.matchNumber}`);
    expect(bracketSlotLabel(bracket, reset, 'B', tr)).toBe(`Winner of Match #${gf.matchNumber}`);
    wf.matchNumber = null;
    expect(bracketSlotLabel(bracket, gf, gfSlot.side, tr)).toBe('Awaiting an earlier match');
  });
  it.each(['SINGLE_ELIMINATION', 'GROUPS'])(
    'retains stage labels and noncrossing routes for %s',
    async (format) => {
      const bracket = await fixture(8, false, format);
      expect(bracketPresentation(bracket).positions.size).toBe(bracket.nodes.length);
      expect(
        bracketPresentation(bracket).sections.some((section) => section.lane === 'FINALS'),
      ).toBe(false);
    },
  );
  it('omits the reset presentation when no reset is configured', async () => {
    const bracket = await fixture(8, false);
    expect(bracket.rounds.filter((round) => round.lane === 'FINALS')).toHaveLength(1);
    expect(bracketPresentation(bracket).sections).toHaveLength(2);
  });
});

describe('named groups', () => {
  const groupRound = (group: number, letter: string, position: number) => ({
    id: `round-${group}`,
    key: `g${group}-r1`,
    name: `Group ${letter} 1`,
    lane: `GROUP_${group}`,
    stageId: 'stage',
    position,
  });
  const bracket = (rounds: ReturnType<typeof groupRound>[]) =>
    ({
      id: 'groups',
      name: 'Groups',
      format: 'GROUPS',
      rounds,
      nodes: [],
      entries: [],
    }) as unknown as CompetitionBracketData;

  it('reads in letter order even when letters follow strength rather than the draw', () => {
    const { rounds } = bracketPresentation(
      bracket([groupRound(1, 'C', 0), groupRound(2, 'A', 1), groupRound(3, 'B', 2)]),
    );
    expect(rounds.map((round) => round.name)).toEqual(['Group A 1', 'Group B 1', 'Group C 1']);
  });

  it('leaves older groups, whose rounds have no group name, in their stored order', () => {
    const older = [groupRound(1, 'C', 0), groupRound(2, 'A', 1)].map((round, index) => ({
      ...round,
      name: `Round ${index + 1}`,
    }));
    const { rounds } = bracketPresentation(bracket(older));
    expect(rounds.map((round) => round.lane)).toEqual(['GROUP_1', 'GROUP_2']);
  });
});
