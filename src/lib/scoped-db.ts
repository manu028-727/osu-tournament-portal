import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { AppError } from './permissions';

type Client = PrismaClient | Prisma.TransactionClient;
type Data = Record<string, unknown>;
// New models must be classified explicitly; an unknown delegate never becomes global.
const globalModels = new Set([
  'user',
  'session',
  'oAuthState',
  'rateLimit',
  'permission',
  'platformSettings',
  'platformAsset',
  'mediaCleanup',
  'tournamentTransfer',
  'participant',
  'beatmap',
]);
const direct = new Set([
  'tournamentSettings',
  'page',
  'pageRevision',
  'tournamentStage',
  'tournamentPhase',
  'phaseAdvancement',
  'modCategory',
  'mappool',
  'mappoolRevision',
  'poolPlan',
  'poolCandidate',
  'poolCandidateTag',
  'poolSkillset',
  'poolReview',
  'poolArtistWarning',
  'staffMember',
  'staffCategory',
  'staffAssignment',
  'mediaAsset',
  'role',
  'userRole',
  'team',
  'teamMember',
  'match',
  'qualifierLobby',
  'qualifierEntry',
  'qualifierStanding',
  'bracket',
  'bracketRound',
  'bracketNode',
  'bracketSlot',
  'bracketEntry',
  'auditLog',
  'refereeImport',
  'ircLobbyRequest',
]);
const parents: Record<string, string[]> = {
  contentBlock: ['revision'],
  mappoolSlot: ['revision'],
  rolePermission: ['role'],
  matchAssignment: ['match'],
  matchMapAction: ['match'],
  matchMapResult: ['match'],
  multiplayerGame: ['match'],
  matchPlayerScore: ['result', 'match'],
  matchEvent: ['match'],
  matchResultRevision: ['match'],
  qualifierAssignment: ['lobby'],
  qualifierScore: ['lobby'],
  qualifierEvent: ['lobby'],
  qualifierGame: ['lobby'],
};
const relations: Record<string, Record<string, string>> = {
  tournament: { settings: 'tournamentSettings' },
  page: {
    revisions: 'pageRevision',
    draftRevision: 'pageRevision',
    publishedRevision: 'pageRevision',
  },
  pageRevision: { blocks: 'contentBlock' },
  tournamentStage: { mappool: 'mappool', qualifierStandings: 'qualifierStanding' },
  mappool: {
    revisions: 'mappoolRevision',
    draftRevision: 'mappoolRevision',
    publishedRevision: 'mappoolRevision',
  },
  mappoolRevision: { slots: 'mappoolSlot' },
  role: { users: 'userRole', permissions: 'rolePermission' },
  staffMember: { assignments: 'staffAssignment' },
  team: { members: 'teamMember' },
  match: {
    assignments: 'matchAssignment',
    actions: 'matchMapAction',
    results: 'matchMapResult',
    events: 'matchEvent',
    revisions: 'matchResultRevision',
    ircLobbyRequests: 'ircLobbyRequest',
  },
  matchMapResult: { playerScores: 'matchPlayerScore' },
  qualifierLobby: {
    games: 'qualifierGame',
    ircLobbyRequests: 'ircLobbyRequest',
    entries: 'qualifierEntry',
    assignments: 'qualifierAssignment',
    scores: 'qualifierScore',
    events: 'qualifierEvent',
  },
  bracket: { rounds: 'bracketRound', nodes: 'bracketNode', entries: 'bracketEntry' },
  bracketNode: { slots: 'bracketSlot' },
};
const object = (value: unknown): Data =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Data) : {};
const contexts = new WeakMap<object, string>();
const scalarFields = new Map(
  Object.entries(Prisma.ModelName).map(([name]) => [
    name[0].toLowerCase() + name.slice(1),
    new Set(
      Object.values(
        (Prisma as unknown as Record<string, Record<string, string>>)[`${name}ScalarFieldEnum`],
      ),
    ),
  ]),
);
const parentReferences: Record<string, Record<string, string>> = {
  pageRevision: { pageId: 'page' },
  mappoolRevision: { mappoolId: 'mappool' },
  contentBlock: { revisionId: 'pageRevision' },
  mappoolSlot: { revisionId: 'mappoolRevision' },
  rolePermission: { roleId: 'role' },
  matchAssignment: { matchId: 'match' },
  matchMapAction: { matchId: 'match' },
  matchMapResult: { matchId: 'match', actionId: 'matchMapAction' },
  multiplayerGame: { matchId: 'match', actionId: 'matchMapAction' },
  matchPlayerScore: { resultId: 'matchMapResult' },
  matchEvent: { matchId: 'match' },
  matchResultRevision: { matchId: 'match' },
  qualifierAssignment: { lobbyId: 'qualifierLobby' },
  qualifierScore: { lobbyId: 'qualifierLobby' },
  qualifierEvent: { lobbyId: 'qualifierLobby' },
  qualifierGame: { lobbyId: 'qualifierLobby' },
  ircLobbyRequest: { matchId: 'match', qualifierLobbyId: 'qualifierLobby' },
};
async function assertReferences(
  client: Client,
  model: string,
  input: unknown,
  tournamentId: string,
): Promise<void> {
  for (const row of Array.isArray(input) ? input : [input]) {
    const data = object(row);
    for (const [field, parent] of Object.entries(parentReferences[model] || {})) {
      if (data[field] === undefined || data[field] === null) continue;
      const delegate = (
        client as unknown as Record<string, { findFirst(args: unknown): Promise<unknown> }>
      )[parent];
      if (
        !(await delegate.findFirst({
          where: withWhere({ id: data[field] }, ownership(parent, tournamentId)!),
          select: { id: true },
        }))
      )
        throw new AppError('Cross-tournament references are not permitted.', 403);
    }
    for (const [field, child] of Object.entries(relations[model] || {})) {
      const nested = object(data[field]);
      if (nested.create) await assertReferences(client, child, nested.create, tournamentId);
      if (nested.createMany)
        await assertReferences(client, child, object(nested.createMany).data, tournamentId);
      if (nested.update) {
        for (const update of Array.isArray(nested.update) ? nested.update : [nested.update])
          await assertReferences(client, child, object(update).data || update, tournamentId);
      }
    }
  }
}
function ownership(model: string, tournamentId: string): Data | null {
  if (model === 'tournament') return { id: tournamentId };
  if (direct.has(model)) return { tournamentId };
  const path = parents[model];
  return path ? path.reduceRight<Data>((where, key) => ({ [key]: where }), { tournamentId }) : null;
}
function withWhere(where: unknown, scope: Data) {
  const original = object(where);
  return {
    ...original,
    AND: [
      ...(Array.isArray(original.AND) ? original.AND : original.AND ? [original.AND] : []),
      scope,
    ],
  };
}
function ownedData(
  model: string,
  input: unknown,
  tournamentId: string,
  creating: boolean,
  nestedChild = false,
): unknown {
  if (Array.isArray(input))
    return input.map((row) => ownedData(model, row, tournamentId, creating, nestedChild));
  const data = { ...object(input) };
  if (model === 'tournament' && data.id !== undefined && data.id !== tournamentId)
    throw new AppError('Tournament identifiers are immutable.', 403);
  if (direct.has(model)) {
    if (data.tournamentId !== undefined && data.tournamentId !== tournamentId)
      throw new AppError('Cross-tournament references are not permitted.', 403);
    if (creating && !nestedChild) data.tournamentId = tournamentId;
    if (nestedChild) delete data.tournamentId;
  }
  for (const field of Object.keys(data))
    if (!scalarFields.get(model)?.has(field) && !(field in (relations[model] || {})))
      throw new AppError(
        'Unsupported nested write: {0}.{1}. Use an explicit domain operation.',
        403,
        [model, field],
      );
  for (const [field, child] of Object.entries(relations[model] || {})) {
    if (!data[field]) continue;
    const nested = { ...object(data[field]) };
    if (
      Object.keys(nested).some(
        (operation) => !['create', 'createMany', 'update'].includes(operation),
      )
    )
      throw new AppError(
        'Unsupported nested operation. Use an explicitly scoped domain operation.',
        403,
      );
    for (const operation of ['create', 'update'] as const)
      if (nested[operation]) {
        const update = nested[operation];
        if (operation === 'update' && (Array.isArray(update) || object(update).data)) {
          const transform = (row: unknown) => ({
            ...object(row),
            where: withWhere(object(row).where, ownership(child, tournamentId)!),
            data: ownedData(child, object(row).data, tournamentId, false, true),
          });
          nested.update = Array.isArray(update) ? update.map(transform) : transform(update);
        } else
          nested[operation] = ownedData(
            child,
            nested[operation],
            tournamentId,
            operation === 'create',
            true,
          );
      }
    if (nested.createMany)
      nested.createMany = {
        ...object(nested.createMany),
        data: ownedData(child, object(nested.createMany).data, tournamentId, true, true),
      };
    data[field] = nested;
  }
  return data;
}

