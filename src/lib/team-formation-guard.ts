import type { Prisma } from '@/generated/prisma/client';
import { loadFormatPlan } from './format-plan-service';
import { AppError } from './permissions';
import { scopedDb } from './scoped-db';

// Refuses a correction once a board has taken players from these standings, since moving
// the seeds now would quietly change who a captain thought they were buying.
export async function assertNoFormationFrom(
  transaction: Prisma.TransactionClient,
  tournamentId: string,
  stageId: string,
) {
  const tx = scopedDb(transaction, tournamentId);
  const sessions = await tx.formationSession.findMany({
    where: { tournamentId },
    select: { phase: { select: { key: true, name: true } } },
  });
  if (!sessions.length) return;
  const { plan } = await loadFormatPlan(transaction, tournamentId);
  for (const session of sessions) {
    const phase = plan?.phases.find((item) => item.key === session.phase.key);
    if (phase?.kind !== 'TEAM_FORMATION') continue;
    const reads = phase.entries.some((item) => {
      const from = item.source;
      if (!('phase' in from)) return false;
      const origin = plan!.phases.find((other) => other.key === from.phase);
      return origin?.kind === 'QUALIFIER' && origin.stageId === stageId;
    });
    if (reads)
      throw new AppError(
        '{0} has used these standings. Restart it before changing the qualifier.',
        409,
        [session.phase.name],
      );
  }
}
