import type { Prisma } from '@/generated/prisma/client';
import { scopedDb } from './scoped-db';

// Traverse actual values, not serialized substrings: IDs with a common prefix are
// different references. Snapshot image IDs and authored URLs share this parser.
export function referencedMediaIds(value: unknown, namespace: 'tenant' | 'platform' = 'tenant') {
  const ids = new Set<string>();
  const pattern =
    namespace === 'tenant'
      ? /\/api\/media\/([a-zA-Z0-9_-]+)/g
      : /\/api\/platform\/media\/([a-zA-Z0-9_-]+)/g;
  const visit = (child: unknown, field = '') => {
    if (typeof child === 'string') {
      for (const match of child.matchAll(pattern)) ids.add(match[1]);
      if (namespace === 'tenant' && ['logoImageId', 'bannerImageId'].includes(field) && child)
        ids.add(child);
    } else if (Array.isArray(child)) child.forEach((entry) => visit(entry));
    else if (child && typeof child === 'object')
      for (const [key, entry] of Object.entries(child)) visit(entry, key);
  };
  visit(value);
  return ids;
}

const historySources = {
  pageRevision: ['html'],
  contentBlock: ['content'],
  staffMember: ['customImage'],
  match: ['participants', 'source'],
  matchResultRevision: ['snapshot'],
  matchEvent: ['data'],
  matchMapAction: ['provenance'],
  qualifierLobby: ['participants'],
  qualifierEvent: ['data'],
  qualifierStanding: ['snapshot'],
  bracket: ['config', 'seedOrder'],
  mappoolSlot: ['metadata'],
  poolCandidate: ['metadata'],
} as const;

// The caller supplies the locked deletion transaction. Scan saved/restorable
// references in bounded batches, including hidden blocks and old snapshots.
export async function isMediaReferenced(
  transaction: Prisma.TransactionClient,
  tournamentId: string,
  id: string,
) {
  const tx = scopedDb(transaction, tournamentId);
  const settings = await tx.tournamentSettings.findUnique({ where: { tournamentId } });
  if (referencedMediaIds(settings).has(id)) return true;
  if (await tx.tournamentStage.count({ where: { bannerImageId: id } })) return true;
  if (await tx.team.count({ where: { logoImageId: id } })) return true;
  type Delegate = {
    findMany(args: unknown): Promise<({ id: string } & Record<string, unknown>)[]>;
  };
  for (const [model, fields] of Object.entries(historySources)) {
    const delegate = (tx as unknown as Record<string, Delegate>)[model];
    let cursor: string | undefined;
    for (;;) {
      const rows = await delegate.findMany({
        where: cursor ? { id: { gt: cursor } } : {},
        orderBy: { id: 'asc' },
        take: 100,
        select: Object.fromEntries(['id', ...fields].map((field) => [field, true])),
      });
      if (rows.some((row) => referencedMediaIds(row).has(id))) return true;
      if (rows.length < 100) break;
      cursor = rows.at(-1)!.id;
    }
  }
  return false;
}
