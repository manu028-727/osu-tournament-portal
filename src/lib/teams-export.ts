import { db } from './db';
import { AppError, can, type Actor } from './permissions';
import { exportTeamCsv } from './teams-csv';

// A complete roster export is a consistent snapshot, not a capped list request.
// Backpressure bounds each database/CSV batch; cancellation rolls back the reader.
export function teamCsvStream(actor: Actor) {
  if (!actor.tournamentId || actor.tournamentId === 'none')
    throw new AppError('Select a tournament.', 400);
  if (!can(actor, 'teams.view') && !can(actor, 'teams.import'))
    throw new AppError('Forbidden.', 403);
  const tournamentId = actor.tournamentId;
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter(),
    encoder = new TextEncoder();
  const exporting = db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await writer.write(encoder.encode('\uFEFF' + exportTeamCsv([]).trimEnd() + '\r\n'));
      let cursor: { id: string; position: number } | undefined;
      for (;;) {
        const teams = await tx.team.findMany({
          where: {
            tournamentId,
            ...(cursor
              ? {
                  OR: [
                    { position: { gt: cursor.position } },
                    { position: cursor.position, id: { gt: cursor.id } },
                  ],
                }
              : {}),
          },
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          take: 100,
          select: {
            id: true,
            name: true,
            slug: true,
            format: true,
            description: true,
            seed: true,
            position: true,
            members: {
              orderBy: [{ position: 'asc' }, { osuId: 'asc' }],
              select: { osuId: true, captain: true, substitute: true },
            },
          },
        });
        if (teams.length) await writer.write(encoder.encode(exportTeamCsv(teams, false) + '\r\n'));
        if (teams.length < 100) break;
        cursor = teams.at(-1)!;
      }
    },
    { isolationLevel: 'RepeatableRead', timeout: 60_000 },
  );
  void exporting
    .then(
      () => writer.close(),
      (error) => writer.abort(error),
    )
    .catch(() => {});
  return readable;
}
