import { Prisma } from '@/generated/prisma/client';
import { createHash } from 'node:crypto';
import { type DraftState } from './match-engine';
import { AppError } from './permissions';
import { teamInclude } from './teams-service';

import type { MatchParticipants } from './matches-types';
export const profileSelect = { id: true, username: true, osuId: true, avatarUrl: true };
export const matchInclude = {
  multiplayerGames: { orderBy: { createdAt: 'desc' as const }, take: 50 },
  stage: { select: { id: true, name: true, slug: true } },
  assignments: {
    include: { user: { select: profileSelect } },
    orderBy: { primary: 'desc' as const },
  },
  poolRevision: { include: { slots: { orderBy: { position: 'asc' as const } } } },
  actions: {
    orderBy: { sequence: 'asc' as const },
    include: { actor: { select: { username: true } } },
  },
  results: { include: { playerScores: true }, orderBy: { createdAt: 'asc' as const } },
};
export type MatchRecord = Prisma.MatchGetPayload<{ include: typeof matchInclude }>;
export const rulesHash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex');
export function rosterSnapshot(
  team: Prisma.TeamGetPayload<{ include: typeof teamInclude }>,
): MatchParticipants['A'] {
  return {
    id: team.id,
    name: team.name,
    slug: team.slug,
    format: team.format,
    logoImageId: team.logoImageId,
    members: team.members.map((m) => ({
      osuId: m.osuId,
      username: m.registeredUsername || m.participant.username,
      avatarUrl: m.participant.avatarUrl,
      captain: m.captain,
      substitute: m.substitute,
    })),
  };
}
export function draftState(match: MatchRecord): DraftState {
  return {
    firstPickSide: match.firstPickSide,
    firstBanSide: match.firstBanSide,
    firstProtectSide: match.firstProtectSide,
    scoreA: match.scoreA,
    scoreB: match.scoreB,
    actions: match.actions,
    pendingPick: match.actions.some(
      (a) =>
        !a.voided &&
        a.kind === 'PICK' &&
        !match.results.some((r) => !r.voided && r.actionId === a.id),
    ),
  };
}
export function lobbyInfo(url: string, id: number | null) {
  if (url) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new AppError('Use an osu! multiplayer match URL.');
    }
    const match = /^\/(?:(?:community\/)?matches|mp)\/(\d+)\/?$/.exec(parsed.pathname);
    if (
      parsed.origin !== 'https://osu.ppy.sh' ||
      !match ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password
    )
      throw new AppError('Use an osu! multiplayer match URL.');
    const value = Number(match[1]);
    if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647 || (id && value !== id))
      throw new AppError('The multiplayer ID and URL do not match.');
    id = value;
  }
  return { multiplayerId: id, lobbyUrl: id ? `https://osu.ppy.sh/community/matches/${id}` : '' };
}
