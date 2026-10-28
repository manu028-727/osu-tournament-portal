import { localeTag, translator, type Locale } from './i18n';
import type { DraftKind } from './match-engine';

export const MATCH_ACTION_MESSAGES: Record<DraftKind, string> = {
  PROTECT: '{0} protects',
  BAN: '{0} bans',
  PICK: '{0} picks',
};

export const MATCH_STATUS_LABELS = {
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In progress',
  AWAITING_CONFIRMATION: 'Awaiting confirmation',
  COMPLETED: 'Completed',
  DISPUTED: 'Disputed',
  CANCELLED: 'Cancelled',
};

export function matchTime(value: string | Date | null, timezone = 'UTC', language: Locale = 'en') {
  return value
    ? new Intl.DateTimeFormat(localeTag(language), {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: timezone,
      }).format(new Date(value))
    : translator(language)('Date to be announced');
}
export const PUBLIC_MATCH_STATUS = {
  SCHEDULED: 'Upcoming',
  IN_PROGRESS: 'In progress',
  AWAITING_CONFIRMATION: 'Awaiting confirmation',
  COMPLETED: 'Completed',
  DISPUTED: 'Under review',
  CANCELLED: 'Cancelled',
};
export function bracketEntrant(name: string, language: Locale = 'en') {
  const ref = /^([WL])(\d+)$/.exec(name);
  const tr = translator(language);
  return ref ? tr(ref[1] === 'W' ? 'Winner of match {0}' : 'Loser of match {0}', ref[2]) : name;
}
export function matchCredits(value: unknown) {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' ? value.slice(0, 120) : '');
  return {
    referee: text(source.referee),
    streamer: text(source.streamer),
    commentators: Array.isArray(source.commentators)
      ? source.commentators.map(text).filter(Boolean).slice(0, 4)
      : [],
  };
}

export function organizerRefereeCredit(value: unknown) {
  if (!value || typeof value !== 'object') return '';
  const result = (value as Record<string, unknown>).organizerResult;
  if (!result || typeof result !== 'object') return '';
  const credit = (result as Record<string, unknown>).externalReferee;
  return typeof credit === 'string' ? credit.trim().slice(0, 120) : '';
}
