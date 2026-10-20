import ExcelJS from 'exceljs';
import type { RefereeRecord } from '../../src/lib/referee-workbook';
export async function refereeFixtureWorkbook(records: RefereeRecord[]) {
  const b = new ExcelJS.Workbook(),
    round = b.addWorksheet('Round Setup');
  b.addWorksheet('Settings').getCell('F9').value = {
    osu: 'Standard',
    taiko: 'Taiko',
    fruits: 'Catch the Beat',
    mania: 'Mania',
  }[records[0].gameMode];
  round.getCell('AB2').value = 'ABBA';
  round.getCell('AC2').value = 'ABAB';
  let row = 5;
  const stages = new Set<string>();
  for (const r of records) {
    if (!stages.has(r.stage)) {
      stages.add(r.stage);
      round.getCell(`G${row}`).value = r.stage;
      r.draftSequence.forEach((kind, i) => (round.getRow(row).getCell(8 + i).value = kind));
      row++;
    }
    const s = b.addWorksheet(r.sheet);
    for (const [a, v] of Object.entries({
      S2: r.code,
      AB7: r.stage,
      E2: r.red,
      J2: r.blue,
      S5: r.mp,
      AQ2: r.bestOf,
      F2: r.forfeitSide === 'A' ? 'FF' : r.scoreA,
      I2: r.forfeitSide === 'B' ? 'FF' : r.scoreB,
      S12: r.firstBanSide === 'A' ? 'Red' : 'Blue',
      S13: r.firstPickSide === 'A' ? 'Red' : 'Blue',
      AB3: r.discord,
    }))
      s.getCell(a).value = v;
    for (const a of r.actions) {
      s.getCell(`E${a.row}`).value = a.side === 'A' ? 'Red' : 'Blue';
      s.getCell(`F${a.row}`).value = {
        formula: 'GOOGLE_SHEETS_ONLY()',
        result: { error: '#NAME?' },
      };
      s.getCell(`H${a.row}`).value = a.slotName;
      s.getCell(`J${a.row}`).value = a.winner ? (a.winner === 'A' ? 'Red' : 'Blue') : null;
    }
    r.pool.forEach((map, i) => {
      s.getCell(`AA${i + 9}`).value = map.name;
      s.getCell(`AC${i + 9}`).value = `!mp map ${map.beatmapId} 0`;
    });
  }
  return Buffer.from(await b.xlsx.writeBuffer());
}
