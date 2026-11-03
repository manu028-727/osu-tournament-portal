import type { Prisma } from '@/generated/prisma/client';
import { AppError, type Actor } from './permissions';
import { resourcePolicy, teamBalance, type ConfirmedMatch } from './resources';
import { scopedDb } from './scoped-db';

export type ResourceAction =
  | {
      type: 'resource.item.save';
      id?: string;
      baseVersion?: number;
      name: string;
      description: string;
      price: number;
      unlockStageId: string | null;
      published: boolean;
    }
  | { type: 'resource.item.archive'; id: string; baseVersion: number }
  | {
      type: 'resource.purchase';
      teamId: string;
      itemId: string;
      stageId: string | null;
      expectedPrice: number;
      note: string;
    }
  | { type: 'resource.purchase.reverse'; id: string; reason: string }
  | { type: 'resource.adjust'; teamId: string; amount: number; reason: string };

// The round a bracket node sits in, as its key reads: g2-r3 is the third round of its lane.
const roundNumber = (key: string | undefined) => {
  const match = key?.match(/-r(\d+)$/);
  return match ? Number(match[1]) : null;
};

async function ledgers(transaction: Prisma.TransactionClient, tournamentId: string) {
  const tx = scopedDb(transaction, tournamentId);
  const settings = await tx.tournamentSettings.findUnique({ where: { tournamentId } });
  const policy = resourcePolicy(settings?.resourcePolicy);
  const [teams, formed, matches, purchases, adjustments] = await Promise.all([
    tx.team.findMany({
      where: { tournamentId, status: 'APPROVED', supersededAt: null },
      orderBy: [{ seed: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
      select: { id: true, name: true, published: true },
    }),
    tx.formationTeam.findMany({
      where: { tournamentId, teamId: { not: null } },
      include: { lots: { select: { price: true } } },
    }),
    tx.match.findMany({
      where: { tournamentId, status: 'COMPLETED', deletedAt: null },
      select: {
        code: true,
        teamAId: true,
        teamBId: true,
        winnerSide: true,
        results: { where: { voided: false }, select: { winnerSide: true } },
        bracketNode: { select: { round: { select: { lane: true, key: true } } } },
      },
    }),
    tx.resourcePurchase.findMany({
      where: { tournamentId },
      orderBy: { createdAt: 'asc' },
      include: {
        item: { select: { name: true } },
        stage: { select: { id: true, name: true } },
      },
    }),
    tx.resourceAdjustment.findMany({ where: { tournamentId }, orderBy: { createdAt: 'asc' } }),
  ]);
  const confirmed: ConfirmedMatch[] = matches.map((match) => ({
    code: match.code,
    lane: match.bracketNode?.round.lane ?? null,
    round: roundNumber(match.bracketNode?.round.key),
    teamAId: match.teamAId,
    teamBId: match.teamBId,
    winnerSide: match.winnerSide,
    mapWinners: match.results.map((result) => result.winnerSide),
  }));
  // Once teams are formed they hold the budgets, and unsold players have nothing to spend.
  const holders = formed.length
    ? teams.filter((team) => formed.some((row) => row.teamId === team.id))
    : teams;
  return {
    policy,
    purchases,
    teams: holders.map((team) => {
      const auction = formed.find((row) => row.teamId === team.id && row.budget !== null);
      const ownPurchases = purchases.filter((row) => row.teamId === team.id);
      const ownAdjustments = adjustments.filter((row) => row.teamId === team.id);
      return {
        ...team,
        purchases: ownPurchases,
        adjustments: ownAdjustments,
        ...teamBalance(team.id, {
          policy,
          auction: auction
            ? {
                budget: auction.budget!,
                spent: auction.lots.reduce((total, lot) => total + (lot.price ?? 0), 0),
              }
            : null,
          matches: confirmed,
          purchases: ownPurchases.map((row) => ({
            price: row.price,
            reversed: !!row.reversedAt,
          })),
          adjustments: ownAdjustments,
        }),
      };
    }),
  };
}

export async function resourceBoard(transaction: Prisma.TransactionClient, tournamentId: string) {
  const tx = scopedDb(transaction, tournamentId);
  const [{ policy, teams }, items, stages] = await Promise.all([
    ledgers(transaction, tournamentId),
    tx.resourceItem.findMany({
      where: { tournamentId, archivedAt: null },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    }),
    tx.tournamentStage.findMany({
      where: { tournamentId, archivedAt: null },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true },
    }),
  ]);
  return {
    policy,
    stages,
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      price: item.price,
      unlockStageId: item.unlockStageId,
      published: item.published,
      version: item.version,
    })),
    teams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      starting: team.starting,
      spentAtAuction: team.spentAtAuction,
      earned: team.earned,
      purchased: team.purchased,
      adjusted: team.adjusted,
      balance: team.balance,
      purchases: team.purchases.map((row) => ({
        id: row.id,
        item: row.item.name,
        stage: row.stage?.name ?? null,
        price: row.price,
        note: row.note,
        reversed: !!row.reversedAt,
        reversedReason: row.reversedReason,
      })),
      adjustments: team.adjustments.map((row) => ({
        id: row.id,
        amount: row.amount,
        reason: row.reason,
      })),
    })),
  };
}
export type ResourceBoard = Awaited<ReturnType<typeof resourceBoard>>;

