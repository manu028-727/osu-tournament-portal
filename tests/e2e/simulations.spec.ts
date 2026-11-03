import { test, expect, type Page } from '@playwright/test';
import { drawGroups } from '../../src/lib/format-advancement';
import { COMPATIBILITY_PLANS } from '../fixtures/format-plans';
import {
  action,
  advancePhase,
  bracketOf,
  cleanupSimulation,
  createPlayers,
  createTournament,
  db,
  evidence,
  importEntrants,
  lockFormat,
  openWorkspace,
  login,
  loginAs,
  playBracket,
  playerName,
  playMatch,
  publishPool,
  read,
  runQualifier,
  setupSimulation,
  stagesOf,
  type Tour,
  unique,
} from './helpers/simulation';

// Each scenario runs a real rulebook's shape from an empty tournament. Distinctive decisions
// are made on screen, while volume work like hundreds of scores uses the same requests the
// screens send, so nothing here reaches past the application. These prove behaviour on mock
// providers and synthetic players, not on live Bancho.
test.setTimeout(Number(process.env.SIM_TIMEOUT ?? 900_000));
// A locator that will never match should fail in seconds, not use up the whole scenario.
test.use({ actionTimeout: 30_000 });
test.beforeAll(setupSimulation);
test.afterAll(cleanupSimulation);

const POOL = [
  { name: 'NM1', category: 'NM' },
  { name: 'NM2', category: 'NM' },
  { name: 'HD1', category: 'HD' },
  { name: 'HR1', category: 'HR' },
  { name: 'DT1', category: 'DT' },
  { name: 'FM1', category: 'FM' },
  { name: 'TB1', category: 'TB' },
];
// Fills every stage's planned pool, returning the maps its qualifier plays.
async function publishAllPools(page: Page, t: Tour) {
  let qualifier: string[] = [];
  for (const stage of await stagesOf(t)) {
    const slots = await publishPool(page, t, stage.id, POOL);
    if (stage.kind === 'QUALIFIERS') qualifier = slots.map((slot) => slot.name);
  }
  return qualifier;
}
async function saveScoring(page: Page, t: Tour, change: () => Promise<void>) {
  await openWorkspace(page, t, 'scoring');
  await change();
  await page.getByRole('button', { name: 'Save scoring and mods' }).click();
  await expect(page.getByText('Scoring saved.')).toBeVisible();
}
const qualifierStage = async (t: Tour) =>
  (await stagesOf(t)).find((stage) => stage.kind === 'QUALIFIERS')!;

// Teams of two starters and a substitute, listed best seed first.
async function teamsOfThree(page: Page, t: Tour, count: number) {
  const players = await createPlayers(count * 3);
  const teams = await importEntrants(
    page,
    t,
    Array.from({ length: count }, (_, index) => {
      const roster = players.slice(index * 3, index * 3 + 3);
      return {
        name: `Team ${String(index + 1).padStart(2, '0')}`,
        players: roster,
        substitutes: [roster[2]],
      };
    }),
    'TEAM',
  );
  return teams;
}

test('MIR Cup as its rules document reads: top 16 into double elimination, accuracy wins', async ({
  page,
  context,
}) => {
  await login(context);
  const t = await createTournament(page, unique('MIR document'), {
    template: /^Qualifiers, then bracket/,
    numbers: { 'Players per side': 2, 'Players on a roster': 3, 'Entrants in the bracket': 16 },
    selects: { 'Seeding method': 'Z-Sum' },
    doubleElimination: true,
  });
  await saveScoring(page, t, async () => {
    await page
      .getByLabel('Maps are won by')
      .selectOption({ label: 'Highest team average accuracy' });
    await page.getByLabel('Mods required on every map').fill('RX');
  });
  const saved = await db.tournamentSettings.findUniqueOrThrow({ where: { tournamentId: t.id } });
  expect(saved.matchRules).toMatchObject({
    teamSize: 2,
    requiredMods: ['RX'],
    enforceNoFail: false,
    winCondition: { metric: 'ACCURACY', teamAggregation: 'AVERAGE', applyMultipliers: false },
  });

  const slots = await publishAllPools(page, t);
  const teams = await teamsOfThree(page, t, 20);
  const members = (team: (typeof teams)[number]) => team.members;
  await runQualifier(page, t, {
    stageId: (await qualifierStage(t)).id,
    entrants: teams.map((team) => ({ id: team.id, members: members(team) })),
    slots,
    score: (entrant, player, slot) => 900_000 - entrant * 5_000 - player * 100 + slot * 37,
    mods: ['RX'],
    cutoff: 16,
  });
  await lockFormat(page, t);
  await advancePhase(page, t, 'Main bracket');
  const bracket = await bracketOf(t, 'main');
  const entries = await db.bracketEntry.findMany({
    where: { tournamentId: t.id, bracketId: bracket },
  });
  expect(entries).toHaveLength(16);

  // Seed 1 meets seed 16, and the team with the worse raw score but better accuracy wins.
  const opening = await db.bracketNode.findFirstOrThrow({
    where: { tournamentId: t.id, bracketId: bracket, state: 'READY' },
    orderBy: { matchNumber: 'asc' },
    include: { match: true },
  });
  const match = opening.match!;
  const [teamA, teamB] = [match.teamAId, match.teamBId].map((id) =>
    teams.find((team) => team.id === id)!,
  );
  const side = (team: (typeof teams)[number], side: 'A' | 'B', rows: [number, number, number][]) =>
    rows.map(([index, score, accuracy]) => ({
      osuId: team.members[index].osuId,
      side,
      score,
      accuracy,
      mods: ['RX'],
    }));
  await playMatch(page, t, match.id, {
    winner: 'A',
    play: (_, map) => ({
      // Team A's starters change between maps, so a 2-of-3 lineup is really exercised.
      scoreA: 0,
      scoreB: 0,
      players: [
        ...side(teamA, 'A', [
          [map === 0 ? 0 : 1, 700_000, 97.12],
          [map === 0 ? 1 : 2, 650_000, 95.5],
        ]),
        ...side(teamB, 'B', [
          [0, 950_000, 94],
          [1, 940_000, 96],
        ]),
      ],
    }),
  });
  const results = await db.matchMapResult.findMany({
    where: { matchId: match.id, voided: false },
    orderBy: { createdAt: 'asc' },
  });
  // Averaged, unmultiplied, and with decimals intact: (97.12 + 95.5) / 2 against (94 + 96) / 2.
  expect(results[0].scoreA).toBeCloseTo(96.31, 5);
  expect(results[0].scoreB).toBeCloseTo(95, 5);
  expect(results.every((result) => result.winnerSide === 'A')).toBe(true);

  await page.goto(`/t/${t.slug}/admin/referee/${match.id}`);
  await expect(page.getByText('96.31').first()).toBeVisible();
  await page.screenshot({ path: `${evidence}/mir-document-accuracy-1366.png`, fullPage: true });
  const stored = await db.match.findUniqueOrThrow({ where: { id: match.id } });
  expect(stored.winnerSide).toBe('A');
});

// Waits for the real bracket, because the page first shows a loading placeholder.
async function bracketEvidence(page: Page, t: Tour, name: string) {
  await page.goto(`/t/${t.slug}/admin/matches?view=bracket`);
  await expect(page.getByText('Managed by the tournament format').first()).toBeVisible();
  await page.screenshot({ path: `${evidence}/${name}-1366.png`, fullPage: true });
}

