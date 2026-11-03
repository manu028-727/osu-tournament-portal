import { z } from 'zod';
import yauzl from 'yauzl';
import { ZipFile } from 'yazl';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { AppError } from './permissions';
import { poolPlanSchema } from './pooling-validation';
import { registrationPolicySchema } from './registration-policy';
import { qualifierBookingPolicySchema } from './qualifier-booking-policy';

export const ARCHIVE_FORMAT = 'osu-tournament-portal';
export const ARCHIVE_VERSION = 1;
export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 128 * 1024 * 1024;
const MAX_JSON_BYTES = 16 * 1024 * 1024;
export type ArchiveRow = Record<string, unknown>;
type Definition = {
  model: string;
  fields: string;
  refs: Record<string, string>;
  parent?: string[];
  review?: boolean;
};
const def = (
  model: string,
  fields: string,
  refs: Record<string, string> = {},
  parent?: string[],
  review = false,
): Definition => ({ model, fields, refs, parent, review });
// This allowlist, not the database's available tables/columns, defines the versioned wire contract.
export const ARCHIVE_TABLES = {
  tournament: def(
    'tournament',
    'id:s slug:s name:s acronym:s description:s status:s gameMode:s published:b timezone:s format:s archivedAt:d? startsAt:d? endsAt:d? version:i matchNumberSequence:i? createdAt:d updatedAt:d',
  ),
  settings: def(
    'tournamentSettings',
    'tournamentId:s gameplayScoring:s? setupState:j? registrationPolicy:j? qualifierBookingPolicy:j? logo:s favicon:s banner:s primaryColor:s accentColor:s registrationUrl:s socialLinks:j importantDates:j navigation:j footer:s copy:j matchRules:j updatedAt:d',
    { tournamentId: 'tournament' },
  ),
  media: def(
    'mediaAsset',
    'id:s tournamentId:s name:s mimeType:s size:i width:i height:i createdBy:s? createdAt:d isPublic:b',
    { tournamentId: 'tournament', createdBy: 'identities' },
  ),
  stages: def(
    'tournamentStage',
    'id:s tournamentId:s name:s slug:s description:s position:i startsAt:d? bannerImageId:s? kind:s archivedAt:d? nextStageId:s? matchRules:j? qualifierPolicy:j? createdAt:d',
    { tournamentId: 'tournament', bannerImageId: 'media', nextStageId: 'stages' },
  ),
  categories: def('modCategory', 'id:s tournamentId:s name:s acronym:s color:s position:i', {
    tournamentId: 'tournament',
  }),
  pages: def(
    'page',
    'id:s tournamentId:s slug:s title:s state:s draftRevisionId:s? publishedRevisionId:s? updatedAt:d',
    {
      tournamentId: 'tournament',
      draftRevisionId: 'pageRevisions',
      publishedRevisionId: 'pageRevisions',
    },
  ),
  pageRevisions: def(
    'pageRevision',
    'id:s tournamentId:s pageId:s title:s html:s createdBy:s? createdAt:d',
    { tournamentId: 'tournament', pageId: 'pages', createdBy: 'identities' },
  ),
  blocks: def(
    'contentBlock',
    'id:s revisionId:s type:s position:i visible:b content:j',
    { revisionId: 'pageRevisions' },
    ['revision'],
  ),
  pools: def(
    'mappool',
    'id:s tournamentId:s stageId:s state:s draftRevisionId:s? publishedRevisionId:s? updatedAt:d',
    {
      tournamentId: 'tournament',
      stageId: 'stages',
      draftRevisionId: 'poolRevisions',
      publishedRevisionId: 'poolRevisions',
    },
  ),
  poolRevisions: def(
    'mappoolRevision',
    'id:s tournamentId:s mappoolId:s notes:s createdBy:s? createdAt:d',
    { tournamentId: 'tournament', mappoolId: 'pools', createdBy: 'identities' },
  ),
  slots: def(
    'mappoolSlot',
    'id:s revisionId:s name:s category:s categoryName:s categoryPriority:i? color:s position:i beatmapId:i metadata:j',
    { revisionId: 'poolRevisions', beatmapId: 'beatmaps' },
    ['revision'],
  ),
  beatmaps: def('beatmap', 'id:i mode:s metadata:j fetchedAt:d'),
  poolPlans: def(
    'poolPlan',
    'id:s tournamentId:s stageId:s slots:j minStars:n? maxStars:n? reviewState:s version:i updatedAt:d',
    { tournamentId: 'tournament', stageId: 'stages' },
  ),
  poolSkillsets: def('poolSkillset', 'id:s tournamentId:s name:s group:s', {
    tournamentId: 'tournament',
  }),
  poolWarnings: def(
    'poolArtistWarning',
    'id:s tournamentId:s artist:s artistKey:s severity:s reason:s source:s',
    { tournamentId: 'tournament' },
  ),
  poolCandidates: def(
    'poolCandidate',
    'id:s tournamentId:s stageId:s? beatmapId:i metadata:j category:s status:s notes:s submitterId:s? selectedSlot:s? warningResolution:j? version:i createdAt:d updatedAt:d',
    {
      tournamentId: 'tournament',
      stageId: 'stages',
      beatmapId: 'beatmaps',
      submitterId: 'identities',
    },
  ),
  poolTags: def('poolCandidateTag', 'tournamentId:s candidateId:s skillsetId:s primary:b', {
    tournamentId: 'tournament',
    candidateId: 'poolCandidates',
    skillsetId: 'poolSkillsets',
  }),
  poolReviews: def(
    'poolReview',
    'id:s tournamentId:s candidateId:s reviewerId:s fit:i? difficulty:i? flags:s notes:s completed:b version:i updatedAt:d',
    { tournamentId: 'tournament', candidateId: 'poolCandidates', reviewerId: 'identities' },
  ),
  staffCategories: def('staffCategory', 'id:s tournamentId:s name:s description:s position:i', {
    tournamentId: 'tournament',
  }),
  staffMembers: def(
    'staffMember',
    'id:s tournamentId:s osuId:i username:s avatarUrl:s profileUrl:s bio:s customImage:s visible:b position:i createdAt:d',
    { tournamentId: 'tournament' },
  ),
  staffAssignments: def('staffAssignment', 'tournamentId:s memberId:s categoryId:s position:s', {
    tournamentId: 'tournament',
    memberId: 'staffMembers',
    categoryId: 'staffCategories',
  }),
  participants: def('participant', 'osuId:i username:s avatarUrl:s country:s? updatedAt:d'),
  teams: def(
    'team',
    'id:s tournamentId:s name:s slug:s description:s format:s logoImageId:s? seed:i? rankSum:i? qualifierPlayed:b? sourceKey:s? position:i status:s published:b version:i rejectionReason:s adminNotes:s registrationAnswers:j? createdAt:d updatedAt:d',
    { tournamentId: 'tournament', logoImageId: 'media' },
  ),
  rosters: def(
    'teamMember',
    'tournamentId:s teamId:s osuId:i captain:b substitute:b position:i registrationRank:i? registeredUsername:s? discordId:s',
    { tournamentId: 'tournament', teamId: 'teams', osuId: 'participants' },
  ),
  matches: def(
    'match',
    'id:s tournamentId:s code:s matchNumber:i? stageId:s teamAId:s? teamBId:s? poolRevisionId:s? participants:j rules:j status:s scheduledAt:d? published:b bracket:s resultMode:s sourceKey:s? source:j? version:i scoreA:i scoreB:i winnerSide:s? forfeitSide:s? rollA:i? rollB:i? firstPickSide:s? firstBanSide:s? firstProtectSide:s? lobbyUrl:s multiplayerId:i? multiplayerSync:j? multiplayerSyncedAt:d? multiplayerError:s? notes:s timerKind:s? timerRemainingSeconds:i timerStartedAt:d? startedAt:d? submittedAt:d? completedAt:d? deletedAt:d? createdAt:d updatedAt:d',
    {
      tournamentId: 'tournament',
      stageId: 'stages',
      teamAId: 'teams',
      teamBId: 'teams',
      poolRevisionId: 'poolRevisions',
    },
  ),
  actions: def(
    'matchMapAction',
    'id:s matchId:s sequence:i kind:s side:s slotName:s category:s voided:b createdAt:d actorId:s? provenance:j?',
    { matchId: 'matches', actorId: 'identities' },
    ['match'],
  ),
  mapResults: def(
    'matchMapResult',
    'id:s matchId:s actionId:s entryMode:s scoreA:n? scoreB:n? winnerSide:s notes:s voided:b createdAt:d updatedAt:d',
    { matchId: 'matches', actionId: 'actions' },
    ['match'],
  ),
  playerScores: def(
    'matchPlayerScore',
    'id:s resultId:s osuId:i side:s score:n accuracy:n? maxCombo:i? misses:i? mods:j',
    { resultId: 'mapResults', osuId: 'participants' },
    ['result', 'match'],
  ),
  events: def(
    'matchEvent',
    'id:s matchId:s version:i actorId:s? kind:s side:s? notes:s data:j createdAt:d',
    { matchId: 'matches', actorId: 'identities' },
    ['match'],
  ),
  resultRevisions: def(
    'matchResultRevision',
    'id:s matchId:s version:i createdBy:s? kind:s reason:s snapshot:j createdAt:d',
    { matchId: 'matches', createdBy: 'identities' },
    ['match'],
  ),
  multiplayerGames: def(
    'multiplayerGame',
    'id:s matchId:s multiplayerId:i gameId:s beatmapId:i slotName:s actionId:s? proposal:j? evidence:j? ignoredAt:d? confirmedAt:d? createdAt:d',
    { matchId: 'matches', actionId: 'actions' },
    ['match'],
  ),
  qualifierLobbies: def(
    'qualifierLobby',
    'id:s tournamentId:s code:s stageId:s poolRevisionId:s rules:j policy:j? gameplayScoring:s? participants:j scheduledAt:d? status:s lobbyUrl:s notes:s version:i capacity:i bookingOpen:b bookingClosesAt:d? multiplayerSyncedAt:d? multiplayerError:s? multiplayerSync:j? deletedAt:d? autoCompleted:b createdAt:d updatedAt:d',
    { tournamentId: 'tournament', stageId: 'stages', poolRevisionId: 'poolRevisions' },
  ),
  qualifierEntries: def('qualifierEntry', 'tournamentId:s lobbyId:s teamId:s position:i', {
    tournamentId: 'tournament',
    lobbyId: 'qualifierLobbies',
    teamId: 'teams',
  }),
  qualifierScores: def(
    'qualifierScore',
    'id:s lobbyId:s osuId:i slotName:s run:i actualScoring:s? representation:s source:s gameId:s? verified:b eligible:b eligibilityReason:s passed:b? eligibilityOverride:s? raw:n mods:j adjusted:n updatedAt:d accuracy:n? maxCombo:i? misses:i?',
    { lobbyId: 'qualifierLobbies', osuId: 'participants' },
    ['lobby'],
  ),
  qualifierEvents: def(
    'qualifierEvent',
    'id:s lobbyId:s actorId:s? version:i kind:s reason:s data:j createdAt:d',
    { lobbyId: 'qualifierLobbies', actorId: 'identities' },
    ['lobby'],
  ),
  qualifierGames: def(
    'qualifierGame',
    'id:s lobbyId:s multiplayerId:i gameId:s run:i? slotName:s? startedAt:d? evidence:j status:s reason:s version:i createdAt:d updatedAt:d',
    { lobbyId: 'qualifierLobbies' },
    ['lobby'],
  ),
  audits: def(
    'auditLog',
    'id:s tournamentId:s actorId:s? action:s entityType:s entityId:s details:j createdAt:d',
    { tournamentId: 'tournament', actorId: 'identities' },
  ),
  qualifierStandings: def(
    'qualifierStanding',
    'id:s tournamentId:s stageId:s version:i published:b sourceHash:s snapshot:j createdAt:d',
    { tournamentId: 'tournament', stageId: 'stages' },
  ),
  brackets: def(
    'bracket',
    'id:s tournamentId:s name:s format:s generationKey:s config:j seedOrder:j sourceStandingId:s? published:b version:i createdAt:d updatedAt:d',
    { tournamentId: 'tournament', sourceStandingId: 'qualifierStandings' },
  ),
  bracketRounds: def(
    'bracketRound',
    'id:s tournamentId:s bracketId:s stageId:s key:s name:s lane:s position:i',
    { tournamentId: 'tournament', bracketId: 'brackets', stageId: 'stages' },
  ),
  bracketNodes: def(
    'bracketNode',
    'id:s tournamentId:s bracketId:s roundId:s key:s position:i matchNumber:i? matchId:s? state:s',
    {
      tournamentId: 'tournament',
      bracketId: 'brackets',
      roundId: 'bracketRounds',
      matchId: 'matches',
    },
  ),
  bracketSlots: def(
    'bracketSlot',
    'id:s tournamentId:s nodeId:s side:s teamId:s? resolved:b mode:s sourceNodeId:s? outcome:s?',
    {
      tournamentId: 'tournament',
      nodeId: 'bracketNodes',
      teamId: 'teams',
      sourceNodeId: 'bracketNodes',
    },
  ),
  bracketEntries: def('bracketEntry', 'tournamentId:s bracketId:s teamId:s seed:i status:s', {
    tournamentId: 'tournament',
    bracketId: 'brackets',
    teamId: 'teams',
  }),
  identities: def(
    'user',
    'id:s osuId:i username:s avatarUrl:s profileUrl:s country:s?',
    {},
    undefined,
    true,
  ),
  tournamentPhases: def(
    'tournamentPhase',
    'id:s tournamentId:s key:s position:i kind:s name:s stageId:s? config:j state:s version:i createdAt:d updatedAt:d',
    { tournamentId: 'tournament', stageId: 'stages' },
  ),
  roles: def(
    'role',
    'id:s tournamentId:s name:s description:s systemKey:s? templateKey:s? createdAt:d',
    { tournamentId: 'tournament' },
    undefined,
    true,
  ),
  rolePermissions: def(
    'rolePermission',
    'roleId:s permissionKey:s',
    { roleId: 'roles' },
    ['role'],
    true,
  ),
  memberships: def(
    'userRole',
    'tournamentId:s userId:s roleId:s',
    { tournamentId: 'tournament', userId: 'identities', roleId: 'roles' },
    undefined,
    true,
  ),
  matchAssignments: def(
    'matchAssignment',
    'matchId:s userId:s primary:b',
    { matchId: 'matches', userId: 'identities' },
    ['match'],
    true,
  ),
  qualifierAssignments: def(
    'qualifierAssignment',
    'lobbyId:s userId:s',
    { lobbyId: 'qualifierLobbies', userId: 'identities' },
    ['lobby'],
    true,
  ),
} as const satisfies Record<string, Definition>;
export type ArchiveTable = keyof typeof ARCHIVE_TABLES;
export const archiveInsertionOrder: ArchiveTable[] = [
  'media',
  'stages',
  'tournamentPhases',
  'categories',
  'poolPlans',
  'poolSkillsets',
  'poolWarnings',
  'poolCandidates',
  'poolTags',
  'poolReviews',
  'pages',
  'pageRevisions',
  'blocks',
  'pools',
  'poolRevisions',
  'slots',
  'staffCategories',
  'staffMembers',
  'staffAssignments',
  'teams',
  'rosters',
  'matches',
  'actions',
  'mapResults',
  'playerScores',
  'events',
  'resultRevisions',
  'multiplayerGames',
  'qualifierLobbies',
  'qualifierEntries',
  'qualifierScores',
  'qualifierEvents',
  'qualifierGames',
  'qualifierStandings',
  'brackets',
  'bracketRounds',
  'bracketNodes',
  'bracketSlots',
  'bracketEntries',
  'audits',
];
export const archiveDeferredFields: Partial<Record<ArchiveTable, readonly string[]>> = {
  stages: ['nextStageId'],
  pages: ['draftRevisionId', 'publishedRevisionId'],
  pools: ['draftRevisionId', 'publishedRevisionId'],
};

