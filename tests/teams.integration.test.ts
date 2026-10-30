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
  for (const osuId of [930000001, 930000002, 930000003])
    await db.participant.create({
      data: { osuId, username: prefix + osuId, avatarUrl: 'https://a.ppy.sh/1' },
    });
});
afterAll(async () => {
  await db.team.deleteMany({ where: { slug: { startsWith: prefix } } });
  await db.participant.deleteMany({ where: { osuId: { in: [930000001, 930000002, 930000003] } } });
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
        { osuId: 930000001, captain: true, substitute: false, discordId: '111111111111111111' },
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
    expect(JSON.stringify(await publicTeams(prefix))).not.toContain('111111111111111111');
    expect(JSON.stringify(await publicTeams(prefix))).not.toContain('discordId');
    expect((await db.teamMember.findFirstOrThrow({ where: { teamId } })).discordId).toBe(
      '111111111111111111',
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
});