const byName = (teams: { id: string; name: string }[]) => {
  const rank = new Map(teams.map((team, index) => [team.id, index]));
  // Entrants are listed best seed first, so the lower index wins unless a test says otherwise.
  return (teamA: string, teamB: string): 'A' | 'B' =>
    rank.get(teamA)! < rank.get(teamB)! ? 'A' : 'B';
};

test('MIR Cup as its brief reads: top 16 into four groups of four, then double elimination', async ({
  page,
  context,
}) => {
  await login(context);
  const t = await createTournament(page, unique('MIR brief'), {
    template: /^Qualifiers, groups, then bracket/,
    numbers: {
      'Players per side': 2,
      'Players on a roster': 3,
      'Groups per tier': 4,
      'Entrants per group': 4,
    },
    selects: { 'Seeding method': 'Z-Sum' },
    doubleElimination: true,
  });
  const slots = await publishAllPools(page, t);
  const teams = await teamsOfThree(page, t, 20);
  await runQualifier(page, t, {
    stageId: (await qualifierStage(t)).id,
    entrants: teams.map((team) => ({ id: team.id, members: team.members })),
    slots,
    score: (entrant, player, slot) => 900_000 - entrant * 5_000 - player * 100 + slot * 37,
    cutoff: 16,
  });
  await lockFormat(page, t);
  await advancePhase(page, t, 'Group stage');
  const groups = await bracketOf(t, 'groups');
  const entries = await db.bracketEntry.findMany({
    where: { tournamentId: t.id, bracketId: groups },
  });
  expect(entries).toHaveLength(16);
  for (const group of [1, 2, 3, 4]) {
    const own = entries.filter((entry) => entry.groupIndex === group);
    expect(own).toHaveLength(4);
    // Each group holds one entrant from each pot, so seeds are spread rather than clustered.
    expect(own.map((entry) => entry.pot).sort()).toEqual([0, 1, 2, 3]);
  }
  const win = byName(teams);
  expect(await playBracket(page, t, groups, win)).toBe(24);
  await advancePhase(page, t, 'Main bracket');
  const main = await bracketOf(t, 'main');
  const seated = await db.bracketEntry.findMany({
    where: { tournamentId: t.id, bracketId: main },
    orderBy: { seed: 'asc' },
  });
  expect(seated).toHaveLength(8);
  // The top two of each group go through: seeds 1-8, because the better seed always won here.
  const index = (id: string) => teams.findIndex((team) => team.id === id);
  expect(seated.map((entry) => index(entry.teamId)).sort((a, b) => a - b)).toEqual([
    0, 1, 2, 3, 4, 5, 6, 7,
  ]);
  // Eight teams in double elimination, without a reset when the Winners champion wins.
  expect(await playBracket(page, t, main, win)).toBe(14);
  await bracketEvidence(page, t, 'mir-brief-bracket');
});

test('Italian Cup 9: direct seeds, seeded groups and placement routing with rematch limits', async ({
  page,
  context,
}) => {
  await login(context);
  const t = await createTournament(page, unique('Italian Cup'), {
    template: /^Top seeds skip groups/,
    numbers: {
      'Players per side': 1,
      'Players on a roster': 1,
      'Seeds skipping groups': 4,
      'Groups per tier': 4,
      'Entrants per group': 4,
    },
    selects: { 'Seeding method': 'Z-Sum' },
  });
  const slots = await publishAllPools(page, t);
  const players = await createPlayers(24);
  const teams = await importEntrants(
    page,
    t,
    players.map((osuId, index) => ({
      name: `Solo ${String(index + 1).padStart(2, '0')}`,
      players: [osuId],
    })),
    'INDIVIDUAL',
  );
  await runQualifier(page, t, {
    stageId: (await qualifierStage(t)).id,
    entrants: teams.map((team) => ({ id: team.id, members: team.members })),
    slots,
    score: (entrant, _, slot) => 900_000 - entrant * 5_000 + slot * 37,
    cutoff: 20,
  });
  await lockFormat(page, t);

  // Choose a draw where two entrants who will finish second and third share a group, so the
  // standard Losers pairing would make them replay each other.
  const phaseRow = await db.tournamentPhase.findFirstOrThrow({
    where: { tournamentId: t.id, key: 'groups' },
  });
  const phase = phaseRow.config as unknown as Parameters<typeof drawGroups>[0];
  const entrants = Array.from({ length: 16 }, (_, index) => ({
    teamId: teams[index + 4].id,
    seed: index + 5,
    value: null,
  }));
  const groupOf = (seed: string) => {
    const { groups } = drawGroups(phase, entrants, { randomSeed: seed });
    return (qualifierSeed: number) =>
      groups.find((group) => group.teams.some((team) => team.seed === qualifierSeed))!.group;
  };
  const randomSeed = Array.from({ length: 500 }, (_, index) => `draw-${index}`).find((seed) => {
    const group = groupOf(seed);
    return [
      [9, 16],
      [10, 15],
      [11, 14],
      [12, 13],
    ].some(([a, b]) => group(a) === group(b));
  })!;
  const draw = await action<{ reviewHash: string }>(page, t, {
    type: 'format.advance.preview',
    phaseKey: 'groups',
    randomSeed,
  });
  await action(page, t, {
    type: 'format.advance',
    phaseKey: 'groups',
    randomSeed,
    reviewHash: draw.reviewHash,
  });

  const groupBracket = await bracketOf(t, 'groups');
  const win = byName(teams);
  // A forfeit in a group: the win counts, but as this format reads it, no map difference.
  const forfeited = await db.bracketNode.findFirstOrThrow({
    where: { tournamentId: t.id, bracketId: groupBracket, state: 'READY' },
    orderBy: { matchNumber: 'asc' },
    include: { match: true },
  });
  const firstTo = ((forfeited.match!.rules as { bestOf: number }).bestOf + 1) / 2;
  const forfeitWinner = win(forfeited.match!.teamAId!, forfeited.match!.teamBId!);
  await action(page, t, {
    type: 'match.forfeit',
    id: forfeited.match!.id,
    baseVersion: forfeited.match!.version,
    winnerSide: forfeitWinner,
    reason: 'No show after ten minutes',
  });
  const afterForfeit = await db.match.findUniqueOrThrow({ where: { id: forfeited.match!.id } });
  await action(page, t, {
    type: 'match.confirm',
    id: afterForfeit.id,
    baseVersion: afterForfeit.version,
    reason: 'No show verified',
  });
  await playBracket(page, t, groupBracket, win);
  const standings = await read<{
    brackets: {
      id: string;
      standings?: { teamId: string; played: number; wins: number; mapDifference: number }[];
    }[];
  }>(page, t, 'competition');
  const rows = standings.brackets.find((bracket) => bracket.id === groupBracket)!.standings!;
  const winnerId = forfeitWinner === 'A' ? forfeited.match!.teamAId! : forfeited.match!.teamBId!;
  const row = rows.find((item) => item.teamId === winnerId)!;
  expect(row.played).toBe(3);
  // Two played wins count their maps. The forfeit adds a win and nothing to the difference.
  expect(row.mapDifference).toBe(2 * firstTo);

  // The solver moves the conflict out of the opening round, and records that it did.
  const preview = await action<{
    reviewHash: string;
    changes: unknown[];
    issues: { code: string }[];
    seats: { seed: number; lane: string; teamId: string; detail: string }[];
  }>(page, t, { type: 'format.advance.preview', phaseKey: 'main' });
  expect(preview.changes.length).toBeGreaterThan(0);
  expect(preview.issues.filter((issue) => issue.code === 'REMATCH_INFEASIBLE')).toEqual([]);
  await advancePhase(page, t, 'Main bracket');
  const mainBracket = await bracketOf(t, 'main');
  const drawnEntries = await db.bracketEntry.findMany({
    where: { tournamentId: t.id, bracketId: groupBracket },
  });
  const sameGroup = (a: string | null, b: string | null) =>
    !!a &&
    !!b &&
    drawnEntries.find((entry) => entry.teamId === a)?.groupIndex ===
      drawnEntries.find((entry) => entry.teamId === b)?.groupIndex &&
    drawnEntries.some((entry) => entry.teamId === a);
  const opening = await db.bracketNode.findMany({
    where: { tournamentId: t.id, bracketId: mainBracket },
    include: { slots: true, round: true },
  });
  for (const node of opening.filter((item) => item.state === 'READY')) {
    const [a, b] = node.slots.map((slot) => slot.teamId);
    expect(sameGroup(a, b), `${node.key} is a rematch`).toBe(false);
  }

  const main = await db.bracketEntry.findMany({
    where: { tournamentId: t.id, bracketId: mainBracket },
    orderBy: { seed: 'asc' },
  });
  expect(main.filter((entry) => entry.entryLane === 'WINNERS')).toHaveLength(8);
  const lower = main.filter((entry) => entry.entryLane === 'LOSERS');
  expect(lower).toHaveLength(8);
  // Starting in Losers means one life, unlike a player who drops from Winners.
  expect(lower.every((entry) => entry.lossesAllowed === 1)).toBe(true);
  await playBracket(page, t, mainBracket, win);
  const worst = lower.at(-1)!;
  const played = await db.match.count({
    where: {
      tournamentId: t.id,
      status: 'COMPLETED',
      bracketNode: { bracketId: mainBracket },
      OR: [{ teamAId: worst.teamId }, { teamBId: worst.teamId }],
    },
  });
  expect(played).toBe(1);
  await bracketEvidence(page, t, 'italian-cup-bracket');
});

