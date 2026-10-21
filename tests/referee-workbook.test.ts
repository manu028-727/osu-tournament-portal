import { describe, it, expect } from 'vitest';
import { refereeFixtureWorkbook } from './fixtures/referee-workbook';
import {
  parseRefereeWorkbook,
  checkWorkbookZip,
  parseWorkbookScoring,
  workbookScoringCompatibility,
} from '../src/lib/referee-workbook';
import { syntheticRecord as record } from './fixtures/referee-record';
import ExcelJS from 'exceljs';
import { validateSheetRecord } from '../src/lib/referee-workbook-state';
import { inheritedRules } from '../src/lib/gameplay-scoring';
describe('synthetic numbered-workbook reconstruction', () => {
  it('finds every numbered match and reconstructs formula-error actions', async () => {
    const parsed = await parseRefereeWorkbook(
      await refereeFixtureWorkbook(['1', '25', '27', '32'].map(record)),
    );
    expect(parsed.records).toHaveLength(4);
    for (const r of parsed.records) {
      expect(r.actions.map((a) => a.kind)).toEqual([
        'PROTECT',
        'PROTECT',
        'BAN',
        'BAN',
        'PICK',
        'PICK',
      ]);
      expect(r.mp).toContain('/100');
      expect(r.issues).toEqual([]);
    }
  });
  it('rejects non-workbooks and oversized archives', async () => {
    await expect(checkWorkbookZip(Buffer.from('not XLSX'))).rejects.toThrow();
    expect(() => checkWorkbookZip(Buffer.alloc(4194305))).toThrow();
  });
  it('rejects qualifier-labelled records rather than inventing head-to-head qualifier sessions', async () => {
    const source = { ...record(), stage: 'Quals' };
    const parsed = (await parseRefereeWorkbook(await refereeFixtureWorkbook([source]))).records[0];
    expect(parsed.issues.join(' ')).toContain('Qualifier workbook normalization is unavailable');
    const slots = source.pool.map((slot) => ({ ...slot, category: slot.name.replace(/\d+$/, '') }));
    expect(() =>
      validateSheetRecord({ ...source, issues: [] }, inheritedRules({}, 'SCORE_V2'), slots),
    ).toThrow('Qualifier workbook normalization is unavailable');
  });
  it('reports ignored qualifier tabs in mixed workbooks and rejects qualifier-only workbooks explicitly', async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await refereeFixtureWorkbook([record()])) as never);
    book.addWorksheet('Qualifier Scores').getCell('A1').value =
      'Unmapped external individual scores';
    book.addWorksheet('Qualifiers Ref');
    book.addWorksheet('Qualifiers Schedule');
    const parsed = await parseRefereeWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0].warnings?.join(' ')).toContain(
      'Worksheet "Qualifier Scores" was not imported',
    );
    expect(parsed.records[0].warnings?.join(' ')).toContain(
      'Worksheet "Qualifiers Ref" was not imported',
    );
    expect(parsed.records[0].warnings?.join(' ')).toContain(
      'Worksheet "Qualifiers Schedule" was not imported',
    );
    book.removeWorksheet('1');
    await expect(parseRefereeWorkbook(Buffer.from(await book.xlsx.writeBuffer()))).rejects.toThrow(
      'Qualifier workbook normalization is unavailable',
    );
  });
  it('uses a canonical Round Setup alias without losing the source bracket or reconstructing another bracket history', async () => {
    const source = { ...record(), stage: 'Grand-finals - Losers' };
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await refereeFixtureWorkbook([source])) as never);
    book.getWorksheet('Round Setup')!.getCell('G5').value = 'GF';
    const parsed = (await parseRefereeWorkbook(Buffer.from(await book.xlsx.writeBuffer())))
      .records[0];
    expect(parsed.issues).toEqual([]);
    expect(parsed.bracket).toBe('Losers');
    expect(parsed.actions).toHaveLength(6);
    book.getWorksheet('Round Setup')!.getCell('G5').value = 'GF - Winners';
    const wrongBracket = (await parseRefereeWorkbook(Buffer.from(await book.xlsx.writeBuffer())))
      .records[0];
    expect(wrongBracket.issues.join(' ')).toContain('Round Setup');
  });
  it('detects only explicitly-labelled scoring metadata and retains original stage/bracket context', async () => {
    const source = { ...record(), stage: 'Grand finals - Losers' };
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await refereeFixtureWorkbook([source])) as never);
    book.getWorksheet('Settings')!.getCell('E10').value = 'Scoring System';
    book.getWorksheet('Settings')!.getCell('F10').value = 'ScoreV1';
    const parsed = (await parseRefereeWorkbook(Buffer.from(await book.xlsx.writeBuffer())))
      .records[0];
    expect(parsed).toMatchObject({
      stage: 'Grand finals - Losers',
      bracket: 'Losers',
      roundLabel: source.stage,
      scoring: {
        mode: 'SCORE_V1',
        declarations: [
          { sheet: 'Settings', cell: 'F10', label: 'Scoring System', value: 'ScoreV1' },
        ],
      },
    });
    expect(workbookScoringCompatibility(parsed.scoring, 'SCORE_V2').errors[0]).toContain('blocked');
    expect(workbookScoringCompatibility(parsed.scoring, 'SCORE_V1').errors).toEqual([]);
  });
  it('does not infer a scoring mode from absent metadata, map results or one-million scores', async () => {
    const parsed = (await parseRefereeWorkbook(await refereeFixtureWorkbook([record()])))
      .records[0];
    expect(parsed.scoring?.mode).toBeNull();
    expect(workbookScoringCompatibility(parsed.scoring, 'SCORE_V2').warnings[0]).toContain(
      'not assumed',
    );
    expect(parseWorkbookScoring('1000000')).toBeNull();
    expect(parseWorkbookScoring('V1')).toBe('SCORE_V1');
    expect(parseWorkbookScoring('SCORE_V2')).toBe('SCORE_V2');
    expect(parseWorkbookScoring('osu!lazer')).toBe('LAZER');
  });
  it.each([
    ['ScoreV1', 'SCORE_V1'],
    ['V2', 'SCORE_V2'],
    ['osu!lazer', 'LAZER'],
  ] as const)(
    'reads explicit Stat Lord Settings F10 %s even without an adjacent label',
    async (value, mode) => {
      const book = new ExcelJS.Workbook();
      await book.xlsx.load((await refereeFixtureWorkbook([record()])) as never);
      book.getWorksheet('Settings')!.getCell('F10').value = value;
      const parsed = (await parseRefereeWorkbook(Buffer.from(await book.xlsx.writeBuffer())))
        .records[0];
      expect(parsed.scoring).toMatchObject({
        mode,
        declarations: [{ sheet: 'Settings', cell: 'F10', value }],
      });
      expect(parsed.scoring?.declarations).toHaveLength(1);
      expect(workbookScoringCompatibility(parsed.scoring, mode).errors).toEqual([]);
    },
  );
  it('blocks unknown F10 values and conflicts with other explicit scoring declarations', async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await refereeFixtureWorkbook([record()])) as never);
    const settings = book.getWorksheet('Settings')!;
    settings.getCell('F10').value = 'Unrecognized source scoring';
    let parsed = (await parseRefereeWorkbook(Buffer.from(await book.xlsx.writeBuffer())))
      .records[0];
    expect(parsed.scoring?.mode).toBeNull();
    expect(workbookScoringCompatibility(parsed.scoring, 'SCORE_V2').errors[0]).toContain(
      'unrecognized or conflicting',
    );
    settings.getCell('F10').value = 'ScoreV1';
    settings.getCell('E11').value = 'Scoring System';
    settings.getCell('F11').value = 'ScoreV2';
    parsed = (await parseRefereeWorkbook(Buffer.from(await book.xlsx.writeBuffer()))).records[0];
    expect(parsed.scoring?.mode).toBeNull();
    expect(parsed.scoring?.declarations).toHaveLength(2);
    expect(workbookScoringCompatibility(parsed.scoring, 'SCORE_V1').errors[0]).toContain(
      'conflicting',
    );
  });
  it('rejects conflicting declarations and historical scoring mismatches without converting scores', () => {
    const source = record();
    source.scoring = {
      mode: 'SCORE_V1',
      declarations: [{ sheet: 'Settings', cell: 'F10', label: 'Scoring System', value: 'ScoreV1' }],
    };
    const slots = source.pool.map((slot) => ({ ...slot, category: slot.name.replace(/\d+$/, '') }));
    expect(() => validateSheetRecord(source, inheritedRules({}, 'SCORE_V2'), slots)).toThrow(
      'frozen match scoring',
    );
    expect(source.scoreA).toBe(2);
    expect(
      workbookScoringCompatibility({ ...source.scoring, mode: null }, 'SCORE_V1').errors[0],
    ).toContain('conflicting');
  });
  it.each(['SCORE_V1', 'SCORE_V2', 'LAZER'] as const)(
    'compares explicit %s metadata without treating other scoring modes as equivalent',
    (mode) => {
      const metadata = {
        mode,
        declarations: [{ sheet: 'Settings', cell: 'F10', label: 'Scoring System', value: mode }],
      };
      expect(workbookScoringCompatibility(metadata, mode).errors).toEqual([]);
      for (const other of ['SCORE_V1', 'SCORE_V2', 'LAZER'] as const)
        if (other !== mode)
          expect(workbookScoringCompatibility(metadata, other).errors[0]).toContain(
            'conversion is not supported',
          );
    },
  );
});
