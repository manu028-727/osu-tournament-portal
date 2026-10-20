import type { Metadata } from 'next';
import './globals.css';
import { TournamentScope } from '@/components/tournament-scope';
import { requestScope } from '@/lib/tournament-context';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
export const dynamic = 'force-dynamic';
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
  let scope;
  try {
    scope = await requestScope();
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e && e.status === 404) notFound();
    throw e;
  }
  const platform = await db.platformSettings.findUnique({ where: { id: 'main' } });
  return (
    <html lang={platform?.locale || 'en'}>
      <body
        style={
          {
            '--brand': platform?.primaryColor,
            '--accent': platform?.accentColor,
          } as React.CSSProperties
        }
      >
        <a
          href="#main"
          className="fixed -top-20 left-4 z-[100] rounded bg-primary px-4 py-2 text-black focus:top-4"
        >
          Skip to content
        </a>
        <TournamentScope key={scope.tournamentId} value={scope}>
          {children}
        </TournamentScope>
      </body>
    </html>
  );
}