test('OIDC 2026: rank and country screening, two runs and Z-Sum', async ({ page, context }) => {
  await login(context);
  const t = await createTournament(page, unique('OIDC'), {
    template: /^Qualifiers, then bracket/,
    numbers: { 'Players per side': 2, 'Players on a roster': 2, 'Entrants in the bracket': 16 },
    selects: { 'Seeding method': 'Z-Sum', 'Qualifier playthroughs': 'Twice' },
    doubleElimination: true,
  });
  const slots = await publishAllPools(page, t);

  // The written limits, entered where an organizer enters them.
  await openWorkspace(page, t, 'registration');
  await page.getByText('Eligibility limits').click();
  await page.getByLabel('Maximum rank (optional)').fill('99999');
  await page.getByLabel('Lowest team rank sum (optional)').fill('5000');
  await page.getByLabel('Highest team rank sum (optional)').fill('150000');
  await page.getByLabel('Eligible countries (ISO codes, optional)').fill('IT, SM, VA');
  await page.getByLabel('Eligible countries (ISO codes, optional)').blur();
  await page
    .getByLabel('When a player does not meet these limits')
    .selectOption({ label: 'Keep it for an organizer to decide' });
  await page.getByRole('button', { name: 'Save registration' }).click();
  await expect(page.getByText('Registration settings saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Open registration', exact: true }).click();
  await expect(page.getByText('Registration opened.')).toBeVisible();
  await openWorkspace(page, t, 'publication');
  await page.getByRole('button', { name: 'Publish tournament' }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unpublish tournament' })).toBeVisible();

  const [inA, inB, lowA, lowB, flagA, flagB, overA, overB] = await createPlayers(
    8,
    (index) =>
      [
        { rank: 75_000 },
        { rank: 75_000 },
        { rank: 2_000 },
        { rank: 2_000 },
        { rank: 6_000 },
        { rank: 7_000, country: 'FR' },
        { rank: 100_000 },
        { rank: 5_000 },
      ][index],
  );
  const register = async (captain: number, mate: number, name: string) => {
    await loginAs(context, captain);
    await page.goto(`/t/${t.slug}/register`);
    await page.getByLabel('Entry name').fill(name);
    await page.getByRole('button', { name: 'Add player' }).click();
    await page.getByLabel('Player osu! ID').fill(String(mate));
    await page.getByRole('button', { name: 'Register', exact: true }).click();
    await expect(page.getByText('Your registration')).toBeVisible();
    return db.team.findFirstOrThrow({ where: { tournamentId: t.id, name } });
  };
  // Exactly at the highest allowed sum, this goes straight through.
  const atLimit = await register(inA, inB, 'At the limit');
  expect(atLimit.status).toBe('APPROVED');
  // Under the lowest sum, and outside a personal limit: both wait for a decision.
  const tooLow = await register(lowA, lowB, 'Too low');
  expect(tooLow).toMatchObject({ status: 'PENDING', published: false });
  const tooHigh = await register(overA, overB, 'Too high');
  expect(tooHigh.status).toBe('PENDING');
  // A player from elsewhere can be admitted after an interview, before even registering.
  await login(context);
  await openWorkspace(page, t, 'registration');
  await page.getByText('Allowed exceptions').click();
  await page.getByLabel('osu! ID').fill(String(flagB));
  await page.getByLabel('Limit to lift').selectOption({ label: 'Country limit' });
  await page.getByLabel('Reason').fill('Passed the language interview');
  await page.getByRole('button', { name: 'Allow this player' }).click();
  await expect(page.getByText('Exception recorded.')).toBeVisible();
  const interviewed = await register(flagA, flagB, 'Interviewed');
  expect(interviewed.status).toBe('APPROVED');

  await login(context);
  await openWorkspace(page, t, 'registration');
  await expect(
    page.getByText('The team rank sum of 4000 is outside the allowed range.'),
  ).toBeVisible();
  await expect(
    page.getByText(`${playerName(overA)} is rank 100000, outside the allowed range.`),
  ).toBeVisible();
  await page.screenshot({ path: `${evidence}/oidc-eligibility-1366.png`, fullPage: true });
  const lowRow = page.locator('li').filter({ hasText: 'Too low' }).first();
  // Approving without deciding is refused, and says what still needs deciding.
  await lowRow.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(
    page.getByText('The team rank sum of 4000 is outside the allowed range.').first(),
  ).toBeVisible();
  expect((await db.team.findUniqueOrThrow({ where: { id: tooLow.id } })).status).toBe('PENDING');
  await lowRow.getByLabel('Why this is allowed').fill('Host ruling on this pair');
  await lowRow.getByRole('button', { name: 'Allow', exact: true }).click();
  await expect(page.getByText('Exception recorded.')).toBeVisible();
  await page
    .locator('li')
    .filter({ hasText: 'Too low' })
    .first()
    .getByRole('button', { name: 'Approve', exact: true })
    .click();
  await expect(page.getByText('Team approved.')).toBeVisible();
  expect((await db.team.findUniqueOrThrow({ where: { id: tooLow.id } })).status).toBe('APPROVED');
  await action(page, t, {
    type: 'team.status',
    id: tooHigh.id,
    baseVersion: tooHigh.version,
    status: 'REJECTED',
    published: true,
    rejectionReason: 'Outside the rank limit',
  });

  // Registration closes and ranks lock. A later rank change no longer affects anyone.
  const tournament = await db.tournament.findUniqueOrThrow({ where: { id: t.id } });
  const settings = await db.tournamentSettings.findUniqueOrThrow({ where: { tournamentId: t.id } });
  await action(page, t, {
    type: 'settings.save',
    baseVersion: tournament.version,
    status: 'UPCOMING',
    registrationPolicy: {
      ...(settings.registrationPolicy as object),
      rankLockAt: new Date(Date.now() - 1000).toISOString(),
    },
  });
  await openWorkspace(page, t, 'registration');
  await page.getByRole('button', { name: /^Record locked ranks/ }).click();
  await expect(page.getByText('Ranks recorded.')).toBeVisible();
  const locked = await db.teamMember.findUniqueOrThrow({
    where: { tournamentId_osuId: { tournamentId: t.id, osuId: inA } },
  });
  expect(locked).toMatchObject({ registrationRank: 75_000 });
  expect(locked.rankCapturedAt).toBeTruthy();

  // The rank sum shows publicly, because the rules care about it.
  await page.goto(`/t/${t.slug}/teams`);
  await expect(page.getByText('150,000').first()).toBeVisible();

  // Fill the field, then qualify: a team's better run on each map counts, into a Z-Sum.
  const others = await createPlayers(26);
  await importEntrants(
    page,
    t,
    Array.from({ length: 13 }, (_, index) => ({
      name: `Filler ${String(index + 1).padStart(2, '0')}`,
      players: others.slice(index * 2, index * 2 + 2),
    })),
    'TEAM',
  );
  const teams = await db.team.findMany({
    where: { tournamentId: t.id, status: 'APPROVED' },
    include: { members: { orderBy: { position: 'asc' } } },
    orderBy: { name: 'asc' },
  });
  const raw = (entrant: number, player: number, slot: number, run: number) =>
    500_000 + ((entrant * 7919 + player * 104_729 + slot * 1_299_709 + run * 15_485_863) % 400_000);
  const stage = await qualifierStage(t);
  await runQualifier(page, t, {
    stageId: stage.id,
    entrants: teams.map((team) => ({ id: team.id, members: team.members })),
    slots,
    runs: 2,
    score: raw,
    cutoff: 16,
  });
  const standing = await read<{
    preview: { rows: { participantId: string; value: number; seed: number | null }[] };
  }>(page, t, 'qualifier-standings', `&stageId=${stage.id}`);
  // Worked out here independently of the application, from the scores it was given.
  const perMap = slots.map((_, slot) =>
    teams.map((_, entrant) =>
      Math.max(...[1, 2].map((run) => raw(entrant, 0, slot, run) + raw(entrant, 1, slot, run))),
    ),
  );
  const zSum = teams.map((_, entrant) =>
    perMap.reduce((total, values) => {
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const deviation = Math.sqrt(
        values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1),
      );
      return total + (values[entrant] - mean) / deviation;
    }, 0),
  );
  for (const [index, team] of teams.entries()) {
    const row = standing.preview.rows.find((item) => item.participantId === team.id)!;
    expect(row.value).toBeCloseTo(zSum[index], 6);
  }
});

