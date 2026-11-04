import { expect, type BrowserContext, type Page } from '@playwright/test';
import { PrismaClient } from '../../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';

const url = process.env.TEST_DATABASE_URL!;
if (new URL(url).pathname !== '/tournament_platform_test')
  throw Error('Isolated test database required');
export const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
export const evidence = '.data/simulations-20261103';
const fixtures = process.env.E2E_OSU_FIXTURE_DIR ?? '';

// Everything these simulations create, so a run can remove exactly what it made.
const created = {
  tournaments: [] as string[],
  users: [] as string[],
  players: [] as number[],
  beatmaps: [] as number[],
  matches: [] as number[],
};
let token = '';
let ownerId = '';
let nextPlayer = randomInt(1_500_000_000, 1_600_000_000);
let nextBeatmap = randomInt(1_600_000_000, 1_690_000_000);

export const unique = (name: string) => `${name}-${randomUUID().slice(0, 8)}`;

// A simulation does hours of organizer work in seconds, which the request limit is there to stop.
// The limit is not under test here, and a click cannot be retried the way a direct request can, so
// its counters keep clearing on this test database while a simulation runs.
let clearingLimits: ReturnType<typeof setInterval> | undefined;

export async function setupSimulation() {
  clearingLimits = setInterval(() => void db.rateLimit.deleteMany({}).catch(() => undefined), 5000);
  await mkdir(evidence, { recursive: true });
  if (fixtures) await mkdir(fixtures, { recursive: true });
  token = randomBytes(32).toString('base64url');
  const user = await db.user.create({
    data: {
      osuId: nextPlayer++,
      username: unique('sim-owner'),
      avatarUrl: '',
      profileUrl: '',
      platformAdmin: true,
      sessions: {
        create: {
          id: createHash('sha256').update(token).digest('hex'),
          expiresAt: new Date(Date.now() + 6 * 3600_000),
        },
      },
    },
  });
  created.users.push(user.id);
  ownerId = user.id;
}

export async function login(context: BrowserContext, language = 'en', appearance = 'light') {
  await context.addCookies([
    { name: 'portal_appearance', value: appearance, url: 'http://localhost:3001' },
    {
      name: 'tournament_session',
      value: token,
      url: 'http://localhost:3001',
      httpOnly: true,
      sameSite: 'Lax',
    },
    { name: 'portal_language', value: language, url: 'http://localhost:3001' },
  ]);
}

