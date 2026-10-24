import { cookies } from 'next/headers.js';
import { cache } from 'react';
import { db } from './db';
import { hash, sessionCookie, token } from './security';
import {
  type Actor,
  type PermissionKey,
  AppError,
  ALL_PERMISSIONS,
  PLATFORM_PERMISSIONS,
} from './permissions';
import { requestScope } from './tournament-context';
type ScopedUser = {
  id: string;
  osuId: number;
  username: string;
  avatarUrl: string;
  platformAdmin: boolean;
  roles: {
    role: {
      id: string;
      name: string;
      systemKey: string | null;
      templateKey: string | null;
      tournamentId: string;
      permissions: { permissionKey: string }[];
    };
  }[];
};
export function actorForTournament(user: ScopedUser, tournamentId: string): Actor {
  const roles = user.roles.filter(({ role }) => role.tournamentId === tournamentId);
  return {
    id: user.id,
    osuId: user.osuId,
    username: user.username,
    avatarUrl: user.avatarUrl,
    tournamentId,
    platformAdmin: user.platformAdmin,
    workspaceAny:
      user.platformAdmin ||
      user.roles.some(({ role }) =>
        role.permissions.some(
          (p) => !PLATFORM_PERMISSIONS.includes(p.permissionKey as PermissionKey),
        ),
      ),
    roles: roles.map(({ role }) => ({
      id: role.id,
      name: role.name,
      systemKey: role.templateKey || role.systemKey,
    })),
    permissions: user.platformAdmin
      ? [...ALL_PERMISSIONS]
      : [
          ...new Set(
            roles.flatMap(({ role }) =>
              role.permissions.map((p) => p.permissionKey as PermissionKey),
            ),
          ),
        ].filter((key) => !PLATFORM_PERMISSIONS.includes(key)),
  };
}
export const getActor = cache(async (tournamentId?: string): Promise<Actor | null> => {
  const raw = (await cookies()).get(sessionCookie())?.value;
  if (!raw) return null;
  const session = await db.session.findUnique({
    where: { id: hash(raw) },
    include: {
      user: { include: { roles: { include: { role: { include: { permissions: true } } } } } },
    },
  });
  if (!session || session.expiresAt < new Date()) return null;
  const { user } = session;
  return actorForTournament(user, tournamentId || (await requestScope()).tournamentId);
});
export async function requireTournamentActor() {
  const actor = await getActor();
  if (!actor) throw new AppError('Sign in to continue.', 401);
  if (!(await requestScope()).slug || !actor.tournamentId || actor.tournamentId === 'none')
    throw new AppError('Select a tournament in the Organizer Workspace before continuing.', 400);
  return actor;
}
export async function createSession(userId: string) {
  const raw = token();
  const expiresAt = new Date(Date.now() + 7 * 86400000);
  await db.session.create({ data: { id: hash(raw), userId, expiresAt } });
  return { raw, expiresAt };
}
export async function loginUser(profile: {
  id: number;
  username: string;
  avatar_url: string;
  country_code?: string;
}) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
    const guest = await tx.role.findUnique({ where: { systemKey: 'Guest' } });
    const platform = await tx.platformSettings.findUnique({ where: { id: 'main' } });
    if (!platform) throw new AppError('Installation is awaiting initialization.', 503);
    const user = await tx.user.upsert({
      where: { osuId: profile.id },
      create: {
        osuId: profile.id,
        username: profile.username,
        avatarUrl: profile.avatar_url,
        profileUrl: `https://osu.ppy.sh/users/${profile.id}`,
        country: profile.country_code,
        ...(guest
          ? { roles: { create: { roleId: guest.id, tournamentId: guest.tournamentId } } }
          : {}),
      },
      update: {
        username: profile.username,
        avatarUrl: profile.avatar_url,
        country: profile.country_code,
        lastLoginAt: new Date(),
      },
    });
    // The protected initialization CLI pins an identity; the database consumes it once.
    if (
      !platform.ownerBootstrappedAt &&
      platform.bootstrapOwnerOsuId === profile.id &&
      (await tx.user.count({ where: { platformAdmin: true } })) === 0
    ) {
      await tx.user.update({ where: { id: user.id }, data: { platformAdmin: true } });
      const owner = await tx.role.findUnique({ where: { systemKey: 'Owner' } });
      if (owner)
        await tx.userRole.upsert({
          where: { userId_roleId: { userId: user.id, roleId: owner.id } },
          create: { userId: user.id, roleId: owner.id, tournamentId: owner.tournamentId },
          update: {},
        });
      await tx.platformSettings.update({
        where: { id: 'main' },
        data: {
          ownerBootstrappedAt: new Date(),
          bootstrapOwnerOsuId: null,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: 'auth.login',
        tournamentId: null,
        entityType: 'User',
        entityId: user.id,
        details: { osuId: profile.id },
      },
    });
    return user;
  });
}