export const tableNames = Object.keys(ARCHIVE_TABLES) as ArchiveTable[];
export const tokens = (table: ArchiveTable) =>
  ARCHIVE_TABLES[table].fields.split(' ').map((token) => {
    const [name, type] = token.split(':');
    return { name, type: type[0], nullable: type.endsWith('?') };
  });
export const archiveHash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const primitive: Record<string, z.ZodType> = {
  s: z.string().max(1000000),
  i: z.number().int().min(-2147483648).max(2147483647),
  n: z.number().finite(),
  b: z.boolean(),
  d: z.iso.datetime(),
  j: z.json(),
};
const enumFields: Record<string, readonly [string, ...string[]]> = {
  'poolPlans.reviewState': ['DRAFT', 'REVIEW', 'APPROVED'],
  'poolCandidates.status': [
    'SUGGESTED',
    'REVIEW',
    'PLAYTESTING',
    'ACCEPTED',
    'REJECTED',
    'SELECTED',
  ],
  'poolWarnings.severity': ['WARN', 'BANNED'],
  'settings.gameplayScoring': ['SCORE_V1', 'SCORE_V2', 'LAZER'],
  'qualifierLobbies.gameplayScoring': ['SCORE_V1', 'SCORE_V2', 'LAZER'],
  'qualifierScores.actualScoring': ['SCORE_V1', 'SCORE_V2', 'LAZER'],
  'qualifierScores.eligibilityOverride': ['INCLUDE', 'EXCLUDE'],
  'qualifierScores.representation': ['LEGACY', 'STANDARDIZED'],
  'qualifierScores.source': ['MANUAL', 'OSU_API', 'IMPORT'],
  'brackets.format': ['SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION', 'GROUPS'],
  'bracketSlots.mode': ['AUTO', 'MANUAL', 'LOCKED'],
  'bracketSlots.outcome': ['WINNER', 'LOSER', 'RESET_A', 'RESET_B'],
  'bracketEntries.status': ['ACTIVE', 'WITHDRAWN', 'DISQUALIFIED'],
  'pages.state': ['DRAFT', 'PUBLISHED', 'UNPUBLISHED'],
  'pools.state': ['DRAFT', 'PUBLISHED', 'UNPUBLISHED'],
  'teams.status': ['PENDING', 'APPROVED', 'REJECTED'],
  'teams.format': ['TEAM', 'INDIVIDUAL'],
  'matches.status': [
    'SCHEDULED',
    'IN_PROGRESS',
    'AWAITING_CONFIRMATION',
    'COMPLETED',
    'DISPUTED',
    'CANCELLED',
  ],
  'qualifierLobbies.status': [
    'SCHEDULED',
    'IN_PROGRESS',
    'AWAITING_CONFIRMATION',
    'COMPLETED',
    'DISPUTED',
    'CANCELLED',
  ],
  'matches.resultMode': ['MAPS', 'SUMMARY'],
  'actions.kind': ['PROTECT', 'BAN', 'PICK'],
};
function fieldSchema(table: ArchiveTable, name: string, type: string, nullable: boolean) {
  let schema = enumFields[`${table}.${name}`]
    ? z.enum(enumFields[`${table}.${name}`])
    : primitive[type];
  if (
    type === 's' &&
    /^(?:side|winnerSide|forfeitSide|firstPickSide|firstBanSide|firstProtectSide)$/.test(name)
  )
    schema = z.enum(['A', 'B']);
  if (type === 's' && (name === 'id' || name in ARCHIVE_TABLES[table].refs))
    schema = z.string().min(1).max(100);
  if (type === 's' && /^(?:color|primaryColor|accentColor)$/.test(name))
    schema = z.string().regex(/^#[a-fA-F0-9]{6}$/);
  if (name === 'matchNumber') schema = z.number().int().positive().max(2147483647);
  if (table === 'qualifierLobbies' && name === 'capacity') schema = z.number().int().min(1).max(16);
  if (table === 'qualifierGames' && name === 'status')
    schema = z.enum(['PENDING', 'ACCEPTED', 'IGNORED']);
  if (table === 'qualifierGames' && name === 'run') schema = z.number().int().min(1).max(2);
  if (table === 'qualifierGames' && name === 'multiplayerId')
    schema = z.number().int().positive().max(2147483647);
  if (name === 'matchNumberSequence') schema = z.number().int().min(0).max(2147483647);
  if (table === 'poolReviews' && ['fit', 'difficulty'].includes(name))
    schema = z.number().int().min(1).max(5);
  if (table === 'poolWarnings' && name === 'source')
    schema = z
      .string()
      .max(2048)
      .refine((value) => !value || /^https?:\/\//.test(value), 'Unsafe warning source URL.');
  const defaults: Record<string, unknown> = {
    'teams.rejectionReason': '',
    'teams.adminNotes': '',
    'qualifierLobbies.capacity': 16,
    'qualifierLobbies.bookingOpen': true,
    'qualifierLobbies.autoCompleted': false,
    'qualifierScores.eligible': true,
    'qualifierScores.eligibilityReason': '',
    'qualifierScores.run': 1,
    'qualifierScores.representation': 'LEGACY',
    'qualifierScores.source': 'MANUAL',
    'qualifierScores.verified': true,
  };
  if (Object.hasOwn(defaults, `${table}.${name}`))
    return schema.default(defaults[`${table}.${name}`]);
  return nullable ? schema.nullable().optional() : schema;
}
const tablesSchema = z
  .object(
    Object.fromEntries(
      tableNames.map((table) => {
        const records = z
          .array(
            z
              .object(
                Object.fromEntries(
                  tokens(table).map(({ name, type, nullable }) => [
                    name,
                    fieldSchema(table, name, type, nullable),
                  ]),
                ),
              )
              .strict(),
          )
          .max(60000);
        return [
          table,
          [
            'qualifierGames',
            'qualifierStandings',
            'brackets',
            'bracketRounds',
            'bracketNodes',
            'bracketSlots',
            'bracketEntries',
            'poolPlans',
            'poolSkillsets',
            'poolWarnings',
            'poolCandidates',
            'poolTags',
            'poolReviews',
          ].includes(table)
            ? records.default([])
            : records,
        ];
      }),
    ),
  )
  .strict();
const manifestSchema = z
  .object({
    format: z.literal(ARCHIVE_FORMAT),
    version: z.literal(ARCHIVE_VERSION),
    exportedAt: z.iso.datetime(),
    source: z.enum(['portal', 'legacy-oidc']),
    sourceOrigin: z
      .url()
      .refine(
        (value) =>
          ['https:', 'http:'].includes(new URL(value).protocol) && new URL(value).origin === value,
      ),
    sourceSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    data: z
      .object({ path: z.literal('tournament.json'), sha256: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict(),
    media: z
      .array(
        z
          .object({
            id: z.string().max(100),
            path: z.string().regex(/^media\/[a-zA-Z0-9_-]{1,100}\.webp$/),
            size: z
              .number()
              .int()
              .positive()
              .max(4 * 1024 * 1024),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .max(1000),
    warnings: z.array(z.string().max(500)).max(1000),
  })
  .strict();
export type ArchiveData = Record<ArchiveTable, ArchiveRow[]>;
export type ArchiveManifest = z.infer<typeof manifestSchema>;
export type ParsedArchive = {
  manifest: ArchiveManifest;
  data: ArchiveData;
  files: Map<string, Buffer>;
  fingerprint: string;
};

export const secretKey = (key: string) =>
  /^(?:password|ircpassword|clientsecret|accesstoken|refreshtoken|sessiontoken|secret|authorization|cookies?|credentials|apikey|token|s3secretaccesskey)$/i.test(
    key.replace(/[_-]/g, ''),
  );
export function checkJson(value: unknown, depth = 0): void {
  if (depth > 64) throw new AppError('Archive JSON is nested too deeply.');
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key) || secretKey(key))
      throw new AppError('Archive contains forbidden secret or object keys.');
    if (
      typeof child === 'string' &&
      /^(?:url|href|src|image|customImage|banner|logo|favicon|avatarUrl|cover|profileUrl|lobbyUrl|registrationUrl)$/i.test(
        key,
      ) &&
      child &&
      !(/^\/(?!\/)[^\\]*$/.test(child) || /^https?:\/\//i.test(child))
    )
      throw new AppError('Unsafe URL in archive field {0}.', 400, [key]);
    checkJson(child, depth + 1);
  }
}
export function validateArchiveData(input: unknown): ArchiveData {
  checkJson(input);
  const data = tablesSchema.parse(input) as ArchiveData;
  if (tableNames.reduce((sum, table) => sum + data[table].length, 0) > 60000)
    throw new AppError('Archive contains too many records.');
  if (data.tournament.length !== 1 || data.settings.length !== 1)
    throw new AppError('Archive must contain one tournament and its settings.');
  if (data.settings[0].qualifierBookingPolicy)
    qualifierBookingPolicySchema.parse(data.settings[0].qualifierBookingPolicy);
  if (data.settings[0].registrationPolicy)
    registrationPolicySchema.parse(data.settings[0].registrationPolicy);
  for (const plan of data.poolPlans)
    poolPlanSchema.parse({
      slots: plan.slots,
      minStars: plan.minStars ?? null,
      maxStars: plan.maxStars ?? null,
      baseVersion: plan.version,
    });
  const indices = new Map<ArchiveTable, Map<unknown, ArchiveRow>>();
  const globalIds = new Set<string>();
  for (const table of tableNames) {
    const index = new Map<unknown, ArchiveRow>();
    const identity = table === 'participants' ? 'osuId' : 'id';
    for (const row of data[table])
      if (identity in row) {
        if (index.has(row[identity]))
          throw new AppError('Duplicate archive identifier in {0}.', 400, [table]);
        if (typeof row[identity] === 'string') {
          if (globalIds.has(row[identity] as string))
            throw new AppError('Archive identifiers must be unique across tables.');
          globalIds.add(row[identity] as string);
        }
        index.set(row[identity], row);
      }
    indices.set(table, index);
  }
  const tournamentId = data.tournament[0].id;
  for (const table of tableNames)
    for (const row of data[table]) {
      if ('tournamentId' in row && row.tournamentId !== tournamentId)
        throw new AppError('Cross-tournament record in {0}.', 400, [table]);
      for (const [field, target] of Object.entries(ARCHIVE_TABLES[table].refs)) {
        if (row[field] != null && !indices.get(target as ArchiveTable)?.has(row[field]))
          throw new AppError('Broken relationship: {0}.{1}.', 400, [table, field]);
      }
    }
  for (const [parents, revisions, owner] of [
    ['pages', 'pageRevisions', 'pageId'],
    ['pools', 'poolRevisions', 'mappoolId'],
  ] as const)
    for (const row of data[parents])
      for (const pointer of ['draftRevisionId', 'publishedRevisionId']) {
        if (row[pointer] && indices.get(revisions)!.get(row[pointer])?.[owner] !== row.id)
          throw new AppError('Revision belongs to a different {0} record.', 400, [parents]);
      }
  for (const result of [...data.mapResults, ...data.multiplayerGames.filter((row) => row.actionId)])
    if (indices.get('actions')!.get(result.actionId)?.matchId !== result.matchId)
      throw new AppError('A map result belongs to a different match.');
  for (const node of data.bracketNodes)
    if (indices.get('bracketRounds')!.get(node.roundId)?.bracketId !== node.bracketId)
      throw new AppError('A bracket node belongs to a different round or division.');
  const usedMatches = new Set<unknown>();
  const nodeSlots = new Map<unknown, ArchiveRow[]>();
  for (const slot of data.bracketSlots)
    nodeSlots.set(slot.nodeId, [...(nodeSlots.get(slot.nodeId) || []), slot]);
  for (const node of data.bracketNodes) {
    if (node.matchId) {
      if (usedMatches.has(node.matchId))
        throw new AppError('A native match cannot occupy multiple bracket nodes.');
      usedMatches.add(node.matchId);
    }
    const slots = nodeSlots.get(node.id) || [];
    if (
      slots.length !== 2 ||
      !slots.some((s) => s.side === 'A') ||
      !slots.some((s) => s.side === 'B')
    )
      throw new AppError('A bracket node requires exactly two participant slots.');
  }
  const slotNodes = new Map(data.bracketNodes.map((node) => [node.id, node]));
  const outgoing = new Map<unknown, unknown[]>();
  for (const slot of data.bracketSlots) {
    if (!!slot.sourceNodeId !== !!slot.outcome)
      throw new AppError('A progression slot requires both source and outcome.');
    if (slot.sourceNodeId)
      outgoing.set(slot.nodeId, [...(outgoing.get(slot.nodeId) || []), slot.sourceNodeId]);
    if (!slotNodes.has(slot.nodeId)) throw new AppError('A bracket slot has no native node.');
  }
  const degrees = new Map([...slotNodes.keys()].map((id) => [id, (outgoing.get(id) || []).length]));
  const children = new Map<unknown, unknown[]>();
  for (const [id, sources] of outgoing)
    for (const source of sources) children.set(source, [...(children.get(source) || []), id]);
  const queue = [...degrees].filter(([, degree]) => degree === 0).map(([id]) => id);
  for (let index = 0; index < queue.length; index++)
    for (const child of children.get(queue[index]) || []) {
      const degree = degrees.get(child)! - 1;
      degrees.set(child, degree);
      if (degree === 0) queue.push(child);
    }
  if (queue.length !== slotNodes.size)
    throw new AppError('Bracket progression cannot contain cycles.');
  const uniqueFields: Partial<Record<ArchiveTable, string[][]>> = {
    identities: [['osuId']],
    pages: [['slug']],
    stages: [['slug']],
    tournamentPhases: [['key']],
    categories: [['acronym']],
    pools: [['stageId']],
    slots: [
      ['revisionId', 'name'],
      ['revisionId', 'position'],
    ],
    staffMembers: [['osuId']],
    staffAssignments: [['memberId', 'categoryId']],
    teams: [['slug']],
    rosters: [['osuId'], ['teamId', 'position']],
    matches: [['code'], ['matchNumber']],
    poolPlans: [['stageId']],
    poolSkillsets: [['name']],
    poolWarnings: [['artistKey']],
    poolCandidates: [['beatmapId']],
    poolTags: [['candidateId', 'skillsetId']],
    poolReviews: [['candidateId', 'reviewerId']],
    actions: [['matchId', 'sequence']],
    mapResults: [['actionId']],
    playerScores: [['resultId', 'osuId']],
    events: [['matchId', 'version']],
    resultRevisions: [['matchId', 'version']],
    multiplayerGames: [['matchId', 'multiplayerId', 'gameId']],
    qualifierLobbies: [['code']],
    qualifierEntries: [
      ['lobbyId', 'teamId'],
      ['lobbyId', 'position'],
    ],
    qualifierScores: [['lobbyId', 'osuId', 'slotName', 'run']],
    qualifierStandings: [['stageId', 'version']],
    brackets: [['generationKey']],
    bracketRounds: [['bracketId', 'key']],
    bracketNodes: [['bracketId', 'key'], ['matchNumber']],
    bracketSlots: [['nodeId', 'side']],
    bracketEntries: [
      ['bracketId', 'teamId'],
      ['bracketId', 'seed'],
    ],
    qualifierEvents: [['lobbyId', 'version']],
  };
  for (const [table, combinations] of Object.entries(uniqueFields))
    for (const fields of combinations) {
      const seen = new Set<string>();
      for (const row of data[table as ArchiveTable]) {
        if (fields.some((field) => row[field] == null)) continue;
        const key = JSON.stringify(fields.map((field) => row[field]));
        if (seen.has(key))
          throw new AppError('Duplicate {0} fields: {1}.', 400, [table, fields.join(', ')]);
        seen.add(key);
      }
    }
  return data;
}

export async function writeArchive(
  manifest: ArchiveManifest,
  data: ArchiveData,
  files: Map<string, Buffer>,
) {
  const json = Buffer.from(JSON.stringify(data));
  if (json.length > MAX_JSON_BYTES)
    throw new AppError('Tournament JSON exceeds the 16 MB format limit.', 413);
  const zip = new ZipFile();
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    let total = 0;
    zip.on('error', reject);
    zip.outputStream.on('error', reject);
    zip.outputStream.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_ARCHIVE_BYTES) {
        (zip.outputStream as Readable).destroy(
          new AppError('Tournament exceeds the 64 MB archive limit.', 413),
        );
      } else chunks.push(chunk);
    });
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
  });
  zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json');
  zip.addBuffer(json, 'tournament.json');
  for (const [name, bytes] of files) zip.addBuffer(bytes, name, { compress: false });
  zip.end();
  return completed;
}

