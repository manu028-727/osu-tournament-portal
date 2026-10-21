import { db as rootDb } from './db';
import { scopedDb } from './scoped-db';
import { requestScope } from './tournament-context';
import { sortPoolSlots } from './mappool-order';
import { cleanHtml } from './rich-text';
import { gameplayScoringSchema } from './gameplay-scoring';
export const revisionInclude = { blocks: { orderBy: { position: 'asc' as const } } };
export const poolRevisionInclude = { slots: { orderBy: { position: 'asc' as const } } };
export async function getTournament(tournamentId?: string) {
  const tournament = await rootDb.tournament.findUniqueOrThrow({
    where: { id: tournamentId || (await requestScope()).tournamentId },
    include: { settings: true },
  });
  return {
    ...tournament,
    settings: tournament.settings
      ? {
          ...tournament.settings,
          gameplayScoring: gameplayScoringSchema
            .nullable()
            .parse(tournament.settings.gameplayScoring),
        }
      : null,
  };
}
async function publicDb(tournamentId?: string) {
  const t = await getTournament(tournamentId);
  if (!t.published) return null;
  return scopedDb(rootDb, t.id);
}
export async function publicPage(slug: string, tournamentId?: string) {
  const db = await publicDb(tournamentId);
  if (!db) return null;
  const page = await db.page.findFirst({
    where: { slug, state: 'PUBLISHED' },
    select: { title: true, publishedRevision: { include: revisionInclude } },
  });
  const revision = page?.publishedRevision;
  if (!revision) return null;
  const publicBase = tournamentId
    ? tournamentId === 'main'
      ? ''
      : `/t/${(await getTournament(tournamentId)).slug}`
    : (await requestScope()).publicBase;
  return {
    ...revision,
    html: cleanHtml(revision.html, publicBase),
    blocks: revision.blocks.map((block) => {
      const content = block.content as Record<string, unknown>;
      return {
        ...block,
        content:
          content && typeof content.html === 'string'
            ? { ...content, html: cleanHtml(content.html, publicBase) }
            : block.content,
      };
    }),
  };
}
export async function publicPools(tournamentId?: string) {
  const db = await publicDb(tournamentId);
  if (!db) return [];
  const stages = await db.tournamentStage.findMany({
    where: { mappool: { state: 'PUBLISHED', publishedRevisionId: { not: null } } },
    orderBy: { position: 'asc' },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      startsAt: true,
      bannerImageId: true,
      mappool: { select: { publishedRevision: { include: poolRevisionInclude } } },
    },
  });
  for (const stage of stages) {
    const revision = stage.mappool?.publishedRevision;
    if (revision) revision.slots = sortPoolSlots(revision.slots);
  }
  return stages;
}
export async function publicPool(slug: string, tournamentId?: string) {
  const db = await publicDb(tournamentId);
  if (!db) return null;
  const stage = await db.tournamentStage.findFirst({
    where: { slug, mappool: { state: 'PUBLISHED', publishedRevisionId: { not: null } } },
    select: {
      name: true,
      slug: true,
      description: true,
      mappool: { select: { publishedRevision: { include: poolRevisionInclude } } },
    },
  });
  const revision = stage?.mappool?.publishedRevision;
  if (revision) revision.slots = sortPoolSlots(revision.slots);
  return stage;
}
export async function publicStaff(tournamentId?: string) {
  const db = await publicDb(tournamentId);
  if (!db) return [];
  return db.staffCategory.findMany({
    orderBy: { position: 'asc' },
    include: {
      assignments: {
        where: { member: { visible: true } },
        orderBy: { member: { position: 'asc' } },
        include: { member: true },
      },
    },
  });
}
