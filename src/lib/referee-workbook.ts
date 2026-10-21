import ExcelJS from 'exceljs';
import yauzl from 'yauzl';
import { createHash } from 'node:crypto';
import { AppError } from './permissions';
import { type Side } from './match-rules';
import { type GameplayScoring } from './gameplay-scoring';
import { normalizeStageLabel } from './stage-reconciliation';
export type WorkbookScoring = {
  mode: GameplayScoring | null;
  declarations: { sheet: string; cell: string; label: string; value: string }[];
};
export type SheetAction = {
  row: number;
  kind: 'PROTECT' | 'BAN' | 'PICK';
  side: Side;
  slotName: string;
  winner: Side | null;
  original: { team: string; action: string; slot: string; winner: string };
};
export type RefereeRecord = {
  sheet: string;
  code: string;
  stage: string;
  bracket?: string | null;
  roundLabel?: string;
  scoring?: WorkbookScoring;
  warnings?: string[];
  red: string;
  blue: string;
  mp: string;
  gameMode: 'osu' | 'taiko' | 'fruits' | 'mania';
  bestOf: number;
  scoreA: number;
  scoreB: number;
  forfeitSide: Side | null;
  firstBanSide: Side;
  firstPickSide: Side;
  firstProtectSide: Side;
  banOrder: 'AB' | 'ABAB' | 'ABBA';
  protectOrder: 'ABAB' | 'ABBA';
  draftSequence: ('PROTECT' | 'BAN' | 'PICK' | 'TB_BAN')[];
  pool: { name: string; beatmapId: number }[];
  actions: SheetAction[];
  discord: string;
  issues: string[];
  fingerprint: string;
};
export const fingerprint = (input: unknown) =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex');
export function qualifierWorkbookIssue(label: string): string | null {
  const key = normalizeStageLabel(label).key;
  return [
    'qualifiers',
    'qualifier results',
    'qualifier scores',
    'qualifier sessions',
    'qualifier runs',
    'qualifier standings',
    'qualifier setup',
    'qualifiers ref',
    'qualifiers schedule',
    'qualifiers ref schedule',
    'qualifier ref',
    'qualifier schedule',
  ].includes(key)
    ? 'Qualifier workbook normalization is unavailable in this head-to-head importer. Sessions, runs, individual scores and seeding policies are not imported or inferred.'
    : null;
}
export function checkWorkbookZip(input: Buffer): Promise<void> {
  if (input.length > 4 * 1024 * 1024) throw new AppError('Use an XLSX workbook up to 4 MB.', 413);
  return new Promise((resolve, reject) =>
    yauzl.fromBuffer(input, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) {
        reject(new AppError('This is not a valid XLSX workbook.'));
        return;
      }
      let count = 0,
        total = 0,
        found = false,
        done = false;
      const fail = () => {
        if (done) return;
        done = true;
        zip.close();
        reject(new AppError('Workbook exceeds safe archive limits.'));
      };
      zip.on('error', fail);
      zip.on('entry', (entry) => {
        count++;
        total += entry.uncompressedSize;
        found ||= entry.fileName === 'xl/workbook.xml';
        if (
          count > 2500 ||
          total > 96 * 1024 * 1024 ||
          entry.uncompressedSize > 20 * 1024 * 1024 ||
          entry.isEncrypted()
        ) {
          fail();
          return;
        }
        zip.readEntry();
      });
      zip.on('end', () => {
        if (done) return;
        done = true;
        zip.close();
        found
          ? resolve()
          : reject(new AppError('Choose an XLSX spreadsheet, not another ZIP archive.'));
      });
      zip.readEntry();
    }),
  );
}
export function workbookText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (value instanceof Date) return value.toISOString();
  if ('error' in value) return '';
  if ('result' in value) return workbookText(value.result as ExcelJS.CellValue);
  if ('text' in value) return value.text;
  if ('richText' in value) return value.richText.map((t) => t.text).join('');
  return '';
}
export function parseWorkbookScoring(value: string): GameplayScoring | null {
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[\s!_.-]+/g, '');
  if (['scorev1', 'score1', 'v1'].includes(key)) return 'SCORE_V1';
  if (['scorev2', 'score2', 'v2'].includes(key)) return 'SCORE_V2';
  if (['lazer', 'osulazer'].includes(key)) return 'LAZER';
  return null;
}

