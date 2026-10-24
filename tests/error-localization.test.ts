import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError } from '../src/lib/permissions';
import type { Locale } from '../src/lib/i18n';

const preference = vi.hoisted(() => ({ language: 'it' as Locale, unavailable: false }));
vi.mock('../src/lib/db', () => ({ db: {} }));
vi.mock('../src/lib/server-locale', () => ({
  getLocale: async () => {
    if (preference.unavailable) throw new Error('Synthetic locale lookup failure');
    return preference.language;
  },
}));
import { errorResponse } from '../src/lib/security';
afterEach(() => {
  preference.language = 'it';
  preference.unavailable = false;
  vi.restoreAllMocks();
});

it('localizes safe error responses and preserves status, parameters and cache policy', async () => {
  const response = await errorResponse(new AppError('Open match {0}', 409, ['Captain']));
  expect(response.status).toBe(409);
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  expect(await response.json()).toEqual({ error: 'Apri incontro Captain' });
  expect(await (await errorResponse(new AppError('Open match Captain', 409))).json()).toEqual({
    error: 'Apri incontro Captain',
  });
  const list = await errorResponse(AppError.fromMessages(['No entrants', 'No source']));
  expect(await list.json()).toEqual({ error: 'Nessun partecipante Nessuna origine' });
});
it('localizes Zod feedback per response without changing global schema error language', async () => {
  const schema = z.object({ score: z.number().positive() });
  const parsed = schema.safeParse({ score: 'invalid' });
  expect(parsed.success).toBe(false);
  if (parsed.success) throw new Error('Expected invalid synthetic score');
  const response = await errorResponse(parsed.error);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'score: Tipo di valore richiesto: numero.' });
  expect(schema.safeParse({ score: 'invalid' }).error?.issues[0].message).toContain(
    'expected number',
  );
});
it('keeps independent locale choices isolated and maps database conflicts', async () => {
  preference.language = 'it';
  const italian = errorResponse({ code: 'P2002' });
  preference.language = 'en';
  const english = errorResponse({ code: 'P2002' });
  const [a, b] = await Promise.all([italian, english]);
  expect(a.status).toBe(409);
  expect(b.status).toBe(409);
  expect(await a.json()).toEqual({ error: "Il nome, il segmento URL o l'account esiste già." });
  expect(await b.json()).toEqual({ error: 'That name, slug or account already exists.' });
});
it('returns the original error even when locale resolution is unavailable', async () => {
  preference.unavailable = true;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await errorResponse(new Error('Synthetic internal detail'));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: 'The request could not be completed. Please try again.',
  });
});
