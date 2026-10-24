import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { localeTag, translator, type Locale } from './i18n';
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export function formatDate(
  value: string | Date | null | undefined,
  timezone = 'UTC',
  language: Locale = 'en',
) {
  return value
    ? new Intl.DateTimeFormat(localeTag(language), {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: timezone,
      }).format(new Date(value))
    : translator(language)('To be announced');
}
export function localDateTimeInput(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
export function duration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
