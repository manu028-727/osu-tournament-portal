import { cache } from 'react';
import { cookies } from 'next/headers';
import { db } from './db';
import { locale, translator } from './i18n';

export const getLocale = cache(async () => {
  const cookie = (await cookies()).get('portal_language')?.value;
  if (cookie === 'en' || cookie === 'it') return cookie;
  const platform = await db.platformSettings.findUnique({
    where: { id: 'main' },
    select: { locale: true },
  });
  return locale(cookie, platform?.locale);
});
export async function getServerT() {
  return translator(await getLocale());
}
