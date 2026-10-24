import { Prisma } from '@/generated/prisma/client';
import { z } from 'zod';
import {
  competitionStoredConfigSchema,
  remapCompetitionConfig,
  remapCompetitionSeedOrder,
} from './competition-archive';
import { recalculateCompetition } from './competition-engine';
import { competitionActionSchema } from './competition-validation';
import { AppError } from './permissions';

import { GroupConfig, groupResultsHash, resolvedGroupSeeds, stable } from './competition-groups';
import { allNodes } from './competition-queries';
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export type CompetitionArchiveWitness = {
  brackets: Record<string, unknown>[];
  bracketRounds: Record<string, unknown>[];
  bracketNodes: Record<string, unknown>[];
  bracketSlots: Record<string, unknown>[];
  bracketEntries: Record<string, unknown>[];
  matches: Record<string, unknown>[];
};
function archiveCompetition(witness: CompetitionArchiveWitness) {
  const id = z.string().min(1);
  const rounds = witness.bracketRounds.map((row) =>
    z
      .object({
        id,
        bracketId: id,
        key: id,
        name: z.string(),
        lane: z.string(),
        stageId: id,
        position: z.number().int(),
      })
      .parse(row),
  );
  const entries = witness.bracketEntries.map((row) =>
    z
      .object({ bracketId: id, teamId: id, seed: z.number().int().positive(), status: z.string() })
      .parse(row),
  );
  const slots = witness.bracketSlots.map((row) =>
    z
      .object({
        nodeId: id,
        side: z.enum(['A', 'B']),
        teamId: id.nullable(),
        resolved: z.boolean(),
        mode: z.string(),
        sourceNodeId: id.nullable(),
        outcome: z.string().nullable(),
      })
      .parse(row),
  );
  const matches = witness.matches.map((row) =>
    z
      .object({
        id,
        code: id,
        status: z.string(),
        teamAId: id.nullable(),
        teamBId: id.nullable(),
        scoreA: z.number().int(),
        scoreB: z.number().int(),
        winnerSide: z.enum(['A', 'B']).nullable(),
        version: z.number().int(),
        matchNumber: z.number().int().positive().optional(),
      })
      .parse(row),
  );
  const nodes = recalculateCompetition(
    witness.bracketNodes.map((row) => {
      const node = z
        .object({
          id,
          bracketId: id,
          roundId: id,
          key: id,
          position: z.number().int(),
          state: z.string(),
          matchId: id.nullable(),
          matchNumber: z.number().int().positive().nullable().optional(),
        })
        .parse(row);
      const match = matches.find((match) => match.id === node.matchId) || null,
        assigned = slots.filter((slot) => slot.nodeId === node.id);
      if (assigned.length !== 2 || new Set(assigned.map((slot) => slot.side)).size !== 2)
        throw new AppError('Archived competition nodes require two distinct slots.');
      if (node.matchId && !match) throw new AppError('Archived competition match not found.');
      if (
        match &&
        assigned.some((slot) => slot.teamId !== (slot.side === 'A' ? match.teamAId : match.teamBId))
      )
        throw new AppError(
          'Archived bracket participants do not match their native match snapshots.',
        );
      return { ...node, matchNumber: node.matchNumber ?? null, slots: assigned, match };
    }),
  );
  const brackets = witness.brackets.map((row) => {
    const bracket = z
      .object({ id, format: z.string(), config: z.unknown(), seedOrder: z.array(id) })
      .parse(row);
    const config = competitionStoredConfigSchema.parse(bracket.config);
    if (stable(bracket.seedOrder) !== stable(config.teamIds))
      throw new AppError('Archived bracket seeds differ from their immutable creation snapshot.');
    return {
      ...bracket,
      config: json(config) as Prisma.JsonValue,
      rounds: rounds.filter((round) => round.bracketId === bracket.id),
      entries: entries.filter((entry) => entry.bracketId === bracket.id),
    };
  });
  return { brackets, nodes };
}
export function validateCompetitionArchive(witness: CompetitionArchiveWitness) {
  const { brackets, nodes } = archiveCompetition(witness),
    byId = new Map(brackets.map((bracket) => [bracket.id, bracket]));
  for (const bracket of brackets) {
    const config = competitionStoredConfigSchema.parse(bracket.config);
    if (config.groupTieOrder || config.groupTieSourceHash || config.groupTieReason) {
      if (
        !config.groupTieOrder ||
        !config.groupTieReason ||
        !config.groupTieSourceHash ||
        new Set(config.groupTieOrder).size !== config.groupTieOrder.length ||
        stable([...config.groupTieOrder].sort()) !==
          stable(bracket.entries.map((entry) => entry.teamId).sort()) ||
        config.groupTieSourceHash !==
          groupResultsHash(bracket.id, nodes, bracket.rounds, config.advancePerGroup)
      )
        throw new AppError(
          'Archived group tiebreak approval does not reproduce its source results.',
        );
    }
    if (config.sourceBracketId || config.groupSource) {
      const source = byId.get(config.sourceBracketId || '');
      if (!source || config.groupSource?.bracketId !== source.id)
        throw new AppError('Archived group seed source is missing or inconsistent.');
      const result = resolvedGroupSeeds(source, nodes);
      if (stable(config.groupSource) !== stable({ bracketId: source.id, ...result }))
        throw new AppError('Archived frozen group seeds do not reproduce their reviewed source.');
      const selected = result.seeds
        .filter((seed) => config.teamIds.includes(seed.teamId))
        .map((seed) => seed.teamId);
      if (stable(selected) !== stable(config.teamIds))
        throw new AppError('Archived bracket contains ineligible or reordered group seeds.');
    }
  }
  for (const bracket of brackets) {
    const seen = new Set<string>();
    let current: typeof bracket | undefined = bracket;
    while (current) {
      if (seen.has(current.id))
        throw new AppError('Archived competition seeding sources contain a cycle.');
      seen.add(current.id);
      const sourceId: string | undefined = (current.config as GroupConfig).sourceBracketId;
      current = sourceId ? byId.get(sourceId) : undefined;
    }
  }
}
// Export localization changes the hash namespace. Verify the old witness and every mapped
// competitive field before rebinding only the two ID-dependent provenance hashes.
export function rebindLocalizedCompetition(
  originalWitness: CompetitionArchiveWitness,
  localizedWitness: CompetitionArchiveWitness,
  ids: ReadonlyMap<string, string>,
) {
  validateCompetitionArchive(originalWitness);
  const expectedWitness = structuredClone(originalWitness);
  for (const table of Object.values(expectedWitness))
    for (const row of table) {
      for (const [field, value] of Object.entries(row))
        if (/^(?:id|.*Id)$/.test(field) && typeof value === 'string' && ids.has(value))
          row[field] = ids.get(value)!;
    }
  for (let index = 0; index < expectedWitness.brackets.length; index++) {
    const original = originalWitness.brackets[index],
      expected = expectedWitness.brackets[index];
    expected.config = remapCompetitionConfig(original.config, ids);
    expected.seedOrder = remapCompetitionSeedOrder(original.seedOrder, ids);
  }
  const expected = archiveCompetition(expectedWitness),
    localized = archiveCompetition(localizedWitness);
  const canonical = (snapshot: ReturnType<typeof archiveCompetition>) => ({
    brackets: snapshot.brackets
      .map((bracket) => ({
        ...bracket,
        rounds: [...bracket.rounds].sort((a, b) => a.id.localeCompare(b.id)),
        entries: [...bracket.entries].sort((a, b) => a.teamId.localeCompare(b.teamId)),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    nodes: snapshot.nodes
      .map((node) => ({
        ...node,
        slots: [...node.slots].sort((a, b) => a.side.localeCompare(b.side)),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
  if (stable(canonical(expected)) !== stable(canonical(localized)))
    throw new AppError(
      'Localized competition results, reviewed ties, seeds or identity references differ from the original witness.',
    );
  const report = { reboundGroups: 0, reboundSources: 0 };
  const saveConfig = (bracket: (typeof localized.brackets)[number], config: unknown) => {
    bracket.config = json(config) as Prisma.JsonValue;
    localizedWitness.brackets.find((row) => row.id === bracket.id)!.config = json(config);
  };
  for (const bracket of localized.brackets) {
    const config = competitionStoredConfigSchema.parse(bracket.config);
    if (!config.groupTieOrder) continue;
    saveConfig(bracket, {
      ...config,
      groupTieSourceHash: groupResultsHash(
        bracket.id,
        localized.nodes,
        bracket.rounds,
        config.advancePerGroup,
      ),
    });
    report.reboundGroups++;
  }
  for (const bracket of localized.brackets) {
    const config = competitionStoredConfigSchema.parse(bracket.config);
    if (!config.groupSource) continue;
    const source = localized.brackets.find((candidate) => candidate.id === config.sourceBracketId);
    if (!source) throw new AppError('Localized group seed source is missing.');
    const fresh = resolvedGroupSeeds(source, localized.nodes);
    if (stable(fresh.seeds) !== stable(config.groupSource.seeds))
      throw new AppError('Localized groups do not reproduce the original qualified seeds.');
    saveConfig(bracket, {
      ...config,
      groupSource: { ...config.groupSource, sourceHash: fresh.sourceHash },
    });
    report.reboundSources++;
  }
  validateCompetitionArchive(localizedWitness);
  return report;
}
// Validate the original-ID witness before rebinding hashes. No results, participants, or seeds are rewritten.
export async function rebindImportedCompetition(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  witness: CompetitionArchiveWitness,
  ids: ReadonlyMap<string, string>,
) {
  validateCompetitionArchive(witness);
  const original = archiveCompetition(witness),
    imported = await tx.bracket.findMany({
      where: { tournamentId },
      include: { rounds: true, entries: true },
    }),
    nodes = recalculateCompetition(await allNodes(tx, tournamentId));
  const mappedId = (id: string) => {
    const result = ids.get(id);
    if (!result) throw new AppError('Competition archive identity remapping is incomplete.');
    return result;
  };
  const mappedNodes = original.nodes.map((node) => ({
    ...node,
    id: mappedId(node.id),
    bracketId: mappedId(node.bracketId),
    roundId: mappedId(node.roundId),
    matchId: node.matchId ? mappedId(node.matchId) : null,
    slots: node.slots.map((slot) => ({
      ...slot,
      teamId: slot.teamId ? mappedId(slot.teamId) : null,
      sourceNodeId: slot.sourceNodeId ? mappedId(slot.sourceNodeId) : null,
    })),
    match: node.match
      ? {
          ...node.match,
          id: mappedId(node.match.id),
          teamAId: node.match.teamAId ? mappedId(node.match.teamAId) : null,
          teamBId: node.match.teamBId ? mappedId(node.match.teamBId) : null,
        }
      : null,
  }));
  const report = { reboundGroups: 0, reboundSources: 0 };
  for (const old of original.brackets) {
    const current = imported.find((bracket) => bracket.id === mappedId(old.id));
    if (!current) throw new AppError('Imported competition bracket is missing.');
    const expected = remapCompetitionConfig(old.config, ids),
      config = competitionStoredConfigSchema.parse(current.config);
    if (
      stable(competitionActionSchema.options[0].parse(expected)) !==
        stable(competitionActionSchema.options[0].parse(config)) ||
      stable(current.seedOrder) !== stable(remapCompetitionSeedOrder(old.seedOrder, ids))
    )
      throw new AppError(
        'Imported competition configuration or frozen seed order was not remapped correctly.',
      );
    if (expected.groupTieOrder) {
      const expectedRounds = old.rounds.map((round) => ({
        ...round,
        id: mappedId(round.id),
        stageId: mappedId(round.stageId),
      }));
      const fresh = groupResultsHash(current.id, nodes, current.rounds, config.advancePerGroup);
      if (
        stable(config.groupTieOrder) !== stable(expected.groupTieOrder) ||
        fresh !== groupResultsHash(current.id, mappedNodes, expectedRounds, config.advancePerGroup)
      )
        throw new AppError(
          'Imported group results or reviewed tiebreak order differ from the original archive.',
        );
      current.config = json({ ...config, groupTieSourceHash: fresh }) as Prisma.JsonValue;
      await tx.bracket.updateMany({
        where: { id: current.id, tournamentId },
        data: { config: json(current.config) },
      });
      report.reboundGroups++;
    }
  }
  for (const old of original.brackets) {
    const expected = remapCompetitionConfig(old.config, ids);
    if (!expected.groupSource) continue;
    const current = imported.find((bracket) => bracket.id === mappedId(old.id))!,
      config = competitionStoredConfigSchema.parse(current.config),
      source = imported.find((bracket) => bracket.id === expected.sourceBracketId);
    if (!source || config.groupSource?.bracketId !== source.id)
      throw new AppError('Imported group seed source was not remapped correctly.');
    const fresh = resolvedGroupSeeds(source, nodes);
    if (
      stable(fresh.seeds) !== stable(expected.groupSource.seeds) ||
      stable(config.groupSource.seeds) !== stable(expected.groupSource.seeds)
    )
      throw new AppError('Imported source groups do not reproduce the archived frozen seeds.');
    await tx.bracket.updateMany({
      where: { id: current.id, tournamentId },
      data: {
        config: json({
          ...config,
          groupSource: { ...config.groupSource, sourceHash: fresh.sourceHash },
          groupImportProvenance: {
            originalSourceHash: expected.groupSource.sourceHash,
            reboundSourceHash: fresh.sourceHash,
          },
        }),
      },
    });
    report.reboundSources++;
  }
  return report;
}
