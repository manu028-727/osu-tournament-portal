import { Prisma } from '@/generated/prisma/client';
import { recalculateCompetition } from './competition-engine';
import { groupResultsHash, reviewedGroupOrder } from './competition-groups';
import { allNodes } from './competition-queries';
import type { CompetitionNode } from './competition-types';
import {
  rankGroups,
  type AdvancementSources,
  type DrawnGroup,
  type GroupsPhase,
  type SourceEntrant,
} from './format-advancement';
import { loadFormatPlan } from './format-plan-service';
import type { FormatPhase } from './format-plan';
import { AppError } from './permissions';
import { qualifierSourceHash } from './qualifier-seeding';
import { qualifierStandingSnapshot } from './qualifier-standings-contract';
import { finalizedQualifierSeeds } from './qualifier-standings-service';
import { scopedDb } from './scoped-db';

export type AdvancementInput = {
  explicit?: Record<string, string[]>;
  reviewedOrder?: string[];
};
export type EntriesAssignment = AdvancementInput & {
  seats?: {
    seed: number;
    lane: string;
    teamId: string | null;
    sourcePhase: string;
    sourceRule: string;
    detail: string;
  }[];
  groups?: DrawnGroup[];
  slots: Record<string, string | null>;
  randomSeed?: string;
  overrides?: Record<string, string | null>;
  changes?: unknown[];
};
export const competitionNodeStarted = (node: CompetitionNode) =>
  !!node.match &&
  !node.match.deletedAt &&
  (node.match.status !== 'SCHEDULED' || !!node.match.startedAt);

async function latestEntries(tx: Prisma.TransactionClient, tournamentId: string, phaseId: string) {
  return tx.phaseAdvancement.findFirst({
    where: { tournamentId, phaseId, kind: 'ENTRIES' },
    orderBy: { revision: 'desc' },
  });
}

async function qualifierEntrants(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  stageId: string,
) {
  const standing = await tx.qualifierStanding.findFirst({
    where: { tournamentId, stageId },
    orderBy: { version: 'desc' },
  });
  if (!standing) return null;
  const snapshot = qualifierStandingSnapshot(standing.snapshot);
  if (snapshot.state !== 'FINALIZED') return null;
  const seeds = await finalizedQualifierSeeds(tx, tournamentId, standing.id);
  const teams = await tx.team.findMany({
    where: { tournamentId, id: { in: seeds.map((seed) => seed.teamId) } },
    select: { id: true, status: true },
  });
  return {
    standing,
    entrants: seeds.map((seed): SourceEntrant => {
      const row = snapshot.calculation.rows.find((item) => item.participantId === seed.teamId);
      return {
        teamId: seed.teamId,
        seed: seed.seed,
        value: row?.value ?? null,
        status:
          teams.find((team) => team.id === seed.teamId)?.status === 'APPROVED'
            ? 'ACTIVE'
            : 'INACTIVE',
      };
    }),
  };
}

