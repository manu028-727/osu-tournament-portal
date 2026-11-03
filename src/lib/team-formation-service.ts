import { randomBytes } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import { resolveEntries, seededShuffle, type AdvancementIssue } from './format-advancement';
import { phaseSources } from './format-guards';
import type { FormatPhase } from './format-plan';
import { loadFormatPlan } from './format-plan-service';
import { AppError, type Actor } from './permissions';
import { registrationPolicySchema } from './registration-policy';
import { registrationOpen } from './registration-service';
import { scopedDb } from './scoped-db';
import {
  auctionSettings,
  currentLot,
  formedTeamOrder,
  moneyLeft,
  parsePastedResults,
  reserveFill,
  seatsLeft,
  snakeTurn,
  type BoardLot,
  type BoardTeam,
} from './team-formation';

type FormationPhase = Extract<FormatPhase, { kind: 'TEAM_FORMATION' }>;
export type FormationAction =
  | { type: 'formation.start'; phaseKey: string; captainTeamIds?: string[]; randomSeed?: string }
  | ({ sessionId: string; baseVersion: number } & (
      | {
          type: 'formation.assign';
          lotId: string;
          formationTeamId: string;
          price?: number | null;
          reason?: string;
        }
      | { type: 'formation.unassign'; lotId: string; reason: string }
      | { type: 'formation.reserve'; lotId: string }
      | { type: 'formation.fill' }
      | { type: 'formation.paste'; text: string; apply: boolean }
      | { type: 'formation.rename'; formationTeamId: string; name: string }
      | { type: 'formation.confirm'; incompleteReason?: string }
      | { type: 'formation.reopen'; reason: string }
      | { type: 'formation.restart'; reason: string }
    ));
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const slugPart = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'team';

// What entering this phase's board would look like, read from the sources it draws on.
async function formationEntrants(
  transaction: Prisma.TransactionClient,
  tournamentId: string,
  phases: readonly FormatPhase[],
  phase: FormationPhase,
) {
  const tx = scopedDb(transaction, tournamentId);
  const { sources } = await phaseSources(transaction, tournamentId, phases, phase, {});
  const resolved = resolveEntries(phase, sources);
  const ids = resolved.seats.flatMap((seat) => (seat.teamId ? [seat.teamId] : []));
  const teams = await tx.team.findMany({
    where: { tournamentId, id: { in: ids } },
    select: {
      id: true,
      published: true,
      status: true,
      supersededAt: true,
      members: { select: { osuId: true, registeredUsername: true, participant: true } },
    },
  });
  return {
    issues: resolved.issues,
    players: resolved.seats.flatMap((seat) => {
      const team = teams.find((item) => item.id === seat.teamId);
      return team ? [{ seed: seat.seed, team }] : [];
    }),
  };
}

