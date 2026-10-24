import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db as rootDb } from './db';
import { scopedDb } from './scoped-db';
import { requestScope } from './tournament-context';
import { AppError, assertPermission, can, type Actor, type PermissionKey } from './permissions';
import { osuGet, profileSchema } from './osu';
import { parseTeamCsv } from './teams-csv';
import type { TeamAction, TeamFields } from './teams-validation';
import type { Prisma } from '@/generated/prisma/client';
import { publicTournamentWhere } from './public-visibility';
import { pageWindow } from './list-pagination';

export const teamInclude = {
  members: { orderBy: { position: 'asc' as const }, include: { participant: true } },
};
type Profile = z.infer<typeof profileSchema>;
type PlannedTeam = TeamFields & { id?: string; baseVersion: number };
export type TeamImportPlan = {
  teams: PlannedTeam[];
  profiles: Profile[];
  errors: string[];
  previewHash: string;
};
export function teamPermission(a: TeamAction): PermissionKey {
  switch (a.type) {
    case 'team.save':
      return a.id ? 'teams.edit' : 'teams.create';
    case 'team.delete':
      return 'teams.delete';
    case 'team.status':
      return 'teams.publish';
    default:
      return 'teams.import';
  }
}
async function profilesFor(ids: number[]) {
  const unique = [...new Set(ids)];
  const cached = await rootDb.participant.findMany({ where: { osuId: { in: unique } } });
  const found = new Map(
    cached.map((p) => [
      p.osuId,
      {
        id: p.osuId,
        username: p.username,
        avatar_url: p.avatarUrl,
        ...(p.country ? { country_code: p.country } : {}),
      },
    ]),
  );
  const missing = unique.filter((id) => !found.has(id));
  for (let offset = 0; offset < missing.length; offset += 50) {
    const params = new URLSearchParams();
    missing.slice(offset, offset + 50).forEach((id) => params.append('ids[]', String(id)));
    const response = z
      .object({ users: z.array(profileSchema) })
      .parse(await osuGet(`users?${params}`));
    response.users.filter((p) => unique.includes(p.id)).forEach((p) => found.set(p.id, p));
  }
  const invalid = unique.filter((id) => !found.has(id));
  if (invalid.length) throw new AppError(`Unknown or unavailable osu! IDs: ${invalid.join(', ')}`);
  return unique.map((id) => found.get(id)!);
}
export async function prepareTeamAction(
  actor: Actor,
  a: TeamAction,
): Promise<{ profiles: Profile[]; plan?: TeamImportPlan }> {
  const tournamentId = actor.tournamentId || 'main',
    db = scopedDb(rootDb, tournamentId);
  if (a.type === 'team.save') return { profiles: await profilesFor(a.members.map((m) => m.osuId)) };
  if (a.type !== 'team.import.preview' && a.type !== 'team.import.apply') return { profiles: [] };
  const { teams: parsed, errors } = parseTeamCsv(a.csv);
  const existing = await db.team.findMany({
    where: { tournamentId, slug: { in: parsed.map((t) => t.slug) } },
  });
  const teams = parsed.map((t) => {
    const old = existing.find((e) => e.slug === t.slug);
    return {
      ...t,
      logoImageId: old?.logoImageId || null,
      id: old?.id,
      baseVersion: old?.version || 0,
    };
  });
  if (existing.length && !can(actor, 'teams.edit'))
    errors.push('Editing existing teams also requires teams.edit.');
  const memberships = await db.teamMember.findMany({
    where: { osuId: { in: teams.flatMap((t) => t.members.map((m) => m.osuId)) } },
  });
  for (const member of memberships)
    if (!existing.some((t) => t.id === member.teamId))
      errors.push(`Player ${member.osuId} already belongs to a team outside this import.`);
  let profiles: Profile[] = [];
  if (!errors.length) {
    try {
      profiles = await profilesFor(teams.flatMap((t) => t.members.map((m) => m.osuId)));
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      errors.push(error.message);
    }
  }
  const previewHash = createHash('sha256')
    .update(
      JSON.stringify({
        tournamentId,
        csv: a.csv,
        teams: teams.map((t) => [t.id, t.baseVersion]),
        memberships: memberships.sort((a, b) => a.osuId - b.osuId).map((m) => [m.teamId, m.osuId]),
      }),
    )
    .digest('hex');
  return { profiles, plan: { teams, profiles, errors, previewHash } };
}
async function writeTeam(
  tx: Prisma.TransactionClient,
  fields: TeamFields,
  profiles: Profile[],
  id?: string,
  preservedMembers?: {
    osuId: number;
    registrationRank: number | null;
    registeredUsername: string | null;
    discordId?: string;
  }[],
) {
  if (
    fields.logoImageId &&
    !(await tx.mediaAsset.findUnique({ where: { id: fields.logoImageId } }))
  )
    throw new AppError('The selected team logo no longer exists.');
  if (
    await tx.teamMember.findFirst({
      where: {
        osuId: { in: fields.members.map((m) => m.osuId) },
        ...(id ? { teamId: { not: id } } : {}),
      },
    })
  )
    throw new AppError('A player already belongs to another team.');
  for (const member of fields.members) {
    const profile = profiles.find((p) => p.id === member.osuId);
    if (!profile) throw new AppError(`Profile ${member.osuId} could not be verified.`);
    await tx.participant.upsert({
      where: { osuId: member.osuId },
      create: {
        osuId: profile.id,
        username: profile.username,
        avatarUrl: profile.avatar_url,
        country: profile.country_code,
      },
      update: {},
    });
  }
  const { members, ...data } = fields;
  const existingMembers =
    preservedMembers ?? (id ? await tx.teamMember.findMany({ where: { teamId: id } }) : []);
  if (id) await tx.teamMember.deleteMany({ where: { teamId: id } });
  const roster = {
    create: members.map((m, position) => ({
      ...m,
      discordId:
        m.discordId ?? existingMembers.find((old) => old.osuId === m.osuId)?.discordId ?? '',
      position,
      registrationRank:
        existingMembers.find((old) => old.osuId === m.osuId)?.registrationRank ?? null,
      registeredUsername:
        existingMembers.find((old) => old.osuId === m.osuId)?.registeredUsername ?? null,
    })),
  };
  return id
    ? tx.team.update({
        where: { id },
        data: { ...data, version: { increment: 1 }, members: roster },
      })
    : tx.team.create({ data: { ...data, members: roster } });
}
async function currentTeam(tx: Prisma.TransactionClient, id: string, version: number) {
  const team = await tx.team.findFirst({ where: { id } });
  if (!team) throw new AppError('Team not found.', 404);
  if (team.version !== version)
    throw new AppError('This team changed in another session. Reload before saving.', 409);
  return team;
}
export async function applyTeamAction(
  tx: Prisma.TransactionClient,
  actor: Actor,
  a: TeamAction,
  prepared: Awaited<ReturnType<typeof prepareTeamAction>>,
) {
  tx = scopedDb(tx, actor.tournamentId || 'main');
  assertPermission(actor, teamPermission(a));
  if (a.type === 'team.import.preview') return prepared.plan;
  if (a.type === 'team.import.apply') {
    const plan = prepared.plan!;
    if (plan.errors.length) throw new AppError(plan.errors.join(' '));
    if (plan.previewHash !== a.previewHash)
      throw new AppError('The import changed. Preview it again before applying.', 409);
    if (plan.teams.some((t) => t.id)) assertPermission(actor, 'teams.edit');
    for (const team of plan.teams) if (team.id) await currentTeam(tx, team.id, team.baseVersion);
    const previousMembers = await tx.teamMember.findMany({
      where: { teamId: { in: plan.teams.flatMap((t) => (t.id ? [t.id] : [])) } },
    });
    await tx.teamMember.deleteMany({
      where: { teamId: { in: plan.teams.flatMap((t) => (t.id ? [t.id] : [])) } },
    });
    const ids = [];
    for (const { id, baseVersion, ...team } of plan.teams) {
      void baseVersion;
      ids.push((await writeTeam(tx, team, prepared.profiles, id, previousMembers)).id);
    }
    return { ids, count: ids.length };
  }
  if (a.type === 'team.save') {
    if (a.id) await currentTeam(tx, a.id, a.baseVersion);
    const { type, id, baseVersion, ...data } = a;
    void type;
    void baseVersion;
    return { id: (await writeTeam(tx, data, prepared.profiles, id)).id };
  }
  await currentTeam(tx, a.id, a.baseVersion);
  if (a.type === 'team.delete') {
    if (await tx.bracketEntry.count({ where: { teamId: a.id } }))
      throw new AppError(
        'This entrant belongs to a competition bracket. Withdraw or hide it instead of deleting its history.',
        409,
      );
    if (await tx.qualifierEntry.count({ where: { teamId: a.id } }))
      throw new AppError(
        'This entrant is used in qualifier history. Hide it instead of deleting it.',
        409,
      );
    if (await tx.match.count({ where: { OR: [{ teamAId: a.id }, { teamBId: a.id }] } }))
      throw new AppError(
        'This team is used in match history. Hide it instead of deleting it.',
        409,
      );
    await tx.team.delete({ where: { id: a.id } });
    return { id: a.id };
  }
  if (a.published && a.status !== 'APPROVED')
    throw new AppError('Only approved teams can be published.');
  await tx.team.update({
    where: { id: a.id },
    data: { status: a.status, published: a.published, version: { increment: 1 } },
  });
  return { id: a.id };
}
export const publicTeamSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  format: true,
  seed: true,
  rankSum: true,
  qualifierPlayed: true,
  logoImageId: true,
  members: {
    orderBy: { position: 'asc' as const },
    select: {
      osuId: true,
      captain: true,
      substitute: true,
      registrationRank: true,
      registeredUsername: true,
      participant: { select: { osuId: true, username: true, avatarUrl: true, country: true } },
    },
  },
};
const publicTeamWhere = {
  published: true,
  status: 'APPROVED',
  tournament: publicTournamentWhere,
} as const;
export async function publicTeams(
  slug?: string,
  tournamentId?: string,
  pagination?: { skip: number; take: number },
) {
  tournamentId ||= (await requestScope()).tournamentId;
  const db = scopedDb(rootDb, tournamentId);
  return db.team.findMany({
    where: { ...publicTeamWhere, ...(slug ? { slug } : {}) },
    orderBy: [{ position: 'asc' }, { seed: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    select: publicTeamSelect,
    ...(pagination ? { skip: pagination.skip, take: pagination.take } : {}),
  });
}

export async function publicTeamsPage(requested: number, tournamentId?: string) {
  tournamentId ||= (await requestScope()).tournamentId;
  const total = await scopedDb(rootDb, tournamentId).team.count({ where: publicTeamWhere });
  const window = pageWindow(requested, total, 50);
  return { ...window, items: await publicTeams(undefined, tournamentId, window) };
}
