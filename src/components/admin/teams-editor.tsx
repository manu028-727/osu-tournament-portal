'use client';
import { Feedback, useT } from '@/components/locale';
import { humanizeCode } from '@/lib/i18n';

import Link, { tournamentApiUrl } from '@/components/tournament-scope';
import { useCallback, useState } from 'react';
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
import { TeamInlineIdentity } from './team-inline-identity';
import { MediaField } from './media';
import { ListPagination } from '../list-pagination';
import type { ListPage } from '@/lib/list-pagination';
import {
  action,
  api,
  Field,
  LoadingState,
  EditorPanel,
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
  const tr = useT();
  const bulkAllowed = can(actor, 'teams.publish') || can(actor, 'teams.delete');
  const { run, busy, notify } = useTask();
  const [draft, setDraft] = useState<TeamView | null>(null),
    [dirty, setDirty] = useState(false),
    [query, setQuery] = useState(''),
    [profile, setProfile] = useState<Profile | null>(null),
    [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [inlineDirty, setInlineDirty] = useState<Set<string>>(new Set());
  const [inlineEpoch, setInlineEpoch] = useState(0);
  const inlineChanged = useCallback(
    (id: string, dirty: boolean) =>
      setInlineDirty((current) => {
        if (current.has(id) === dirty) return current;
        const next = new Set(current);
        if (dirty) next.add(id);
        else next.delete(id);
        return next;
      }),
    [],
  );
  const leaveInline = () => {
    if (!inlineDirty.size) return true;
    if (!window.confirm(tr('Discard unsaved team changes?'))) return false;
    setInlineEpoch((n) => n + 1);
    setInlineDirty(new Set());
    return true;
  };
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [bulkOperation, setBulkOperation] = useState(
    can(actor, 'teams.publish') ? 'APPROVE' : 'DELETE',
  );
  const [bulkReason, setBulkReason] = useState('');
  const {
    data: result,
    error,
    reload,
    loading,
  } = useResource<ListPage<TeamView>>(
    `teams&paged=1&page=${page}&q=${encodeURIComponent(filter)}`,
    true,
  );
  const data = result?.items;
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
    if (!dirty || window.confirm(tr('Discard unsaved team changes?'))) {
      setDraft(null);
      setDirty(false);
    }
  };
  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  return (
    <>
      <SectionTitle
        title={tr('Teams & players')}
        description={tr(filter ? '{0} matching entries' : '{0} registered entries', result!.total)}
      >
        <div className="flex flex-wrap gap-2">
          {can(actor, 'settings.manage') && (
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/settings#registration">{tr('Registration settings')}</Link>
            </Button>
          )}
          {(can(actor, 'teams.view') || can(actor, 'teams.import')) && (
            <Button asChild variant="outline" size="sm">
              <a href={tournamentApiUrl('/api/admin/teams/export')}>
                <Download size={17} />
                {tr('Export CSV')}
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
              {tr('Import CSV')}
            </Button>
          )}
          {can(actor, 'teams.create') && (
            <Button
              size="sm"
              onClick={() => {
                if (dirty && !window.confirm(tr('Discard unsaved team changes?'))) return;
                setDraft(empty());
                setProfile(null);
                setQuery('');
                setDirty(false);
              }}
            >
              <Plus size={17} />
              {tr('New team')}
            </Button>
          )}
        </div>
      </SectionTitle>
      <Field label={tr('Search teams or players')}>
        <input
          value={filter}
          maxLength={100}
          onChange={(e) => {
            if (!leaveInline()) return;
            setSelectedTeams([]);
            setFilter(e.target.value);
            setPage(1);
          }}
          type="search"
        />
      </Field>
      {(can(actor, 'teams.publish') || can(actor, 'teams.delete')) && (
        <div className="my-3 flex flex-wrap items-end gap-2">
          <span className="text-sm">{tr('{0} selected', selectedTeams.length)}</span>
          <Field label={tr('Bulk team action')}>
            <select value={bulkOperation} onChange={(e) => setBulkOperation(e.target.value)}>
              {can(actor, 'teams.publish') && (
                <>
                  <option value="APPROVE">{tr('Approve and publish')}</option>
                  <option value="REJECT">{tr('Reject with public reason')}</option>
                  <option value="PUBLISH">{tr('Publish')}</option>
                  <option value="HIDE">{tr('Hide')}</option>
                </>
              )}
              {can(actor, 'teams.delete') && (
                <option value="DELETE">{tr('Delete unused entrants')}</option>
              )}
            </select>
          </Field>
          {bulkOperation === 'REJECT' && (
            <Field label={tr('Public rejection reason')}>
              <input
                minLength={3}
                maxLength={2000}
                value={bulkReason}
                onChange={(e) => setBulkReason(e.target.value)}
              />
            </Field>
          )}
          <ConfirmButton
            title={tr('Apply to {0} entrants?', selectedTeams.length)}
            description={tr(
              bulkOperation === 'DELETE'
                ? 'Only unused entrants can be deleted. If any selected entrant has competition history, nothing is deleted.'
                : 'The selected registration statuses and public visibility will change together. Tournament reservations remain separate.',
            )}
            disabled={
              busy ||
              !selectedTeams.length ||
              (bulkOperation === 'REJECT' && bulkReason.trim().length < 3)
            }
            onConfirm={() =>
              void run(async () => {
                await action({
                  type: 'team.bulk',
                  entries: data
                    .filter((t) => selectedTeams.includes(t.id))
                    .map((t) => ({ id: t.id, baseVersion: t.version })),
                  operation: bulkOperation,
                  rejectionReason: bulkReason,
                });
                setSelectedTeams([]);
                await reload();
              }, tr('Entrants updated.'))
            }
          >
            {tr('Apply to selected')}
          </ConfirmButton>
        </div>
      )}
      <div className="mt-3 overflow-x-auto">
        <table className="admin-table">
          <thead>
            <tr>
              {bulkAllowed && (
                <th>
                  <input
                    type="checkbox"
                    aria-label={tr('Select this page of entrants')}
                    checked={data.length > 0 && data.every((t) => selectedTeams.includes(t.id))}
                    onChange={(e) =>
                      setSelectedTeams(e.target.checked ? data.map((t) => t.id) : [])
                    }
                  />
                </th>
              )}
              <th>{tr('Team')}</th>
              <th>{tr('Roster')}</th>
              <th>{tr('Registration')}</th>
              <th>{tr('Public')}</th>
              <th>{tr('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((t) => (
              <tr key={t.id}>
                {bulkAllowed && (
                  <td>
                    <input
                      type="checkbox"
                      aria-label={tr('Select {0}', t.name)}
                      checked={selectedTeams.includes(t.id)}
                      onChange={(e) =>
                        setSelectedTeams(
                          e.target.checked
                            ? [...selectedTeams, t.id]
                            : selectedTeams.filter((id) => id !== t.id),
                        )
                      }
                    />
                  </td>
                )}
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
                      {can(actor, 'teams.edit') ? (
                        <TeamInlineIdentity
                          key={`${t.id}:${inlineEpoch}`}
                          team={t}
                          onChanged={reload}
                          onDirty={inlineChanged}
                        />
                      ) : (
                        <p className="font-semibold">{t.name}</p>
                      )}
                      <p className="text-xs text-muted">
                        {t.format === 'INDIVIDUAL' ? tr('Solo') : tr('Team')}
                        {t.seed ? tr(' · Seed {0}', t.seed) : ''}
                      </p>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="min-w-36 space-y-1">
                    {t.members.map((m) => (
                      <p key={m.osuId} className="text-xs">
                        {m.participant.username}
                        {m.captain ? tr(' · Captain') : m.substitute ? tr(' · Substitute') : ''}
                      </p>
                    ))}
                  </div>
                </td>
                <td>
                  <Badge>{tr(humanizeCode(t.status))}</Badge>
                </td>
                <td>{t.published ? tr('Published') : tr('Hidden')}</td>
                <td>
                  <div className="flex gap-1">
                    {can(actor, 'teams.edit') && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={tr('Edit {0}', t.name)}
                        title={tr('Edit team')}
                        onClick={() => {
                          if (dirty && !window.confirm(tr('Discard unsaved team changes?'))) return;
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
                        aria-label={tr('Publication {0}', t.name)}
                        title={tr('Approval and visibility')}
                        onClick={() => setVisibility({ ...t })}
                      >
                        <Eye size={18} />
                      </Button>
                    )}
                    {can(actor, 'teams.delete') && (
                      <ConfirmButton
                        title={tr('Delete {0}?', t.name)}
                        description={tr(
                          'Teams used in matches cannot be deleted. Hide them to retain their history.',
                        )}
                        disabled={busy}
                        onConfirm={() =>
                          void run(async () => {
                            await action({
                              type: 'team.delete',
                              id: t.id,
                              baseVersion: t.version,
                            });
                            await reload();
                          }, tr('Team deleted.'))
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
      <ListPagination
        page={result!.page}
        pageSize={result!.pageSize}
        total={result!.total}
        onPage={(page) => {
          if (!leaveInline()) return;
          setSelectedTeams([]);
          setPage(page);
        }}
        busy={loading || busy}
      />
      {!data.length && (
        <div className="py-14 text-center text-muted">
          <Users size={32} className="mx-auto mb-4" />
          {tr('No registered teams.')}
        </div>
      )}
      <EditorPanel
        open={!!draft}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title={draft?.id ? tr('Edit team') : tr('New team')}
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
              }, tr('Team saved.'));
            }}
          >
            <div className="grid-fields">
              <Field label={tr('Team name')}>
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
              <Field label={tr('Team slug')}>
                <input
                  required
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  value={draft.slug}
                  onChange={(e) => update({ slug: e.target.value })}
                />
              </Field>
              <Field label={tr('Format')}>
                <select
                  value={draft.format}
                  onChange={(e) => update({ format: e.target.value as TeamView['format'] })}
                >
                  <option value="TEAM">{tr('Team')}</option>
                  <option value="INDIVIDUAL">{tr('Individual / 1v1')}</option>
                </select>
              </Field>
              <Field label={tr('Seed')}>
                <input
                  type="number"
                  min={1}
                  value={draft.seed || ''}
                  onChange={(e) => update({ seed: e.target.value ? Number(e.target.value) : null })}
                />
              </Field>
              <Field label={tr('Display order')}>
                <input
                  type="number"
                  min={0}
                  value={draft.position}
                  onChange={(e) => update({ position: Number(e.target.value) })}
                />
              </Field>
            </div>
            <Field label={tr('Team description')}>
              <textarea
                maxLength={4000}
                value={draft.description}
                onChange={(e) => update({ description: e.target.value })}
              />
            </Field>
            <MediaField
              label={tr('Team logo')}
              value={draft.logoImageId ? `/api/media/${draft.logoImageId}` : ''}
              canUpload={can(actor, 'media.upload')}
              onChange={(url) => {
                const id = /^\/api\/media\/([a-zA-Z0-9_-]+)$/.exec(url)?.[1];
                if (url && !id) {
                  notify(tr('Select a logo from the media library.'), true);
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
                {tr('Remove logo')}
              </Button>
            )}
            <section className="border-t pt-6">
              <h2 className="mb-4 text-xl font-semibold">{tr('Player roster')}</h2>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Field label={tr('osu! ID or username')}>
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
                    }, tr('osu! profile verified.'))
                  }
                >
                  <Search size={17} />
                  {tr('Look up')}
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
                    {tr('Add player')}
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
                    <Field label={tr('Discord user ID for {0}', m.participant.username)}>
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
                      {tr('Captain')}
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
                      {tr('Substitute')}
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={tr('Remove {0}', m.participant.username)}
                      title={tr('Remove player')}
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
            <Field
              label={tr('Private administrative notes')}
              hint={tr(
                'Only website organizers can see these notes. They are never shown as a rejection reason.',
              )}
            >
              <textarea
                maxLength={4000}
                value={draft.adminNotes || ''}
                onChange={(event) => update({ adminNotes: event.target.value })}
              />
            </Field>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" disabled={busy} onClick={close}>
                {tr('Cancel')}
              </Button>
              <SaveButton busy={busy}>
                <Save size={17} />
                {tr('Save team')}
              </SaveButton>
            </div>
          </form>
        )}
      </EditorPanel>
      <EditorPanel
        open={!!visibility}
        onOpenChange={(open) => {
          if (!open) setVisibility(null);
        }}
        title={tr('Approval & visibility')}
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
                  rejectionReason: visibility.rejectionReason || '',
                });
                setVisibility(null);
                await reload();
              }, tr('Team visibility updated.'));
            }}
          >
            <p className="font-semibold">{visibility.name}</p>
            <Field label={tr('Registration status')}>
              <select
                value={visibility.status}
                onChange={(e) =>
                  setVisibility({
                    ...visibility,
                    status: e.target.value as TeamView['status'],
                    published:
                      e.target.value === 'REJECTED' ||
                      (e.target.value === 'APPROVED' && visibility.published),
                  })
                }
              >
                <option value="PENDING">{tr('Pending')}</option>
                <option value="APPROVED">{tr('Approved')}</option>
                <option value="REJECTED">{tr('Rejected')}</option>
              </select>
            </Field>
            {visibility.status === 'REJECTED' && (
              <Field
                label={tr('Public rejection reason')}
                hint={tr(
                  'Rejected entries remain visible with this reason. Keep private notes in the team editor.',
                )}
              >
                <textarea
                  required
                  minLength={3}
                  maxLength={2000}
                  value={visibility.rejectionReason || ''}
                  onChange={(event) =>
                    setVisibility({ ...visibility, rejectionReason: event.target.value })
                  }
                />
              </Field>
            )}
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={visibility.published}
                disabled={visibility.status !== 'APPROVED'}
                onChange={(e) => setVisibility({ ...visibility, published: e.target.checked })}
              />
              {tr('Published on the tournament website')}
            </label>
            <SaveButton busy={busy}>{tr('Save visibility')}</SaveButton>
          </form>
        )}
      </EditorPanel>
      <EditorPanel
        open={importOpen}
        onOpenChange={setImportOpen}
        title={tr('Import teams CSV')}
        wide
      >
        <div className="space-y-5">
          <Field label={tr('CSV file')}>
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
                  }, tr('CSV loaded.'));
              }}
            />
          </Field>
          <Field label={tr('CSV content')}>
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
              }, tr('Import preview ready.'))
            }
          >
            <FileSpreadsheet size={17} />
            {tr('Preview import')}
          </Button>
          {preview && (
            <div className="space-y-4">
              {preview.errors.length ? (
                <ul role="alert" className="list-inside list-disc text-red-200">
                  {preview.errors.map((message, i) => (
                    <li key={i}>
                      <Feedback message={message} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-accent">
                  {preview.teams.length} {tr('valid teams ·')} {preview.profiles.length}{' '}
                  {tr('verified players')}
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>{tr('Team')}</th>
                      <th>{tr('Players')}</th>
                      <th>{tr('Change')}</th>
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
                        <td>{t.id ? tr('Update roster') : tr('Create approved entry')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ConfirmButton
                variant="default"
                title={tr('Apply this import?')}
                description={tr(
                  'Existing approval and publication settings are preserved. New teams are automatically approved and published.',
                )}
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
                  }, tr('Teams imported.'))
                }
              >
                <Upload size={17} />
                {tr('Apply import')}
              </ConfirmButton>
            </div>
          )}
        </div>
      </EditorPanel>
    </>
  );
}