// Reads what a phase's entries come from, with a witness of exactly those sources. The
// witness uses each source's own hash, so correcting a result makes an advancement stale.
export async function phaseSources(
  transaction: Prisma.TransactionClient,
  tournamentId: string,
  phases: readonly FormatPhase[],
  phase: Extract<FormatPhase, { entries: unknown }>,
  input: AdvancementInput,
) {
  const tx = scopedDb(transaction, tournamentId);
  const sources: AdvancementSources = {
    qualifiers: {},
    groups: {},
    explicit: input.explicit,
    reviewedOrder: input.reviewedOrder,
  };
  const witness: Record<string, unknown> = {};
  const standingIds: string[] = [];
  const bracketIds: string[] = [];
  const nodes = recalculateCompetition(await allNodes(transaction, tournamentId));
  for (const item of phase.entries) {
    const from = item.source;
    if (from.kind === 'REGISTRATION') {
      const teams = await tx.team.findMany({
        where: { tournamentId, status: 'APPROVED', supersededAt: null },
        select: { id: true, seed: true, name: true },
        orderBy: [{ seed: 'asc' }, { name: 'asc' }],
      });
      // Unseeded entrants follow seeded ones, in the order organizers see them.
      const ordered = [
        ...teams.filter((team) => team.seed !== null),
        ...teams.filter((team) => team.seed === null),
      ];
      sources.registered = ordered.map((team, index) => ({
        teamId: team.id,
        seed: index + 1,
        status: 'ACTIVE',
      }));
      witness.registered = ordered.map((team) => team.id);
      continue;
    }
    const origin = phases.find((other) => other.key === from.phase);
    if (origin?.kind === 'QUALIFIER' && !sources.qualifiers![origin.key]) {
      const loaded = await qualifierEntrants(transaction, tournamentId, origin.stageId);
      if (loaded) {
        sources.qualifiers![origin.key] = loaded.entrants;
        standingIds.push(loaded.standing.id);
        witness[`qualifier:${origin.key}`] = [loaded.standing.id, loaded.standing.sourceHash];
      }
    }
    if (origin?.kind === 'GROUPS' && !sources.groups![origin.key]) {
      const row = await tx.tournamentPhase.findFirst({
        where: { tournamentId, key: origin.key },
        include: { bracket: { include: { rounds: true, entries: true } } },
      });
      if (!row?.bracket) continue;
      const advancement = await latestEntries(transaction, tournamentId, row.id);
      const assignment = advancement?.assignment as EntriesAssignment | undefined;
      const path = nodes.filter((node) => node.bracketId === row.bracket!.id);
      const reviewed = [...reviewedGroupOrder(row.bracket, path), ...(input.reviewedOrder || [])];
      const ranked = rankGroups(
        origin as GroupsPhase,
        path,
        row.bracket.rounds,
        row.bracket.entries,
        reviewed,
      );
      sources.groups![origin.key] = {
        phase: origin as GroupsPhase,
        drawn: assignment?.groups ?? [],
        rows: ranked.rows,
        complete: !!assignment?.groups?.length && ranked.complete,
      };
      bracketIds.push(row.bracket.id);
      witness[`groups:${origin.key}`] = [
        row.bracket.id,
        groupResultsHash(row.bracket.id, path, row.bracket.rounds, 2),
        reviewed,
        // A later forfeit changes standings without changing any score.
        path.map((node) => [node.id, node.match?.forfeitSide ?? null]),
      ];
    }
    if (from.kind === 'EXPLICIT' || origin?.kind === 'TEAM_FORMATION')
      witness[`explicit:${from.phase}`] = input.explicit?.[from.phase] ?? [];
  }
  return {
    sources,
    standingIds,
    bracketIds,
    sourceHash: qualifierSourceHash(witness),
  };
}

// Blocks gameplay when the results this phase was seeded from have since changed.
export async function assertPhaseSourcesCurrent(
  transaction: Prisma.TransactionClient,
  tournamentId: string,
  bracketId: string,
) {
  const tx = scopedDb(transaction, tournamentId);
  const row = await tx.tournamentPhase.findFirst({ where: { tournamentId, bracketId } });
  if (!row) return;
  const latest = await latestEntries(transaction, tournamentId, row.id);
  if (!latest) throw new AppError('Advance entrants into this phase before starting a match.', 409);
  const { plan } = await loadFormatPlan(transaction, tournamentId);
  const phase = plan?.phases.find((item) => item.key === row.key);
  if (!phase || !('entries' in phase)) return;
  const assignment = latest.assignment as EntriesAssignment;
  const current = await phaseSources(transaction, tournamentId, plan!.phases, phase, assignment);
  if (current.sourceHash !== latest.sourceHash)
    throw new AppError(
      'The results seeding this phase have changed. Review and advance its entrants again before starting.',
      409,
    );
}

// Only played downstream matches block a correction. Until then the phase can be re-advanced.
export async function consumersOfBracket(
  transaction: Prisma.TransactionClient,
  tournamentId: string,
  bracketId: string,
  nodes: readonly CompetitionNode[],
) {
  const brackets = await scopedDb(transaction, tournamentId).bracket.findMany({
    where: { tournamentId },
    select: { id: true, name: true, version: true, config: true },
  });
  return brackets
    .filter((bracket) =>
      ((bracket.config as { sourceBracketIds?: string[] }).sourceBracketIds ?? []).includes(
        bracketId,
      ),
    )
    .filter((bracket) =>
      nodes.some((node) => node.bracketId === bracket.id && competitionNodeStarted(node)),
    )
    .map(({ id, name, version }) => ({ id, name, version }));
}

export async function advancedSlot(
  transaction: Prisma.TransactionClient,
  tournamentId: string,
  bracketId: string,
  nodeKey: string,
  side: 'A' | 'B',
) {
  const row = await scopedDb(transaction, tournamentId).tournamentPhase.findFirst({
    where: { tournamentId, bracketId },
  });
  if (!row) return undefined;
  const latest = await latestEntries(transaction, tournamentId, row.id);
  const slots = (latest?.assignment as EntriesAssignment | undefined)?.slots;
  const key = `${nodeKey}:${side}`;
  return slots && key in slots ? { teamId: slots[key], resolved: true } : undefined;
}
