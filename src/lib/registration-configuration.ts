import { createHash } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import { publicTournamentWhere } from './public-visibility';
import { AppError } from './permissions';
import { registrationPolicySchema } from './registration-policy';
export async function registrationConfiguration(
  tx: Prisma.TransactionClient,
  tournamentId: string,
) {
  const tournament = await tx.tournament.findFirst({
    where: { id: tournamentId, ...publicTournamentWhere },
    include: { settings: true },
  });
  if (!tournament?.settings) throw new AppError('Tournament not found.', 404);
  const policy = registrationPolicySchema.parse(tournament.settings.registrationPolicy || {});
  const policyToken = createHash('sha256')
    .update(
      JSON.stringify({
        policy,
        format: tournament.format,
        status: tournament.status,
        mode: tournament.gameMode,
        rules: tournament.settings.matchRules,
      }),
    )
    .digest('hex');
  return { tournament, policy, policyToken };
}
