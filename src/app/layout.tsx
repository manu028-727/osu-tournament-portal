import { getLocale, getServerT } from '@/lib/server-locale';
import { LocaleProvider } from '@/components/locale';
import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { appearance, themeStyle } from '@/lib/theme';
import { AppearanceProvider } from '@/components/appearance';
import { cookies } from 'next/headers';
import './globals.css';
import { TournamentScope } from '@/components/tournament-scope';
import { requestScope } from '@/lib/tournament-context';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
export const dynamic = 'force-dynamic';
const sans = localFont({
  src: [
    { path: '../../public/fonts/IBMPlexSans-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../../public/fonts/IBMPlexSans-SemiBold.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-interface',
  display: 'swap',
});
const mono = localFont({
  src: '../../public/fonts/IBMPlexMono-Regular.woff2',
  variable: '--font-data',
  display: 'swap',
  preload: false,
});
export async function generateMetadata(): Promise<Metadata> {
  const platform = await db.platformSettings.findUnique({ where: { id: 'main' } });
  return {
    title: platform?.name || 'osu! Tournament Platform',
    description: platform?.description || '',
    metadataBase: new URL(process.env.APP_URL || 'http://localhost:3000'),
    icons: platform?.favicon ? { icon: platform.favicon } : undefined,
    openGraph: platform?.socialImage ? { images: [platform.socialImage] } : undefined,
  };
}
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const tr = await getServerT();
  let scope;
  try {
    scope = await requestScope();
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e && e.status === 404) notFound();
    throw e;
  }
  const platform = await db.platformSettings.findUnique({ where: { id: 'main' } });
  const preference = appearance((await cookies()).get('portal_appearance')?.value);
  return (
    <html lang={await getLocale()} data-appearance={preference}>
      <body
        className={`${sans.variable} ${mono.variable}`}
        style={themeStyle(platform?.primaryColor, platform?.accentColor) as React.CSSProperties}
      >
        <a
          href="#main"
          className="fixed -top-20 left-4 z-[100] rounded-xl bg-primary px-4 py-2 text-[var(--brand-ink)] focus:top-4"
        >
          {tr('Skip to content')}
        </a>
        <LocaleProvider initial={await getLocale()}>
          <AppearanceProvider initial={preference}>
            <TournamentScope key={scope.tournamentId} value={scope}>
              {children}
            </TournamentScope>
          </AppearanceProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
