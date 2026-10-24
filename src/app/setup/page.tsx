import { getServerT } from '@/lib/server-locale';
import { db } from '@/lib/db';
import { getActor } from '@/lib/auth';
import { LanguageControl } from '@/components/locale';
export const dynamic = 'force-dynamic';
export async function generateMetadata() {
  const tr = await getServerT();
  return { title: tr('Setup'), robots: { index: false, follow: false } };
}
export default async function Setup() {
  const tr = await getServerT();
  const platform = await db.platformSettings.findUnique({ where: { id: 'main' } });
  const actor = await getActor();
  const configured = !!process.env.OSU_CLIENT_ID && !!process.env.OSU_CLIENT_SECRET;
  const count = await db.tournament.count();
  const state = !platform
    ? 'Awaiting initialization'
    : !configured
      ? 'Awaiting OAuth configuration'
      : !platform.ownerBootstrappedAt
        ? 'Awaiting designated owner sign-in'
        : !count
          ? 'Ready for your first tournament'
          : 'Configured';
  return (
    <main id="main" className="wrap max-w-2xl py-16 space-y-6">
      <div className="flex justify-end">
        <LanguageControl />
      </div>
      <h1 className="text-2xl font-semibold">{tr('Setup')}</h1>
      <p role="status">{tr(state)}</p>
      {actor?.platformAdmin ? (
        <a className="text-primary" href="/admin/tournaments">
          {tr('Open organizer workspace')}
        </a>
      ) : configured && platform ? (
        <a className="text-primary" href="/api/auth/login?returnTo=/setup">
          {tr('Login with osu!')}
        </a>
      ) : null}
      <a href="/" className="block text-muted">
        {tr('Tournaments')}
      </a>
    </main>
  );
}
