import { getActor } from '@/lib/auth';
import { getTournament } from '@/lib/queries';
import { AdminShell } from '@/components/admin/shell';
import { Button } from '@/components/ui/button';
import { Shield, ArrowUpRight } from 'lucide-react';
import { redirect } from 'next/navigation';
import { canAccessWorkspace } from '@/lib/workspace';
import { requestScope } from '@/lib/tournament-context';
import { themeStyle } from '@/lib/theme';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Organizer workspace', robots: { index: false, follow: false } };
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  const scope = await requestScope();
  if (!actor)
    return (
      <main id="main" className="flex min-h-screen items-center justify-center p-6">
        <div className="card w-full max-w-md p-10 text-center">
          <Shield className="mx-auto mb-6 text-primary" size={30} />
          <p className="eyebrow mb-3">ORGANIZER WORKSPACE</p>
          <h1 className="text-2xl font-semibold">Organizer sign in</h1>
          <p className="mb-8 mt-4 text-sm text-muted">
            Sign in with your osu! account to access your tournament workspace.
          </p>
          <Button asChild>
            <a href={`/api/auth/login?returnTo=${encodeURIComponent(scope.path)}`}>
              Login with osu!
              <ArrowUpRight size={15} />
            </a>
          </Button>
          <a href="/" className="mt-6 block text-xs text-muted">
            Back to the tournament
          </a>
        </div>
      </main>
    );
  if (scope.path === '/admin/tournaments') {
    if (!actor.workspaceAny && !actor.platformAdmin) redirect('/?notice=workspace-restricted');
    return (
      <AdminShell actor={actor} name="Tournament platform" acronym="osu!" platform>
        {children}
      </AdminShell>
    );
  }
  if (scope.tournamentId === 'none') redirect('/admin/tournaments');
  if (!canAccessWorkspace(actor))
    redirect(actor.workspaceAny ? '/admin/tournaments' : '/?notice=workspace-restricted');
  const t = await getTournament();
  return (
    <div
      style={themeStyle(t.settings?.primaryColor, t.settings?.accentColor) as React.CSSProperties}
    >
      <AdminShell actor={actor} name={t.name} acronym={t.acronym}>
        {children}
      </AdminShell>
    </div>
  );
}
