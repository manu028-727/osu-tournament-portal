import { siteCopy } from '@/lib/copy';
import { ArrowUpRight } from 'lucide-react';
import { PublicNav } from '@/components/public-nav';
import { getActor } from '@/lib/auth';
import { getTournament, publicPage } from '@/lib/queries';
import type { PageContent, TournamentView } from '@/lib/types';
import { canAccessWorkspace } from '@/lib/workspace';
import { notFound } from 'next/navigation';
import { requestScope } from '@/lib/tournament-context';
import { db } from '@/lib/db';
import { themeStyle } from '@/lib/theme';
import pilot from '@/components/home-pilot.module.css';
import { TournamentProfileHeader } from '@/components/home-content';
export const dynamic = 'force-dynamic';
export async function generateMetadata() {
  if (
    (await requestScope()).path === '/' &&
    (await db.platformSettings.findUnique({ where: { id: 'main' } }))?.rootMode === 'DIRECTORY'
  )
    return {};
  if ((await requestScope()).tournamentId === 'none') return {};
  const t = await getTournament();
  if (!t.published) return { title: 'Tournament unavailable' };
  return {
    title: { default: t.name, template: `%s · ${t.acronym}` },
    description: t.description,
    icons: t.settings?.favicon ? { icon: t.settings.favicon } : undefined,
  };
}
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const scope = await requestScope();
  const directory =
    scope.path === '/' &&
    (await db.platformSettings.findUnique({ where: { id: 'main' } }))?.rootMode === 'DIRECTORY';
  if (directory || (scope.path === '/' && scope.tournamentId === 'none')) return children;
  if (scope.tournamentId === 'none') notFound();
  const [raw, actor] = await Promise.all([getTournament(), getActor()]);
  if (!raw.published) notFound();
  const t = raw as unknown as TournamentView;
  const home = await publicPage('home');
  return (
    <div
      className={pilot.page}
      style={themeStyle(t.settings.primaryColor, t.settings.accentColor) as React.CSSProperties}
    >
      <PublicNav
        user={
          actor
            ? {
                username: actor.username,
                avatarUrl: actor.avatarUrl,
                osuId: actor.osuId,
                workspace: canAccessWorkspace(actor) || !!actor.workspaceAny,
              }
            : undefined
        }
      />
      <TournamentProfileHeader page={home as PageContent | null} tournament={t} />
      <main id="main" className="public-main min-h-[65vh]">
        {children}
      </main>
      <footer className="public-footer border-t">
        <div className={pilot.footer}>
          {t.settings.footer && <p>{t.settings.footer}</p>}
          <nav aria-label="Social links">
            {t.settings.socialLinks.map((link, i) => (
              <a key={i} href={link.href} target="_blank" rel="noopener noreferrer">
                {link.label}
                <ArrowUpRight size={14} />
              </a>
            ))}
          </nav>
          {siteCopy(t.settings.copy).footerTagline && (
            <p>{siteCopy(t.settings.copy).footerTagline}</p>
          )}
        </div>
      </footer>
    </div>
  );
}
