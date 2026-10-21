import { z } from 'zod';
import { db } from './db';
import { actorForTournament } from './auth';
import { assertPermission, AppError, can } from './permissions';
import { matchAccess } from './match-access';
import { matchScope, lobbyInfo } from './matches-service';
import type { Prisma } from '@/generated/prisma/client';

export const gatewayRequest = z.object({
  identity: z.object({
    userId: z.string().max(100),
    sessionHash: z.string().regex(/^[a-f0-9]{64}$/),
    tournamentId: z.string().max(100),
    matchId: z.string().max(100),
  }),
  operation: z.enum(['authorize', 'control', 'create', 'complete', 'resolve']),
  baseVersion: z.number().int().positive().optional(),
  requestId: z.string().min(1).max(100).optional(),
  name: z
    .string()
    .min(1)
    .max(300)
    .regex(/^[^\x00-\x1f\x7f]+$/)
    .optional(),
  status: z.enum(['CREATED', 'FAILED', 'UNKNOWN']).optional(),
  url: z.string().max(200).optional(),
  commandKind: z
    .enum([
      'settings',
      'name',
      'invite',
      'addref',
      'listrefs',
      'map',
      'mods',
      'timer',
      'aborttimer',
      'start',
      'abort',
      'lock',
      'unlock',
      'close',
      'set',
    ])
    .optional(),
  channel: z
    .string()
    .regex(/^#mp_[1-9]\d{0,9}$/)
    .optional(),
});
type GatewayRequest = z.infer<typeof gatewayRequest>;
export async function authorizeIrc(
  identity: GatewayRequest['identity'],
  tx: Prisma.TransactionClient = db,
) {
  const session = await tx.session.findUnique({
    where: { id: identity.sessionHash },
    include: {
      user: { include: { roles: { include: { role: { include: { permissions: true } } } } } },
    },
  });
  if (!session || session.userId !== identity.userId || session.expiresAt <= new Date())
    throw new AppError('Your website session expired. Sign in again.', 401);
  const actor = actorForTournament(session.user, identity.tournamentId);
  assertPermission(actor, 'referee.access');
  if (
    !can(actor, 'matches.view') &&
    !can(actor, 'matches.view_all') &&
    !can(actor, 'matches.manage') &&
    !can(actor, 'matches.manage_all')
  )
    throw new AppError('Match access denied.', 403);
  const match = await tx.match.findFirst({
    where: { AND: [{ id: identity.matchId }, matchScope(actor)] },
    include: { assignments: true },
  });
  if (!match) throw new AppError('Match not found.', 404);
  if ((match.rules as { gameplayScoring?: string }).gameplayScoring === 'LAZER')
    throw new AppError(
      'Legacy Bancho IRC cannot configure lazer multiplayer rooms. Operate the lazer room directly.',
      409,
    );
  return { actor, match, access: matchAccess(actor, match) };
}
export async function executeGateway(input: GatewayRequest) {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
      const { actor, match, access } = await authorizeIrc(input.identity, tx);
      const active = await tx.ircLobbyRequest.findFirst({
        where: { matchId: match.id, status: { in: ['PENDING', 'UNKNOWN'] } },
        select: { id: true, status: true, name: true, createdAt: true },
      });
      const createdLobby = await tx.ircLobbyRequest.findFirst({
        where: { matchId: match.id, userId: actor.id, status: 'CREATED' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, lobbyUrl: true },
      });
      if (input.operation === 'authorize')
        return {
          username: actor.username,
          operate: access.operate,
          multiplayerId: match.multiplayerId,
          lobbyUrl: match.lobbyUrl,
          version: match.version,
          activeRequest: active,
          createdLobby,
        };
      if (!access.operate || ['COMPLETED', 'CANCELLED'].includes(match.status))
        throw new AppError('This match is read only. Reopen it or ask an authorized referee.', 403);
      if (input.operation === 'control') {
        if (input.commandKind) {
          const expected = match.multiplayerId || createdLobby?.lobbyUrl.match(/\/(\d+)$/)?.[1];
          if (!expected || input.channel !== `#mp_${expected}`)
            throw new AppError('Lobby binding changed. Reload before sending commands.', 409);
          await tx.auditLog.create({
            data: {
              actorId: actor.id,
              tournamentId: match.tournamentId,
              entityType: 'Match',
              entityId: match.id,
              action: 'irc.command.requested',
              details: { command: input.commandKind, channel: input.channel },
            },
          });
        }
        return {
          multiplayerId: match.multiplayerId,
          lobbyUrl: match.lobbyUrl,
          version: match.version,
          createdLobby,
        };
      }
      if (input.operation === 'create') {
        if (input.baseVersion !== match.version)
          throw new AppError('Match changed. Refresh before creating a lobby.', 409);
        if (match.multiplayerId || active || createdLobby)
          throw new AppError(
            'A lobby or unresolved creation request already exists. Inspect BanchoBot before trying again.',
            409,
          );
        if (!input.name) throw new AppError('Enter a lobby name.');
        const request = await tx.ircLobbyRequest.create({
          data: {
            matchId: match.id,
            tournamentId: match.tournamentId,
            userId: actor.id,
            name: input.name,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            tournamentId: match.tournamentId,
            entityType: 'Match',
            entityId: match.id,
            action: 'irc.lobby.requested',
            details: { requestId: request.id },
          },
        });
        return { requestId: request.id };
      }
      const request = await tx.ircLobbyRequest.findFirst({
        where: { id: input.requestId || '', matchId: match.id, tournamentId: match.tournamentId },
      });
      if (!request) throw new AppError('Lobby request not found.', 404);
      if (input.operation === 'resolve') {
        await tx.ircLobbyRequest.update({
          where: { id: request.id },
          data: { status: 'RESOLVED' },
        });
      } else {
        if (request.userId !== actor.id || !['PENDING', 'UNKNOWN'].includes(request.status))
          throw new AppError('This lobby request cannot be changed.', 409);
        const url = input.status === 'CREATED' ? lobbyInfo(input.url || '', null).lobbyUrl : '';
        if (!input.status || (input.status === 'CREATED' && !url))
          throw new AppError('Missing confirmed multiplayer URL.');
        await tx.ircLobbyRequest.update({
          where: { id: request.id },
          data: { status: input.status, lobbyUrl: url },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          tournamentId: match.tournamentId,
          entityType: 'Match',
          entityId: match.id,
          action: `irc.lobby.${input.operation === 'resolve' ? 'resolved' : input.status?.toLowerCase()}`,
          details: { requestId: request.id },
        },
      });
      return { ok: true };
    },
    { timeout: 10000 },
  );
}
