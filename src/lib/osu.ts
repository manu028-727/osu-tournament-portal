import { z } from 'zod';
import { db } from './db';
import { AppError } from './permissions';
import { rateLimit } from './security';
export const profileSchema = z.object({
  id: z.number().int().positive(),
  username: z.string(),
  avatar_url: z.url(),
  country_code: z.string().optional(),
});
const apiBeatmap = z.object({
  id: z.number().int(),
  mode: z.string(),
  version: z.string(),
  difficulty_rating: z.number(),
  bpm: z.number().nullable(),
  total_length: z.number(),
  ar: z.number(),
  cs: z.number(),
  accuracy: z.number(),
  drain: z.number(),
  beatmapset: z.object({
    id: z.number(),
    title: z.string(),
    artist: z.string(),
    creator: z.string(),
    covers: z.record(z.string(), z.string()),
  }),
});
export type BeatmapMetadata = {
  id: number;
  mode: string;
  title: string;
  artist: string;
  mapper: string;
  difficulty: string;
  stars: number;
  bpm: number;
  length: number;
  ar: number;
  cs: number;
  od: number;
  hp: number | null;
  unavailable?: boolean;
  statisticsSource?: 'main-sheet';
  cover: string;
  url: string;
};
let credentials: Promise<{ access_token: string; expiresAt: number }> | undefined;
export function oauthConfig() {
  if (!process.env.OSU_CLIENT_ID || !process.env.OSU_CLIENT_SECRET)
    throw new AppError(
      'osu! OAuth is not configured. Add OSU_CLIENT_ID and OSU_CLIENT_SECRET to the server environment.',
      503,
    );
  return { client_id: process.env.OSU_CLIENT_ID, client_secret: process.env.OSU_CLIENT_SECRET };
}
export async function requestToken(params: Record<string, string>) {
  const res = await fetch('https://osu.ppy.sh/oauth/token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...oauthConfig(), ...params }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new AppError('osu! could not complete authentication. Please try again.', 502);
  return z.object({ access_token: z.string(), expires_in: z.number() }).parse(await res.json());
}
async function publicToken() {
  if (credentials && (await credentials).expiresAt > Date.now())
    return (await credentials).access_token;
  credentials = requestToken({ grant_type: 'client_credentials', scope: 'public' }).then((t) => ({
    ...t,
    expiresAt: Date.now() + (t.expires_in - 120) * 1000,
  }));
  try {
    return (await credentials).access_token;
  } catch (e) {
    credentials = undefined;
    throw e;
  }
}
export async function osuGet(path: string, accessToken?: string, apiVersion?: string) {
  await rateLimit('osu:global', 55, 60);
  let response: Response;
  try {
    response = await fetch(`https://osu.ppy.sh/api/v2/${path}`, {
      headers: {
        Authorization: `Bearer ${accessToken || (await publicToken())}`,
        Accept: 'application/json',
        ...(apiVersion ? { 'x-api-version': apiVersion } : {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      'osu! is temporarily unavailable. Saved content is safe; try again shortly.',
      502,
    );
  }
  if (response.status === 404)
    throw new AppError('The osu! account or beatmap was not found.', 404);
  if (!response.ok) {
    if (response.status === 401) credentials = undefined;
    throw new AppError('osu! could not return data. Please try again shortly.', 502);
  }
  return response.json();
}
export async function osuProfile(osuId: number) {
  const profile = profileSchema.parse(await osuGet(`users/${osuId}`));
  if (profile.id !== osuId)
    throw new AppError('The requested osu! user ID could not be verified.', 404);
  return profile;
}
export async function beatmaps(ids: number[], mode: string) {
  const unique = [...new Set(ids)];
  const cached = await db.beatmap.findMany({ where: { id: { in: unique } } });
  const found = new Map<number, BeatmapMetadata>();
  for (const item of cached)
    if (item.fetchedAt.getTime() > Date.now() - 86400000)
      found.set(item.id, item.metadata as BeatmapMetadata);
  const missing = unique.filter((id) => !found.has(id));
  for (let i = 0; i < missing.length; i += 50) {
    const batch = missing.slice(i, i + 50);
    const query = new URLSearchParams();
    batch.forEach((id) => query.append('ids[]', String(id)));
    const result = z
      .object({ beatmaps: z.array(apiBeatmap) })
      .parse(await osuGet(`beatmaps?${query}`));
    for (const map of result.beatmaps) {
      const s = map.beatmapset;
      const metadata: BeatmapMetadata = {
        id: map.id,
        mode: map.mode,
        title: s.title,
        artist: s.artist,
        mapper: s.creator,
        difficulty: map.version,
        stars: map.difficulty_rating,
        bpm: map.bpm || 0,
        length: map.total_length,
        ar: map.ar,
        cs: map.cs,
        od: map.accuracy,
        hp: map.drain,
        cover: s.covers['cover@2x'] || s.covers.cover,
        url: `https://osu.ppy.sh/beatmaps/${map.id}`,
      };
      await db.beatmap.upsert({
        where: { id: map.id },
        create: { id: map.id, mode: map.mode, metadata },
        update: { mode: map.mode, metadata, fetchedAt: new Date() },
      });
      found.set(map.id, metadata);
    }
  }
  return {
    maps: unique
      .filter((id) => found.has(id) && found.get(id)!.mode === mode)
      .map((id) => found.get(id)!),
    errors: unique
      .filter((id) => !found.has(id) || found.get(id)!.mode !== mode)
      .map((id) => ({
        id,
        error: found.has(id)
          ? `This beatmap uses ${found.get(id)!.mode}; the tournament uses ${mode}.`
          : 'Beatmap does not exist or is unavailable.',
      })),
  };
}
