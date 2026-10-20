import { describe, expect, it } from 'vitest';
import {
  sortPoolSlots,
  poolSlotErrors,
  nextSlotName,
  movePoolSlot,
} from '../src/lib/mappool-order';
const categories = ['NM', 'HD', 'HR', 'DT', 'FM', 'TB'].map((acronym, position) => ({
  acronym,
  position,
}));
const slot = (name: string, beatmapId = 1) => ({
  name,
  category: name.replace(/\d+$/, ''),
  beatmapId,
  editorId: name,
});
describe('canonical mappool ordering', () => {
  it('sorts every standard category numerically and leaves tiebreakers last', () => {
    const names = [
      'HR2',
      'NM3',
      'DT1',
      'HD2',
      'TB2',
      'NM1',
      'FM2',
      'HR1',
      'NM10',
      'NM2',
      'HD1',
      'FM1',
      'TB',
    ];
    expect(
      sortPoolSlots(
        names.map((n) => slot(n)),
        categories,
      ).map((s) => s.name),
    ).toEqual([
      'NM1',
      'NM2',
      'NM3',
      'NM10',
      'HD1',
      'HD2',
      'HR1',
      'HR2',
      'DT1',
      'FM1',
      'FM2',
      'TB',
      'TB2',
    ]);
  });
  it('keeps custom categories at their configured priority with deterministic fallback', () => {
    const values = [slot('TB'), slot('ZZ2'), slot('EZ1'), slot('HD1'), slot('NM1'), slot('AA1')];
    expect(
      sortPoolSlots(values, [...categories, { acronym: 'EZ', position: 2 }]).map((s) => s.name),
    ).toEqual(['NM1', 'HD1', 'EZ1', 'AA1', 'ZZ2', 'TB']);
  });
  it('rejects duplicate normalized slots and mismatched or invalid slot numbers', () => {
    expect(poolSlotErrors([slot('NM01'), slot('NM1')], categories).join(' ')).toContain(
      'Duplicate slot: NM1',
    );
    expect(
      poolSlotErrors([{ ...slot('HD1'), category: 'NM' }, slot('NM0')], categories),
    ).toHaveLength(2);
  });
  it('moves maps by swapping slot names without losing stable identities or metadata', () => {
    const initial = [
      { ...slot('NM1', 11), metadata: { title: 'First' } },
      { ...slot('NM2', 22), metadata: { title: 'Second' } },
      slot('HD1', 33),
    ];
    const next = movePoolSlot(initial, 'NM2', -1, categories);
    expect(next.map((s) => [s.editorId, s.name, s.beatmapId])).toEqual([
      ['NM2', 'NM1', 22],
      ['NM1', 'NM2', 11],
      ['HD1', 'HD1', 33],
    ]);
    expect(initial[0].name).toBe('NM1');
    expect(nextSlotName([slot('NM1'), slot('NM3')], 'NM')).toBe('NM2');
    expect(movePoolSlot(initial, 'NM1', -1, categories)).toEqual(initial);
  });
});
