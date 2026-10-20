import type { RefereeRecord } from './referee-workbook';

type StoredTimeline = {
  actions: {
    id: string;
    kind: string;
    side: string;
    slotName: string;
    voided: boolean;
  }[];
  results: { actionId: string; winnerSide: string; voided: boolean }[];
};
export function storedTimeline(match: StoredTimeline) {
  const winners = new Map(
    match.results.filter((r) => !r.voided).map((r) => [r.actionId, r.winnerSide]),
  );
  return match.actions
    .filter((a) => !a.voided)
    .map((a) => ({
      kind: a.kind,
      side: a.side,
      slotName: a.slotName,
      winner: winners.get(a.id) || null,
    }));
}
export function sameTimeline(match: StoredTimeline, record: RefereeRecord) {
  return (
    JSON.stringify(storedTimeline(match)) ===
    JSON.stringify(
      record.actions.map(({ kind, side, slotName, winner }) => ({ kind, side, slotName, winner })),
    )
  );
}
