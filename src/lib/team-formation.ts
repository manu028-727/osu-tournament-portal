// The rules of a formation board, kept pure so an operator's every choice can be tested.
export type BoardTeam = { id: string; position: number; name: string; budget: number | null };
export type BoardLot = {
  id: string;
  osuId: number;
  username: string;
  seed: number | null;
  position: number;
  captain: boolean;
  state: string;
  formationTeamId: string | null;
  price: number | null;
};
export const auctionSettings = (value: unknown) =>
  value as { budget: number; minimumRaise: number; lotOrder: string; reserveFillPrice: number };

const bySeed = (a: BoardLot, b: BoardLot) =>
  (a.seed ?? Infinity) - (b.seed ?? Infinity) || a.position - b.position;
const onTeam = (lots: readonly BoardLot[], team: BoardTeam) =>
  lots.filter((lot) => lot.formationTeamId === team.id);

export const seatsLeft = (team: BoardTeam, lots: readonly BoardLot[], rosterSize: number) =>
  rosterSize - onTeam(lots, team).length;

export const moneyLeft = (team: BoardTeam, lots: readonly BoardLot[]) =>
  team.budget === null
    ? null
    : team.budget - onTeam(lots, team).reduce((total, lot) => total + (lot.price ?? 0), 0);

// Who is on the clock: the order runs down the teams and back up.
export function snakeTurn(
  teams: readonly BoardTeam[],
  lots: readonly BoardLot[],
  rosterSize: number,
) {
  const ordered = [...teams].sort((a, b) => a.position - b.position);
  const picksPerTeam = rosterSize - 1;
  const made = lots.filter((lot) => lot.state === 'SOLD' && !lot.captain).length;
  if (made >= ordered.length * picksPerTeam) return null;
  const round = Math.floor(made / ordered.length);
  const index = made % ordered.length;
  return ordered[round % 2 ? ordered.length - 1 - index : index];
}

// The lot being offered now: the next one drawn that has not been decided.
export const currentLot = <T extends BoardLot>(lots: readonly T[]): T | null =>
  [...lots].filter((lot) => lot.state === 'WAITING').sort((a, b) => a.position - b.position)[0] ??
  null;

// Reserves go best seed first, and teams take one seat each in turn so nobody fills up
// on the best of them. The rulebook this comes from only fixes the player order.
export function reserveFill(
  teams: readonly BoardTeam[],
  lots: readonly BoardLot[],
  rosterSize: number,
) {
  const reserves = lots.filter((lot) => lot.state === 'RESERVE').sort(bySeed);
  const open = new Map(teams.map((team) => [team.id, seatsLeft(team, lots, rosterSize)]));
  const ordered = [...teams].sort((a, b) => a.position - b.position);
  const assignments: { lotId: string; formationTeamId: string }[] = [];
  while (reserves.length) {
    const before = assignments.length;
    for (const team of ordered) {
      if (!reserves.length || (open.get(team.id) ?? 0) <= 0) continue;
      assignments.push({ lotId: reserves.shift()!.id, formationTeamId: team.id });
      open.set(team.id, open.get(team.id)! - 1);
    }
    if (assignments.length === before) break;
  }
  return assignments;
}

// The order teams enter the next phase, best first. An unseeded captain counts for nothing
// in an average rather than dragging it to the bottom.
export function formedTeamOrder(
  teams: readonly BoardTeam[],
  lots: readonly BoardLot[],
  teamSeeding: string,
) {
  const value = (team: BoardTeam) => {
    const own = onTeam(lots, team);
    if (teamSeeding === 'CAPTAIN_SEED') return own.find((lot) => lot.captain)?.seed ?? Infinity;
    const seeded = own.flatMap((lot) => (lot.seed === null ? [] : [lot.seed]));
    return seeded.length ? seeded.reduce((a, b) => a + b, 0) / seeded.length : Infinity;
  };
  return [...teams].sort((a, b) => value(a) - value(b) || a.position - b.position);
}

export type PastedResult = {
  line: string;
  lotId: string | null;
  formationTeamId: string | null;
  reserve: boolean;
  price: number | null;
  error: string | null;
};
const RESERVE_WORDS = /^(reserves?|unsold|no bids?|riserv[ae]|invenduto)$/i;
const PRICE = /(?:^|[\s,;|-])[$€£]?\s*(\d[\d.,]*)\s*[$€£]?\s*$/;
const SOLD_TO =
  /^(.+?)\s+(?:sold to|bought by|goes to|venduto a|to)\s+(.+?)(?:\s+(?:for|per|a))?$/i;

// Reads results an auction bot printed, one player per line, in any common shape. Nothing
// here changes the board: the operator reviews the rows, then they apply as ordinary sales.
export function parsePastedResults(
  text: string,
  lots: readonly BoardLot[],
  teams: readonly BoardTeam[],
): PastedResult[] {
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const captainOf = (team: BoardTeam) =>
    lots.find((lot) => lot.captain && lot.formationTeamId === team.id)?.username ?? '';
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const failed = (error: string): PastedResult => ({
        line,
        lotId: null,
        formationTeamId: null,
        reserve: false,
        price: null,
        error,
      });
      const priced = line.match(PRICE);
      const price = priced ? Number(priced[1].replace(/[.,]/g, '')) : null;
      const rest = (priced ? line.slice(0, priced.index) : line).trim();
      const sold = rest.match(SOLD_TO);
      const parts = sold
        ? [sold[1], sold[2]]
        : rest
            .split(/\t|[,;|]|\s+(?:-|–|->|→|=>)\s+/)
            .map((part) => part.trim())
            .filter(Boolean);
      if (parts.length < 2) return failed('Each line needs a player and a team.');
      const [player, buyer] = parts;
      const lot = lots.find(
        (item) =>
          !item.captain && (same(item.username, player) || String(item.osuId) === player.trim()),
      );
      if (!lot) return failed('No player on this board matches this line.');
      if (RESERVE_WORDS.test(buyer))
        return {
          line,
          lotId: lot.id,
          formationTeamId: null,
          reserve: true,
          price: null,
          error: null,
        };
      const team = teams.find((item) => same(item.name, buyer) || same(captainOf(item), buyer));
      if (!team) return failed('No team or captain on this board matches this line.');
      return { line, lotId: lot.id, formationTeamId: team.id, reserve: false, price, error: null };
    });
}
