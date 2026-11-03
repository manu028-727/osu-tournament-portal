import { describe, expect, it } from 'vitest';
import {
  currentLot,
  formedTeamOrder,
  moneyLeft,
  parsePastedResults,
  reserveFill,
  seatsLeft,
  snakeTurn,
  type BoardLot,
  type BoardTeam,
} from '../src/lib/team-formation';

const team = (position: number, budget: number | null = 4000): BoardTeam => ({
  id: `t${position}`,
  position,
  name: `Team ${position}`,
  budget,
});
const lot = (id: number, fields: Partial<BoardLot> = {}): BoardLot => ({
  id: `l${id}`,
  osuId: 1000 + id,
  username: `Player ${id}`,
  seed: id,
  position: id,
  captain: false,
  state: 'WAITING',
  formationTeamId: null,
  price: null,
  ...fields,
});
const captain = (id: number, teamId: string, seed: number | null = id) =>
  lot(id, { captain: true, state: 'SOLD', formationTeamId: teamId, seed });

describe('snake draft order', () => {
  // Written out by hand: three teams down, then back up, then down again.
  const expected = ['t0', 't1', 't2', 't2', 't1', 't0', 't0', 't1', 't2'];
  it('runs down the teams and back up, ending when every seat is taken', () => {
    const teams = [team(0), team(1), team(2)];
    const lots = [captain(1, 't0'), captain(2, 't1'), captain(3, 't2')];
    const seen: string[] = [];
    for (let pick = 0; pick < expected.length; pick++) {
      const turn = snakeTurn(teams, lots, 4)!;
      seen.push(turn.id);
      lots.push(lot(10 + pick, { state: 'SOLD', formationTeamId: turn.id }));
    }
    expect(seen).toEqual(expected);
    expect(snakeTurn(teams, lots, 4)).toBeNull();
  });
});

describe('auction board', () => {
  it('derives what is left from the sales themselves', () => {
    const t = team(0);
    const lots = [
      captain(1, 't0'),
      lot(2, { state: 'SOLD', formationTeamId: 't0', price: 1500 }),
      lot(3, { state: 'SOLD', formationTeamId: 't0', price: 400 }),
      lot(4, { state: 'RESERVE' }),
    ];
    expect(moneyLeft(t, lots)).toBe(2100);
    expect(seatsLeft(t, lots, 5)).toBe(2);
    expect(moneyLeft(team(1, null), lots)).toBeNull();
  });

  it('offers the next undecided player in draw order', () => {
    expect(
      currentLot([
        lot(1, { position: 5 }),
        lot(2, { position: 3 }),
        lot(3, { position: 1, state: 'RESERVE' }),
      ])?.id,
    ).toBe('l2');
    expect(currentLot([lot(1, { state: 'SOLD' })])).toBeNull();
  });
});

describe('reserve fill', () => {
  it('gives out reserves best seed first, one seat per team in turn', () => {
    const teams = [team(0), team(1)];
    const lots = [
      captain(1, 't0'),
      captain(2, 't1'),
      lot(9, { state: 'RESERVE', seed: 9 }),
      lot(5, { state: 'RESERVE', seed: 5 }),
      lot(7, { state: 'RESERVE', seed: 7 }),
      lot(8, { state: 'RESERVE', seed: 8 }),
    ];
    expect(reserveFill(teams, lots, 3)).toEqual([
      { lotId: 'l5', formationTeamId: 't0' },
      { lotId: 'l7', formationTeamId: 't1' },
      { lotId: 'l8', formationTeamId: 't0' },
      { lotId: 'l9', formationTeamId: 't1' },
    ]);
  });

  it('stops when seats run out and skips full teams', () => {
    const teams = [team(0), team(1)];
    const lots = [
      captain(1, 't0'),
      captain(2, 't1'),
      lot(3, { state: 'SOLD', formationTeamId: 't0' }),
      lot(4, { state: 'RESERVE' }),
      lot(5, { state: 'RESERVE' }),
    ];
    expect(reserveFill(teams, lots, 2)).toEqual([{ lotId: 'l4', formationTeamId: 't1' }]);
  });

  it('leaves players who were never offered out of it', () => {
    expect(reserveFill([team(0)], [captain(1, 't0'), lot(2)], 2)).toEqual([]);
  });
});

