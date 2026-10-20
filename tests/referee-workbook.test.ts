import { describe, it, expect } from 'vitest';
import { refereeFixtureWorkbook } from './fixtures/referee-workbook';
import { parseRefereeWorkbook, checkWorkbookZip } from '../src/lib/referee-workbook';
import { syntheticRecord as record } from './fixtures/referee-record';
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
});
