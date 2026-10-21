'use client';
import Link from '@/components/tournament-scope';
import { useCallback, useEffect, useState } from 'react';
import { Plus, ArrowUpRight, Archive, Eye, EyeOff, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Actor } from '@/lib/permissions';
import { api, Field, Modal, SectionTitle, useTask, LoadingState, ConfirmButton } from './shared';
import { PlatformSettingsEditor, type PlatformConfig } from './platform-settings';
import { TournamentImporter } from './tournament-transfer';
import { SCORING_LABELS } from '@/lib/gameplay-scoring';
type Item = {
  canPublish: boolean;
  matchCount: number;
  id: string;
  name: string;
  acronym: string;
  slug: string;
  gameMode: string;
  status: string;
  published: boolean;
  archivedAt: string | null;
  version: number;
  settings: { banner: string; logo: string } | null;
  _count: { stages: number; teams: number };
};
export function TournamentsEditor({ actor }: { actor: Actor }) {
  const [data, setData] = useState<{
      tournaments: Item[];
      users: { id: string; osuId: number; username: string; platformAdmin: boolean }[];
      platform: PlatformConfig | null;
    } | null>(null),
    [error, setError] = useState(''),
    [open, setOpen] = useState(false);
  const { busy, run } = useTask();
  const reload = useCallback(async () => {
    try {
      setData(await api('/api/tournaments'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const send = async (body: unknown) => {
    const result = await api<{ id: string }>('/api/tournaments', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    await reload();
    return result;
  };
  if (!data) return <LoadingState error={error} retry={() => void reload()} />;
  return (
    <>
      <SectionTitle title="Tournaments" description={`${data.tournaments.length} workspaces`}>
        <Button asChild variant="outline">
          <Link href="/tournaments">
            <ArrowUpRight size={17} />
            Public directory
          </Link>
        </Button>
        {actor.platformAdmin && <TournamentImporter onImported={reload} />}
        {actor.platformAdmin && (
          <Button onClick={() => setOpen(true)}>
            <Plus size={17} />
            Create tournament
          </Button>
        )}
      </SectionTitle>
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        {data.tournaments.map((t) => (
          <article key={t.id} className="card min-w-0 overflow-hidden">
            {t.settings?.banner && (
              <img src={t.settings.banner} alt="" className="h-32 w-full object-cover" />
            )}
            <div className="p-5">
              <p className="text-xs text-muted">
                {t.gameMode} · {t.status} ·{' '}
                {t.archivedAt ? 'Archived' : t.published ? 'Published' : 'Private'}
              </p>
              <h2 className="my-2 text-xl font-semibold">{t.name}</h2>
              <p className="mb-5 text-sm text-muted">
                {t._count.stages} stages · {t._count.teams} entrants · {t.matchCount} matches
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link href={`/t/${t.slug}/admin`}>
                    Open tournament
                    <ArrowUpRight size={16} />
                  </Link>
                </Button>
                <Button asChild size="icon" variant="outline">
                  <Link
                    title="Tournament settings"
                    aria-label={`Edit ${t.name}`}
                    href={`/t/${t.slug}/admin/settings`}
                  >
                    <Settings size={17} />
                  </Link>
                </Button>
                {t.canPublish && (
                  <>
                    <ConfirmButton
                      title={t.published ? 'Hide this tournament?' : 'Publish this tournament?'}
                      description="Content publication states are preserved."
                      onConfirm={() =>
                        run(
                          () =>
                            send({
                              type: 'lifecycle',
                              id: t.id,
                              baseVersion: t.version,
                              published: !t.published,
                              archived: !!t.archivedAt,
                            }),
                          'Visibility saved.',
                        )
                      }
                    >
                      <span className="flex items-center gap-2">
                        {t.published ? <EyeOff size={16} /> : <Eye size={16} />}{' '}
                        {t.published ? 'Hide' : 'Publish'}
                      </span>
                    </ConfirmButton>
                    <ConfirmButton
                      title={t.archivedAt ? 'Restore tournament?' : 'Archive tournament?'}
                      description="All content, teams and match histories will be retained."
                      onConfirm={() =>
                        run(
                          () =>
                            send({
                              type: 'lifecycle',
                              id: t.id,
                              baseVersion: t.version,
                              published: t.published,
                              archived: !t.archivedAt,
                            }),
                          'Lifecycle saved.',
                        )
                      }
                    >
                      <Archive size={16} />
                      {t.archivedAt ? 'Restore' : 'Archive'}
                    </ConfirmButton>
                  </>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {!data.tournaments.length && (
        <p className="py-12 text-muted">No tournament staff memberships assigned.</p>
      )}
      {data.platform && actor.platformAdmin && (
        <PlatformSettingsEditor
          platform={data.platform}
          tournaments={data.tournaments}
          onSave={send}
        />
      )}
      {actor.platformAdmin && (
        <form
          className="mt-8 space-y-5 border-t pt-6"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            if (window.confirm('Change this account’s platform-wide administrative access?'))
              void run(
                () =>
                  send({
                    type: 'platform-admin',
                    userId: form.get('userId'),
                    enabled: form.get('enabled') === 'on',
                  }),
                'Platform access updated.',
              );
          }}
        >
          <h2 className="text-xl font-semibold">Platform administrators</h2>
          <p className="text-sm text-muted">
            {data.users
              .filter((u) => u.platformAdmin)
              .map((u) => u.username)
              .join(', ')}
          </p>
          <Field label="Global osu! account">
            <select name="userId" required>
              <option value="">Select account</option>
              {data.users
                .filter((u) => u.id !== actor.id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username} · {u.osuId}
                  </option>
                ))}
            </select>
          </Field>
          <label className="flex items-center gap-3">
            <input type="checkbox" name="enabled" />
            Platform administrator
          </label>
          <Button disabled={busy}>Apply platform access</Button>
        </form>
      )}
      <Modal title="Create tournament" open={open} onOpenChange={setOpen}>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            const values = Object.fromEntries(new FormData(e.currentTarget));
            void run(async () => {
              await send({ type: 'create', ...values });
              setOpen(false);
            }, 'Tournament created privately.');
          }}
        >
          <Field label="Name">
            <input name="name" required maxLength={120} />
          </Field>
          <Field label="Acronym">
            <input name="acronym" required maxLength={20} />
          </Field>
          <Field label="URL slug">
            <input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} />
          </Field>
          <Field label="Game mode">
            <select name="gameMode">
              {['osu', 'taiko', 'fruits', 'mania'].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Format">
            <select name="format">
              <option value="TEAMS">Teams</option>
              <option value="SOLO">1v1</option>
              <option value="CUSTOM">Custom</option>
            </select>
          </Field>
          <Field label="Scoring System">
            <select name="gameplayScoring" defaultValue="SCORE_V2">
              {Object.entries(SCORING_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Timezone">
            <input name="timezone" defaultValue={data.platform?.timezone || 'UTC'} required />
          </Field>
          <Field label="Description">
            <textarea name="description" maxLength={2000} />
          </Field>
          <Button disabled={busy}>Create tournament</Button>
        </form>
      </Modal>
    </>
  );
}
