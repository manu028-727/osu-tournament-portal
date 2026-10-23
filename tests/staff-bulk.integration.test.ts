import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import { executeAction } from '../src/lib/admin-service';
import { assertTestDatabase } from '../src/lib/instance';
import type { Actor } from '../src/lib/permissions';
import { applyStaffBulkAction } from '../src/lib/staff-bulk';
import { staffBulkActionSchema, type StaffBulkAction } from '../src/lib/staff-bulk-validation';
import { actionSchema } from '../src/lib/validation';

assertTestDatabase(process.env.DATABASE_URL);
const prefix = `staff-bulk-${randomUUID()}`;
const tournamentId = `${prefix}-a`,
  foreignId = `${prefix}-b`;
const actor: Actor = {
  id: `${prefix}-user`,
  tournamentId,
  osuId: randomInt(1_500_000_000, 1_900_000_000),
  username: prefix,
  avatarUrl: '',
  roles: [],
  permissions: ['staff.edit'],
};
let alpha = '',
  beta = '',
  foreign = '',
  hosts = '',
  referees = '',
  streamers = '',
  foreignCategory = '',
  roleId = '';
let verified = false;
const payload = (patch: StaffBulkAction['patch'], memberIds = [alpha, beta]): StaffBulkAction => ({
  type: 'staff.bulk',
  memberIds,
  patch,
});
const apply = (input: StaffBulkAction, user: Actor | null = actor) =>
  db.$transaction((tx) => applyStaffBulkAction(tx, user, input), { timeout: 15000 });
const snapshot = () =>
  db.staffMember.findMany({
    where: { tournamentId },
    include: { assignments: { orderBy: { categoryId: 'asc' } } },
    orderBy: { id: 'asc' },
  });
const assignments = (memberId: string) =>
  db.staffAssignment.findMany({ where: { memberId }, orderBy: { categoryId: 'asc' } });

beforeAll(async () => {
  const [database] = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  expect(database.name).toContain('test');
  verified = true;
  for (const id of [tournamentId, foreignId])
    await db.tournament.create({
      data: { id, slug: id, name: prefix, acronym: 'TEST', description: '', gameMode: 'osu' },
    });
  await db.user.create({
    data: {
      id: actor.id,
      osuId: actor.osuId,
      username: actor.username,
      avatarUrl: '',
      profileUrl: '',
    },
  });
  roleId = (
    await db.role.create({
      data: {
        tournamentId,
        name: 'Staff bulk test manager',
        permissions: { create: { permissionKey: 'staff.edit' } },
      },
    })
  ).id;
  const category = async (scope: string, name: string) =>
    (await db.staffCategory.create({ data: { tournamentId: scope, name } })).id;
  hosts = await category(tournamentId, 'Hosts');
  referees = await category(tournamentId, 'Referees');
  streamers = await category(tournamentId, 'Streamers');
  foreignCategory = await category(foreignId, 'Foreign category');
  const member = async (scope: string, name: string, offset: number) =>
    (
      await db.staffMember.create({
        data: {
          tournamentId: scope,
          osuId: actor.osuId + offset,
          username: name,
          avatarUrl: `https://a.ppy.sh/${actor.osuId + offset}`,
          profileUrl: `https://osu.ppy.sh/users/${actor.osuId + offset}`,
          bio: `${name} biography to preserve`,
          customImage: `/images/${name}.png`,
          position: offset,
        },
      })
    ).id;
  alpha = await member(tournamentId, 'Alpha', 0);
  beta = await member(tournamentId, 'Beta', 1);
  foreign = await member(foreignId, 'Foreign', 2);
});

