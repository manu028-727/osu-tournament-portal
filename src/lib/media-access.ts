import { db } from './db';
import { scopedDb } from './scoped-db';

export async function isPublicAsset(id: string, tournamentId: string) {
  const t = await db.tournament.findUnique({
    where: { id: tournamentId },
    include: { settings: true },
  });
  if (!t?.published) return false;
  const scoped = scopedDb(db, tournamentId),
    url = `/api/media/${id}`;
  if ([t.settings?.logo, t.settings?.favicon, t.settings?.banner].includes(url)) return true;
  if (
    await scoped.tournamentStage.count({
      where: { bannerImageId: id, mappool: { state: 'PUBLISHED' } },
    })
  )
    return true;
  if (await scoped.team.count({ where: { logoImageId: id, published: true, status: 'APPROVED' } }))
    return true;
  if (await scoped.staffMember.count({ where: { visible: true, customImage: url } })) return true;
  const pages = await scoped.page.findMany({
    where: { state: 'PUBLISHED' },
    select: { publishedRevision: { include: { blocks: true } } },
  });
  return pages.some((p) => JSON.stringify(p.publishedRevision).includes(url));
}

export async function assertOwnedMedia(
  client: ReturnType<typeof scopedDb<typeof db>>,
  value: unknown,
) {
  const ids = [
    ...new Set(
      [...JSON.stringify(value).matchAll(/\/api\/media\/([a-zA-Z0-9_-]+)/g)].map((m) => m[1]),
    ),
  ];
  if (
    ids.length &&
    (await client.mediaAsset.count({ where: { id: { in: ids } } })) !== ids.length
  ) {
    const { AppError } = await import('./permissions');
    throw new AppError('An image does not belong to this tournament.', 403);
  }
}
