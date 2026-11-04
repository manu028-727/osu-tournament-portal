'use client';
import { useT } from '@/components/locale';
import { humanizeCode } from '@/lib/i18n';

import Link from '@/components/tournament-scope';
import { useCallback, useEffect, useState } from 'react';
import { Plus, ArrowUpRight, Archive, Eye, EyeOff, Settings, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Actor } from '@/lib/permissions';
import {
  api,
  Field,
  EditorPanel,
  SectionTitle,
  useTask,
  LoadingState,
  ConfirmButton,
} from './shared';
import { PlatformSettingsEditor, type PlatformConfig } from './platform-settings';
import { TournamentImporter } from './tournament-transfer';
import { DeleteTournamentDialog } from './delete-tournament-dialog';
import { SCORING_LABELS } from '@/lib/gameplay-scoring';
const suggestedSlug = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
const suggestedAcronym = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (/^\d+$/.test(word) ? word : word[0]))
    .join('')
    .toUpperCase()
    .slice(0, 20);
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
  const tr = useT();
  const [data, setData] = useState<{
      tournaments: Item[];
      users: { id: string; osuId: number; username: string; platformAdmin: boolean }[];
      platform: PlatformConfig | null;
    } | null>(null),
    [error, setError] = useState(''),
    [open, setOpen] = useState(false),
    [deleting, setDeleting] = useState<Item | null>(null);
  const { busy, run } = useTask();
  const [identity, setIdentity] = useState({ name: '', acronym: '', slug: '' });
  const [edited, setEdited] = useState({ acronym: false, slug: false });
  // Offers an acronym and address from the name, until the organizer types their own.
  const changeName = (name: string) =>
    setIdentity({
      name,
      acronym: edited.acronym ? identity.acronym : suggestedAcronym(name),
      slug: edited.slug ? identity.slug : suggestedSlug(name),
    });
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
      <SectionTitle
        title={tr('Tournaments')}
        description={tr('{0} workspaces', data.tournaments.length)}
      >
        <Button asChild variant="outline">
          <Link href="/tournaments">
            <ArrowUpRight size={17} />
            {tr('Public directory')}
          </Link>
        </Button>
        {actor.platformAdmin && <TournamentImporter onImported={reload} />}
        {actor.platformAdmin && (
          <Button onClick={() => setOpen(true)}>
            <Plus size={17} />
            {tr('Create tournament')}
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
                {t.gameMode} · {tr(humanizeCode(t.status))} ·{' '}
                {t.archivedAt ? tr('Archived') : t.published ? tr('Published') : tr('Private')}
              </p>
              <h2 className="my-2 text-xl font-semibold">{t.name}</h2>
              <p className="mb-5 text-sm text-muted">
                {t._count.stages} {tr('stages ·')} {t._count.teams} {tr('entrants ·')}{' '}
                {t.matchCount} {tr('matches')}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link href={`/t/${t.slug}/admin`}>
                    {tr('Open tournament')}
                    <ArrowUpRight size={16} />
                  </Link>
                </Button>
                <Button asChild size="icon" variant="outline">
                  <Link
                    title={tr('Tournament settings')}
                    aria-label={tr('Edit {0}', t.name)}
                    href={`/t/${t.slug}/admin/settings`}
                  >
                    <Settings size={17} />
                  </Link>
                </Button>
                {t.canPublish && (
                  <>
                    <ConfirmButton
                      title={
                        t.published ? tr('Hide this tournament?') : tr('Publish this tournament?')
                      }
                      description={tr('Content publication states are preserved.')}
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
                          tr('Visibility saved.'),
                        )
                      }
                    >
                      <span className="flex items-center gap-2">
                        {t.published ? <EyeOff size={16} /> : <Eye size={16} />}{' '}
                        {t.published ? tr('Hide') : tr('Publish')}
                      </span>
                    </ConfirmButton>
                    <ConfirmButton
                      title={t.archivedAt ? tr('Restore tournament?') : tr('Archive tournament?')}
                      description={tr('All content, teams and match histories will be retained.')}
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
                          tr('Lifecycle saved.'),
                        )
                      }
                    >
                      <Archive size={16} />
                      {t.archivedAt ? tr('Restore') : tr('Archive')}
                    </ConfirmButton>
                  </>
                )}
                {actor.platformAdmin && (
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => setDeleting(t)}
                  >
                    <Trash2 size={16} />
                    {tr('Delete')}
                  </Button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {!data.tournaments.length && (
        <p className="py-12 text-muted">
          {tr(
            actor.platformAdmin
              ? 'No tournaments yet.'
              : 'No tournament staff memberships assigned.',
          )}
        </p>
      )}
      {deleting && (
        <DeleteTournamentDialog
          tournament={deleting}
          close={() => setDeleting(null)}
          deleted={reload}
        />
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
            if (window.confirm(tr('Change this account’s platform-wide administrative access?')))
              void run(
                () =>
                  send({
                    type: 'platform-admin',
                    userId: form.get('userId'),
                    enabled: form.get('enabled') === 'on',
                  }),
                tr('Platform access updated.'),
              );
          }}
        >
          <h2 className="text-xl font-semibold">{tr('Platform administrators')}</h2>
          <p className="text-sm text-muted">
            {data.users
              .filter((u) => u.platformAdmin)
              .map((u) => u.username)
              .join(', ')}
          </p>
          <Field label={tr('Global osu! account')}>
            <select name="userId" required>
              <option value="">{tr('Select account')}</option>
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
            {tr('Platform administrator')}
          </label>
          <Button disabled={busy}>{tr('Apply platform access')}</Button>
        </form>
      )}
      <EditorPanel
        guardChanges
        busy={busy}
        title={tr('Create tournament')}
        open={open}
        onOpenChange={setOpen}
      >
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            const values = Object.fromEntries(new FormData(e.currentTarget));
            void run(async () => {
              await send({ type: 'create', ...values });
              setOpen(false);
              // Everything else about the tournament is set up on its own home page.
              window.location.assign(`/t/${String(values.slug)}/admin`);
            }, tr('Tournament created privately.'));
          }}
        >
          <Field label={tr('Name')}>
            <input
              name="name"
              required
              maxLength={120}
              value={identity.name}
              onChange={(e) => changeName(e.target.value)}
            />
          </Field>
          <Field label={tr('Acronym')}>
            <input
              name="acronym"
              required
              maxLength={20}
              value={identity.acronym}
              onChange={(e) => {
                setEdited({ ...edited, acronym: true });
                setIdentity({ ...identity, acronym: e.target.value });
              }}
            />
          </Field>
          <Field label={tr('URL slug')}>
            <input
              name="slug"
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              maxLength={80}
              value={identity.slug}
              onChange={(e) => {
                setEdited({ ...edited, slug: true });
                setIdentity({ ...identity, slug: e.target.value });
              }}
            />
          </Field>
          <Field label={tr('Game mode')}>
            <select name="gameMode">
              {['osu', 'taiko', 'fruits', 'mania'].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <details>
            <summary className="min-h-11 cursor-pointer py-2 text-sm">{tr('More options')}</summary>
            <div className="space-y-5 pt-2">
              <Field label={tr('Scoring System')}>
                <select name="gameplayScoring" defaultValue="SCORE_V2">
                  {Object.entries(SCORING_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {tr(label)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={tr('Timezone')}>
                <input name="timezone" defaultValue={data.platform?.timezone || 'UTC'} required />
              </Field>
              <Field label={tr('Description')}>
                <textarea name="description" maxLength={2000} />
              </Field>
            </div>
          </details>
          <Button disabled={busy}>{tr('Create tournament')}</Button>
        </form>
      </EditorPanel>
    </>
  );
}