export async function readArchive(bytes: Buffer): Promise<ParsedArchive> {
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new AppError('Maximum archive size is 64 MB.', 413);
  const files = await new Promise<Map<string, Buffer>>((resolve, reject) => {
    yauzl.fromBuffer(
      bytes,
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip) return reject(new AppError('Choose a valid tournament ZIP archive.'));
        const files = new Map<string, Buffer>();
        let total = 0,
          failed = false;
        const fail = (reason: unknown) => {
          if (failed) return;
          failed = true;
          zip.close();
          reject(
            reason instanceof AppError
              ? reason
              : new AppError('The ZIP archive is damaged or unsafe.'),
          );
        };
        zip.on('error', fail);
        zip.on('entry', (entry) => {
          const allowed =
            /^(?:manifest\.json|tournament\.json|media\/[a-zA-Z0-9_-]{1,100}\.webp)$/.test(
              entry.fileName,
            );
          const unixType = (entry.externalFileAttributes >>> 16) & 0xf000;
          if (
            !allowed ||
            files.has(entry.fileName) ||
            entry.isEncrypted() ||
            (unixType && unixType !== 0x8000) ||
            files.size >= 1002 ||
            entry.uncompressedSize >
              (entry.fileName.endsWith('.webp') ? 4 * 1024 * 1024 : MAX_JSON_BYTES) ||
            total + entry.uncompressedSize > MAX_EXPANDED_BYTES ||
            ![0, 8].includes(entry.compressionMethod)
          )
            return fail(
              new AppError('Archive paths, entries or sizes exceed the supported format.'),
            );
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) return fail(streamError);
            const chunks: Buffer[] = [];
            let size = 0;
            stream.on('error', fail);
            stream.on('data', (chunk) => {
              size += chunk.length;
              total += chunk.length;
              if (size > entry.uncompressedSize || total > MAX_EXPANDED_BYTES) {
                (stream as Readable).destroy();
                fail(new AppError('Archive expansion exceeds safe limits.'));
              } else chunks.push(chunk);
            });
            stream.on('end', () => {
              if (failed) return;
              files.set(entry.fileName, Buffer.concat(chunks));
              zip.readEntry();
            });
          });
        });
        zip.on('end', () => {
          if (!failed) resolve(files);
        });
        zip.readEntry();
      },
    );
  });
  let rawManifest: unknown, rawData: unknown;
  try {
    rawManifest = JSON.parse(files.get('manifest.json')?.toString('utf8') || '');
    rawData = JSON.parse(files.get('tournament.json')?.toString('utf8') || '');
  } catch {
    throw new AppError('Archive manifest or tournament JSON is missing or malformed.');
  }
  const manifest = manifestSchema.parse(rawManifest);
  if (archiveHash(files.get('tournament.json')!) !== manifest.data.sha256)
    throw new AppError('Tournament JSON checksum does not match.');
  const data = validateArchiveData(rawData);
  if (
    manifest.sourceSlug !== data.tournament[0].slug ||
    manifest.media.length !== data.media.length
  )
    throw new AppError('Manifest and tournament contents do not match.');
  const seen = new Set<string>();
  for (const asset of manifest.media) {
    const file = files.get(asset.path);
    if (
      seen.has(asset.path) ||
      !data.media.some((row) => row.id === asset.id) ||
      !file ||
      file.length !== asset.size ||
      archiveHash(file) !== asset.sha256
    )
      throw new AppError('A media file is missing, duplicated or has an invalid checksum.');
    seen.add(asset.path);
  }
  if (
    files.size !== seen.size + 2 ||
    new Set(manifest.media.map((file) => file.id)).size !== manifest.media.length
  )
    throw new AppError('Archive contains undeclared or duplicate media.');
  return { manifest, data, files, fingerprint: archiveHash(bytes) };
}