// All scoped delegates retain a tenant predicate, including unique-ID writes.
export function scopedDb<T extends Client>(client: T, tournamentId: string): T {
  if (!tournamentId) throw new AppError('A tournament context is required.', 400);
  const existing = contexts.get(client);
  if (existing && existing !== tournamentId)
    throw new AppError('Cannot change an active transaction tournament.', 403);
  if (existing) return client;
  const delegates = new Map<PropertyKey, unknown>();
  const proxy = new Proxy(client, {
    get(target, property) {
      const member = Reflect.get(target, property);
      if (property === '$transaction' && typeof member === 'function')
        return (callback: unknown, ...options: unknown[]) => {
          if (typeof callback !== 'function')
            throw new AppError('Scoped transactions require a callback.', 403);
          return member.call(
            target,
            (tx: Prisma.TransactionClient) => callback(scopedDb(tx, tournamentId)),
            ...options,
          );
        };
      if (typeof member === 'function') return member.bind(target);
      if (typeof property !== 'string' || !ownership(property, tournamentId)) {
        if (
          typeof property === 'string' &&
          scalarFields.has(property) &&
          !globalModels.has(property)
        )
          throw new AppError('Unclassified database model: {0}.', 403, [property]);
        return member;
      }
      if (!delegates.has(property))
        delegates.set(
          property,
          new Proxy(member as object, {
            get(delegate, operation) {
              const method = Reflect.get(delegate, operation);
              if (typeof method !== 'function' || typeof operation !== 'string') return method;
              return (input: unknown = {}) => {
                const args = { ...object(input) },
                  scope = ownership(property, tournamentId)!;
                if (!['create', 'createMany', 'createManyAndReturn'].includes(operation))
                  args.where = withWhere(args.where, scope);
                if (
                  [
                    'create',
                    'createMany',
                    'createManyAndReturn',
                    'update',
                    'updateMany',
                    'updateManyAndReturn',
                  ].includes(operation)
                )
                  args.data = ownedData(
                    property,
                    args.data,
                    tournamentId,
                    operation.startsWith('create'),
                  );
                if (operation === 'upsert') {
                  args.create = ownedData(property, args.create, tournamentId, true);
                  args.update = ownedData(property, args.update, tournamentId, false);
                }
                return (async () => {
                  for (const field of ['data', 'create', 'update'])
                    if (args[field])
                      await assertReferences(target, property, args[field], tournamentId);
                  return method.call(delegate, args);
                })();
              };
            },
          }),
        );
      return delegates.get(property);
    },
  });
  contexts.set(proxy, tournamentId);
  return proxy;
}