export async function formationBoards(transaction: Prisma.TransactionClient, tournamentId: string) {
  const tx = scopedDb(transaction, tournamentId);
  const { plan, locked } = await loadFormatPlan(transaction, tournamentId);
  if (!plan) return [];
  const phases = plan.phases.filter(
    (phase): phase is FormationPhase => phase.kind === 'TEAM_FORMATION',
  );
  const boards = [];
  for (const phase of phases) {
    const session = await tx.formationSession.findFirst({
      where: { tournamentId, phase: { key: phase.key } },
      include: {
        teams: { orderBy: { position: 'asc' } },
        lots: { orderBy: { position: 'asc' } },
      },
    });
    let entrants: { osuId: number; username: string; teamId: string; seed: number | null }[] = [];
    let issues: AdvancementIssue[] = [];
    if (!session && locked) {
      const read = await formationEntrants(transaction, tournamentId, plan.phases, phase);
      issues = read.issues;
      const seen = new Map(read.players.map((player) => [player.team.id, player.seed]));
      // Captains may be chosen from anyone registered, so the picker offers everyone.
      const others = await tx.team.findMany({
        where: { tournamentId, status: 'APPROVED', supersededAt: null },
        select: {
          id: true,
          members: { select: { osuId: true, registeredUsername: true, participant: true } },
        },
      });
      entrants = others
        .filter((team) => team.members.length === 1)
        .map((team) => ({
          teamId: team.id,
          osuId: team.members[0].osuId,
          username: team.members[0].registeredUsername || team.members[0].participant.username,
          seed: seen.get(team.id) ?? null,
        }))
        .sort(
          (a, b) =>
            (a.seed ?? Infinity) - (b.seed ?? Infinity) || a.username.localeCompare(b.username),
        );
    }
    boards.push({
      phaseKey: phase.key,
      name: phase.name,
      method: phase.method,
      teamCount: phase.teamCount,
      rosterSize: phase.rosterSize,
      captains: phase.captains,
      auction: phase.auction ?? null,
      locked,
      issues,
      entrants,
      seats: entrants.filter((entrant) => entrant.seed !== null).length,
      session: session
        ? {
            id: session.id,
            state: session.state,
            version: session.version,
            teams: session.teams.map((team) => ({
              id: team.id,
              position: team.position,
              name: team.name,
              budget: team.budget,
              teamId: team.teamId,
              moneyLeft: moneyLeft(team, session.lots),
              seatsLeft: seatsLeft(team, session.lots, session.rosterSize),
            })),
            lots: session.lots.map((lot) => ({
              id: lot.id,
              osuId: lot.osuId,
              username: lot.username,
              seed: lot.seed,
              position: lot.position,
              captain: lot.captain,
              state: lot.state,
              formationTeamId: lot.formationTeamId,
              price: lot.price,
              filled: lot.filled,
            })),
            currentLotId: session.state === 'OPEN' ? (currentLot(session.lots)?.id ?? null) : null,
            onTheClockId:
              session.state === 'OPEN' && session.method === 'SNAKE_DRAFT'
                ? (snakeTurn(session.teams, session.lots, session.rosterSize)?.id ?? null)
                : null,
            fill:
              session.state === 'OPEN' && session.method === 'AUCTION'
                ? reserveFill(session.teams, session.lots, session.rosterSize)
                : [],
          }
        : null,
    });
  }
  return boards;
}
export type FormationBoards = Awaited<ReturnType<typeof formationBoards>>;

// What viewers and captains follow. The draw order and every organizer's reason stay
// private; only the player now on offer is revealed, as they would be in the room.
export async function publicTeamFormation(
  transaction: Prisma.TransactionClient,
  tournamentId: string,
) {
  const sessions = await scopedDb(transaction, tournamentId).formationSession.findMany({
    where: { tournamentId },
    orderBy: { createdAt: 'asc' },
    include: {
      phase: { select: { name: true } },
      teams: { orderBy: { position: 'asc' } },
      lots: { orderBy: [{ seed: 'asc' }, { username: 'asc' }] },
    },
  });
  return sessions.map((session) => {
    const current = session.state === 'OPEN' ? currentLot(session.lots) : null;
    const on =
      session.state === 'OPEN' && session.method === 'SNAKE_DRAFT'
        ? snakeTurn(session.teams, session.lots, session.rosterSize)
        : null;
    const publicLot = (lot: (typeof session.lots)[number]) => ({
      osuId: lot.osuId,
      username: lot.username,
      seed: lot.seed,
      captain: lot.captain,
      price: lot.price,
      filled: lot.filled,
    });
    return {
      name: session.phase.name,
      method: session.method,
      state: session.state,
      rosterSize: session.rosterSize,
      current: session.method === 'AUCTION' && current ? publicLot(current) : null,
      onTheClock: on?.name ?? null,
      teams: session.teams.map((team) => ({
        name: team.name,
        budget: team.budget,
        moneyLeft: moneyLeft(team, session.lots),
        players: session.lots
          .filter((lot) => lot.formationTeamId === team.id)
          .sort((a, b) => Number(b.captain) - Number(a.captain))
          .map(publicLot),
      })),
      undecided: session.lots
        .filter((lot) => lot.state === 'WAITING' && lot.id !== current?.id)
        .map(publicLot),
      reserves: session.lots.filter((lot) => lot.state === 'RESERVE').map(publicLot),
    };
  });
}

