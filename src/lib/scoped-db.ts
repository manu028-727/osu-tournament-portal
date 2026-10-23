import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { AppError } from './permissions';

type Client = PrismaClient | Prisma.TransactionClient;
type Data = Record<string, unknown>;
const direct = new Set([
  'tournamentSettings',
  'page',
  'pageRevision',
  'tournamentStage',
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
};
const relations: Record<string, Record<string, string>> = {
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
  for (const [field, child] of Object.entries(relations[model] || {})) {
    if (!data[field]) continue;
    const nested = { ...object(data[field]) };
    for (const operation of ['create', 'update'] as const)
      if (nested[operation])
        nested[operation] = ownedData(
          child,
          nested[operation],
          tournamentId,
          operation === 'create',
          true,
        );
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
        return (callback: unknown, ...options: unknown[]) =>
          typeof callback === 'function'
            ? member.call(
                target,
                (tx: Prisma.TransactionClient) => callback(scopedDb(tx, tournamentId)),
                ...options,
              )
            : member.call(target, callback, ...options);
      if (typeof member === 'function') return member.bind(target);
      if (typeof property !== 'string' || !ownership(property, tournamentId)) return member;
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
                return method.call(delegate, args);
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
