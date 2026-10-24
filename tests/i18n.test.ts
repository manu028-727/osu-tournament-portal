import { expect, it } from 'vitest';
import { locale, localeTag, translator, translateGeneratedMessage } from '../src/lib/i18n';
import italian from '../src/lib/locales/it.json';
import english from '../src/lib/locales/en.json';
import { AppError } from '../src/lib/permissions';
import { messageList } from '../src/lib/messages';
import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { matchTime, bracketEntrant } from '../src/lib/match-display';
import { DEFAULT_COPY } from '../src/lib/copy';
import { STAGE_TEMPLATES } from '../src/components/admin/stage-editor-model';
import { formatNumber, humanizeCode } from '../src/lib/i18n';
import { ARCHIVE_TABLES } from '../src/lib/tournament-archive-format';

it('uses an explicit supported preference and a bounded installation fallback', () => {
  expect(locale('it', 'en')).toBe('it');
  expect(locale('en', 'it-IT')).toBe('en');
  expect(locale(undefined, 'it-IT')).toBe('it');
  expect(locale('invalid', 'unknown')).toBe('en');
  expect([localeTag('en'), localeTag('it')]).toEqual(['en-GB', 'it-IT']);
});
it('translates built-in copy while preserving interpolated authored values', () => {
  expect(translator('it')('Interface language')).toBe("Lingua dell'interfaccia");
  expect(translator('en')('Apri incontro {0}', 'Capitano')).toBe('Open match Capitano');
  expect(translator('it')('Apri incontro {0}', 'Captain')).toBe('Apri incontro Captain');
  expect(translator('en')('Nessuna squadra pubblicata')).toBe('No teams published');
});
it('keeps interpolation slots equivalent across catalogs', () => {
  const slots = (message: string) => [...new Set(message.match(/\{\d+\}/g) || [])].sort();
  for (const catalog of [english, italian])
    for (const [key, value] of Object.entries(catalog))
      expect(slots(value), key).toEqual(slots(key));
});
it('recognizes generated feedback without translating captured names', () => {
  expect(translateGeneratedMessage('it', 'Open match Captain')).toBe('Apri incontro Captain');
  expect(translateGeneratedMessage('en', 'Apri incontro Capitano')).toBe('Open match Capitano');
  expect(translateGeneratedMessage('it', 'Unknown provider text')).toBe('Unknown provider text');
  expect(translateGeneratedMessage('en', 'Apri incontro Captain')).toBe('Open match Captain');
  const localized = translator('it')(
    'Match number {0} is already allocated or reserved in this tournament. Resolve the number conflict before importing.',
    'Captain',
  );
  expect(translateGeneratedMessage('en', localized)).toBe(
    'Match number Captain is already allocated or reserved in this tournament. Resolve the number conflict before importing.',
  );
  expect(translateGeneratedMessage('en', translator('it')('Changes saved.'))).toBe(
    'Changes saved.',
  );
});
it('keeps error text compatible and localization metadata out of serialized/logged properties', () => {
  const error = new AppError('Open match {0}', 409, ['Capitano']);
  expect(error.message).toBe('Open match Capitano');
  expect(translator('it')(error.translationKey, ...error.translationValues)).toBe(
    'Apri incontro Capitano',
  );
  expect(Object.keys(error)).toEqual(['status']);
  expect(JSON.parse(JSON.stringify(error))).toEqual({ status: 409 });
  const list = new AppError('{0}: {1}', 400, [
    'Name stays English',
    messageList(['No entrants', 'No source']),
  ]);
  expect(list.message).toBe('Name stays English: No entrants No source');
  expect(translator('it')(list.translationKey, ...list.translationValues)).toBe(
    'Name stays English: Nessun partecipante Nessuna origine',
  );
});
it('formats dates and generated bracket references in the selected language, preserving names', () => {
  expect(matchTime('2026-10-24T12:30:00Z', 'UTC', 'it')).toContain('24 ott 2026');
  expect(matchTime('2026-10-24T12:30:00Z', 'UTC', 'en')).toContain('24 Oct 2026');
  expect(bracketEntrant('W12', 'it')).toBe("Vincitore dell'incontro 12");
  expect(bracketEntrant('Captain', 'it')).toBe('Captain');
  expect(formatNumber(5.82, 'it', 2)).toBe('5,82');
  expect(formatNumber(5.82, 'en', 2)).toBe('5.82');
});
it('rejects duplicate catalog keys before JSON parsing can hide them', () => {
  for (const file of ['en', 'it']) {
    const source = ts.parseJsonText(file, readFileSync(`src/lib/locales/${file}.json`, 'utf8'));
    const keys = source.statements.flatMap((statement) =>
      ts.isExpressionStatement(statement) && ts.isObjectLiteralExpression(statement.expression)
        ? statement.expression.properties.map((property) => property.name?.getText(source))
        : [],
    );
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.length, file).toBe(new Set(keys).size);
  }
});
it('covers literal interface messages, domain errors and shared built-in label maps', () => {
  const missing = new Set<string>();
  const check = (message: string) => {
    if (/[A-Za-z]/.test(message) && !Object.hasOwn(italian, message)) missing.add(message);
  };
  const literals = (node: ts.Node | undefined): string[] => {
    if (!node) return [];
    if (ts.isStringLiteralLike(node)) return [node.text];
    if (ts.isTemplateExpression(node))
      return [
        node.head.text +
          node.templateSpans.map((part, index) => `{${index}}${part.literal.text}`).join(''),
      ];
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node)
    )
      return literals(node.expression);
    if (ts.isConditionalExpression(node))
      return [...literals(node.whenTrue), ...literals(node.whenFalse)];
    if (ts.isElementAccessExpression(node) && ts.isObjectLiteralExpression(node.expression))
      return node.expression.properties.flatMap((property) =>
        ts.isPropertyAssignment(property) ? literals(property.initializer) : [],
      );
    return [];
  };
  const shared = new Set([
    'MATCH_ACTION_MESSAGES',
    'MATCH_STATUS_LABELS',
    'PUBLIC_MATCH_STATUS',
    'PERMISSIONS',
    'QUALIFIER_METHOD_LABELS',
    'SCORING_LABELS',
    'SCORING_DESCRIPTIONS',
    'decisionLabels',
  ]);
  for (const file of readdirSync('src', { recursive: true })
    .map(String)
    .filter((file) => /\.tsx?$/.test(file) && !file.startsWith('generated/'))) {
    const source = ts.createSourceFile(
      file,
      readFileSync(`src/${file}`, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ['tr', 't'].includes(node.expression.getText(source)))
        literals(node.arguments[0]).forEach(check);
      if (
        ts.isNewExpression(node) &&
        ['AppError', 'Error'].includes(node.expression.getText(source))
      )
        literals(node.arguments?.[0]).forEach(check);
      if (
        ts.isPropertyAssignment(node) &&
        (node.name.getText(source) === 'message' ||
          (file.startsWith('components/') &&
            ['label', 'title'].includes(node.name.getText(source))))
      )
        literals(node.initializer).forEach(check);
      if (ts.isVariableDeclaration(node) && shared.has(node.name.getText(source))) {
        const labels = (child: ts.Node) => {
          if (ts.isPropertyAssignment(child)) literals(child.initializer).forEach(check);
          ts.forEachChild(child, labels);
        };
        if (node.initializer) labels(node.initializer);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  STAGE_TEMPLATES.forEach((template) => check(template.name));
  Object.keys(ARCHIVE_TABLES).forEach((key) => check(humanizeCode(key.replace(/([A-Z])/g, ' $1'))));
  [
    'Match',
    'Multiplayer',
    'Rosters',
    'Rules',
    'Discord',
    'History',
    'Hero',
    'Text',
    'Image',
    'Announcements',
    'Buttons',
    'Timeline',
    'Timeout',
  ].forEach(check);
  Object.keys(DEFAULT_COPY).forEach((key) =>
    check(key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())),
  );
  [
    'DRAFT',
    'PUBLISHED',
    'UNPUBLISHED',
    'PENDING',
    'APPROVED',
    'REJECTED',
    'UPCOMING',
    'REGISTRATIONS_OPEN',
    'ONGOING',
    'COMPLETED',
    'SCHEDULED',
    'IN_PROGRESS',
    'AWAITING_CONFIRMATION',
    'DISPUTED',
    'CANCELLED',
    'SUGGESTED',
    'REVIEW',
    'PLAYTESTING',
    'ACCEPTED',
    'SELECTED',
    'BEST_PER_MAP',
    'BEST_COMPLETE_RUN',
    'FIRST_RUN',
    'SECOND_RUN',
    'PROVISIONAL',
    'FINALIZED',
    'SUPERSEDED',
    'REOPENED',
    'READY',
    'WAITING',
    'LOCKED',
    'BYE',
    'PROTECT',
    'BAN',
    'PICK',
    'READY_FOR_REVIEW',
  ]
    .map(humanizeCode)
    .forEach(check);
  expect([...missing]).toEqual([]);
});
