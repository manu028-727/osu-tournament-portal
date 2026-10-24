import { expect, it } from 'vitest';
import { referencedMediaIds } from '../src/lib/media-references';

it('recognizes authored URLs and snapshot IDs without prefix matches or platform confusion', () => {
  const ids = referencedMediaIds({
    html: '<img src="/api/media/asset-long?x=1">',
    hidden: [{ logoImageId: 'snapshot' }, '/api/media/other#fragment'],
    platform: '/api/platform/media/global',
  });
  expect([...ids].sort()).toEqual(['asset-long', 'other', 'snapshot']);
  expect(ids.has('asset')).toBe(false);
  expect([...referencedMediaIds('/api/platform/media/global', 'platform')]).toEqual(['global']);
});
