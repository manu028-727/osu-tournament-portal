import type { RefereeRecord, SheetAction } from '../../src/lib/referee-workbook';
export function syntheticRecord(code = '1'): RefereeRecord {
  const actions: Omit<SheetAction, 'row' | 'original'>[] = [
    { kind: 'PROTECT', side: 'A', slotName: 'NM1', winner: null },
    { kind: 'PROTECT', side: 'B', slotName: 'HD1', winner: null },
    { kind: 'BAN', side: 'A', slotName: 'HR1', winner: null },
    { kind: 'BAN', side: 'B', slotName: 'DT1', winner: null },
    { kind: 'PICK', side: 'A', slotName: 'NM2', winner: 'A' },
    { kind: 'PICK', side: 'B', slotName: 'FM1', winner: 'A' },
  ];
  return {
    sheet: code,
    code,
    stage: 'Test Round',
    red: 'Team Alpha',
    blue: 'Team Beta',
    mp: 'https://osu.ppy.sh/community/matches/100',
    gameMode: 'osu',
    bestOf: 3,
    scoreA: 2,
    scoreB: 0,
    forfeitSide: null,
    firstBanSide: 'A',
    firstPickSide: 'A',
    firstProtectSide: 'A',
    banOrder: 'ABAB',
    protectOrder: 'ABAB',
    draftSequence: ['PROTECT', 'BAN', 'PICK'],
    pool: ['NM1', 'NM2', 'HD1', 'HR1', 'DT1', 'FM1', 'TB'].map((name, i) => ({
      name,
      beatmapId: 900000001 + i,
    })),
    actions: actions.map((a, i) => ({
      ...a,
      row: 9 + i,
      original: {
        team: a.side === 'A' ? 'Red' : 'Blue',
        action: a.kind,
        slot: a.slotName,
        winner: a.winner ? 'Red' : '',
      },
    })),
    discord: '',
    issues: [],
    fingerprint: '',
  };
}
