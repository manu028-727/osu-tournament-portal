'use client';
import { tournamentApiUrl } from '@/components/tournament-scope';
import { useState } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Users,
  Upload,
  Download,
  Search,
  Eye,
  Save,
  X,
  FileSpreadsheet,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { can, type Actor } from '@/lib/permissions';
import type { TeamView } from '@/lib/teams-types';
import type { TeamImportPlan } from '@/lib/teams-service';
import { TEAM_CSV_COLUMNS } from '@/lib/teams-csv';
import { slugify } from '@/lib/utils';
import { MediaField } from './media';
import {
  action,
  api,
  Field,
  LoadingState,
  Modal,
  SectionTitle,
  SaveButton,
  ConfirmButton,
  useResource,
  useTask,
  useUnsaved,
} from './shared';

type Profile = { id: number; username: string; avatar_url: string };
const empty = (): TeamView => ({
  id: '',
  version: 0,
  name: '',
  slug: '',
  description: '',
  format: 'TEAM',
  seed: null,
  position: 0,
  logoImageId: null,
  members: [],
  status: 'PENDING',
  published: false,
});
export function TeamsEditor({ actor }: { actor: Actor }) {
  const { data, error, reload } = useResource<TeamView[]>('teams');
  const { run, busy, notify } = useTask();
  const [draft, setDraft] = useState<TeamView | null>(null),
    [dirty, setDirty] = useState(false),
    [query, setQuery] = useState(''),
    [profile, setProfile] = useState<Profile | null>(null),
    [filter, setFilter] = useState('');
  const [visibility, setVisibility] = useState<TeamView | null>(null),
    [importOpen, setImportOpen] = useState(false),
    [csv, setCsv] = useState(''),
    [preview, setPreview] = useState<TeamImportPlan | null>(null);
  useUnsaved(dirty);
  const update = (fields: Partial<TeamView>) => {
    setDraft((d) => (d ? { ...d, ...fields } : null));
    setDirty(true);
  };
  const close = () => {
    if (!dirty || window.confirm('Discard unsaved team changes?')) {
      setDraft(null);
      setDirty(false);
    }
  };
  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  return (
    <>
      <SectionTitle title="Teams & players" description={`${data.length} registered entries`}>
        <div className="flex flex-wrap gap-2">
          {(can(actor, 'teams.view') || can(actor, 'teams.import')) && (
            <Button asChild variant="outline" size="sm">
              <a href={tournamentApiUrl('/api/admin/teams/export')}>
                <Download size={17} />
                Export CSV
              </a>
            </Button>
          )}
          {can(actor, 'teams.import') && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCsv('');
                setPreview(null);
                setImportOpen(true);
              }}
            >
              <Upload size={17} />
              Import CSV
            </Button>
          )}
          {can(actor, 'teams.create') && (
            <Button
              size="sm"
              onClick={() => {
                setDraft(empty());
                setProfile(null);
                setQuery('');
                setDirty(false);
              }}
            >
              <Plus size={17} />
              New team
            </Button>
          )}
        </div>
      </SectionTitle>
      <Field label="Search teams or players">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} type="search" />
      </Field>
      <div className="mt-6 overflow-x-auto">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Team</th>
              <th>Roster</th>
              <th>Registration</th>
              <th>Public</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data
              .filter((t) =>
                `${t.name} ${t.members.map((m) => m.participant.username).join(' ')}`
                  .toLowerCase()
                  .includes(filter.toLowerCase()),
              )
              .map((t) => (
                <tr key={t.id}>
                  <td>
                    <div className="flex min-w-40 items-center gap-3">
                      {t.logoImageId ? (
                        <img
                          src={`/api/media/${t.logoImageId}`}
                          alt=""
                          className="size-10 rounded-md object-cover"
                        />
                      ) : (
                        <Users size={22} className="shrink-0 text-primary" />
                      )}
                      <div>
                        <p className="font-semibold">{t.name}</p>
                        <p className="text-xs text-muted">
                          {t.format === 'INDIVIDUAL' ? 'Solo' : 'Team'}
                          {t.seed ? ` · Seed ${t.seed}` : ''}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="min-w-36 space-y-1">
                      {t.members.map((m) => (
                        <p key={m.osuId} className="text-xs">
                          {m.participant.username}
                          {m.captain ? ' · Captain' : m.substitute ? ' · Substitute' : ''}
                        </p>
                      ))}
                    </div>
                  </td>
                  <td>
                    <Badge>{t.status}</Badge>
                  </td>
                  <td>{t.published ? 'Published' : 'Hidden'}</td>
                  <td>
                    <div className="flex gap-1">
                      {can(actor, 'teams.edit') && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${t.name}`}
                          title="Edit team"
                          onClick={() => {
                            setDraft(structuredClone(t));
                            setDirty(false);
                            setProfile(null);
                            setQuery('');
                          }}
                        >
                          <Pencil size={18} />
                        </Button>
                      )}
                      {can(actor, 'teams.publish') && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Publication ${t.name}`}
                          title="Approval and visibility"
                          onClick={() => setVisibility({ ...t })}
                        >
                          <Eye size={18} />
                        </Button>
                      )}
                      {can(actor, 'teams.delete') && (
                        <ConfirmButton
                          title={`Delete ${t.name}?`}
                          description="Teams used in matches cannot be deleted. Hide them to retain their history."
                          disabled={busy}
                          onConfirm={() =>
                            void run(async () => {
                              await action({
                                type: 'team.delete',
                                id: t.id,
                                baseVersion: t.version,
                              });
                              await reload();
                            }, 'Team deleted.')
                          }
                        >
                          <Trash2 size={18} />
                        </ConfirmButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!data.length && (
        <div className="py-14 text-center text-muted">
          <Users size={32} className="mx-auto mb-4" />
          No registered teams.
        </div>
      )}
      <Modal
        open={!!draft}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title={draft?.id ? 'Edit team' : 'New team'}
        wide
      >
        {draft && (
          <form
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await action({
                  ...draft,
                  type: 'team.save',
                  id: draft.id || undefined,
                  baseVersion: draft.version,
                  members: draft.members.map(({ osuId, captain, substitute, discordId }) => ({
                    osuId,
                    captain,
                    substitute,
                    discordId,
                  })),
                });
                setDirty(false);
                setDraft(null);
                await reload();
              }, 'Team saved.');
            }}
          >
            <div className="grid-fields">
              <Field label="Team name">
                <input
                  required
                  maxLength={120}
                  value={draft.name}
                  onChange={(e) =>
                    update({
                      name: e.target.value,
                      ...(!draft.id ? { slug: slugify(e.target.value) } : {}),
                    })
                  }
                />
              </Field>
              <Field label="Team slug">
                <input
                  required
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  value={draft.slug}
                  onChange={(e) => update({ slug: e.target.value })}
                />
              </Field>
              <Field label="Format">
                <select
                  value={draft.format}
                  onChange={(e) => update({ format: e.target.value as TeamView['format'] })}
                >
                  <option value="TEAM">Team</option>
                  <option value="INDIVIDUAL">Individual / 1v1</option>
                </select>
              </Field>
              <Field label="Seed">
                <input
                  type="number"
                  min={1}
                  value={draft.seed || ''}
                  onChange={(e) => update({ seed: e.target.value ? Number(e.target.value) : null })}
                />
              </Field>
              <Field label="Display order">
                <input
                  type="number"
                  min={0}
                  value={draft.position}
                  onChange={(e) => update({ position: Number(e.target.value) })}
                />
              </Field>
            </div>
            <Field label="Team description">
              <textarea
                maxLength={4000}
                value={draft.description}
                onChange={(e) => update({ description: e.target.value })}
              />
            </Field>
            <MediaField
              label="Team logo"
              value={draft.logoImageId ? `/api/media/${draft.logoImageId}` : ''}
              canUpload={can(actor, 'media.upload')}
              onChange={(url) => {
                const id = /^\/api\/media\/([a-zA-Z0-9_-]+)$/.exec(url)?.[1];
                if (url && !id) {
                  notify('Select a logo from the media library.', true);
                  return;
                }
                update({ logoImageId: id || null });
              }}
            />
            {draft.logoImageId && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => update({ logoImageId: null })}
              >
                <Trash2 size={17} />
                Remove logo
              </Button>
            )}
            <section className="border-t pt-6">
              <h2 className="mb-4 text-xl font-semibold">Player roster</h2>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Field label="osu! ID or username">
                    <input
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setProfile(null);
                      }}
                    />
                  </Field>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !query.trim()}
                  onClick={() =>
                    void run(async () => {
                      setProfile(
                        await api<Profile>(`/api/admin/players?q=${encodeURIComponent(query)}`),
                      );
                    }, 'osu! profile verified.')
                  }
                >
                  <Search size={17} />
                  Look up
                </Button>
              </div>
              {profile && (
                <div className="my-4 flex flex-wrap items-center gap-3 border-y py-4">
                  <img src={profile.avatar_url} alt="" className="size-11 rounded-md" />
                  <span className="min-w-0 flex-1 break-words">
                    {profile.username} · #{profile.id}
                  </span>
                  <Button
                    type="button"
                    disabled={draft.members.some((m) => m.osuId === profile.id)}
                    onClick={() => {
                      update({
                        members: [
                          ...draft.members,
                          {
                            osuId: profile.id,
                            captain: !draft.members.length,
                            substitute: false,
                            participant: {
                              osuId: profile.id,
                              username: profile.username,
                              avatarUrl: profile.avatar_url,
                              country: null,
                            },
                          },
                        ],
                      });
                      setProfile(null);
                      setQuery('');
                    }}
                  >
                    <Plus size={17} />
                    Add player
                  </Button>
                </div>
              )}
              <div className="mt-5 space-y-3">
                {draft.members.map((m) => (
                  <div key={m.osuId} className="flex flex-wrap items-center gap-4 border-b pb-4">
                    <img src={m.participant.avatarUrl} alt="" className="size-10 rounded-md" />
                    <a
                      className="min-w-28 flex-1 break-words text-primary"
                      href={`https://osu.ppy.sh/users/${m.osuId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {m.participant.username}
                    </a>
                    <Field label={`Discord user ID for ${m.participant.username}`}>
                      <input
                        inputMode="numeric"
                        value={m.discordId || ''}
                        onChange={(e) =>
                          update({
                            members: draft.members.map((p) =>
                              p.osuId === m.osuId ? { ...p, discordId: e.target.value } : p,
                            ),
                          })
                        }
                      />
                    </Field>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="team-captain"
                        checked={m.captain}
                        onChange={() =>
                          update({
                            members: draft.members.map((p) => ({
                              ...p,
                              captain: p.osuId === m.osuId,
                              substitute: p.osuId === m.osuId ? false : p.substitute,
                            })),
                          })
                        }
                      />
                      Captain
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={m.substitute}
                        disabled={m.captain}
                        onChange={(e) =>
                          update({
                            members: draft.members.map((p) =>
                              p.osuId === m.osuId ? { ...p, substitute: e.target.checked } : p,
                            ),
                          })
                        }
                      />
                      Substitute
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${m.participant.username}`}
                      title="Remove player"
                      onClick={() =>
                        update({ members: draft.members.filter((p) => p.osuId !== m.osuId) })
                      }
                    >
                      <X size={18} />
                    </Button>
                  </div>
                ))}
              </div>
            </section>
            <SaveButton busy={busy}>
              <Save size={17} />
              Save team
            </SaveButton>
          </form>
        )}
      </Modal>
      <Modal
        open={!!visibility}
        onOpenChange={(open) => {
          if (!open) setVisibility(null);
        }}
        title="Approval & visibility"
      >
        {visibility && (
          <form
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await action({
                  type: 'team.status',
                  id: visibility.id,
                  baseVersion: visibility.version,
                  status: visibility.status,
                  published: visibility.published,
                });
                setVisibility(null);
                await reload();
              }, 'Team visibility updated.');
            }}
          >
            <p className="font-semibold">{visibility.name}</p>
            <Field label="Registration status">
              <select
                value={visibility.status}
                onChange={(e) =>
                  setVisibility({
                    ...visibility,
                    status: e.target.value as TeamView['status'],
                    published: e.target.value === 'APPROVED' && visibility.published,
                  })
                }
              >
                <option value="PENDING">Pending</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </Field>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={visibility.published}
                disabled={visibility.status !== 'APPROVED'}
                onChange={(e) => setVisibility({ ...visibility, published: e.target.checked })}
              />
              Published on the tournament website
            </label>
            <SaveButton busy={busy}>Save visibility</SaveButton>
          </form>
        )}
      </Modal>
      <Modal open={importOpen} onOpenChange={setImportOpen} title="Import teams CSV" wide>
        <div className="space-y-5">
          <Field label="CSV file">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void run(async () => {
                    if (file.size > 250000) throw new Error('Choose a CSV up to 250 KB.');
                    setCsv(await file.text());
                    setPreview(null);
                  }, 'CSV loaded.');
              }}
            />
          </Field>
          <Field label="CSV content">
            <textarea
              value={csv}
              className="min-h-48 font-mono"
              placeholder={TEAM_CSV_COLUMNS.join(',')}
              onChange={(e) => {
                setCsv(e.target.value);
                setPreview(null);
              }}
            />
          </Field>
          <Button
            variant="outline"
            disabled={busy || !csv.trim()}
            onClick={() =>
              void run(async () => {
                setPreview(await action<TeamImportPlan>({ type: 'team.import.preview', csv }));
              }, 'Import preview ready.')
            }
          >
            <FileSpreadsheet size={17} />
            Preview import
          </Button>
          {preview && (
            <div className="space-y-4">
              {preview.errors.length ? (
                <ul role="alert" className="list-inside list-disc text-red-200">
                  {preview.errors.map((message, i) => (
                    <li key={i}>{message}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-accent">
                  {preview.teams.length} valid teams · {preview.profiles.length} verified players
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Team</th>
                      <th>Players</th>
                      <th>Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.teams.map((t) => (
                      <tr key={t.slug}>
                        <td>{t.name}</td>
                        <td>
                          {t.members
                            .map(
                              (m) =>
                                preview.profiles.find((p) => p.id === m.osuId)?.username || m.osuId,
                            )
                            .join(', ')}
                        </td>
                        <td>{t.id ? 'Update roster' : 'Create hidden entry'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ConfirmButton
                variant="default"
                title="Apply this import?"
                description="Existing approval and publication settings are preserved. New teams remain hidden."
                disabled={busy || !!preview.errors.length}
                onConfirm={() =>
                  void run(async () => {
                    await action({
                      type: 'team.import.apply',
                      csv,
                      previewHash: preview.previewHash,
                    });
                    setImportOpen(false);
                    setPreview(null);
                    await reload();
                  }, 'Teams imported.')
                }
              >
                <Upload size={17} />
                Apply import
              </ConfirmButton>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
