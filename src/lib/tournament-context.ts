import { headers } from 'next/headers.js';
import { cache } from 'react';
import { db } from './db';
import { AppError } from './permissions';
export const requestScope = cache(async () => {
  let slug: string | null = null,
    path = '';
  try {
    const h = await headers();
    slug = h.get('x-tournament-slug');
    path = h.get('x-original-path') || '';
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') throw error;
  }
  if (slug) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new AppError('Tournament not found.', 404);
    const tournament = await db.tournament.findUnique({
      where: { slug },
      select: { id: true, timezone: true },
    });
    if (!tournament) throw new AppError('Tournament not found.', 404);
    return {
      tournamentId: tournament.id,
      timezone: tournament.timezone,
      slug,
      path,
      publicBase: `/t/${slug}`,
      adminBase: `/admin/t/${slug}`,
    };
  }
  const platform = await db.platformSettings.findUnique({ where: { id: 'main' } });
  if (
    platform?.defaultTournamentId &&
    platform.defaultTournamentId !== 'main' &&
    platform.rootMode === 'FEATURED'
  ) {
    const t = await db.tournament.findUniqueOrThrow({
      where: { id: platform.defaultTournamentId },
    });
    return {
      tournamentId: t.id,
      timezone: t.timezone,
      slug: t.slug,
      path,
      publicBase: `/t/${t.slug}`,
      adminBase: `/admin/t/${t.slug}`,
    };
  }
  const fallback =
    platform?.defaultTournamentId ||
    (await db.tournament.findUnique({ where: { id: 'main' }, select: { id: true } }))?.id ||
    'none';
  return {
    tournamentId: fallback,
    timezone:
      (
        await db.tournament.findUnique({
          where: { id: fallback },
          select: { timezone: true },
        })
      )?.timezone ||
      platform?.timezone ||
      'UTC',
    slug: '',
    path,
    publicBase: '',
    adminBase: '/admin',
  };
});