export async function loginAs(context: BrowserContext, osuId: number) {
  const session = randomBytes(32).toString('base64url');
  const username = playerName(osuId);
  const user = await db.user.upsert({
    where: { osuId },
    create: { osuId, username, avatarUrl: '', profileUrl: '' },
    update: {},
  });
  created.users.push(user.id);
  await db.session.create({
    data: {
      id: createHash('sha256').update(session).digest('hex'),
      userId: user.id,
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  await context.clearCookies({ name: 'tournament_session' });
  await context.addCookies([
    {
      name: 'tournament_session',
      value: session,
      url: 'http://localhost:3001',
      httpOnly: true,
      sameSite: 'Lax',
    },
    { name: 'portal_language', value: 'en', url: 'http://localhost:3001' },
  ]);
}

export const playerName = (osuId: number) => `Sim ${osuId}`;

// Synthetic players the mock provider can serve, with a rank and flag for eligibility rules.
export async function createPlayers(
  count: number,
  shape: (index: number) => { rank?: number | null; country?: string } = () => ({}),
) {
  const ids: number[] = [];
  for (let index = 0; index < count; index++) {
    const osuId = nextPlayer++;
    const { rank = 1000 + index, country = 'IT' } = shape(index);
    created.players.push(osuId);
    await db.participant.create({
      data: { osuId, username: playerName(osuId), avatarUrl: '', country },
    });
    if (fixtures)
      await writeFile(
        `${fixtures}/user-${osuId}.json`,
        JSON.stringify({
          id: osuId,
          username: playerName(osuId),
          avatar_url: 'https://a.ppy.sh/1',
          country_code: country,
          statistics: { global_rank: rank },
        }),
      );
    ids.push(osuId);
  }
  return ids;
}

// Cached beatmaps, so saving a pool reads metadata without reaching the provider.
export async function createBeatmaps(count: number) {
  const ids: number[] = [];
  for (let index = 0; index < count; index++) {
    const id = nextBeatmap++;
    created.beatmaps.push(id);
    await db.beatmap.create({
      data: {
        id,
        mode: 'osu',
        metadata: {
          id,
          mode: 'osu',
          title: `Simulated map ${index + 1}`,
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
          url: `https://osu.ppy.sh/beatmaps/${id}`,
        },
      },
    });
    ids.push(id);
  }
  return ids;
}

// The same request every editor sends. Volume work goes through here, and each format's
// distinctive decisions go through the screen.
export type Tour = { id: string; slug: string };
export async function action<T = Record<string, unknown>>(page: Page, t: Tour, body: object) {
  const send = () =>
    page.evaluate(
      async ({ scope, body }) => {
        const response = await fetch(`/api/admin/action?tournament=${scope}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        return { ok: response.ok, status: response.status, data: await response.json() };
      },
      { scope: t.slug, body },
    );
  let result = await send();
  if (result.status === 429) {
    await db.rateLimit.deleteMany({});
    result = await send();
  }
  expect(result.ok, `${JSON.stringify(body).slice(0, 200)} -> ${JSON.stringify(result.data)}`).toBe(
    true,
  );
  return result.data as T;
}

export async function read<T = Record<string, unknown>>(
  page: Page,
  t: Tour,
  section: string,
  query = '',
) {
  return page.evaluate(
    async ({ scope, section, query }) =>
      (await fetch(`/api/admin/data?section=${section}${query}&tournament=${scope}`)).json(),
    { scope: t.slug, section, query },
  ) as Promise<T>;
}

// Phases fold shut once saved, so editing one starts by opening it.
export async function openPhase(page: Page, name: string) {
  const phase = page
    .locator('details[aria-label]')
    .filter({ has: page.locator(`summary strong`, { hasText: name }) });
  if (!(await phase.first().getAttribute('open'))) await phase.first().locator('summary').click();
  return phase.first();
}

// A fresh load, because navigating to a new hash alone would keep the current page's state.
export async function openWorkspace(page: Page, t: Tour, section: string) {
  await page.goto('about:blank');
  await page.goto(`/t/${t.slug}/admin#${section}`);
}

export type TemplateForm = {
  template: RegExp;
  numbers?: Record<string, number>;
  selects?: Record<string, string>;
  doubleElimination?: boolean;
};

// A new tournament through the chooser, then its format through the guided workspace.
export async function createTournament(page: Page, name: string, form: TemplateForm) {
  await page.goto('/admin/tournaments');
  await page.getByRole('button', { name: 'Create tournament', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  const slug = await dialog.getByLabel('URL slug').inputValue();
  await dialog.getByRole('button', { name: 'Create tournament', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/t/${slug}/admin`));
  const { id } = await db.tournament.findUniqueOrThrow({ where: { slug }, select: { id: true } });
  created.tournaments.push(id);
  const format = page.getByRole('radiogroup', { name: 'Tournament format' });
  await format.getByRole('radio', { name: form.template }).click();
  for (const [label, value] of Object.entries(form.numbers ?? {}))
    await page.getByRole('spinbutton', { name: label, exact: true }).fill(String(value));
  for (const [label, value] of Object.entries(form.selects ?? {}))
    await page.getByRole('combobox', { name: label, exact: true }).selectOption({ label: value });
  if (form.doubleElimination !== undefined)
    await page.getByLabel('Double elimination').setChecked(form.doubleElimination);
  await page.getByRole('button', { name: 'Use this format' }).click();
  await expect(page.getByText(/Template applied/)).toBeVisible();
  return { id, slug } as Tour;
}

type StageRow = { id: string; name: string; kind: string };
export const stagesOf = (t: Tour): Promise<StageRow[]> =>
  db.tournamentStage.findMany({
    where: { tournamentId: t.id, archivedAt: null },
    orderBy: { position: 'asc' },
    select: { id: true, name: true, kind: true },
  });

// Fills a stage's mappool from cached maps and publishes it, through the pool editor's actions.
export async function publishPool(
  page: Page,
  t: Tour,
  stageId: string,
  fallback: { name: string; category: string }[],
) {
  const plan = await db.poolPlan.findFirst({ where: { tournamentId: t.id, stageId } });
  const planned = (plan?.slots ?? []) as { name: string; category: string }[];
  const slots = planned.length ? planned : fallback;
  const pool = await db.mappool.findFirst({
    where: { tournamentId: t.id, stageId },
    select: { id: true, draftRevisionId: true },
  });
  const beatmaps = await createBeatmaps(slots.length);
  const categories = await db.modCategory.findMany({ where: { tournamentId: t.id } });
  const body = {
    type: 'pool.save',
    id: pool!.id,
    baseRevisionId: pool!.draftRevisionId,
    notes: '',
    slots: slots.map((slot, position) => ({
      name: slot.name,
      categoryId: categories.find((item) => item.acronym === slot.category)?.id,
      category: slot.category,
      position,
      beatmapId: beatmaps[position],
    })),
  };
  await action(page, t, body);
  const saved = await db.mappool.findUniqueOrThrow({ where: { id: pool!.id } });
  await action(page, t, {
    type: 'pool.publish',
    id: pool!.id,
    revisionId: saved.draftRevisionId,
  });
  return slots;
}

// The Teams page's own CSV import, reviewed and then applied.
export async function importEntrants(
  page: Page,
  t: Tour,
  teams: { name: string; players: number[]; substitutes?: number[]; seed?: number }[],
  format: 'TEAM' | 'INDIVIDUAL',
) {
  const rows = ['team_name,format,seed,osu_id,captain,substitute'];
  for (const team of teams) {
    team.players.forEach((osuId, index) =>
      rows.push(
        `${team.name},${format},${team.seed ?? ''},${osuId},${index === 0},${
          team.substitutes?.includes(osuId) ?? false
        }`,
      ),
    );
  }
  const csv = rows.join('\n');
  const preview = await action<{ previewHash: string; errors: string[] }>(page, t, {
    type: 'team.import.preview',
    csv,
  });
  expect(preview.errors).toEqual([]);
  await action(page, t, { type: 'team.import.apply', csv, previewHash: preview.previewHash });
  return db.team.findMany({
    where: { tournamentId: t.id },
    include: { members: { orderBy: { position: 'asc' } } },
    orderBy: { name: 'asc' },
  });
}

export async function lockFormat(page: Page, t: Tour) {
  await openWorkspace(page, t, 'format');
  await page.getByRole('button', { name: 'Lock format' }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('Format locked. Its matches are reserved.')).toBeVisible();
}

export async function cleanupSimulation() {
  clearInterval(clearingLimits);
  const where = { tournamentId: { in: created.tournaments } };
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
  await db.tournamentStage.deleteMany({ where });
  await db.team.deleteMany({ where });
  await db.modCategory.deleteMany({ where });
  await db.staffMember.deleteMany({ where });
  await db.auditLog.deleteMany({ where });
  await db.userRole.deleteMany({ where });
  await db.role.deleteMany({ where });
  await db.page.deleteMany({ where });
  await db.tournament.deleteMany({ where: { id: { in: created.tournaments } } });
  await db.session.deleteMany({ where: { userId: { in: created.users } } });
  await db.user.deleteMany({ where: { id: { in: created.users } } });
  await db.participant.deleteMany({ where: { osuId: { in: created.players } } });
  await db.beatmap.deleteMany({ where: { id: { in: created.beatmaps } } });
  if (fixtures) {
    for (const osuId of created.players)
      await rm(`${fixtures}/user-${osuId}.json`, { force: true });
    for (const id of created.matches) await rm(`${fixtures}/match-${id}.json`, { force: true });
  }
  await db.$disconnect();
}

// A Bancho match the mock provider will serve, in the shape the real API returns.
export async function createMultiplayerFixture(id: number, games: unknown[]) {
  created.matches.push(id);
  await writeFile(
    `${fixtures}/match-${id}.json`,
    JSON.stringify({
      match: { id, name: `sim ${id}` },
      first_event_id: 1,
      events: games.map((game, index) => ({ id: index + 1, game })),
    }),
  );
}

export type MapPlay = {
  scoreA?: number;
  scoreB?: number;
  players?: {
    osuId: number;
    side: 'A' | 'B';
    score: number;
    accuracy?: number;
    mods?: string[];
  }[];
};
type MatchRead = {
  match: {
    id: string;
    version: number;
    status: string;
    scoreA: number;
    scoreB: number;
    participants: Record<'A' | 'B', { members: { osuId: number; substitute: boolean }[] }>;
    rules: { teamSize: number; protectCount?: number };
    workflow: {
      phase: string;
      side: 'A' | 'B' | null;
      eligibleSlots: string[];
      currentActionId: string | null;
    };
  };
};

// Walks one match through its real state machine, the same actions the referee panel sends.
// The winner takes every map after the first `mapsLost`; `play` can supply exact scores.
export async function playMatch(
  page: Page,
  t: Tour,
  matchId: string,
  options: {
    winner: 'A' | 'B';
    mapsLost?: number;
    play?: (slot: string, map: number, winner: 'A' | 'B') => MapPlay | null;
    stopBefore?: string;
  },
) {
  const loser = options.winner === 'A' ? 'B' : 'A';
  let maps = 0;
  let slot = '';
  for (let step = 0; step < 200; step++) {
    const { match } = await read<MatchRead>(page, t, 'match', `&id=${matchId}`);
    const flow = match.workflow;
    const base = { id: matchId, baseVersion: match.version };
    if (flow.phase === options.stopBefore) return match;
    switch (flow.phase) {
      case 'PREPARATION':
        await action(page, t, { ...base, type: 'match.start' });
        break;
      case 'ROLL':
        await action(page, t, {
          ...base,
          type: 'match.roll',
          rollA: 90,
          rollB: 10,
          firstPickSide: 'A',
          firstBanSide: 'A',
          ...(match.rules.protectCount ? { firstProtectSide: 'A' } : {}),
        });
        break;
      case 'PROTECT':
      case 'BAN':
      case 'PICK':
      case 'TIEBREAKER':
        slot = flow.eligibleSlots[0];
        await action(page, t, {
          ...base,
          type: 'match.draft',
          kind: flow.phase === 'TIEBREAKER' ? 'PICK' : flow.phase,
          side: flow.side,
          slotName: slot,
        });
        break;
      case 'RESULT': {
        const winner = maps < (options.mapsLost ?? 0) ? loser : options.winner;
        const played = options.play?.(slot, maps, winner);
        maps++;
        await action(
          page,
          t,
          played
            ? {
                ...base,
                type: 'match.score',
                actionId: flow.currentActionId,
                scoreA: played.scoreA ?? 0,
                scoreB: played.scoreB ?? 0,
                players: (played.players ?? []).map((row) => ({ mods: [], ...row })),
                reason: 'Recorded from the lobby',
              }
            : {
                ...base,
                type: 'match.winner',
                actionId: flow.currentActionId,
                winnerSide: winner,
                reason: 'Recorded from the lobby',
              },
        );
        break;
      }
      case 'REVIEW':
        await action(page, t, { ...base, type: 'match.submit' });
        break;
      case 'AWAITING_CONFIRMATION':
        await action(page, t, { ...base, type: 'match.confirm', reason: 'Result verified' });
        break;
      case 'COMPLETED':
        return match;
      default:
        throw Error(`Match stopped at ${flow.phase}`);
    }
  }
  throw Error('Match did not finish');
}

// Plays whichever matches of a bracket are ready, until none are, so later rounds appear.
export async function playBracket(
  page: Page,
  t: Tour,
  bracketId: string,
  winnerOf: (teamA: string, teamB: string, lane: string, round: string) => 'A' | 'B',
) {
  let played = 0;
  for (let round = 0; round < 400; round++) {
    const node = await db.bracketNode.findFirst({
      where: {
        tournamentId: t.id,
        bracketId,
        state: 'READY',
        match: { status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
      },
      orderBy: [{ matchNumber: 'asc' }],
      include: { match: true, round: true },
    });
    if (!node?.match) return played;
    await playMatch(page, t, node.match.id, {
      winner: winnerOf(node.match.teamAId!, node.match.teamBId!, node.round.lane, node.round.key),
    });
    played++;
  }
  throw Error('Bracket did not finish');
}

// Advances a phase from the workspace, reviewing what it will do before applying it.
export async function advancePhase(page: Page, t: Tour, phaseName: string) {
  await openWorkspace(page, t, 'format');
  const phase = page
    .locator('[class*="phase"]')
    .filter({ has: page.getByRole('heading', { name: phaseName, exact: true, level: 3 }) });
  await phase.getByRole('button', { name: 'Review entrants' }).click();
  await phase.getByRole('button', { name: 'Apply entrants' }).click();
  await expect(page.getByText('Entrants applied.')).toBeVisible();
}

export async function bracketOf(t: Tour, phaseKey: string) {
  const row = await db.tournamentPhase.findFirstOrThrow({
    where: { tournamentId: t.id, key: phaseKey },
  });
  return row.bracketId!;
}

// What a player must wear on a map: its category's mods, plus what the whole event requires.
export const slotMods = (slot: string, base: string[]) => {
  const category = slot.replace(/\d+$/, '');
  return [...base, ...(['HD', 'HR', 'DT', 'EZ', 'FL'].includes(category) ? [category] : [])];
};

// Runs a qualifier: as many lobbies as it takes, every score, then finalized standings.
export async function runQualifier(
  page: Page,
  t: Tour,
  options: {
    stageId: string;
    entrants: { id: string; members: { osuId: number; substitute?: boolean }[] }[];
    slots: string[];
    runs?: number;
    score: (entrant: number, player: number, slot: number, run: number) => number;
    mods?: string[];
    accuracy?: (entrant: number, player: number, slot: number) => number;
    cutoff?: number;
  },
) {
  const { stageId, entrants, slots } = options;
  // A lobby holds sixteen active players, and at most eight teams.
  const starters = entrants[0].members.filter((member) => !member.substitute).length;
  const seats = starters === 1 ? 16 : Math.min(8, Math.floor(16 / starters));
  for (let start = 0; start < entrants.length; start += seats) {
    const seated = entrants.slice(start, start + seats);
    const code = unique('q');
    await action(page, t, {
      type: 'qualifier.create',
      code,
      stageId,
      teamIds: seated.map((entrant) => entrant.id),
      refereeIds: [ownerId],
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
      notes: '',
    });
    const lobby = await db.qualifierLobby.findFirstOrThrow({
      where: { tournamentId: t.id, code },
    });
    const current = () => db.qualifierLobby.findUniqueOrThrow({ where: { id: lobby.id } });
    await action(page, t, {
      type: 'qualifier.status',
      id: lobby.id,
      baseVersion: lobby.version,
      command: 'START',
      reason: 'Lobby opened',
    });
    for (let run = 1; run <= (options.runs ?? 1); run++)
      for (const [slotIndex, slotName] of slots.entries())
        await action(page, t, {
          type: 'qualifier.scores',
          id: lobby.id,
          baseVersion: (await current()).version,
          slotName,
          run,
          reason: 'Recorded from the lobby',
          scores: seated.flatMap((entrant, offset) =>
            entrant.members
              .filter((member) => !member.substitute)
              .map((member, player) => ({
                osuId: member.osuId,
                raw: options.score(start + offset, player, slotIndex, run),
                mods: slotMods(slotName, options.mods ?? ['NF']),
                ...(options.accuracy
                  ? { accuracy: options.accuracy(start + offset, player, slotIndex) }
                  : {}),
                passed: true,
              })),
          ),
        });
    await action(page, t, {
      type: 'qualifier.lobby',
      id: lobby.id,
      baseVersion: (await current()).version,
      lobbyUrl: `https://osu.ppy.sh/community/matches/${randomInt(1_000_000, 9_000_000)}`,
    });
    await action(page, t, {
      type: 'qualifier.status',
      id: lobby.id,
      baseVersion: (await current()).version,
      command: 'SUBMIT',
      reason: 'Lobby finished',
    });
    await action(page, t, {
      type: 'qualifier.status',
      id: lobby.id,
      baseVersion: (await current()).version,
      command: 'CONFIRM',
      reason: 'Scores verified',
    });
  }
  type Standings = {
    latest: { version: number } | null;
    preview: { sourceHash: string; issues?: unknown[] };
  };
  const standings = () => read<Standings>(page, t, 'qualifier-standings', `&stageId=${stageId}`);
  let current = await standings();
  await action(page, t, {
    type: 'qualifier.standings.calculate',
    stageId,
    baseVersion: current.latest?.version ?? 0,
    sourceHash: current.preview.sourceHash,
  });
  current = await standings();
  expect(
    current.preview.issues ?? [],
    JSON.stringify(current.preview.issues ?? []).slice(0, 600),
  ).toEqual([]);
  await action(page, t, {
    type: 'qualifier.standings.finalize',
    stageId,
    baseVersion: current.latest!.version,
    sourceHash: current.preview.sourceHash,
    tieOrder: [],
    reason: '',
    cutoff: options.cutoff ?? entrants.length,
  });
}
