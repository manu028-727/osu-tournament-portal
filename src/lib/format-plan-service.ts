import { createHash } from 'node:crypto';
import { Prisma } from '@/generated/prisma/client';
import {
  formatPlanSchema,
  FORMAT_PLAN_VERSION,
  type FormatPhase,
  type FormatPlan,
} from './format-plan';
import { AppError, assertPermission, type Actor } from './permissions';
import { scopedDb } from './scoped-db';

type PhaseRow = {
  key: string;
  kind: string;
  name: string;
  position: number;
  stageId: string | null;
  config: Prisma.JsonValue;
  state: string;
  version: number;
};

const phaseFromRow = (row: PhaseRow) =>
  ({
    ...(row.config as Record<string, unknown>),
    key: row.key,
    kind: row.kind,
    name: row.name,
    ...(row.stageId ? { stageId: row.stageId } : {}),
  }) as FormatPhase;

// A later save must have seen every phase as it stands now.
export const formatPlanToken = (rows: readonly PhaseRow[]) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        [...rows]
          .sort((a, b) => a.position - b.position)
          .map((row) => [
            row.key,
            row.kind,
            row.name,
            row.stageId,
            row.config,
            row.state,
            row.version,
          ]),
      ),
    )
    .digest('hex');

export async function loadFormatPlan(tx: Prisma.TransactionClient, tournamentId: string) {
  const rows = await scopedDb(tx, tournamentId).tournamentPhase.findMany({
    where: { tournamentId },
    orderBy: { position: 'asc' },
  });
  const parsed = rows.length
    ? formatPlanSchema.safeParse({ version: FORMAT_PLAN_VERSION, phases: rows.map(phaseFromRow) })
    : null;
  return {
    rows,
    token: formatPlanToken(rows),
    plan: parsed?.success ? parsed.data : null,
    locked: rows.some((row) => row.state !== 'PLANNED'),
    invalid: !!parsed && !parsed.success,
  };
}

function planStageIds(plan: FormatPlan) {
  return plan.phases.flatMap((phase) => [
    ...('stageId' in phase ? [{ phase, stageId: phase.stageId }] : []),
    ...('roundStages' in phase
      ? Object.values(phase.roundStages).map((stageId) => ({ phase, stageId }))
      : []),
  ]);
}

export async function saveFormatPlan(
  transaction: Prisma.TransactionClient,
  actor: Actor,
  tournamentId: string,
  input: { baseToken: string; plan: unknown },
) {
  assertPermission(actor, 'matches.manage');
  const tx = scopedDb(transaction, tournamentId);
  const current = await loadFormatPlan(transaction, tournamentId);
  if (current.token !== input.baseToken)
    throw new AppError('The tournament format changed. Reload and review before saving.', 409);
  if (current.locked)
    throw new AppError(
      'This format is locked. Its reserved matches cannot be replanned here.',
      409,
    );
  const plan = formatPlanSchema.parse(input.plan);
  const stages = await tx.tournamentStage.findMany({ where: { tournamentId } });
  for (const { phase, stageId } of planStageIds(plan)) {
    const stage = stages.find((item) => item.id === stageId);
    if (!stage) throw new AppError('{0} uses a stage that no longer exists.', 409, [phase.name]);
    if ((phase.kind === 'QUALIFIER') !== (stage.kind === 'QUALIFIERS'))
      throw new AppError('{0} needs a {1} stage.', 400, [
        phase.name,
        phase.kind === 'QUALIFIER' ? 'qualifier' : 'head-to-head',
      ]);
  }
  await tx.tournamentPhase.deleteMany({ where: { tournamentId } });
  for (const [position, phase] of plan.phases.entries()) {
    const { key, kind, name, ...rest } = phase;
    const { stageId, ...config } = rest as typeof rest & { stageId?: string };
    await tx.tournamentPhase.create({
      data: {
        tournamentId,
        key,
        kind,
        name,
        position,
        stageId: stageId ?? null,
        config: JSON.parse(JSON.stringify(config)),
      },
    });
  }
  return { phases: plan.phases.length };
}