export function workbookScoringCompatibility(
  scoring: WorkbookScoring | undefined,
  target: GameplayScoring,
) {
  const warnings: string[] = [];
  const errors: string[] = [];
  if (!scoring?.declarations.length)
    warnings.push(
      'Workbook has no explicit gameplay scoring provenance. Source scores are not assumed to use the tournament scoring system; no conversion is performed.',
    );
  else if (!scoring.mode)
    errors.push(
      'Workbook scoring metadata is unrecognized or conflicting. Review the original scoring declarations.',
    );
  else if (scoring.mode !== target)
    errors.push(
      `Workbook gameplay scoring ${scoring.mode} differs from tournament ${target}. Import is blocked; score conversion is not supported.`,
    );
  return { warnings, errors };
}

function detectWorkbookScoring(book: ExcelJS.Workbook): WorkbookScoring {
  const declarations: WorkbookScoring['declarations'] = [];
  const settings = book.getWorksheet('Settings');
  if (settings) {
    for (let row = 1; row <= Math.min(settings.rowCount, 100); row++) {
      for (let column = 1; column <= Math.min(settings.columnCount, 40); column++) {
        const cell = settings.getCell(row, column);
        if (cell.isMerged && cell.master.address !== cell.address) continue;
        const label = workbookText(cell.value).trim();
        if (
          !/^(?:gameplay scoring(?: system)?|scoring system|scoring mode|score mode)$/i.test(label)
        )
          continue;
        for (let offset = 1; offset <= 4; offset++) {
          const valueCell = settings.getCell(row, column + offset);
          if (valueCell.isMerged && valueCell.master.address === cell.address) continue;
          const value = workbookText(valueCell.value).trim();
          if (!value) continue;
          declarations.push({ sheet: settings.name, cell: valueCell.address, label, value });
          break;
        }
      }
    }
    // Numbered Stat Lord referee sheets define F10 as gameplay scoring, even without a label.
    const fixedScoring = workbookText(settings.getCell('F10').value).trim();
    if (
      book.getWorksheet('Round Setup') &&
      book.worksheets.some((sheet) => /^\d{1,6}$/.test(sheet.name)) &&
      fixedScoring &&
      !declarations.some((declaration) => declaration.cell === 'F10')
    )
      declarations.push({
        sheet: settings.name,
        cell: 'F10',
        label: 'Stat Lord gameplay scoring (Settings F10)',
        value: fixedScoring,
      });
  }
  const modes = declarations.map((declaration) => parseWorkbookScoring(declaration.value));
  const unique = new Set(modes);
  return { mode: unique.size === 1 && !unique.has(null) ? modes[0] : null, declarations };
}
export async function parseRefereeWorkbook(input: Buffer) {
  await checkWorkbookZip(input);
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(input as unknown as Parameters<typeof book.xlsx.load>[0], {
      ignoreNodes: ['dataValidations', 'conditionalFormatting', 'drawing', 'extLst'],
    });
  } catch {
    throw new AppError('The workbook could not be decoded. Export it as XLSX again.');
  }
  if (book.worksheets.length > 120)
    throw new AppError('A workbook may contain at most 120 worksheets.');
  const text = (sheet: ExcelJS.Worksheet, address: string) => {
    const cell = sheet.getCell(address);
    return workbookText(
      cell.type === ExcelJS.ValueType.Formula ? (cell.result as ExcelJS.CellValue) : cell.value,
    ).trim();
  };
  const rounds = book.getWorksheet('Round Setup'),
    records: RefereeRecord[] = [];
  const scoring = detectWorkbookScoring(book);
  const unsupported = book.worksheets.filter(
    (sheet) => !/^\d{1,6}$/.test(sheet.name) && qualifierWorkbookIssue(sheet.name),
  );
  const warnings = unsupported.map(
    (sheet) => `Worksheet "${sheet.name}" was not imported. ${qualifierWorkbookIssue(sheet.name)}`,
  );
  for (const sheet of book.worksheets.filter((s) => /^\d{1,6}$/.test(s.name))) {
    const issues: string[] = [],
      stage = text(sheet, 'AB7'),
      red = text(sheet, 'E2'),
      blue = text(sheet, 'J2');
    const qualifierIssue = qualifierWorkbookIssue(stage);
    if (qualifierIssue) issues.push(qualifierIssue);
    const setting = book.getWorksheet('Settings'),
      sourceMode = setting ? text(setting, 'F9').toLowerCase() : '';
    const modes: Record<string, RefereeRecord['gameMode']> = {
      standard: 'osu',
      'osu!': 'osu',
      taiko: 'taiko',
      catch: 'fruits',
      'catch the beat': 'fruits',
      mania: 'mania',
    };
    const gameMode = modes[sourceMode] || null;
    if (!gameMode) issues.push('Game mode is missing or unrecognized in Settings F9.');
    if (sheet.actualRowCount > 500)
      issues.push(
        'Worksheet exceeds the supported 500-row referee area. Review extended records before importing.',
      );
    if ([stage, red, blue].some((v) => v.length > 160))
      issues.push('Stage or team name exceeds 160 characters.');
    const side = (value: string): Side | null =>
      value === 'Red' || value === red ? 'A' : value === 'Blue' || value === blue ? 'B' : null;
    let roundRow = 0;
    if (rounds) {
      const sourceStage = normalizeStageLabel(stage);
      const candidates: { row: number; label: string; key: string; bracket: string | null }[] = [];
      for (let row = 5; row <= Math.min(rounds.rowCount, 200); row++) {
        const label = text(rounds, `G${row}`);
        const normalized = normalizeStageLabel(label);
        if (normalized.key === sourceStage.key)
          candidates.push({ row, label, key: normalized.key, bracket: normalized.bracket });
      }
      const exact = candidates.filter(
        (candidate) => candidate.label.toLowerCase() === stage.toLowerCase(),
      );
      const contextual = candidates.filter(
        (candidate) => candidate.bracket === sourceStage.bracket,
      );
      const generic = candidates.filter((candidate) => !candidate.bracket);
      const rows = exact.length ? exact : contextual.length ? contextual : generic;
      if (rows.length === 1) roundRow = rows[0].row;
      else if (rows.length > 1)
        issues.push(
          'Round Setup contains ambiguous stage/round aliases; review the source mapping.',
        );
    }
    const pairs: RefereeRecord['draftSequence'] = [];
    if (rounds && roundRow)
      for (let c = 8; c <= 21; c++) {
        const kind = workbookText(rounds.getRow(roundRow).getCell(c).value).trim().toUpperCase();
        if (['PROTECT', 'BAN', 'PICK'].includes(kind))
          pairs.push(kind as 'PROTECT' | 'BAN' | 'PICK');
      }
    if (rounds && roundRow && text(rounds, `V${roundRow}`).toLowerCase().includes('tb'))
      pairs.push('TB_BAN');
    const expanded = pairs.flatMap((kind) => [kind, kind]);
    expanded.push('PICK');
    const firstBanSide = side(text(sheet, 'S12')) || 'A',
      firstPickSide = side(text(sheet, 'S13')) || 'A',
      firstProtectSide = side(text(sheet, 'S11')) || firstBanSide;
    const actions: SheetAction[] = [],
      pool: RefereeRecord['pool'] = [];
    for (let row = 9; row <= Math.min(Math.max(sheet.rowCount, 37), 500); row++) {
      const slot = text(sheet, `H${row}`).toUpperCase();
      if (!slot) continue;
      if (!/^[A-Z][A-Z0-9_-]{0,19}$/.test(slot)) {
        issues.push(`Row ${row}: invalid map slot.`);
        continue;
      }
      const original = {
        team: text(sheet, `E${row}`),
        action: text(sheet, `F${row}`),
        slot,
        winner: text(sheet, `J${row}`),
      };
      const cached = original.action.toUpperCase().replaceAll(' ', '_'),
        fromRound = expanded[row - 9];
      let kind = cached === 'TIEBREAKER' ? 'PICK' : cached === 'TB_BAN' ? 'BAN' : cached;
      if (!['PROTECT', 'BAN', 'PICK'].includes(kind))
        kind = fromRound === 'TB_BAN' ? 'BAN' : fromRound || '';
      if (!['PROTECT', 'BAN', 'PICK'].includes(kind)) {
        issues.push(
          `Row ${row}: action cannot be reconstructed from the cached cell or Round Setup.`,
        );
        continue;
      }
      if (fromRound && kind !== (fromRound === 'TB_BAN' ? 'BAN' : fromRound))
        issues.push(`Row ${row}: cached action disagrees with Round Setup.`);
      let actor = side(original.team);
      if (!actor && cached === 'TIEBREAKER' && !original.team) {
        const picks = actions.filter((a) => a.kind === 'PICK').length;
        actor = picks % 2 ? (firstPickSide === 'A' ? 'B' : 'A') : firstPickSide;
      }
      if (!actor) {
        issues.push(`Row ${row}: unknown acting team.`);
        continue;
      }
      const winner = original.winner ? side(original.winner) : null;
      if (original.winner && !winner) issues.push(`Row ${row}: unknown map winner.`);
      if (kind !== 'PICK' && winner)
        issues.push(`Row ${row}: a non-pick action contains a winner.`);
      actions.push({
        row,
        kind: kind as SheetAction['kind'],
        side: actor,
        slotName: slot,
        winner,
        original,
      });
    }
    for (let row = 9; row <= Math.min(Math.max(sheet.rowCount, 37), 500); row++) {
      const name = text(sheet, `AA${row}`).toUpperCase(),
        command = text(sheet, `AC${row}`),
        id = /^!mp map (\d+)(?:\s|$)/.exec(command)?.[1];
      if (name && id && /^[A-Z][A-Z0-9_-]{0,19}$/.test(name))
        pool.push({ name, beatmapId: Number(id) });
    }
    const rawA = text(sheet, 'F2'),
      rawB = text(sheet, 'I2'),
      code = text(sheet, 'S2');
    const bestOf =
      Number(text(sheet, 'AQ2')) || Number(/^Best of (\d+)/i.exec(text(sheet, 'G2'))?.[1]);
    const forfeitSide = ['FF', '-1'].includes(rawA)
      ? 'A'
      : ['FF', '-1'].includes(rawB)
        ? 'B'
        : null;
    if (!code || code.length > 80 || !stage || !red || !blue)
      issues.push('Missing match ID, stage or participating team names.');
    if (code !== sheet.name) issues.push('Worksheet name and match ID disagree.');
    if (!Number.isInteger(bestOf) || bestOf < 1 || bestOf > 31 || bestOf % 2 !== 1)
      issues.push('Missing or invalid best-of format.');
    if (!forfeitSide && (!/^\d+$/.test(rawA) || !/^\d+$/.test(rawB)))
      issues.push('Missing or invalid final score.');
    const rawOrder = rounds ? text(rounds, 'AB2') : '';
    const banCount = actions.filter((a) => a.kind === 'BAN').length;
    const banOrder =
      rawOrder === 'AB' || rawOrder === 'ABAB' || rawOrder === 'ABBA'
        ? rawOrder
        : banCount === 2
          ? 'AB'
          : null;
    if (!banOrder && banCount) issues.push('Ban order cannot be determined from Round Setup.');
    if (!pairs.length && actions.length)
      issues.push(
        'Round Setup action pairs are unavailable; review this workbook before importing.',
      );
    const result: RefereeRecord = {
      sheet: sheet.name,
      code,
      stage,
      bracket: normalizeStageLabel(stage).bracket,
      roundLabel: stage,
      scoring,
      ...(warnings.length ? { warnings } : {}),
      red,
      blue,
      mp: text(sheet, 'S5'),
      gameMode: gameMode || 'osu',
      bestOf,
      scoreA: forfeitSide ? (forfeitSide === 'A' ? 0 : (bestOf + 1) / 2) : Number(rawA),
      scoreB: forfeitSide ? (forfeitSide === 'B' ? 0 : (bestOf + 1) / 2) : Number(rawB),
      forfeitSide,
      firstBanSide,
      firstPickSide,
      firstProtectSide,
      banOrder: banOrder || 'ABBA',
      protectOrder: rounds && text(rounds, 'AC2') === 'ABBA' ? 'ABBA' : 'ABAB',
      draftSequence: pairs,
      pool,
      actions,
      discord: workbookText(sheet.getCell('AB3').value),
      issues,
      fingerprint: '',
    };
    result.fingerprint = fingerprint({ ...result, fingerprint: undefined });
    records.push(result);
  }
  if (!records.length)
    throw new AppError(
      unsupported.length
        ? qualifierWorkbookIssue(unsupported[0].name)!
        : 'No numbered referee match worksheets were found.',
    );
  return { fingerprint: createHash('sha256').update(input).digest('hex'), records };
}