describe('formed team seeding', () => {
  const teams = [team(0), team(1)];
  const lots = [
    captain(1, 't0', 1),
    lot(8, { seed: 9, state: 'SOLD', formationTeamId: 't0' }),
    captain(2, 't1', 2),
    lot(3, { seed: 3, state: 'SOLD', formationTeamId: 't1' }),
  ];
  it('uses the average seed of the players bought', () => {
    expect(formedTeamOrder(teams, lots, 'AVERAGE_PLAYER_SEED').map((t) => t.id)).toEqual([
      't1',
      't0',
    ]);
  });
  it("can use the captain's seed alone", () => {
    expect(formedTeamOrder(teams, lots, 'CAPTAIN_SEED').map((t) => t.id)).toEqual(['t0', 't1']);
  });
  it('does not punish a team for a captain who never played qualifiers', () => {
    const unseeded = [
      captain(1, 't0', null),
      lot(2, { seed: 2, state: 'SOLD', formationTeamId: 't0' }),
      captain(3, 't1', 3),
      lot(4, { seed: 4, state: 'SOLD', formationTeamId: 't1' }),
    ];
    expect(formedTeamOrder(teams, unseeded, 'AVERAGE_PLAYER_SEED')[0].id).toBe('t0');
  });
  it('falls back to board order on a tie', () => {
    const tied = [captain(1, 't1', 4), captain(2, 't0', 4)];
    expect(formedTeamOrder(teams, tied, 'AVERAGE_PLAYER_SEED')[0].id).toBe('t0');
  });
});

describe('pasted auction results', () => {
  const teams = [team(0), { ...team(1), name: 'The Bombers' }];
  const lots = [captain(1, 't0'), captain(2, 't1'), lot(3), lot(4), lot(5), lot(6)];
  const read = (text: string) => parsePastedResults(text, lots, teams);

  it.each([
    ['Player 3\tThe Bombers\t1200', 1200],
    ['Player 3, The Bombers, $1200', 1200],
    ['Player 3 - The Bombers - 1200$', 1200],
    ['Player 3 | The Bombers | €1.200', 1200],
    ['Player 3 sold to The Bombers for $1,200', 1200],
    ['PLAYER 3 -> the bombers 1200', 1200],
    ['1003, The Bombers, 1200', 1200],
  ])('reads %s', (line, price) => {
    expect(read(line)).toMatchObject([{ lotId: 'l3', formationTeamId: 't1', price, error: null }]);
  });

  it('matches a team by its captain as well as its name', () => {
    expect(read('Player 3, Player 2, 500')).toMatchObject([{ formationTeamId: 't1', price: 500 }]);
  });

  it('reads an unsold player as a reserve', () => {
    expect(read('Player 3 - unsold')).toMatchObject([{ lotId: 'l3', reserve: true, error: null }]);
    expect(read('Player 4, no bids')).toMatchObject([{ lotId: 'l4', reserve: true }]);
  });

  it('flags what it cannot read instead of guessing', () => {
    expect(read('Nobody, The Bombers, 100')[0].error).toContain('No player');
    expect(read('Player 3, Nobody, 100')[0].error).toContain('No team');
    expect(read('just some words')[0].error).toContain('player and a team');
    // A captain is never for sale.
    expect(read('Player 1, The Bombers, 100')[0].error).toContain('No player');
  });

  it('ignores blank lines and keeps each line for review', () => {
    expect(read('\nPlayer 3, The Bombers, 100\n\n').map((row) => row.line)).toEqual([
      'Player 3, The Bombers, 100',
    ]);
  });
});
