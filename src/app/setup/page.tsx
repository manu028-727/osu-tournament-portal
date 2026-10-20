import { db } from '@/lib/db';
import { getActor } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Setup', robots: { index: false, follow: false } };
export default async function Setup() {
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
      <h1 className="text-2xl font-semibold">Setup</h1>
      <p role="status">{state}</p>
      {actor?.platformAdmin ? (
        <a className="text-primary" href="/admin/tournaments">
          Open organizer workspace
        </a>
      ) : configured && platform ? (
        <a className="text-primary" href="/api/auth/login?returnTo=/setup">
          Login with osu!
        </a>
      ) : null}
      <a href="/" className="block text-muted">
        Tournaments
      </a>
    </main>
  );
}