async function loadSession(
  transaction: Prisma.TransactionClient,
  tournamentId: string,
  sessionId: string,
  baseVersion: number,
) {
  const tx = scopedDb(transaction, tournamentId);
  const session = await tx.formationSession.findFirst({
    where: { id: sessionId, tournamentId },
    include: { teams: { orderBy: { position: 'asc' } }, lots: { orderBy: { position: 'asc' } } },
  });
  if (!session) throw new AppError('Team formation not found.', 404);
  if (session.version !== baseVersion)
    throw new AppError('The board changed in another session. Reload before continuing.', 409);
  return session;
}
type Session = Awaited<ReturnType<typeof loadSession>>;

async function recordEvent(
  transaction: Prisma.TransactionClient,
  actor: Actor,
  tournamentId: string,
  session: Pick<Session, 'id' | 'version'>,
  kind: string,
  data: Record<string, unknown>,
  reason = '',
  update: Prisma.FormationSessionUpdateInput = {},
) {
  const tx = scopedDb(transaction, tournamentId);
  const version = session.version + 1;
  await tx.formationSession.update({
    where: { id: session.id },
    data: { ...update, version },
  });
  await tx.formationEvent.create({
    data: {
      tournamentId,
      sessionId: session.id,
      sequence: version,
      kind,
      data: json(data),
      reason,
      actorId: actor.id,
    },
  });
  return { sessionId: session.id, version };
}

// One decision about one player, with the same checks whether typed or pasted.
function assignmentProblem(
  session: Session,
  lots: readonly BoardLot[],
  teams: readonly BoardTeam[],
  lotId: string,
  formationTeamId: string,
  price: number | null | undefined,
  reason: string | undefined,
) {
  const lot = lots.find((item) => item.id === lotId);
  const team = teams.find((item) => item.id === formationTeamId);
  if (!lot || lot.captain) return 'Choose a player on this board.';
  if (!team) return 'Choose a team on this board.';
  if (lot.state === 'SOLD') return 'This player already has a team. Undo that first.';
  if (seatsLeft(team, lots, session.rosterSize) <= 0) return 'This team is already full.';
  if (session.method === 'AUCTION') {
    const { minimumRaise } = auctionSettings(session.settings);
    if (typeof price !== 'number' || price < minimumRaise)
      return 'A sale needs a price of at least the minimum raise.';
    if (price > (moneyLeft(team, lots) ?? 0)) return 'This team cannot afford that price.';
  } else if (price !== null && price !== undefined) return 'Only an auction has prices.';
  if (
    session.method === 'SNAKE_DRAFT' &&
    snakeTurn(teams, lots, session.rosterSize)?.id !== team.id &&
    (reason ?? '').trim().length < 3
  )
    return 'Another team is on the clock. Give a reason to pick out of turn.';
  return null;
}

