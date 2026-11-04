import { getServerT } from '@/lib/server-locale';
import { siteCopy } from '@/lib/copy';
import { ArrowUpRight } from 'lucide-react';
import { PublicNav } from '@/components/public-nav';
import { getActor } from '@/lib/auth';
import { getTournament } from '@/lib/queries';
import type { TournamentView } from '@/lib/types';
import { canAccessWorkspace } from '@/lib/workspace';
import { notFound } from 'next/navigation';
import { requestScope } from '@/lib/tournament-context';
import { db } from '@/lib/db';
import { themeStyle } from '@/lib/theme';
import styles from '@/components/tournament-profile.module.css';
import { TournamentProfileHeader } from '@/components/tournament-profile';
import { isPublicTournament } from '@/lib/public-visibility';
export const dynamic = 'force-dynamic';
export async function generateMetadata() {
  if (
    (await requestScope()).path === '/' &&
    (await db.platformSettings.findUnique({ where: { id: 'main' } }))?.rootMode === 'DIRECTORY'
  )
    return {};
  if ((await requestScope()).tournamentId === 'none') return {};
  const t = await getTournament();
  if (!isPublicTournament(t)) return { title: 'Tournament unavailable' };
  return {
    title: { default: t.name, template: `%s · ${t.acronym}` },
    description: t.description,
    // A present icons key replaces the inherited icons, even when it is undefined.
    ...(t.settings?.favicon ? { icons: { icon: t.settings.favicon } } : {}),
  };
}
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const tr = await getServerT();
  const scope = await requestScope();
  const directory =
    scope.path === '/' &&
    (await db.platformSettings.findUnique({ where: { id: 'main' } }))?.rootMode === 'DIRECTORY';
  if (directory || (scope.path === '/' && scope.tournamentId === 'none')) return children;
  if (scope.tournamentId === 'none') notFound();
  const [raw, actor] = await Promise.all([getTournament(), getActor()]);
  if (!isPublicTournament(raw)) notFound();
  const t = raw as unknown as TournamentView;
  return (
    <div
      className={styles.page}
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
      <TournamentProfileHeader tournament={t} />
      <main id="main" className="public-main min-h-[65vh]">
        {children}
      </main>
      <footer className="public-footer border-t">
        <div className={styles.footer}>
          {t.settings.footer && <p>{t.settings.footer}</p>}
          <nav aria-label={tr('Social links')}>
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
