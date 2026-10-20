import { describe, expect, it } from 'vitest';
import { appearance, contrast, themeStyle } from '../src/lib/theme';

describe('custom branding contrast', () => {
  it.each(['#000000', '#ffffff', '#202023', '#3a085c', '#ff0000', '#00ff00', '#0000ff', '#f1b4cf'])(
    'keeps %s readable on raised surfaces and primary buttons',
    (primary) => {
      const style = themeStyle(primary);
      expect(contrast(style['--brand-dark'], '#302b30')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(style['--brand-light'], '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(style['--brand-dark'], style['--brand-ink-dark'])).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrast(style['--brand-light'], style['--brand-ink-light'])).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(style['--brand-original']).toBe(primary);
    },
  );
  it('uses safe defaults for missing or invalid colors', () => {
    expect(themeStyle(null, 'url(unsafe)')).toEqual(themeStyle());
  });
  it('preserves a sufficiently contrasting brand', () => {
    expect(themeStyle('#f1b4cf')['--brand-dark']).toBe('#f1b4cf');
    expect(contrast('#ffffff', '#000000')).toBe(21);
  });
  it.each(['#e96ca8', '#32b877', '#18386f', '#e77b22', '#fff5a6', '#8859c5'])(
    'supports configured accent %s in either appearance',
    (value) => {
      const colors = themeStyle(value, value);
      expect(contrast(colors['--brand-dark'], '#302b30')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors['--brand-light'], '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(colors['--brand-original']).toBe(value);
    },
  );
  it('validates the appearance cookie without treating it as branding', () => {
    expect(appearance('light')).toBe('light');
    expect(appearance('dark')).toBe('dark');
    expect(appearance('system')).toBe('system');
    expect(appearance('garbage')).toBe('system');
  });
});
