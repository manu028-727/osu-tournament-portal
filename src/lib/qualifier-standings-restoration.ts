import { Prisma } from '@/generated/prisma/client';
import { scopedDb } from './scoped-db';

import {
  QUALIFIER_CALCULATION_VERSION,
  PREVIOUS_QUALIFIER_CALCULATION_VERSION,
  LEGACY_QUALIFIER_CALCULATION_VERSION,
  canonicalQualifierJson,
  resolveQualifierTies,
  type QualifierCalculation,
} from './qualifier-seeding';

import type { QualifierStandingSnapshot } from './qualifier-standings-contract';
import { qualifierStandingSnapshot } from './qualifier-standings-contract';
import { loadQualifierCalculation, lockStage } from './qualifier-standings-sources';
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export function calculationWitness(calculation: QualifierCalculation) {
  const bySlot = <T extends { slotName: string }>(values: T[]) =>
    [...values].sort((a, b) => (a.slotName < b.slotName ? -1 : a.slotName > b.slotName ? 1 : 0));
  const byId = <T extends { id: string }>(values: T[]) =>
    [...values].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const references = (values: QualifierCalculation['references']) =>
    bySlot(values).map((r) => ({ ...r, participantIds: [...r.participantIds].sort() }));
  const maps = (values: QualifierCalculation['rows'][number]['selected']) =>
    bySlot(values).map((m) => ({
      ...m,
      scoreIds: [...m.scoreIds].sort(),
      players: [...m.players].sort((a, b) => a.osuId - b.osuId),
    }));
  return {
    calculationVersion: calculation.calculationVersion,
    formula: calculation.formula,
    formulaReference: calculation.formulaReference,
    policy: calculation.policy,
    gameplayScoring: calculation.gameplayScoring,
    source: {
      tournamentId: calculation.source.tournamentId,
      stageId: calculation.source.stageId,
      policy: calculation.source.policy,
      gameplayScoring: calculation.source.gameplayScoring,
      participants: byId(calculation.source.participants).map((p) => ({
        ...p,
        roster: [...p.roster].sort((a, b) => a - b),
      })),
      maps: bySlot(calculation.source.maps),
      scores: byId(calculation.source.scores).map((s) => ({ ...s, mods: [...s.mods].sort() })),
    },
    references: references(calculation.references),
    frozenRunReferences: references(calculation.frozenRunReferences),
    rows: [...calculation.rows]
      .sort((a, b) =>
        a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0,
      )
      .map((r) => ({
        ...r,
        selected: maps(r.selected),
        breakdown: bySlot(r.breakdown),
        runs: [...r.runs]
          .sort((a, b) => a.run - b.run)
          .map((run) => ({ ...run, maps: maps(run.maps) })),
      })),
    errors: calculation.issues
      .filter((i) => i.severity === 'ERROR')
      .map((i) => canonicalQualifierJson(i))
      .sort(),
  };
}
// Import-only reconciliation: recomputation is a witness, never a replacement for historical rank/tie decisions.
export async function rebindImportedQualifierStandings(
  tx: Prisma.TransactionClient,
  tournamentId: string,
) {
  tx = scopedDb(tx, tournamentId);
  const records = await tx.qualifierStanding.findMany({
    where: { tournamentId },
    orderBy: [{ stageId: 'asc' }, { version: 'asc' }],
  });
  const report = { rebound: 0, skipped: 0, warnings: [] as string[] };
  const calculations = new Map<string, QualifierCalculation>();
  for (const record of records) {
    try {
      const stored = qualifierStandingSnapshot(record.snapshot);
      if (
        ![
          QUALIFIER_CALCULATION_VERSION,
          PREVIOUS_QUALIFIER_CALCULATION_VERSION,
          LEGACY_QUALIFIER_CALCULATION_VERSION,
        ].includes(stored.calculation.calculationVersion)
      )
        throw new Error('Unknown calculation formula/version.');
      const key = `${record.stageId}:${stored.calculation.calculationVersion}`;
      let fresh = calculations.get(key);
      if (!fresh) {
        await lockStage(tx, record.stageId, tournamentId);
        fresh = (
          await loadQualifierCalculation(
            tx,
            record.stageId,
            tournamentId,
            stored.calculation.calculationVersion,
          )
        ).calculation;
        calculations.set(key, fresh);
      }
      if (record.sourceHash === fresh.sourceHash) {
        report.skipped++;
        continue;
      }
      const reviewed = stored.tieResolution
        ? resolveQualifierTies(fresh, stored.tieResolution.order)
        : fresh;
      if (stored.state === 'FINALIZED' && !reviewed.canFinalize)
        throw new Error('Restored sources cannot reproduce finalized seeds.');
      if (
        canonicalQualifierJson(calculationWitness(stored.calculation)) !==
        canonicalQualifierJson(calculationWitness(reviewed))
      )
        throw new Error(
          'Restored scores, selection, statistics or historical ranking values differ.',
        );
      const seeds = stored.calculation.rows
        .filter((r) => r.seed !== null)
        .map((r) => ({
          teamId: r.participantId,
          seed: r.seed!,
          qualified: stored.cutoff === null || r.seed! <= stored.cutoff,
        }));
      if (
        stored.state === 'FINALIZED' &&
        canonicalQualifierJson([...stored.seeds].sort((a, b) => a.seed - b.seed)) !==
          canonicalQualifierJson(seeds.sort((a, b) => a.seed - b.seed))
      )
        throw new Error(
          'Stored finalized seeds or cutoff do not match the preserved historical ranking.',
        );
      const snapshot: QualifierStandingSnapshot = {
        ...stored,
        calculation: { ...stored.calculation, sourceHash: fresh.sourceHash, source: fresh.source },
        importProvenance: [
          ...(stored.importProvenance || []),
          {
            originalSourceHash: record.sourceHash,
            reboundSourceHash: fresh.sourceHash,
            reboundAt: new Date().toISOString(),
            calculationVersion: fresh.calculationVersion,
          },
        ],
      };
      await tx.qualifierStanding.update({
        where: { id: record.id, tournamentId },
        data: { sourceHash: fresh.sourceHash, snapshot: json(snapshot) },
      });
      report.rebound++;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError
      )
        throw error;
      report.skipped++;
      report.warnings.push(
        `Qualifier standings ${record.id} v${record.version} remain stale: ${error instanceof Error ? error.message : 'unverifiable snapshot'}`,
      );
    }
  }
  return report;
}
