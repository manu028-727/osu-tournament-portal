import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { db } from '../src/lib/db';
import { executeAction } from '../src/lib/admin-service';
import { actionSchema } from '../src/lib/validation';
import { publicTeams, type TeamImportPlan } from '../src/lib/teams-service';
import type { Actor, PermissionKey } from '../src/lib/permissions';
const prefix = `teams-${Date.now()}`;
let owner: Actor, guest: Actor, teamId: string;
async function account(osuId: number, systemKey: string): Promise<Actor> {
  const role = await db.role.findUniqueOrThrow({
    where: { systemKey },
    include: { permissions: true },
  });
  const user = await db.user.create({
    data: {
      osuId,
      username: prefix + systemKey,
      avatarUrl: 'https://a.ppy.sh/1',
      profileUrl: `https://osu.ppy.sh/users/${osuId}`,
      roles: { create: { roleId: role.id } },
    },
  });
  return {
    ...user,
    roles: [role],
    permissions: role.permissions.map((p) => p.permissionKey as PermissionKey),
  };
}
const act = (actor: Actor | null, value: unknown) =>
  executeAction(actor, actionSchema.parse(value));
beforeAll(async () => {
  if (new URL(process.env.DATABASE_URL!).pathname !== '/tournament_platform_test')
    throw new Error('Test database only.');
  owner = await account(920000001, 'Owner');
  guest = await account(920000002, 'Guest');
  for (const osuId of [930000001, 930000002, 930000003, 930000004])
    await db.participant.create({
      data: { osuId, username: prefix + osuId, avatarUrl: 'https://a.ppy.sh/1' },
    });
});
afterAll(async () => {
  await db.team.deleteMany({ where: { slug: { startsWith: prefix } } });
  await db.participant.deleteMany({
    where: { osuId: { in: [930000001, 930000002, 930000003, 930000004] } },
  });
  await db.user.deleteMany({ where: { osuId: { in: [920000001, 920000002] } } });
  await db.$disconnect();
});
describe.sequential('persistent team registration workflows', () => {
  it('automatically approves new organizer entries and rejects Guest mutations', async () => {
    const input = {
      type: 'team.save',
      name: prefix,
      slug: prefix,
      members: [
        { osuId: 930000001, captain: true, substitute: false, discordUsername: '@Player_One' },
      ],
    };
    await expect(act(guest, input)).rejects.toThrow('permission');
    const team = (await act(owner, input)) as { id: string };
    teamId = team.id;
    expect(await publicTeams(prefix)).toHaveLength(1);
  });
  it('keeps legacy pending entries private and rejects stale writes', async () => {
    await expect(
      act(owner, {
        type: 'team.status',
        id: teamId,
        baseVersion: 1,
        status: 'PENDING',
        published: true,
      }),
    ).rejects.toThrow('Pending teams');
    await act(owner, {
      type: 'team.status',
      id: teamId,
      baseVersion: 1,
      status: 'APPROVED',
      published: true,
    });
    expect((await publicTeams(prefix))[0].members[0].osuId).toBe(930000001);
    expect(JSON.stringify(await publicTeams(prefix))).not.toContain('player_one');
    expect(JSON.stringify(await publicTeams(prefix))).not.toContain('discord');
    expect((await db.teamMember.findFirstOrThrow({ where: { teamId } })).discordUsername).toBe(
      'player_one',
    );
    await expect(
      act(owner, {
        type: 'team.status',
        id: teamId,
        baseVersion: 1,
        status: 'REJECTED',
        rejectionReason: 'Reviewed eligibility rejection',
        published: false,
      }),
    ).rejects.toThrow('another session');
  });
  it('keeps a numeric ID from before usernames until a username replaces it', async () => {
    const save = (id: string | undefined, baseVersion: number, discordUsername?: string) =>
      act(owner, {
        type: 'team.save',
        id,
        baseVersion,
        name: `${prefix}-older`,
        slug: `${prefix}-older`,
        members: [{ osuId: 930000004, captain: true, substitute: false, discordUsername }],
      }) as Promise<{ id: string }>;
    const { id } = await save(undefined, 0);
    await db.teamMember.updateMany({
      where: { teamId: id },
      data: { discordId: '222222222222222222' },
    });
    const member = () => db.teamMember.findFirstOrThrow({ where: { teamId: id } });

    // A form that leaves the username blank has not replaced anything.
    await save(id, 1, '');
    expect(await member()).toMatchObject({ discordId: '222222222222222222', discordUsername: '' });
    await save(id, 2, '@Older.Player');
    expect(await member()).toMatchObject({ discordId: '', discordUsername: 'older.player' });
    // A roster saved without this field, as a CSV import does, keeps what is there.
    await save(id, 3);
    expect(await member()).toMatchObject({ discordUsername: 'older.player' });
    await db.team.delete({ where: { id } });
  });
  it('protects unique team membership and rejects invalid solo rosters', async () => {
    await expect(
      act(owner, {
        type: 'team.save',
        name: prefix,
        slug: prefix + '-other',
        members: [{ osuId: 930000001, captain: true, substitute: false }],
      }),
    ).rejects.toThrow('another team');
    expect(() =>
      actionSchema.parse({
        type: 'team.save',
        name: 'Solo',
        slug: 'solo',
        format: 'INDIVIDUAL',
        members: [
          { osuId: 930000002, captain: true, substitute: false },
          { osuId: 930000003, captain: false, substitute: false },
        ],
      }),
    ).toThrow();
  });
  it('previews CSV without writing and atomically applies reviewed records', async () => {
    const csv = `team_name,team_slug,osu_id,captain\nImported,${prefix}-import,930000002,true\nImported,${prefix}-import,930000003,false`;
    const plan = (await act(owner, { type: 'team.import.preview', csv })) as TeamImportPlan;
    expect(plan.errors).toEqual([]);
    expect(
      await db.team.findFirst({ where: { tournamentId: 'main', slug: prefix + '-import' } }),
    ).toBeNull();
    await expect(
      act(owner, { type: 'team.import.apply', csv, previewHash: 'a'.repeat(64) }),
    ).rejects.toThrow('Preview');
    await act(owner, { type: 'team.import.apply', csv, previewHash: plan.previewHash });
    expect(
      (
        await db.team.findFirstOrThrow({
          where: { slug: prefix + '-import' },
          include: { members: true },
        })
      ).members,
    ).toHaveLength(2);
    expect((await publicTeams(prefix + '-import'))[0].status).toBe('APPROVED');
    expect(
      await db.auditLog.count({ where: { actorId: owner.id, action: 'team.import.apply' } }),
    ).toBe(1);
  });
  it('preserves approval on imports, rejects changed previews, and publishes public rejection reasons', async () => {
    const csv = `team_name,team_slug,osu_id,captain\nUpdated,${prefix},930000001,true`;
    const plan = (await act(owner, { type: 'team.import.preview', csv })) as TeamImportPlan;
    await act(owner, {
      type: 'team.status',
      id: teamId,
      baseVersion: 2,
      status: 'APPROVED',
      published: true,
    });
    await expect(
      act(owner, { type: 'team.import.apply', csv, previewHash: plan.previewHash }),
    ).rejects.toThrow('Preview');
    const next = (await act(owner, { type: 'team.import.preview', csv })) as TeamImportPlan;
    await act(owner, { type: 'team.import.apply', csv, previewHash: next.previewHash });
    const updated = await db.team.findUniqueOrThrow({ where: { id: teamId } });
    expect(updated.published).toBe(true);
    expect(updated.status).toBe('APPROVED');
    await act(owner, {
      type: 'team.status',
      id: teamId,
      baseVersion: updated.version,
      status: 'REJECTED',
      rejectionReason: 'Reviewed eligibility rejection',
      published: false,
    });
    expect((await publicTeams(prefix)).find((team) => team.id === teamId)).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'Reviewed eligibility rejection',
    });
  });
  it('supports narrow inline identity edits and atomic, reviewed team batches', async () => {
    const team = await db.team.findUniqueOrThrow({ where: { id: teamId } });
    const imported = await db.team.findFirstOrThrow({ where: { slug: prefix + '-import' } });
    const roster = await db.teamMember.findMany({ where: { teamId } });
    await expect(
      act(guest, {
        type: 'team.patch',
        id: team.id,
        baseVersion: team.version,
        name: 'Denied',
        seed: 1,
      }),
    ).rejects.toThrow('permission');
    await act(owner, {
      type: 'team.patch',
      id: team.id,
      baseVersion: team.version,
      name: prefix,
      seed: 4,
    });
    expect(await db.teamMember.findMany({ where: { teamId } })).toEqual(roster);
    await expect(
      act(owner, {
        type: 'team.bulk',
        entries: [
          { id: imported.id, baseVersion: imported.version },
          { id: team.id, baseVersion: team.version },
        ],
        operation: 'HIDE',
      }),
    ).rejects.toThrow('another session');
    expect((await db.team.findUniqueOrThrow({ where: { id: imported.id } })).published).toBe(true);
    const updated = await db.team.findUniqueOrThrow({ where: { id: team.id } });
    await act(owner, {
      type: 'team.bulk',
      entries: [
        { id: updated.id, baseVersion: updated.version },
        { id: imported.id, baseVersion: imported.version },
      ],
      operation: 'APPROVE',
    });
    expect(await db.auditLog.count({ where: { actorId: owner.id, action: 'team.patch' } })).toBe(1);
  });
  it('validates bulk role permissions and reviewed assignments transactionally', async () => {
    const role = await db.role.findUniqueOrThrow({ where: { systemKey: 'Pooler' } });
    const before = await db.userRole.findMany({ where: { userId: guest.id } });
    const selection = [{ userId: guest.id, baseRoleIds: before.map((r) => r.roleId) }];
    await expect(
      act(owner, {
        type: 'user.roles.bulk',
        users: selection,
        roleIds: [role.id],
        operation: 'ADD',
        baseRoles: [],
      }),
    ).rejects.toThrow('Role permissions changed');
    await expect(
      act(guest, {
        type: 'user.roles.bulk',
        users: selection,
        roleIds: [role.id],
        operation: 'ADD',
      }),
    ).rejects.toThrow('permission');
    await act(owner, {
      type: 'user.roles.bulk',
      users: selection,
      roleIds: [role.id],
      operation: 'ADD',
    });
    await expect(
      act(owner, {
        type: 'user.roles.bulk',
        users: selection,
        roleIds: [role.id],
        operation: 'REMOVE',
      }),
    ).rejects.toThrow('changed');
    const current = await db.userRole.findMany({ where: { userId: guest.id } });
    await expect(
      act(owner, {
        type: 'user.roles.bulk',
        users: [
          { userId: guest.id, baseRoleIds: current.map((r) => r.roleId) },
          { userId: owner.id, baseRoleIds: owner.roles.map((r) => r.id) },
        ],
        roleIds: [role.id],
        operation: 'REMOVE',
      }),
    ).rejects.toThrow('own roles');
    expect(await db.userRole.findMany({ where: { userId: guest.id } })).toEqual(current);
    await act(owner, {
      type: 'user.roles',
      userId: guest.id,
      roleIds: before.map((r) => r.roleId),
      baseRoleIds: current.map((r) => r.roleId),
    });
  });
});
