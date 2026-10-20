// Branding is stored unchanged; only presentation colors are contrast-adjusted.
function rgb(hex: string) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
export function luminance(hex: string) {
  const c = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}
export function contrast(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
function color(value: string | null | undefined, fallback: string) {
  return value && /^#[\da-f]{6}$/i.test(value) ? value : fallback;
}
function readable(value: string, surface: string, light: boolean) {
  let channels = rgb(value);
  let result = value;
  while (contrast(result, surface) < 4.5) {
    channels = channels.map((v) => (light ? Math.max(0, v - 8) : Math.min(255, v + 8)));
    result = '#' + channels.map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  return result;
}
export function themeStyle(primary?: string | null, accent?: string | null) {
  const brand = color(primary, '#f1b4cf');
  const secondary = color(accent, '#89d6b5');
  const dark = readable(brand, '#3d353c', false);
  const light = readable(brand, '#f1e9ed', true);
  const ink = (background: string) =>
    contrast(background, '#181518') > contrast(background, '#ffffff') ? '#181518' : '#ffffff';
  return {
    '--brand': `light-dark(${light}, ${dark})`,
    '--brand-original': brand,
    '--brand-dark': dark,
    '--brand-light': light,
    '--accent': `light-dark(${readable(secondary, '#f1e9ed', true)}, ${readable(secondary, '#3d353c', false)})`,
    '--brand-ink': `light-dark(${ink(light)}, ${ink(dark)})`,
    '--brand-ink-dark': ink(dark),
    '--brand-ink-light': ink(light),
  };
}
export type Appearance = 'system' | 'light' | 'dark';
export function appearance(value?: string | null): Appearance {
  return value === 'light' || value === 'dark' ? value : 'system';
}
