import { z } from 'zod';
import { translator, translateGeneratedMessage, type Locale } from './i18n';

type Issue = { path?: unknown[]; message?: string; code?: string; expected?: string };
export function validationFeedback(issues: readonly Issue[], language: Locale) {
  const tr = translator(language);
  const types: Record<string, string> = {
    string: 'text',
    number: 'number',
    boolean: 'boolean',
    array: 'list',
    object: 'object',
    int: 'integer',
    date: 'date',
  };
  return issues
    .slice(0, 3)
    .map((issue) => {
      let message = issue.message || tr('Invalid value');
      if (language === 'it') {
        if (issue.code === 'invalid_type')
          message = tr('Expected a valid {0}.', tr(types[issue.expected || ''] || 'value'));
        else if (issue.code && issue.code !== 'custom') {
          const localized = z.locales.it().localeError(issue as unknown as z.core.$ZodRawIssue);
          message = typeof localized === 'string' ? localized : localized?.message || message;
        } else message = translateGeneratedMessage(language, message);
      }
      return `${issue.path?.map(String).join('.') || tr('Input')}: ${message}`;
    })
    .join('; ');
}