test('Italian Draft Cup 3: solo qualifiers, a captain auction, then budgets and perks', async ({
  page,
  context,
}) => {
  await login(context);
  const t = await createTournament(page, unique('Draft Cup'), {
    template: /^Individual qualifiers, then a draft/,
    numbers: { 'Players per side': 3, 'Players on a roster': 5, Teams: 8 },
    selects: { 'Seeding method': 'Average map placement', 'Formation method': 'Auction' },
    doubleElimination: true,
  });
  // The written auction: $4000, raises of $100, drawn in random order, $400 from the reserves.
  await openWorkspace(page, t, 'format');
  await page.getByLabel('Budget per captain').fill('4000');
  await page.getByLabel('Minimum raise').fill('100');
  await page.getByLabel('Price to fill from reserves').fill('400');
  await page.getByLabel('Lot order').selectOption({ label: 'Random draw' });
  await page.getByRole('button', { name: 'Save format' }).click();
  await expect(page.getByText(/saved/i).first()).toBeVisible();

  const slots = await publishAllPools(page, t);
  const players = await createPlayers(40);
  const entries = await importEntrants(
    page,
    t,
    players.map((osuId, index) => ({
      name: `Solo ${String(index + 1).padStart(2, '0')}`,
      players: [osuId],
    })),
    'INDIVIDUAL',
  );
  await runQualifier(page, t, {
    stageId: (await qualifierStage(t)).id,
    entrants: entries.map((team) => ({ id: team.id, members: team.members })),
    slots,
    score: (entrant, _, slot) => 900_000 - entrant * 5_000 + slot,
    cutoff: 40,
  });
  await lockFormat(page, t);

  // Hosts choose the captains, and these are not the best seeds.
  await openWorkspace(page, t, 'format');
  const board = page.getByRole('region', { name: 'Phases' });
  const captains = players.slice(32);
  for (const osuId of captains)
    await board.getByRole('checkbox', { name: new RegExp(playerName(osuId)) }).check();
  await page.getByRole('button', { name: 'Start team formation' }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(board.getByText('Now offering')).toBeVisible();
  const session = await db.formationSession.findFirstOrThrow({ where: { tournamentId: t.id } });
  expect(session.randomSeed).toBeTruthy();
  const waiting = () =>
    db.formationLot.findMany({
      where: { sessionId: session.id, state: 'WAITING' },
      orderBy: { position: 'asc' },
    });

  // The first two players on the operator's own screen: a sale and a player with no bids.
  const decision = board.locator('form').filter({ has: page.getByLabel('Winning price') });
  const teamName = (index: number) => `Team ${playerName(captains[index])}`;
  await decision.getByLabel('Team').selectOption({ label: teamName(0) });
  await decision.getByLabel('Winning price').fill('1200');
  await decision.getByRole('button', { name: 'Sold', exact: true }).click();
  await expect(page.getByText('Sale recorded.')).toBeVisible();
  await decision.getByRole('button', { name: 'No bids', exact: true }).click();
  await expect(page.getByText(/moved to the reserves/)).toBeVisible();

  // The rest as a bot would print them. Team 1 has three seats left, teams 2-4 four each, and
  // teams 5-8 three each, leaving four seats for the reserves below.
  const seats = [3, 4, 4, 4, 3, 3, 3, 3];
  const remaining = await waiting();
  const lines: string[] = [];
  let lot = 0;
  for (const [team, count] of seats.entries())
    for (let seat = 0; seat < count; seat++)
      lines.push(`${remaining[lot++].username}, ${teamName(team)}, $500`);
  for (; lot < remaining.length; lot++) lines.push(`${remaining[lot].username} - unsold`);
  await board.getByText('Paste results from a bot').click();
  await board.getByRole('textbox', { name: 'One player per line' }).fill(lines.join('\n'));
  await board.getByRole('button', { name: 'Check lines' }).click();
  await expect(page.getByText('Lines checked.')).toBeVisible();
  await board.getByRole('button', { name: `Apply ${lines.length} lines` }).click();
  await expect(page.getByText('Results applied.')).toBeVisible();

  // Four seats stay open, so the best four reserves fill them at the written price.
  await expect(board.getByText('Fill 4 open seats from the reserves')).toBeVisible();
  await board.getByRole('button', { name: 'Fill from reserves' }).click();
  await expect(page.getByText('Teams filled.')).toBeVisible();
  const filled = await db.formationLot.findMany({
    where: { sessionId: session.id, filled: true },
    orderBy: { seed: 'asc' },
  });
  expect(filled.map((row) => row.price)).toEqual([400, 400, 400, 400]);
  const reserves = await db.formationLot.findMany({
    where: { sessionId: session.id, state: 'RESERVE' },
  });
  expect(Math.max(...filled.map((row) => row.seed!))).toBeLessThan(
    Math.min(...reserves.map((row) => row.seed!), Infinity),
  );
  await page.screenshot({ path: `${evidence}/draft-cup-board-1366.png`, fullPage: true });
  await page.getByRole('button', { name: 'Confirm teams' }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('Teams confirmed.')).toBeVisible();

  // Team seeds come from their players' average seed, which the rulebook leaves to be read.
  const formed = await db.team.findMany({
    where: { tournamentId: t.id, format: 'TEAM' },
    include: { members: true },
    orderBy: { seed: 'asc' },
  });
  expect(formed).toHaveLength(8);
  expect(formed.every((team) => team.members.length === 5)).toBe(true);
  const lots = await db.formationLot.findMany({ where: { sessionId: session.id } });
  const average = (team: (typeof formed)[number]) => {
    const seeds = team.members.flatMap((member) => {
      const seed = lots.find((row) => row.osuId === member.osuId)?.seed;
      return seed ? [seed] : [];
    });
    return seeds.reduce((a, b) => a + b, 0) / seeds.length;
  };
  const averages = formed.map(average);
  expect(averages).toEqual([...averages].sort((a, b) => a - b));

  // Budget rules as written: $200 a map, $100 past the second Losers round, two items a stage.
  await openWorkspace(page, t, 'resources');
  await page.getByLabel('Teams have a budget they can spend on items').check();
  await page.getByLabel('Earned per map won').fill('200');
  await page.getByLabel('Most items a team can buy for one stage (optional)').fill('2');
  await page.getByRole('button', { name: 'Add a rate' }).click();
  await page.getByLabel('From round').fill('3');
  await page.getByRole('spinbutton', { name: 'Per map won', exact: true }).fill('100');
  await page.getByRole('button', { name: 'Save budget rules' }).click();
  await expect(page.getByText('Budget rules saved.')).toBeVisible();

  const stages = await stagesOf(t);
  const quarterfinals = stages.find((stage) => stage.name === 'Quarterfinals')!;
  const semifinals = stages.find((stage) => stage.name === 'Semifinals')!;
  const newItem = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Add item' }) });
  await newItem.getByLabel('Item', { exact: true }).fill('Early perk');
  await newItem.getByLabel('Price').fill('500');
  await newItem.getByLabel('Unlocks at').selectOption({ label: 'Quarterfinals' });
  await newItem.getByLabel('What it does').fill('Effect applied by the referee');
  await newItem.getByLabel('Revealed').check();
  await newItem.getByRole('button', { name: 'Add item' }).click();
  await expect(page.getByText('Item saved.')).toBeVisible();
  const late = await action<{ id: string }>(page, t, {
    type: 'resource.item.save',
    name: 'Later perk',
    price: 800,
    unlockStageId: semifinals.id,
    published: false,
  });
  const early = await db.resourceItem.findFirstOrThrow({
    where: { tournamentId: t.id, name: 'Early perk' },
  });

  await advancePhase(page, t, 'Main bracket');
  const main = await bracketOf(t, 'main');
  // The team that spent $1200 on its first player, and its opening match.
  const buyer = formed.find((team) =>
    team.members.some((member) => member.captain && member.osuId === captains[0]),
  )!;
  const opening = await db.bracketNode.findFirstOrThrow({
    where: {
      tournamentId: t.id,
      bracketId: main,
      state: 'READY',
      match: { OR: [{ teamAId: buyer.id }, { teamBId: buyer.id }] },
    },
    include: { match: true },
  });
  const match = opening.match!;
  const ledger = async (teamId: string) => {
    const data = await read<{
      resources: { teams: { id: string; balance: number; earned: number }[] };
    }>(page, t, 'setup');
    return data.resources.teams.find((team) => team.id === teamId)!;
  };
  // 4000, minus 1200, 500 three times, and nothing else for this team.
  expect((await ledger(buyer.id)).balance).toBe(4000 - 1200 - 1500);

  // Purchases hold to their unlock stage, the stage limit and the money.
  const buy = (itemId: string, stageId: string, expectedPrice: number) =>
    page.evaluate(
      async ({ scope, body }) =>
        (
          await fetch(`/api/admin/action?tournament=${scope}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        ).json(),
      {
        scope: t.slug,
        body: { type: 'resource.purchase', teamId: buyer.id, itemId, stageId, expectedPrice },
      },
    );
  expect((await buy(late.id, quarterfinals.id, 800)).error).toContain('only unlocks at');
  await openWorkspace(page, t, 'resources');
  const row = page.locator('details').filter({ hasText: buyer.name }).first();
  await row.locator('summary').click();
  await row.getByLabel('Item to buy').selectOption({ label: 'Early perk ($ 500)' });
  await row.getByLabel('For stage').selectOption({ label: 'Quarterfinals' });
  await row.getByLabel('Note for staff').fill('Announced before the roll');
  await row.getByRole('button', { name: 'Record purchase' }).click();
  await expect(page.getByText('Purchase recorded.')).toBeVisible();
  expect((await ledger(buyer.id)).balance).toBe(800);
  await buy(early.id, quarterfinals.id, 500);
  expect((await buy(early.id, quarterfinals.id, 500)).error).toBeTruthy();
  expect((await ledger(buyer.id)).balance).toBe(300);

  // The referee sees what was bought. Applying it stays their job, and no score changes.
  await page.goto(`/t/${t.slug}/admin/referee/${match.id}`);
  await expect(page.getByRole('heading', { name: 'Items bought for this match' })).toBeVisible();
  await expect(page.getByText('Effect applied by the referee').first()).toBeVisible();
  await page.screenshot({ path: `${evidence}/draft-cup-referee-1366.png`, fullPage: true });

  // Earnings follow the confirmed result. The buyer loses one map, then wins the match.
  const side = match.teamAId === buyer.id ? 'A' : 'B';
  await playMatch(page, t, match.id, { winner: side, mapsLost: 1 });
  const finished = await db.match.findUniqueOrThrow({ where: { id: match.id } });
  const won = side === 'A' ? finished.scoreA : finished.scoreB;
  const rival = side === 'A' ? finished.teamBId! : finished.teamAId!;
  expect((await ledger(buyer.id)).earned).toBe(won * 200);
  expect((await ledger(rival)).earned).toBe(200);
  const beforeCorrection = (await ledger(buyer.id)).balance;

  // A wrong result is corrected, and the money follows with nothing else to record.
  await action(page, t, {
    type: 'match.result.set',
    id: match.id,
    baseVersion: finished.version,
    scoreA: side === 'A' ? 1 : won,
    scoreB: side === 'A' ? won : 1,
    winnerSide: side === 'A' ? 'B' : 'A',
    forfeitSide: null,
    externalReferee: '',
    reason: 'The referee recorded the wrong team',
    confirm: true,
    approveProgression: true,
  });
  expect((await ledger(buyer.id)).earned).toBe(200);
  expect((await ledger(buyer.id)).balance).toBe(beforeCorrection - (won - 1) * 200);

  // Past the second Losers round the lower rate applies, across a whole played bracket.
  const seedOf = new Map(formed.map((team) => [team.id, team.seed ?? 99]));
  await playBracket(page, t, main, (a, b) => (seedOf.get(a)! < seedOf.get(b)! ? 'A' : 'B'));
  const played = await db.match.findMany({
    where: { tournamentId: t.id, status: 'COMPLETED', bracketNode: { bracketId: main } },
    include: { bracketNode: { include: { round: true } } },
  });
  const lowerRate = played.filter((item) => {
    const round = Number(item.bracketNode!.round.key.split('-r')[1]);
    return item.bracketNode!.round.lane === 'LOSERS' && round >= 3;
  });
  expect(lowerRate.length).toBeGreaterThan(0);
  const expected = (teamId: string) =>
    played.reduce((total, item) => {
      const rate = lowerRate.includes(item) ? 100 : 200;
      const maps =
        item.teamAId === teamId ? item.scoreA : item.teamBId === teamId ? item.scoreB : 0;
      return total + maps * rate;
    }, 0);
  for (const team of formed) expect((await ledger(team.id)).earned).toBe(expected(team.id));

  await openWorkspace(page, t, 'publication');
  await page.getByRole('button', { name: 'Publish tournament' }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unpublish tournament' })).toBeVisible();
  await page.goto(`/t/${t.slug}/team-formation`);
  await expect(page.getByText('These teams are final.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Team balances' })).toBeVisible();
  await expect(page.getByText('Early perk', { exact: true }).first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Later perk');
  await expect(page.locator('body')).not.toContainText('Announced before the roll');
  await page.screenshot({ path: `${evidence}/draft-cup-public-1366.png`, fullPage: true });
});

test('OWC 2025: national teams, %MAX, tiers, pots, group labels, the exact RO16 and a reset', async ({
  page,
  context,
}) => {
  await login(context);
  const t = await createTournament(page, unique('OWC'), {
    template: /^Tiered groups with byes/,
    numbers: {
      'Players per side': 4,
      'Players on a roster': 8,
      'Seeds skipping groups': 8,
      'Groups per tier': 4,
      'Entrants per group': 4,
    },
    selects: { 'Seeding method': 'Percent of map maximum (%MAX)' },
  });
  // The published bracket pairs Losers entrants by hand, which a template cannot guess. The plan
  // editor sends this same request, and it reads the same stages the template created.
  const stages = await stagesOf(t);
  const stageOf = (kind: string) => stages.find((stage) => stage.kind === kind)!.id;
  const plan = JSON.parse(
    JSON.stringify(COMPATIBILITY_PLANS.owc)
      .replaceAll('stage-qualifiers', stageOf('QUALIFIERS'))
      .replaceAll('stage-groups', stageOf('GROUPS'))
      .replaceAll('stage-ro16', stageOf('ELIMINATION')),
  );
  plan.phases.find((phase: { key: string }) => phase.key === 'groups').draw = 'RANDOM_BY_POT';
  const setup = await read<{ planToken: string }>(page, t, 'setup');
  await action(page, t, { type: 'format.plan.save', baseToken: setup.planToken, plan });

  // Timers: the first overrun is a warning, then the rules name a consequence.
  await saveScoring(page, t, async () => {
    await page.getByText('Turn order and timers').click();
    await page.getByLabel('Pick timer (seconds)').fill('10');
    await page.getByText('Referee procedures').click();
    await page.getByLabel('A team’s first overrun is only a warning').check();
    await page.getByLabel('When the pick timer runs out').selectOption('RANDOM_MAP');
  });

  // National teams: one per country, each with players from that country.
  await openWorkspace(page, t, 'registration');
  await page.getByText('Eligibility limits').click();
  await page
    .getByLabel('National teams: one team per country, with players from that country')
    .check();
  await page.getByRole('button', { name: 'Save registration' }).click();
  await expect(page.getByText('Registration settings saved.')).toBeVisible();

  const slots = await publishAllPools(page, t);
  const code = (index: number) =>
    `${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + (index % 26))}`;
  const players = await createPlayers(320, (index) => ({ country: code(Math.floor(index / 8)) }));
  const teams = await importEntrants(
    page,
    t,
    Array.from({ length: 40 }, (_, index) => {
      const roster = players.slice(index * 8, index * 8 + 8);
      return {
        name: `Nation ${String(index + 1).padStart(2, '0')}`,
        players: roster,
        substitutes: roster.slice(4),
      };
    }),
    'TEAM',
  );
  await openWorkspace(page, t, 'registration');
  await expect(page.getByText('All 40 teams meet the limits above.')).toBeVisible();

  const stage = await qualifierStage(t);
  const raw = (entrant: number, player: number, slot: number) =>
    800_000 - entrant * 4_000 + ((entrant * 37 + player * 11 + slot * 7) % 900);
  await runQualifier(page, t, {
    stageId: stage.id,
    entrants: teams.map((team) => ({ id: team.id, members: team.members })),
    slots,
    score: (entrant, player, slot) => raw(entrant, player, slot),
    cutoff: 40,
  });
  // %MAX worked out here independently: each map's team total over that map's best total.
  const totals = slots.map((_, slot) =>
    teams.map((_, entrant) =>
      [0, 1, 2, 3].reduce((sum, player) => sum + raw(entrant, player, slot), 0),
    ),
  );
  const percent = teams.map((_, entrant) =>
    totals.reduce((sum, map) => sum + (map[entrant] / Math.max(...map)) * 100, 0),
  );
  const standing = await read<{
    preview: { rows: { participantId: string; value: number }[] };
  }>(page, t, 'qualifier-standings', `&stageId=${stage.id}`);
  const valueOf = new Map(standing.preview.rows.map((row) => [row.participantId, row.value]));
  teams.forEach((team, index) => expect(valueOf.get(team.id)).toBeCloseTo(percent[index], 6));

  await lockFormat(page, t);
  await advancePhase(page, t, 'Group stage');
  const groupBracket = await bracketOf(t, 'groups');
  const entries = await db.bracketEntry.findMany({
    where: { tournamentId: t.id, bracketId: groupBracket },
  });
  expect(entries).toHaveLength(32);
  // Two tiers, each drawn from its own pots, with letters given in order of source strength.
  const labelled = new Map<string, typeof entries>();
  for (const entry of entries)
    labelled.set(entry.provenance!, [...(labelled.get(entry.provenance!) ?? []), entry]);
  expect([...labelled.keys()].sort()).toEqual(
    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((letter) => `Group ${letter}`),
  );
  for (const own of labelled.values()) {
    expect(own.map((entry) => entry.pot).sort()).toEqual([0, 1, 2, 3]);
    expect(new Set(own.map((entry) => entry.tier)).size).toBe(1);
  }
  const strength = (letter: string) =>
    labelled.get(`Group ${letter}`)!.reduce((sum, entry) => sum + valueOf.get(entry.teamId)!, 0);
  for (const tier of [
    ['A', 'B', 'C', 'D'],
    ['E', 'F', 'G', 'H'],
  ])
    for (let index = 1; index < tier.length; index++)
      expect(strength(tier[index - 1])).toBeGreaterThanOrEqual(strength(tier[index]));
  expect(labelled.get('Group A')![0].tier).toBe('challengers');
  expect(labelled.get('Group E')![0].tier).toBe('contenders');

  // The timer flow on a real match, configured above and frozen into its rules.
  const win = byName(teams);
  const first = await db.bracketNode.findFirstOrThrow({
    where: { tournamentId: t.id, bracketId: groupBracket, state: 'READY' },
    orderBy: { matchNumber: 'asc' },
    include: { match: true },
  });
  const atPick = await playMatch(page, t, first.match!.id, {
    winner: 'A',
    stopBefore: 'PICK',
  });
  await action(page, t, {
    id: atPick.id,
    baseVersion: atPick.version,
    type: 'match.timer',
    command: 'START',
    kind: 'PICK',
  });
  expect((first.match!.rules as { pickSeconds: number }).pickSeconds).toBe(10);
  await page.waitForTimeout(10_500);
  await page.goto(`/t/${t.slug}/admin/referee/${first.match!.id}`);
  await page.getByText('Timers, replays and sanctions').click();
  await expect(page.getByText('The rules ask for: Warning')).toBeVisible();
  await page.getByRole('button', { name: 'Record it' }).click();
  await expect(page.getByText('Sanction recorded.')).toBeVisible();
  await expect(page.getByText('The rules ask for: A random map is chosen')).toBeVisible();
  await expect(page.getByText('!roll', { exact: false }).first()).toBeVisible();
  await page.screenshot({ path: `${evidence}/owc-timer-1366.png`, fullPage: true });

  await playBracket(page, t, groupBracket, win);
  await advancePhase(page, t, 'Main bracket');
  const main = await bracketOf(t, 'main');
  const slotsOf = await db.bracketSlot.findMany({
    where: { tournamentId: t.id, node: { bracketId: main }, entryRef: { startsWith: 'seed:' } },
    include: { node: true },
  });
  const pairs = new Map<string, number[]>();
  for (const slot of slotsOf)
    pairs.set(slot.nodeId, [...(pairs.get(slot.nodeId) ?? []), Number(slot.entryRef!.slice(5))]);
  const opening = [...pairs.values()].map((pair) => pair.sort((a, b) => a - b).join('v')).sort();
  // Winners in the published order, and Losers exactly as the event's table pairs them.
  expect(opening).toEqual(
    [
      [1, 16],
      [8, 9],
      [4, 13],
      [5, 12],
      [2, 15],
      [7, 10],
      [3, 14],
      [6, 11],
      [22, 27],
      [19, 30],
      [23, 26],
      [18, 31],
      [21, 28],
      [20, 29],
      [24, 25],
      [17, 32],
    ]
      .map(([a, b]) => `${a}v${b}`)
      .sort(),
  );
  // Seats 1-8 are the top qualifiers, and later seats follow group letters.
  const seated = await db.bracketEntry.findMany({
    where: { tournamentId: t.id, bracketId: main },
    orderBy: { seed: 'asc' },
  });
  expect(seated).toHaveLength(32);
  expect(seated.slice(0, 8).map((entry) => entry.teamId)).toEqual(
    teams.slice(0, 8).map((team) => team.id),
  );
  expect(seated.filter((entry) => entry.entryLane === 'LOSERS')).toHaveLength(16);

  // The Losers champion wins the first final, so a reset really is played.
  const played = await playBracket(page, t, main, (a, b, lane, round) =>
    lane === 'FINALS' ? (round === 'g3-r1' ? 'B' : 'A') : win(a, b),
  );
  expect(played).toBeGreaterThan(0);
  const finals = await db.match.findMany({
    where: {
      tournamentId: t.id,
      status: 'COMPLETED',
      bracketNode: { bracketId: main, round: { lane: 'FINALS' } },
    },
  });
  expect(finals).toHaveLength(2);
  await bracketEvidence(page, t, 'owc-bracket');
});

test('A format nobody has run: accuracy qualifiers, a snake draft, a league and reseeded playoffs', async ({
  page,
  context,
}) => {
  await login(context);
  const t = await createTournament(page, unique('Novel'), {
    template: /^Qualifiers, groups, then bracket/,
    numbers: {
      'Players per side': 2,
      'Players on a roster': 4,
      'Groups per tier': 4,
      'Entrants per group': 3,
    },
    selects: { 'Seeding method': 'Raw score' },
    doubleElimination: false,
  });
  const stages = await stagesOf(t);
  const stageOf = (kind: string) => stages.find((stage) => stage.kind === kind)!.id;
  const plan = JSON.parse(
    JSON.stringify(COMPATIBILITY_PLANS.novel)
      .replaceAll('stage-qualifiers', stageOf('QUALIFIERS'))
      .replaceAll('stage-league', stageOf('GROUPS'))
      .replaceAll('stage-playoffs', stageOf('ELIMINATION')),
  );
  // Eight teams rather than the shape's six: with four survivors in the playoffs, reseeding
  // changes who meets whom, which a four-team bracket has no room to show.
  const [, draft, leaguePhase, playoffsPhase] = plan.phases;
  draft.teamCount = 8;
  leaguePhase.entries[0].source.count = 8;
  leaguePhase.tiers[0] = { ...leaguePhase.tiers[0], seedTo: 8, groupSize: 8 };
  playoffsPhase.size = 8;
  playoffsPhase.entries = Array.from({ length: 8 }, (_, index) => ({
    source: {
      kind: 'PLACEMENT',
      phase: 'league',
      placement: index + 1,
      orderWithin: 'CROSS_GROUP_RANK',
    },
    seedFrom: index + 1,
  }));
  const setup = await read<{ planToken: string }>(page, t, 'setup');
  await action(page, t, { type: 'format.plan.save', baseToken: setup.planToken, plan });

  // Players qualify alone, seeded on accuracy rather than score, set up on the stage itself.
  await openWorkspace(page, t, 'stages');
  await page.getByRole('button', { name: 'Details for Qualifiers' }).click();
  await page.getByLabel('Players counted per map').fill('1');
  await page.getByLabel('Team aggregation').selectOption('AVERAGE');
  await page.getByLabel('Seeded on').selectOption('ACCURACY');
  await page.getByRole('button', { name: 'Save qualifier scoring' }).click();
  await expect(page.getByText(/saved/i).first()).toBeVisible();

  const slots = await publishAllPools(page, t);
  const players = await createPlayers(32);
  const entries = await importEntrants(
    page,
    t,
    players.map((osuId, index) => ({
      name: `Solo ${String(index + 1).padStart(2, '0')}`,
      players: [osuId],
    })),
    'INDIVIDUAL',
  );
  await runQualifier(page, t, {
    stageId: (await qualifierStage(t)).id,
    entrants: entries.map((team) => ({ id: team.id, members: team.members })),
    slots,
    // Raw score runs the opposite way to accuracy, so only the configured metric can give
    // the order this expects.
    score: (entrant) => 500_000 + entrant * 1_000,
    accuracy: (entrant) => 99 - entrant * 0.25,
    cutoff: 32,
  });
  const standing = await db.qualifierStanding.findFirstOrThrow({
    where: { tournamentId: t.id },
    orderBy: { version: 'desc' },
  });
  const rows = (
    standing.snapshot as {
      calculation: { rows: { participantId: string; seed: number; value: number }[] };
    }
  ).calculation.rows;
  const best = rows.find((row) => row.seed === 1)!;
  expect(best.participantId).toBe(entries[0].id);
  // Seeded on accuracy across every map, so the best player's total is theirs on each map.
  expect(best.value).toBeCloseTo(99 * slots.length, 6);

  await lockFormat(page, t);

  // The eight best seeds captain. The order runs down the teams and back up, and is enforced.
  await openWorkspace(page, t, 'format');
  const board = page.getByRole('region', { name: 'Phases' });
  await expect(board.getByText('The best 8 qualifier seeds become captains.')).toBeVisible();
  await page.getByRole('button', { name: 'Start team formation' }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(board.getByText('On the clock')).toBeVisible();
  type Board = {
    formation: {
      session: {
        id: string;
        version: number;
        onTheClockId: string | null;
        teams: { id: string; name: string; position: number }[];
        lots: { id: string; captain: boolean; state: string; seed: number | null }[];
      };
    }[];
  };
  const session = async () => (await read<Board>(page, t, 'setup')).formation[0].session;
  const start = await session();
  const firstPick = board
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Pick player' }) });
  await firstPick.getByLabel('Player').selectOption({ index: 1 });
  await firstPick.getByRole('button', { name: 'Pick player' }).click();
  await expect(page.getByText('Player placed.')).toBeVisible();
  const order: string[] = [start.onTheClockId!];
  for (let pick = 1; pick < 24; pick++) {
    const now = await session();
    const lot = now.lots
      .filter((item) => !item.captain && item.state !== 'SOLD')
      .sort((a, b) => a.seed! - b.seed!)[0];
    order.push(now.onTheClockId!);
    await action(page, t, {
      type: 'formation.assign',
      sessionId: now.id,
      baseVersion: now.version,
      lotId: lot.id,
      formationTeamId: now.onTheClockId,
    });
  }
  const ids = [...start.teams].sort((a, b) => a.position - b.position).map((team) => team.id);
  expect(order).toEqual([...ids, ...[...ids].reverse(), ...ids]);
  await openWorkspace(page, t, 'format');
  await page.getByRole('button', { name: 'Confirm teams' }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('Teams confirmed.')).toBeVisible();

  const formed = await db.team.findMany({
    where: { tournamentId: t.id, format: 'TEAM' },
    orderBy: { seed: 'asc' },
  });
  expect(formed).toHaveLength(8);

  // Eight hand-chosen entrants into one round robin, from the review screen.
  await openWorkspace(page, t, 'format');
  const league = page
    .locator('[class*="phase"]')
    .filter({ has: page.getByRole('heading', { name: 'League', exact: true, level: 3 }) });
  await league.getByRole('button', { name: 'Review entrants' }).click();
  for (const [index, team] of formed.entries())
    await league
      .getByRole('combobox', { name: `Choose entrant ${index + 1}` })
      .selectOption({ label: team.name });
  await league.getByRole('button', { name: 'Review entrants' }).first().click();
  await league.getByRole('button', { name: 'Apply entrants' }).click();
  await expect(page.getByText('Entrants applied.')).toBeVisible();
  const leagueBracket = await bracketOf(t, 'league');
  const seedOf = new Map(formed.map((team, index) => [team.id, index + 1]));
  // Seed 3 beats seed 2 and seed 5 beats seed 3, leaving 2 and 3 level on wins. Head-to-head,
  // the first tiebreaker after wins, must then put 3 ahead.
  const upsets = new Set(['3>2', '5>3']);
  const played = await playBracket(page, t, leagueBracket, (a, b) => {
    const [seedA, seedB] = [seedOf.get(a)!, seedOf.get(b)!];
    if (upsets.has(`${seedA}>${seedB}`)) return 'A';
    if (upsets.has(`${seedB}>${seedA}`)) return 'B';
    return seedA < seedB ? 'A' : 'B';
  });
  expect(played).toBe(28);
  const data = await read<{
    brackets: {
      id: string;
      standings?: { teamId: string; rank: number; wins: number; tied: boolean }[];
    }[];
  }>(page, t, 'competition');
  const table = data.brackets.find((bracket) => bracket.id === leagueBracket)!.standings!;
  const ranked = [...table].sort((a, b) => a.rank - b.rank);
  expect(ranked.map((row) => seedOf.get(row.teamId))).toEqual([1, 3, 2, 4, 5, 6, 7, 8]);
  expect(ranked.every((row) => !row.tied)).toBe(true);

  // Playoffs seat the whole league in its final order, and the next round waits to be reseeded.
  await advancePhase(page, t, 'Playoffs');
  const playoffs = await bracketOf(t, 'playoffs');
  const seated = await db.bracketEntry.findMany({
    where: { tournamentId: t.id, bracketId: playoffs },
    orderBy: { seed: 'asc' },
  });
  const rankOf = new Map(seated.map((entry) => [entry.teamId, entry.seed]));
  expect(seated.map((entry) => seedOf.get(entry.teamId))).toEqual([1, 3, 2, 4, 5, 6, 7, 8]);
  // Last place beats first in the opening round, so the fixed bracket would now pair 8 with 4.
  const quarterfinals = await playBracket(page, t, playoffs, (a, b) => {
    const [rankA, rankB] = [rankOf.get(a)!, rankOf.get(b)!];
    if (Math.min(rankA, rankB) === 1) return rankA === 8 ? 'A' : 'B';
    return rankA < rankB ? 'A' : 'B';
  });
  expect(quarterfinals).toBe(4);
  await openWorkspace(page, t, 'format');
  await page.getByRole('button', { name: 'Reseed next round' }).click();
  await expect(page.getByText('Next round reseeded.')).toBeVisible();
  const history = await db.phaseAdvancement.findFirstOrThrow({
    where: { tournamentId: t.id, kind: 'RESEED' },
  });
  // Best survivor against worst: 2 meets 8 and 3 meets 4, instead of 8 v 4 and 2 v 3.
  const reseeded = (history.assignment as { pairs: string[][] }).pairs.map((pair) =>
    pair.map((id) => rankOf.get(id)!).sort((a, b) => a - b),
  );
  expect(reseeded.sort((a, b) => a[0] - b[0])).toEqual([
    [2, 8],
    [3, 4],
  ]);
  // The semifinals, then a final and a third-place match, which only two survivors can fill.
  const rest = await playBracket(page, t, playoffs, (a, b) =>
    rankOf.get(a)! < rankOf.get(b)! ? 'A' : 'B',
  );
  expect(rest).toBe(4);
  const thirdPlace = await db.match.count({
    where: {
      tournamentId: t.id,
      status: 'COMPLETED',
      bracketNode: { bracketId: playoffs, round: { lane: 'THIRD_PLACE' } },
    },
  });
  expect(thirdPlace).toBe(1);
  await bracketEvidence(page, t, 'novel-bracket');
});
