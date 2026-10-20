import Link from '@/components/tournament-scope';
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
  return (
    <div
      style={
        {
          '--brand': t.settings.primaryColor,
          '--accent': t.settings.accentColor,
        } as React.CSSProperties
      }
    >
      <PublicNav
        name={t.name}
        acronym={t.acronym}
        logo={t.settings.logo}
        links={t.settings.navigation}
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
      <main id="main" className="min-h-[65vh] appear">
        {children}
      </main>
      <footer className="mt-12 border-t border-white/5">
        <div className="wrap grid gap-8 py-12 md:grid-cols-[1fr_auto]">
          <div>
            <Link href="/" className="text-lg font-semibold tracking-tight">
              {t.name}
              <span className="ml-2 text-primary">↗</span>
            </Link>
            <p className="mt-3 max-w-md text-xs text-muted">{t.settings.footer}</p>
          </div>
          <div className="flex flex-wrap gap-7 text-xs text-muted">
            {t.settings.socialLinks.map((l, i) => (
              <a
                key={i}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 self-start hover:text-primary"
              >
                {l.label}
                <ArrowUpRight size={12} />
              </a>
            ))}
          </div>
        </div>
        <div className="wrap flex flex-wrap justify-between gap-3 border-t border-white/5 py-6 text-[10px] text-white/30">
          <span>
            © {new Date().getUTCFullYear()} {t.name}
          </span>
          <span>{siteCopy(t.settings.copy).footerTagline}</span>
        </div>
      </footer>
    </div>
  );
}
