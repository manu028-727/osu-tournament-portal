import { z } from 'zod';
import { requireTournamentActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { AppError } from '@/lib/permissions';
import { profileSchema, osuGet } from '@/lib/osu';
import { errorResponse, rateLimit } from '@/lib/security';
export async function GET(request: Request) {
  try {
    const actor = await requireTournamentActor();
    if (!actor.permissions.some((p) => ['teams.create', 'teams.edit', 'teams.import'].includes(p)))
      throw new AppError('Forbidden.', 403);
    await rateLimit(`profiles:${actor.id}`, 20);
    const query = z
      .string()
      .trim()
      .min(1)
      .max(80)
      .parse(new URL(request.url).searchParams.get('q'));
    const cached = await db.participant.findFirst({
      where:
        /^\d+$/.test(query) && Number(query) <= 2147483647
          ? { osuId: Number(query) }
          : { username: { equals: query, mode: 'insensitive' } },
    });
    if (cached && cached.updatedAt.getTime() > Date.now() - 86400000)
      return Response.json(
        {
          id: cached.osuId,
          username: cached.username,
          avatar_url: cached.avatarUrl,
          country_code: cached.country,
        },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    let profile;
    try {
      profile = profileSchema.parse(
        await osuGet(
          `users/${/^\d+$/.test(query) ? Number(query) : '@' + encodeURIComponent(query.replace(/^@/, ''))}`,
        ),
      );
    } catch (error) {
      if (!cached) throw error;
      profile = {
        id: cached.osuId,
        username: cached.username,
        avatar_url: cached.avatarUrl,
        country_code: cached.country,
      };
    }
    await db.participant.upsert({
      where: { osuId: profile.id },
      create: {
        osuId: profile.id,
        username: profile.username,
        avatarUrl: profile.avatar_url,
        country: profile.country_code,
      },
      update: {
        username: profile.username,
        avatarUrl: profile.avatar_url,
        country: profile.country_code,
      },
    });
    return Response.json(profile, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
