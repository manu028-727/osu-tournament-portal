import { expect, it } from 'vitest';
import { Prisma } from '../src/generated/prisma/client';
import {
  ARCHIVE_TABLES,
  archiveInsertionOrder,
  archiveDeferredFields,
  tableNames,
  tokens,
} from '../src/lib/tournament-archive-format';
import { remapArchiveValue } from '../src/lib/archive-identities';

// Intentional wire exclusions. New models/omitted scalar fields require review.
const excludedModels = [
  'session',
  'oAuthState',
  'rateLimit',
  'permission',
  'mediaCleanup',
  'ircLobbyRequest',
  'refereeImport',
  'platformSettings',
  'platformAsset',
  'tournamentTransfer',
];
const omittedFields: Record<string, string[]> = {
  user: ['platformAdmin', 'lastLoginAt', 'createdAt'],
  mediaAsset: ['key'],
  modCategory: ['version'],
  staffMember: ['version'],
  staffCategory: ['version'],
};
it('classifies every model and scalar into reviewed version 1 fields or explicit exclusions', () => {
  const archived = new Map(
    Object.entries(ARCHIVE_TABLES).map(([table, definition]) => [definition.model, table]),
  );
  expect([...archived.keys(), ...excludedModels].sort()).toEqual(
    Object.keys(Prisma.ModelName)
      .map((name) => name[0].toLowerCase() + name.slice(1))
      .sort(),
  );
  for (const [model, table] of archived) {
    const name = model[0].toUpperCase() + model.slice(1);
    const fields = Object.values(
      (Prisma as unknown as Record<string, Record<string, string>>)[name + 'ScalarFieldEnum'],
    );
    expect(
      [
        ...tokens(table as keyof typeof ARCHIVE_TABLES).map((field) => field.name),
        ...(omittedFields[model] || []),
      ].sort(),
      model,
    ).toEqual(fields.sort());
  }
});
it('accounts for every imported, regenerated and review-only table and defers only valid reference fields', () => {
  const special = [
    'tournament',
    'settings',
    'identities',
    'participants',
    'beatmaps',
    'roles',
    'rolePermissions',
    'memberships',
    'matchAssignments',
    'qualifierAssignments',
  ];
  expect([...archiveInsertionOrder, ...special].sort()).toEqual([...tableNames].sort());
  for (const [table, fields] of Object.entries(archiveDeferredFields))
    for (const field of fields)
      expect(ARCHIVE_TABLES[table as keyof typeof ARCHIVE_TABLES].refs).toHaveProperty(field);
});
it('preserves version 1 nested identity slots, maps, media text and ordinary authored strings', () => {
  const ids = new Map([['old', 'new']]);
  const value = {
    id: 'old',
    teamIds: ['old'],
    snapshot: { participantId: 'old', title: 'old', note: 'old is text' },
    roundStages: { custom: 'old' },
    tieResolution: { order: ['old'], reason: 'old' },
    seedOrder: ['old'],
    groupTieOrder: ['old'],
    html: '<img src="/api/media/old">',
  };
  const mapped = remapArchiveValue(value, ids, (text) =>
    text.replace('/api/media/old', '/api/media/new'),
  );
  expect(mapped).toEqual({
    id: 'new',
    teamIds: ['new'],
    snapshot: { participantId: 'new', title: 'old', note: 'old is text' },
    roundStages: { custom: 'new' },
    tieResolution: { order: ['new'], reason: 'old' },
    seedOrder: ['new'],
    groupTieOrder: ['new'],
    html: '<img src="/api/media/new">',
  });
  expect(value.id).toBe('old');
});