beforeEach(async () => {
  await db.$transaction(async (tx) => {
    await tx.staffAssignment.deleteMany({ where: { tournamentId } });
    await tx.staffAssignment.createMany({
      data: [
        { tournamentId, memberId: alpha, categoryId: hosts, position: 'Lead host' },
        { tournamentId, memberId: alpha, categoryId: streamers, position: 'Stream lead' },
        { tournamentId, memberId: beta, categoryId: hosts, position: 'Host' },
        { tournamentId, memberId: beta, categoryId: referees, position: 'Existing referee label' },
      ],
    });
    await tx.staffMember.update({ where: { id: alpha }, data: { visible: true } });
    await tx.staffMember.update({ where: { id: beta }, data: { visible: false } });
    await tx.auditLog.deleteMany({ where: { tournamentId } });
    await tx.userRole.upsert({
      where: { userId_roleId: { userId: actor.id, roleId } },
      create: { tournamentId, userId: actor.id, roleId },
      update: {},
    });
  });
});

afterAll(async () => {
  try {
    if (!verified) return;
    assertTestDatabase(process.env.DATABASE_URL);
    await db.$transaction(async (tx) => {
      const scope = { tournamentId: { in: [tournamentId, foreignId] } };
      await tx.auditLog.deleteMany({ where: scope });
      await tx.staffMember.deleteMany({ where: scope });
      await tx.staffCategory.deleteMany({ where: scope });
      await tx.role.deleteMany({ where: scope });
      await tx.tournament.deleteMany({ where: { id: { in: [tournamentId, foreignId] } } });
      await tx.user.deleteMany({ where: { id: actor.id } });
    });
  } finally {
    await db.$disconnect();
  }
});

describe('staff bulk input validation', () => {
  it('rejects duplicate, empty, oversized selections and empty patches', () => {
    expect(staffBulkActionSchema.safeParse(payload({ visible: true }, [])).success).toBe(false);
    expect(
      staffBulkActionSchema.safeParse(payload({ visible: true }, [alpha, alpha])).success,
    ).toBe(false);
    expect(
      staffBulkActionSchema.safeParse(
        payload(
          { visible: true },
          Array.from({ length: 201 }, (_, index) => `staff-${index}`),
        ),
      ).success,
    ).toBe(false);
    expect(staffBulkActionSchema.safeParse(payload({})).success).toBe(false);
  });
  it('rejects unrelated fields and website access changes', () => {
    for (const patch of [
      { bio: 'overwrite' },
      { customImage: '' },
      { roleIds: ['Owner'] },
      { visible: true, permissions: ['roles.manage'] },
    ])
      expect(
        staffBulkActionSchema.safeParse({ ...payload({ visible: true }), patch }).success,
      ).toBe(false);
    expect(
      staffBulkActionSchema.safeParse({ ...payload({ visible: true }), userIds: [actor.id] })
        .success,
    ).toBe(false);
  });
  it('validates assignment operations and labels without defaulting omitted labels', () => {
    expect(
      staffBulkActionSchema.safeParse(
        payload({
          assignment: { operation: 'REASSIGN', categoryId: hosts, destinationCategoryId: hosts },
        }),
      ).success,
    ).toBe(false);
    expect(
      staffBulkActionSchema.safeParse(
        payload({
          assignment: { operation: 'LABEL', categoryId: hosts, position: 'x'.repeat(101) },
        }),
      ).success,
    ).toBe(false);
    const parsed = staffBulkActionSchema.parse(
      payload({ assignment: { operation: 'ADD', categoryId: hosts } }),
    );
    expect(parsed.patch.assignment).not.toHaveProperty('position');
    expect(
      staffBulkActionSchema.parse(
        payload({ assignment: { operation: 'LABEL', categoryId: hosts, position: '  Captain  ' } }),
      ).patch.assignment,
    ).toMatchObject({ position: 'Captain' });
  });
});