// What the public may follow when organizers allow it: totals and what was bought, never
// notes, reasons or items organizers have not revealed yet.
export async function publicResources(transaction: Prisma.TransactionClient, tournamentId: string) {
  const tx = scopedDb(transaction, tournamentId);
  const { policy, teams } = await ledgers(transaction, tournamentId);
  if (!policy.enabled || !policy.public) return null;
  const items = await tx.resourceItem.findMany({
    where: { tournamentId, archivedAt: null, published: true },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: {
      name: true,
      description: true,
      price: true,
      unlockStage: { select: { name: true } },
    },
  });
  return {
    currency: policy.currency,
    items: items.map((item) => ({
      name: item.name,
      description: item.description,
      price: item.price,
      unlocksAt: item.unlockStage?.name ?? null,
    })),
    teams: teams
      .filter((team) => team.published)
      .map((team) => ({
        name: team.name,
        balance: team.balance,
        purchases: team.purchases
          .filter((row) => !row.reversedAt)
          .map((row) => ({ item: row.item.name, stage: row.stage?.name ?? null })),
      })),
  };
}

export async function applyResourceAction(
  transaction: Prisma.TransactionClient,
  actor: Actor,
  tournamentId: string,
  a: ResourceAction,
) {
  const tx = scopedDb(transaction, tournamentId);
  const stage = async (id: string | null) => {
    if (!id) return null;
    const row = await tx.tournamentStage.findFirst({
      where: { id, tournamentId, archivedAt: null },
      select: { id: true, position: true },
    });
    if (!row) throw new AppError('Choose a stage in this tournament.');
    return row;
  };
  if (a.type === 'resource.item.save') {
    await stage(a.unlockStageId);
    const fields = {
      name: a.name,
      description: a.description,
      price: a.price,
      unlockStageId: a.unlockStageId,
      published: a.published,
    };
    if (!a.id) {
      const position = await tx.resourceItem.count({ where: { tournamentId } });
      const row = await tx.resourceItem.create({ data: { ...fields, tournamentId, position } });
      return { id: row.id };
    }
    const updated = await tx.resourceItem.updateMany({
      where: { id: a.id, tournamentId, version: a.baseVersion, archivedAt: null },
      data: { ...fields, version: { increment: 1 } },
    });
    if (!updated.count)
      throw new AppError('This item changed in another session. Reload before saving.', 409);
    return { id: a.id };
  }
  if (a.type === 'resource.item.archive') {
    const updated = await tx.resourceItem.updateMany({
      where: { id: a.id, tournamentId, version: a.baseVersion, archivedAt: null },
      data: { archivedAt: new Date(), version: { increment: 1 } },
    });
    if (!updated.count)
      throw new AppError('This item changed in another session. Reload before saving.', 409);
    return { id: a.id };
  }
  if (a.type === 'resource.purchase.reverse') {
    const updated = await tx.resourcePurchase.updateMany({
      where: { id: a.id, tournamentId, reversedAt: null },
      data: { reversedAt: new Date(), reversedById: actor.id, reversedReason: a.reason },
    });
    if (!updated.count) throw new AppError('This purchase was already reversed.', 409);
    return { id: a.id };
  }
  const team = await tx.team.findFirst({
    where: { id: a.teamId, tournamentId, status: 'APPROVED', supersededAt: null },
    select: { id: true },
  });
  if (!team) throw new AppError('Choose an approved team in this tournament.');
  if (a.type === 'resource.adjust') {
    const row = await tx.resourceAdjustment.create({
      data: {
        tournamentId,
        teamId: team.id,
        amount: a.amount,
        reason: a.reason,
        actorId: actor.id,
      },
    });
    return { id: row.id };
  }
  const { policy, teams } = await ledgers(transaction, tournamentId);
  if (!policy.enabled) throw new AppError('Turn budgets on before recording purchases.', 409);
  const item = await tx.resourceItem.findFirst({
    where: { id: a.itemId, tournamentId, archivedAt: null },
    include: { unlockStage: { select: { name: true, position: true } } },
  });
  if (!item) throw new AppError('Choose an item that is still on sale.');
  if (item.price !== a.expectedPrice)
    throw new AppError('The price of this item changed. Reload before buying it.', 409);
  const bought = await stage(a.stageId);
  if ((item.unlockStage || policy.maxPerStage) && !bought)
    throw new AppError('Choose the stage this purchase is for.');
  if (item.unlockStage && bought!.position < item.unlockStage.position)
    throw new AppError('{0} only unlocks at {1}.', 409, [item.name, item.unlockStage.name]);
  if (
    policy.maxPerStage &&
    (await tx.resourcePurchase.count({
      where: { tournamentId, teamId: team.id, stageId: a.stageId, reversedAt: null },
    })) >= policy.maxPerStage
  )
    throw new AppError('This team has already bought {0} items for this stage.', 409, [
      policy.maxPerStage,
    ]);
  const balance = teams.find((row) => row.id === team.id)?.balance ?? 0;
  if (item.price > balance)
    throw new AppError('This team has {0} {1} and the item costs {2}.', 409, [
      policy.currency,
      balance,
      item.price,
    ]);
  const row = await tx.resourcePurchase.create({
    data: {
      tournamentId,
      itemId: item.id,
      teamId: team.id,
      stageId: a.stageId,
      price: item.price,
      note: a.note,
      actorId: actor.id,
    },
  });
  return { id: row.id };
}
