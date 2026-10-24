import italian from './locales/it.json' with { type: 'json' };
import english from './locales/en.json' with { type: 'json' };
import { formatMessage, isMessageList } from './messages';

export type Locale = 'en' | 'it';
export type Translator = (message: string, ...values: unknown[]) => string;
export function humanizeCode(value: string) {
  const text = value.replaceAll('_', ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
export const localeTag = (locale: Locale) => (locale === 'it' ? 'it-IT' : 'en-GB');
export function formatNumber(value: number, language: Locale, digits?: number) {
  return value.toLocaleString(
    localeTag(language),
    digits === undefined
      ? undefined
      : { minimumFractionDigits: digits, maximumFractionDigits: digits },
  );
}
export function locale(value: unknown, fallback: unknown = 'en'): Locale {
  if (value === 'en' || value === 'it') return value;
  return typeof fallback === 'string' && /^it(?:-|$)/i.test(fallback) ? 'it' : 'en';
}
export function translator(language: Locale): Translator {
  return (message, ...values) => {
    const text =
      language === 'it'
        ? ((italian as Record<string, string>)[message] ?? message)
        : ((english as Record<string, string>)[message] ?? message);
    return formatMessage(text, values, (value) =>
      isMessageList(value)
        ? value.items.map((item) => translateGeneratedMessage(language, item)).join(value.separator)
        : String(value),
    );
  };
}
// Only generated feedback uses this matcher. Authored CMS, names, notes and
// histories are rendered directly; interpolation parameters remain untouched.
const reverse = new Map<string, string>();
for (const [key, value] of Object.entries(italian)) if (key !== value) reverse.set(value, key);
const patterns = Object.entries(italian)
  .flatMap(([key, value]) => [{ key, text: key }, ...(key === value ? [] : [{ key, text: value }])])
  .filter(({ text }) => /\{\d+\}/.test(text))
  .map(({ key, text }) => {
    const indexes: number[] = [];
    const escaped = text
      .split(/(\{\d+\})/)
      .map((part) => {
        if (/^\{\d+\}$/.test(part)) {
          indexes.push(Number(part.slice(1, -1)));
          return '([\\s\\S]*?)';
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('');
    return {
      key,
      indexes,
      literalLength: text.replace(/\{\d+\}/g, '').length,
      expression: new RegExp('^' + escaped + '$'),
    };
  })
  .filter((pattern) => pattern.literalLength >= 4)
  .sort((a, b) => b.literalLength - a.literalLength);
export function translateGeneratedMessage(language: Locale, message: string) {
  const tr = translator(language);
  if (Object.hasOwn(english, message)) return tr(message);
  if (reverse.has(message)) return tr(reverse.get(message)!);
  if (Object.hasOwn(italian, message)) return tr(message);
  for (const { key, indexes, expression } of patterns) {
    const match = expression.exec(message);
    if (!match) continue;
    const values: string[] = [];
    let consistent = true;
    indexes.forEach((index, part) => {
      if (values[index] !== undefined && values[index] !== match[part + 1]) consistent = false;
      values[index] = match[part + 1];
    });
    if (consistent) return tr(key, ...values);
  }
  return message;
}