describe('atomic public staff bulk operations', () => {
  it('dispatches the root action contract and stores its full typed payload', async () => {
    const input = payload({
      visible: false,
      assignment: { operation: 'LABEL', categoryId: hosts, position: 'Tournament host' },
    });
    expect(await executeAction(actor, actionSchema.parse(input))).toEqual({ updated: 2 });
    expect((await snapshot()).every((member) => !member.visible)).toBe(true);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { tournamentId, action: 'staff.bulk', entityId: 'bulk' },
    });
    expect(audit.details).toEqual(input);
    expect(
      await db.auditLog.count({
        where: { tournamentId, action: 'staff.bulk', entityType: 'StaffMember' },
      }),
    ).toBe(2);
  });

  it('rechecks database permissions after a staff role is revoked', async () => {
    const before = await snapshot();
    await db.userRole.delete({ where: { userId_roleId: { userId: actor.id, roleId } } });
    await expect(
      executeAction(actor, actionSchema.parse(payload({ visible: false }))),
    ).rejects.toMatchObject({ status: 403 });
    expect(await snapshot()).toEqual(before);
    expect(await db.auditLog.count({ where: { tournamentId } })).toBe(0);
  });

  it('does not use one tournament staff role to operate in another tournament', async () => {
    const before = await db.staffMember.findUniqueOrThrow({ where: { id: foreign } });
    await expect(
      executeAction(actor, actionSchema.parse(payload({ visible: false }, [foreign])), foreignId),
    ).rejects.toMatchObject({ status: 403 });
    expect(await db.staffMember.findUniqueOrThrow({ where: { id: foreign } })).toEqual(before);
  });

  it('changes visibility only, preserves all profile and category data, and audits every member', async () => {
    const before = await snapshot();
    expect(await apply(payload({ visible: false }))).toEqual({ updated: 2 });
    const after = await snapshot();
    expect(after).toEqual(before.map((member) => ({ ...member, visible: false })));
    expect(await db.auditLog.count({ where: { tournamentId, action: 'staff.bulk' } })).toBe(2);
    await apply(payload({ visible: true }));
    expect((await snapshot()).every((member) => member.visible)).toBe(true);
  });

  it('adds a category once and preserves existing labels unless explicitly patched', async () => {
    await apply(payload({ assignment: { operation: 'ADD', categoryId: referees } }));
    await apply(payload({ assignment: { operation: 'ADD', categoryId: referees } }));
    expect(
      (await assignments(alpha)).find((entry) => entry.categoryId === referees)?.position,
    ).toBe('');
    expect((await assignments(beta)).find((entry) => entry.categoryId === referees)?.position).toBe(
      'Existing referee label',
    );
    expect(await db.staffAssignment.count({ where: { tournamentId, categoryId: referees } })).toBe(
      2,
    );
    await apply(
      payload({
        assignment: { operation: 'ADD', categoryId: referees, position: 'Senior referee' },
      }),
    );
    expect(
      (await db.staffAssignment.findMany({ where: { tournamentId, categoryId: referees } })).every(
        (entry) => entry.position === 'Senior referee',
      ),
    ).toBe(true);
  });

  it('removes only the chosen category and tolerates already-absent assignments', async () => {
    const keep = (await assignments(alpha)).filter((entry) => entry.categoryId !== streamers);
    const betaBefore = await assignments(beta);
    await apply(payload({ assignment: { operation: 'REMOVE', categoryId: streamers } }));
    expect(await assignments(alpha)).toEqual(keep);
    expect(await assignments(beta)).toEqual(betaBefore);
  });

  it('reassigns source categories, inheriting source labels while keeping existing destination labels', async () => {
    await apply(
      payload({
        assignment: { operation: 'REASSIGN', categoryId: hosts, destinationCategoryId: referees },
      }),
    );
    const alphaAfter = await assignments(alpha),
      betaAfter = await assignments(beta);
    expect(alphaAfter.find((entry) => entry.categoryId === referees)?.position).toBe('Lead host');
    expect(betaAfter.find((entry) => entry.categoryId === referees)?.position).toBe(
      'Existing referee label',
    );
    expect(alphaAfter.find((entry) => entry.categoryId === streamers)?.position).toBe(
      'Stream lead',
    );
    expect(await db.staffAssignment.count({ where: { tournamentId, categoryId: hosts } })).toBe(0);
  });

  it('patches category position labels, including intentionally clearing a label', async () => {
    const before = await snapshot();
    await apply(
      payload({ assignment: { operation: 'LABEL', categoryId: hosts, position: 'New label' } }),
    );
    const after = await snapshot();
    expect(after).toEqual(
      before.map((member) => ({
        ...member,
        assignments: member.assignments.map((entry) =>
          entry.categoryId === hosts ? { ...entry, position: 'New label' } : entry,
        ),
      })),
    );
    await apply(payload({ assignment: { operation: 'LABEL', categoryId: hosts, position: '' } }));
    expect(
      (await db.staffAssignment.findMany({ where: { tournamentId, categoryId: hosts } })).every(
        (entry) => entry.position === '',
      ),
    ).toBe(true);
  });

  it('combines visibility and reassigning with explicit labels without touching user roles', async () => {
    const beforeUser = await db.user.findUniqueOrThrow({
      where: { id: actor.id },
      include: { roles: true },
    });
    await apply(
      payload({
        visible: false,
        assignment: {
          operation: 'REASSIGN',
          categoryId: hosts,
          destinationCategoryId: referees,
          position: 'Shared label',
        },
      }),
    );
    expect((await snapshot()).every((member) => !member.visible)).toBe(true);
    expect(
      (await db.staffAssignment.findMany({ where: { tournamentId, categoryId: referees } })).every(
        (entry) => entry.position === 'Shared label',
      ),
    ).toBe(true);
    expect(
      await db.user.findUniqueOrThrow({ where: { id: actor.id }, include: { roles: true } }),
    ).toEqual(beforeUser);
  });

  it('rejects foreign or missing members and categories before any selected record changes', async () => {
    const before = await snapshot();
    const foreignBefore = await db.staffMember.findUniqueOrThrow({ where: { id: foreign } });
    for (const ids of [
      [alpha, foreign],
      [alpha, 'missing-member'],
    ])
      await expect(apply(payload({ visible: false }, ids))).rejects.toMatchObject({ status: 404 });
    for (const categoryId of [foreignCategory, 'missing-category'])
      await expect(
        apply(payload({ visible: false, assignment: { operation: 'ADD', categoryId } })),
      ).rejects.toMatchObject({ status: 404 });
    await expect(
      apply(
        payload({
          visible: false,
          assignment: {
            operation: 'REASSIGN',
            categoryId: hosts,
            destinationCategoryId: foreignCategory,
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(await snapshot()).toEqual(before);
    expect(await db.staffMember.findUniqueOrThrow({ where: { id: foreign } })).toEqual(
      foreignBefore,
    );
    expect(await db.auditLog.count({ where: { tournamentId } })).toBe(0);
  });

  it('rejects reassigning or relabeling when any member lacks the source assignment', async () => {
    const before = await snapshot();
    await expect(
      apply(
        payload({
          visible: false,
          assignment: { operation: 'REASSIGN', categoryId: referees, destinationCategoryId: hosts },
        }),
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      apply(
        payload({
          visible: false,
          assignment: { operation: 'LABEL', categoryId: referees, position: 'Changed' },
        }),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await snapshot()).toEqual(before);
    expect(await db.auditLog.count({ where: { tournamentId } })).toBe(0);
  });

  it('enforces staff.edit and explicit tournament context', async () => {
    const before = await snapshot();
    await expect(apply(payload({ visible: false }), null)).rejects.toMatchObject({ status: 401 });
    for (const user of [
      { ...actor, permissions: [] },
      { ...actor, tournamentId: undefined },
      { ...actor, tournamentId: 'none' },
    ])
      await expect(apply(payload({ visible: false }), user)).rejects.toMatchObject({ status: 403 });
    await expect(
      apply(payload({ visible: false }), { ...actor, tournamentId: foreignId }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await snapshot()).toEqual(before);
  });

  it('rolls back assignments, visibility and audit rows if the surrounding transaction fails', async () => {
    const before = await snapshot();
    await expect(
      db.$transaction(async (tx) => {
        await applyStaffBulkAction(
          tx,
          actor,
          payload({ visible: false, assignment: { operation: 'REMOVE', categoryId: hosts } }),
        );
        throw new Error('Forced transaction failure');
      }),
    ).rejects.toThrow('Forced transaction failure');
    expect(await snapshot()).toEqual(before);
    expect(await db.auditLog.count({ where: { tournamentId } })).toBe(0);
  });
});