export async function applyFormationAction(
  transaction: Prisma.TransactionClient,
  actor: Actor,
  tournamentId: string,
  a: FormationAction,
) {
  const tx = scopedDb(transaction, tournamentId);
  if (a.type === 'formation.start') {
    const { plan, locked } = await loadFormatPlan(transaction, tournamentId);
    const phase = plan?.phases.find((item) => item.key === a.phaseKey);
    if (!plan || phase?.kind !== 'TEAM_FORMATION')
      throw new AppError('Choose a team formation phase.');
    if (!locked) throw new AppError('Lock the format before starting team formation.', 409);
    const row = await tx.tournamentPhase.findFirstOrThrow({
      where: { tournamentId, key: phase.key },
    });
    if (await tx.formationSession.count({ where: { phaseId: row.id } }))
      throw new AppError('This team formation has already started.', 409);
    const tournament = await tx.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
      include: { settings: true },
    });
    const policy = registrationPolicySchema.parse(tournament.settings?.registrationPolicy || {});
    if (registrationOpen(policy, tournament.status, false))
      throw new AppError('Close registration before forming teams.', 409);
    const read = await formationEntrants(transaction, tournamentId, plan.phases, phase);
    const blocking = read.issues.find((issue) => issue.severity === 'ERROR');
    if (blocking)
      throw new AppError(
        blocking.message,
        409,
        blocking.values?.map(
          (value) => plan.phases.find((item) => item.key === value)?.name ?? value,
        ),
      );
    const seats = read.players;
    let captains: { seed: number | null; team: (typeof seats)[number]['team'] }[];
    if (phase.captains === 'TOP_SEEDS') captains = seats.slice(0, phase.teamCount);
    else {
      const chosen = a.captainTeamIds ?? [];
      if (new Set(chosen).size !== phase.teamCount || chosen.length !== phase.teamCount)
        throw new AppError('Choose exactly {0} captains.', 400, [phase.teamCount]);
      const teams = await tx.team.findMany({
        where: { tournamentId, id: { in: chosen }, status: 'APPROVED', supersededAt: null },
        select: {
          id: true,
          published: true,
          status: true,
          supersededAt: true,
          members: { select: { osuId: true, registeredUsername: true, participant: true } },
        },
      });
      if (teams.length !== chosen.length)
        throw new AppError('Every captain must be an approved entrant in this tournament.');
      captains = chosen.map((id) => ({
        seed: seats.find((seat) => seat.team.id === id)?.seed ?? null,
        team: teams.find((team) => team.id === id)!,
      }));
    }
    if (captains.length < phase.teamCount)
      throw new AppError('Only {0} players are available to captain {1} teams.', 409, [
        captains.length,
        phase.teamCount,
      ]);
    const players = seats.filter(
      (seat) => !captains.some((captain) => captain.team.id === seat.team.id),
    );
    if ([...captains, ...players].some((seat) => seat.team.members.length !== 1))
      throw new AppError('Team formation needs solo entrants, each holding one player.', 409);
    const randomSeed =
      phase.auction?.lotOrder === 'RANDOM'
        ? (a.randomSeed ?? randomBytes(12).toString('hex'))
        : null;
    const drawn = randomSeed ? seededShuffle(players, randomSeed, phase.key) : players;
    const session = await tx.formationSession.create({
      data: {
        tournamentId,
        phaseId: row.id,
        method: phase.method,
        rosterSize: phase.rosterSize,
        teamSeeding: phase.teamSeeding,
        settings: json(phase.auction ?? {}),
        randomSeed,
      },
    });
    const nameOf = (seat: (typeof captains)[number]) =>
      seat.team.members[0].registeredUsername || seat.team.members[0].participant.username;
    const lot = (
      seat: (typeof captains)[number],
      position: number,
      extra: { captain?: boolean; state?: string; formationTeamId?: string } = {},
    ) => ({
      tournamentId,
      sessionId: session.id,
      sourceTeamId: seat.team.id,
      sourcePublished: seat.team.published,
      osuId: seat.team.members[0].osuId,
      username: nameOf(seat),
      seed: seat.seed,
      position,
      ...extra,
    });
    for (const [position, captain] of captains.entries()) {
      const team = await tx.formationTeam.create({
        data: {
          tournamentId,
          sessionId: session.id,
          position,
          name: `Team ${nameOf(captain)}`,
          budget: phase.auction?.budget ?? null,
        },
      });
      await tx.formationLot.create({
        data: lot(captain, position, { captain: true, state: 'SOLD', formationTeamId: team.id }),
      });
    }
    await tx.formationLot.createMany({
      data: drawn.map((seat, index) => lot(seat, captains.length + index)),
    });
    // Captains could otherwise keep editing the rosters this board is about to move.
    const navigation = (tournament.settings!.navigation as { label: string; href: string }[]) ?? [];
    await tx.tournamentSettings.update({
      where: { tournamentId },
      data: {
        registrationPolicy: json({ ...policy, rosterLocked: true }),
        ...(navigation.some((link) => link.href === '/team-formation')
          ? {}
          : { navigation: [...navigation, { label: 'Team formation', href: '/team-formation' }] }),
      },
    });
    await tx.tournament.update({
      where: { id: tournamentId },
      data: { version: { increment: 1 } },
    });
    await tx.tournamentPhase.update({
      where: { id: row.id },
      data: { state: 'ACTIVE', version: { increment: 1 } },
    });
    return recordEvent(transaction, actor, tournamentId, session, 'START', {
      captains: captains.map((captain) => captain.team.members[0].osuId),
      players: players.length,
      randomSeed,
    });
  }

  const session = await loadSession(transaction, tournamentId, a.sessionId, a.baseVersion);
  if (a.type === 'formation.reopen')
    return reopen(transaction, actor, tournamentId, session, a.reason);
  if (session.state !== 'OPEN') throw new AppError('Reopen team formation to change it.', 409);
  const teamNamed = (id: string | null) => session.teams.find((team) => team.id === id)?.name;

  if (a.type === 'formation.assign') {
    const problem = assignmentProblem(
      session,
      session.lots,
      session.teams,
      a.lotId,
      a.formationTeamId,
      a.price,
      a.reason,
    );
    if (problem) throw new AppError(problem, 409);
    const lot = session.lots.find((item) => item.id === a.lotId)!;
    await tx.formationLot.update({
      where: { id: lot.id },
      data: {
        state: 'SOLD',
        formationTeamId: a.formationTeamId,
        price: a.price ?? null,
        filled: false,
      },
    });
    return recordEvent(
      transaction,
      actor,
      tournamentId,
      session,
      'ASSIGN',
      { osuId: lot.osuId, team: teamNamed(a.formationTeamId), price: a.price ?? null },
      a.reason?.trim() ?? '',
    );
  }
  if (a.type === 'formation.unassign' || a.type === 'formation.reserve') {
    const lot = session.lots.find((item) => item.id === a.lotId);
    if (!lot || lot.captain) throw new AppError('Choose a player on this board.');
    await tx.formationLot.update({
      where: { id: lot.id },
      data: {
        state: a.type === 'formation.reserve' ? 'RESERVE' : 'WAITING',
        formationTeamId: null,
        price: null,
        filled: false,
      },
    });
    return recordEvent(
      transaction,
      actor,
      tournamentId,
      session,
      a.type === 'formation.reserve' ? 'RESERVE' : 'UNASSIGN',
      { osuId: lot.osuId, team: teamNamed(lot.formationTeamId) ?? null, price: lot.price },
      a.type === 'formation.unassign' ? a.reason : '',
    );
  }
  if (a.type === 'formation.fill') {
    if (session.method !== 'AUCTION') throw new AppError('Only an auction has reserves to fill.');
    if (session.lots.some((lot) => lot.state === 'WAITING'))
      throw new AppError('Offer every player before filling teams from the reserves.', 409);
    const price = auctionSettings(session.settings).reserveFillPrice;
    const fills = reserveFill(session.teams, session.lots, session.rosterSize);
    if (!fills.length) throw new AppError('No team has a seat to fill from the reserves.', 409);
    for (const fill of fills)
      await tx.formationLot.update({
        where: { id: fill.lotId },
        data: { state: 'SOLD', formationTeamId: fill.formationTeamId, price, filled: true },
      });
    return recordEvent(transaction, actor, tournamentId, session, 'FILL', {
      price,
      players: fills.map((fill) => ({
        osuId: session.lots.find((lot) => lot.id === fill.lotId)!.osuId,
        team: teamNamed(fill.formationTeamId),
      })),
    });
  }
  if (a.type === 'formation.paste') {
    const rows = parsePastedResults(a.text, session.lots, session.teams);
    // Later rows are judged against the board as earlier ones leave it.
    const lots = session.lots.map((lot) => ({ ...lot }));
    const checked = rows.map((row) => {
      if (row.error || row.reserve) return row;
      const problem = assignmentProblem(
        session,
        lots,
        session.teams,
        row.lotId!,
        row.formationTeamId!,
        row.price,
        session.method === 'SNAKE_DRAFT' ? 'Pasted results' : undefined,
      );
      if (problem) return { ...row, error: problem };
      const lot = lots.find((item) => item.id === row.lotId)!;
      lot.state = 'SOLD';
      lot.formationTeamId = row.formationTeamId;
      lot.price = row.price;
      return row;
    });
    if (!a.apply) return { rows: checked };
    if (!checked.length || checked.some((row) => row.error))
      throw new AppError('Fix the highlighted lines before applying these results.', 409);
    for (const row of checked)
      await tx.formationLot.update({
        where: { id: row.lotId! },
        data: row.reserve
          ? { state: 'RESERVE', formationTeamId: null, price: null }
          : { state: 'SOLD', formationTeamId: row.formationTeamId, price: row.price },
      });
    return recordEvent(transaction, actor, tournamentId, session, 'PASTE', {
      lines: checked.map((row) => row.line),
    });
  }
  if (a.type === 'formation.rename') {
    const team = session.teams.find((item) => item.id === a.formationTeamId);
    if (!team) throw new AppError('Choose a team on this board.');
    await tx.formationTeam.update({ where: { id: team.id }, data: { name: a.name } });
    return recordEvent(transaction, actor, tournamentId, session, 'RENAME', {
      from: team.name,
      to: a.name,
    });
  }
  if (a.type === 'formation.restart') {
    const events = await tx.formationEvent.findMany({
      where: { sessionId: session.id },
      orderBy: { sequence: 'asc' },
    });
    await tx.formationLot.deleteMany({ where: { sessionId: session.id } });
    await tx.formationEvent.deleteMany({ where: { sessionId: session.id } });
    await tx.formationTeam.deleteMany({ where: { sessionId: session.id } });
    await tx.formationSession.delete({ where: { id: session.id } });
    await tx.tournamentPhase.update({
      where: { id: session.phaseId },
      data: { state: 'LOCKED', version: { increment: 1 } },
    });
    // The board is gone, so the audit entry keeps what it recorded.
    return { restarted: true, reason: a.reason, events: json(events) };
  }

  // Confirm: the only step that moves anyone. Until here every decision could be undone.
  const short = session.teams.filter((team) => seatsLeft(team, session.lots, session.rosterSize));
  if (short.length && (a.incompleteReason ?? '').trim().length < 3)
    throw new AppError('{0} teams are not full. Give a reason to confirm them anyway.', 409, [
      short.length,
    ]);
  const sold = session.lots.filter((lot) => lot.state === 'SOLD');
  const rows = await tx.teamMember.findMany({
    where: { tournamentId, osuId: { in: sold.map((lot) => lot.osuId) } },
  });
  for (const lot of sold)
    if (!rows.some((row) => row.osuId === lot.osuId && row.teamId === lot.sourceTeamId))
      throw new AppError('{0} is no longer on their registered entry. Reload the board.', 409, [
        lot.username,
      ]);
  const now = new Date();
  const order = formedTeamOrder(session.teams, session.lots, session.teamSeeding);
  const taken = new Set(
    (await tx.team.findMany({ where: { tournamentId }, select: { slug: true } })).map(
      (team) => team.slug,
    ),
  );
  for (const [index, formation] of order.entries()) {
    let slug = slugPart(formation.name);
    for (let attempt = 2; taken.has(slug); attempt++)
      slug = `${slugPart(formation.name)}-${attempt}`;
    taken.add(slug);
    const team = await tx.team.create({
      data: {
        tournamentId,
        name: formation.name,
        slug,
        format: 'TEAM',
        seed: index + 1,
        position: index,
        status: 'APPROVED',
        published: true,
      },
    });
    const own = sold
      .filter((lot) => lot.formationTeamId === formation.id)
      .sort(
        (a, b) =>
          Number(b.captain) - Number(a.captain) ||
          (a.seed ?? Infinity) - (b.seed ?? Infinity) ||
          a.position - b.position,
      );
    for (const [position, lot] of own.entries())
      await tx.teamMember.update({
        where: { teamId_osuId: { teamId: lot.sourceTeamId, osuId: lot.osuId } },
        data: { teamId: team.id, captain: lot.captain, substitute: false, position },
      });
    await tx.formationTeam.update({ where: { id: formation.id }, data: { teamId: team.id } });
  }
  // Their qualifier history stays attached to the original entrant, whose status stands.
  await tx.team.updateMany({
    where: { tournamentId, id: { in: sold.map((lot) => lot.sourceTeamId) } },
    data: { supersededAt: now, published: false, version: { increment: 1 } },
  });
  await tx.tournamentPhase.update({
    where: { id: session.phaseId },
    data: { state: 'COMPLETE', version: { increment: 1 } },
  });
  return recordEvent(
    transaction,
    actor,
    tournamentId,
    session,
    'CONFIRM',
    { teams: order.map((team) => team.name) },
    a.incompleteReason?.trim() ?? '',
    { state: 'CONFIRMED', confirmedAt: now },
  );
}

