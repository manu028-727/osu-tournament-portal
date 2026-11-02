import type { Prisma } from '@/generated/prisma/client';
import {
  AppError,
  assertPermission,
  assertRoleGrant,
  type Actor,
  type PermissionKey,
} from './permissions';
import { scopedDb } from './scoped-db';
export async function applyUserRoles(
  transaction: Prisma.TransactionClient,
  actor: Actor,
  tournamentId: string,
  a: {
    userId: string;
    roleIds: string[];
    baseRoleIds?: string[];
    baseRoles?: { id: string; permissions: PermissionKey[] }[];
  },
) {
  assertPermission(actor, 'users.manage');
  const tx = scopedDb(transaction, tournamentId);
  const target = await tx.user.findUniqueOrThrow({
    where: { id: a.userId },
    include: {
      roles: {
        where: { tournamentId },
        include: { role: { include: { permissions: true } } },
      },
    },
  });
  if (
    a.baseRoleIds &&
    JSON.stringify([...a.baseRoleIds].sort()) !==
      JSON.stringify(target.roles.map((r) => r.roleId).sort())
  )
    throw new AppError('Role assignments changed. Reload before saving.', 409);
  const roles = await tx.role.findMany({
    where: { id: { in: [...new Set(a.roleIds)] } },
    include: { permissions: true },
  });
  if (roles.length !== new Set(a.roleIds).size)
    throw new AppError('One of the selected roles no longer exists.');
  if (a.baseRoles)
    for (const role of [...roles, ...target.roles.map((r) => r.role)]) {
      const reviewed = a.baseRoles.find((r) => r.id === role.id);
      if (
        !reviewed ||
        JSON.stringify([...reviewed.permissions].sort()) !==
          JSON.stringify(role.permissions.map((p) => p.permissionKey).sort())
      )
        throw new AppError('Role permissions changed. Reload before saving.', 409);
    }
  const owner = roles.find(
    (r) => (('templateKey' in r && r.templateKey) || r.systemKey) === 'Owner',
  );
  assertRoleGrant(
    actor,
    target.id,
    roles.flatMap((r) => r.permissions.map((p) => p.permissionKey as PermissionKey)),
    !!owner,
  );
  if (
    target.roles.some((r) => (r.role.templateKey || r.role.systemKey) === 'Owner') &&
    !actor.platformAdmin &&
    !actor.roles.some((r) => r.systemKey === 'Owner')
  )
    throw new AppError('Only an Owner can change another Owner’s roles.', 403);
  if (target.roles.some((r) => (r.role.templateKey || r.role.systemKey) === 'Owner') && !owner) {
    const ownerRole = target.roles.find(
      (r) => (r.role.templateKey || r.role.systemKey) === 'Owner',
    )!;
    if ((await tx.userRole.count({ where: { roleId: ownerRole.roleId } })) <= 1)
      throw new AppError('The last Owner cannot be removed.', 409);
  }
  // Also protect removal of privileges the actor does not hold.
  if (
    target.roles.some((r) =>
      r.role.permissions.some((p) => !actor.permissions.includes(p.permissionKey as PermissionKey)),
    )
  )
    throw new AppError('This account contains protected permissions.', 403);
  await tx.userRole.deleteMany({ where: { userId: target.id } });
  await tx.userRole.createMany({
    data: roles.map((r) => ({ userId: target.id, roleId: r.id })),
  });
  return { id: target.id, before: target.roles.map((r) => r.roleId) };
}