// Puts every player back on their registered entry, while nothing depends on the teams.
async function reopen(
  transaction: Prisma.TransactionClient,
  actor: Actor,
  tournamentId: string,
  session: Session,
  reason: string,
) {
  const tx = scopedDb(transaction, tournamentId);
  if (session.state !== 'CONFIRMED') throw new AppError('This board is still open.', 409);
  const teamIds = session.teams.flatMap((team) => (team.teamId ? [team.teamId] : []));
  const where = { tournamentId, teamId: { in: teamIds } };
  if (
    (await tx.bracketEntry.count({ where })) ||
    (await tx.bracketSlot.count({ where })) ||
    (await tx.qualifierEntry.count({ where })) ||
    (await tx.resourcePurchase.count({ where })) ||
    (await tx.resourceAdjustment.count({ where })) ||
    (await tx.match.count({
      where: { tournamentId, OR: [{ teamAId: { in: teamIds } }, { teamBId: { in: teamIds } }] },
    }))
  )
    throw new AppError(
      'These teams have entered a later phase, so they can no longer change.',
      409,
    );
  const members = await tx.teamMember.findMany({ where });
  const sold = session.lots.filter((lot) => lot.state === 'SOLD');
  if (
    members.length !== sold.length ||
    members.some((member) => {
      const lot = sold.find((item) => item.osuId === member.osuId);
      const formation = session.teams.find((team) => team.teamId === member.teamId);
      return !lot || lot.formationTeamId !== formation?.id;
    })
  )
    throw new AppError('A formed roster was edited after confirmation. Undo that first.', 409);
  for (const lot of sold) {
    const formation = session.teams.find((team) => team.id === lot.formationTeamId)!;
    await tx.teamMember.update({
      where: { teamId_osuId: { teamId: formation.teamId!, osuId: lot.osuId } },
      data: { teamId: lot.sourceTeamId, captain: true, substitute: false, position: 0 },
    });
    await tx.team.update({
      where: { id: lot.sourceTeamId },
      data: { supersededAt: null, published: lot.sourcePublished, version: { increment: 1 } },
    });
  }
  await tx.formationTeam.updateMany({
    where: { sessionId: session.id },
    data: { teamId: null },
  });
  await tx.team.deleteMany({ where: { tournamentId, id: { in: teamIds } } });
  await tx.tournamentPhase.update({
    where: { id: session.phaseId },
    data: { state: 'ACTIVE', version: { increment: 1 } },
  });
  return recordEvent(transaction, actor, tournamentId, session, 'REOPEN', {}, reason, {
    state: 'OPEN',
    confirmedAt: null,
  });
}
