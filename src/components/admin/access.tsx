'use client';
import { localeTag } from '@/lib/i18n';
import { useLocale, useT } from '@/components/locale';

import { useState } from 'react';
import { Plus, Trash2, Search, LockKeyhole } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { PERMISSIONS, type Actor, type PermissionKey } from '@/lib/permissions';
import {
  action,
  ConfirmButton,
  Field,
  LoadingState,
  Modal,
  SaveButton,
  SectionTitle,
  useResource,
  useTask,
  useUnsaved,
} from './shared';
type Role = {
  id: string;
  name: string;
  description: string;
  systemKey: string | null;
  permissions: { permissionKey: PermissionKey }[];
  _count?: { users: number };
};
type User = {
  id: string;
  osuId: number;
  username: string;
  avatarUrl: string;
  lastLoginAt: string;
  roles: { roleId: string; role: Role }[];
};
export function RolesEditor({ actor }: { actor: Actor }) {
  const tr = useT();
  const { data, error, reload } = useResource<{ roles: Role[]; permissions: typeof PERMISSIONS }>(
    'roles',
  );
  const { busy, run } = useTask();
  const [role, setRole] = useState<{
      id?: string;
      name: string;
      description: string;
      permissions: PermissionKey[];
    } | null>(null),
    [dirty, setDirty] = useState(false);
  useUnsaved(dirty);
  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  return (
    <>
      <SectionTitle title={tr('Roles & permissions')}>
        <Button
          size="sm"
          onClick={() => {
            setRole({ name: '', description: '', permissions: [] });
            setDirty(false);
          }}
        >
          <Plus size={13} />
          {tr('Create role')}
        </Button>
      </SectionTitle>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.roles.map((r) => {
          const own = actor.roles.some((a) => a.id === r.id);
          return (
            <div className="card flex flex-col p-6" key={r.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">{r.name}</h2>
                {r.systemKey && (
                  <Badge>
                    {r.systemKey === 'Owner' ? (
                      <>
                        <LockKeyhole size={10} />
                        {tr('Protected')}
                      </>
                    ) : (
                      tr('System role')
                    )}
                  </Badge>
                )}
              </div>
              <p className="mt-2 text-xs text-muted">{r.description}</p>
              <p className="mb-6 mt-4 text-xs text-muted">
                {r.permissions.length} {tr('permissions ·')} {r._count?.users || 0} {tr('users')}
              </p>
              <div className="mt-auto flex justify-between border-t pt-4">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={r.systemKey === 'Owner' || own}
                  onClick={() => {
                    setRole({
                      id: r.id,
                      name: r.name,
                      description: r.description,
                      permissions: r.permissions.map((p) => p.permissionKey),
                    });
                    setDirty(false);
                  }}
                >
                  {own ? tr('Assigned to you') : tr('Edit role')}
                </Button>
                {!r.systemKey && !own && (
                  <ConfirmButton
                    title={tr('Delete {0}?', r.name)}
                    description={tr('This role will be removed from every user who has it.')}
                    disabled={busy}
                    onConfirm={() =>
                      void run(async () => {
                        await action({ type: 'role.delete', id: r.id });
                        await reload();
                      }, tr('Role deleted.'))
                    }
                  >
                    <Trash2 size={13} />
                  </ConfirmButton>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <Modal
        open={!!role}
        onOpenChange={() => {
          if (dirty && !window.confirm(tr('Discard unsaved role changes?'))) return;
          setRole(null);
          setDirty(false);
        }}
        title={role?.id ? tr('Edit role') : tr('Create role')}
        description={tr(
          'You can grant only permissions you hold. Your own roles and the Owner role are protected.',
        )}
      >
        {role && (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await action({ type: 'role.save', ...role });
                await reload();
                setRole(null);
                setDirty(false);
              }, tr('Role saved.'));
            }}
          >
            <Field label={tr('Role name')}>
              <input
                required
                value={role.name}
                onChange={(e) => {
                  setRole({ ...role, name: e.target.value });
                  setDirty(true);
                }}
              />
            </Field>
            <Field label={tr('Description')}>
              <textarea
                value={role.description}
                onChange={(e) => {
                  setRole({ ...role, description: e.target.value });
                  setDirty(true);
                }}
              />
            </Field>
            <fieldset className="space-y-2">
              <legend className="mb-3 text-xs font-semibold">{tr('Granular permissions')}</legend>
              {Object.entries(data.permissions).map(([key, description]) => (
                <label className="flex items-start gap-3 rounded-lg border p-3" key={key}>
                  <input
                    className="mt-1 shrink-0"
                    type="checkbox"
                    disabled={!actor.permissions.includes(key as PermissionKey)}
                    checked={role.permissions.includes(key as PermissionKey)}
                    onChange={(e) => {
                      setRole({
                        ...role,
                        permissions: e.target.checked
                          ? [...role.permissions, key as PermissionKey]
                          : role.permissions.filter((p) => p !== key),
                      });
                      setDirty(true);
                    }}
                  />
                  <span>
                    <span className="block font-mono text-xs text-primary">{key}</span>
                    <span className="mt-1 block text-xs font-normal text-muted">
                      {tr(description)}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            <SaveButton busy={busy}>{tr('Save role')}</SaveButton>
          </form>
        )}
      </Modal>
    </>
  );
}
export function UsersEditor({ actor }: { actor: Actor }) {
  const language = useLocale();
  const tr = useT();
  const [query, setQuery] = useState(''),
    [search, setSearch] = useState('');
  const { data, error, reload } = useResource<{ users: User[]; roles: Role[] }>(
    `users&q=${encodeURIComponent(search)}`,
  );
  const { busy, run } = useTask();
  const [user, setUser] = useState<User | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [dirty, setDirty] = useState(false);
  useUnsaved(dirty);
  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  return (
    <>
      <SectionTitle title={tr('User management')} />
      <form
        className="mb-6 flex min-w-0 max-w-lg gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(query);
        }}
      >
        <input
          aria-label={tr('Search users')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr('Search by osu! username or ID…')}
        />
        <Button type="submit" variant="outline" className="shrink-0">
          <Search size={15} />
          {tr('Search')}
        </Button>
      </form>
      <div className="card relative overflow-x-auto">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{tr('User')}</th>
              <th>{tr('osu! ID')}</th>
              <th>{tr('Roles')}</th>
              <th>{tr('Last login')}</th>
              <th>
                <span className="sr-only">{tr('Manage')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id}>
                <td>
                  <div className="flex items-center gap-3">
                    <img src={u.avatarUrl} alt="" className="size-8 rounded-lg" />
                    <span className="font-medium">
                      {u.username}
                      {u.id === actor.id && (
                        <span className="ml-2 text-xs text-muted">{tr('You')}</span>
                      )}
                    </span>
                  </div>
                </td>
                <td className="font-mono text-muted">{u.osuId}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {u.roles.map((r) => (
                      <Badge key={r.roleId}>{r.role.name}</Badge>
                    ))}
                  </div>
                </td>
                <td className="whitespace-nowrap text-xs text-muted">
                  {new Date(u.lastLoginAt).toLocaleDateString(localeTag(language))}
                </td>
                <td>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setUser(u);
                      setSelected(u.roles.map((r) => r.roleId));
                      setDirty(false);
                    }}
                  >
                    {tr('Manage')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.users.length && (
          <div className="py-16 text-center text-sm text-muted">
            {tr('No users match your search.')}
          </div>
        )}
      </div>
      <p className="mt-4 text-xs text-muted">
        {tr('Showing up to 100 matching users. Refine your search to find a specific account.')}
      </p>
      <Modal
        open={!!user}
        onOpenChange={() => {
          if (dirty && !window.confirm(tr('Discard unsaved role assignments?'))) return;
          setUser(null);
          setDirty(false);
        }}
        title={user ? tr('Manage {0}', user.username) : tr('User roles')}
        description={tr('Assign multiple roles. Public staff positions are managed separately.')}
      >
        {user && (
          <form
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await action({ type: 'user.roles', userId: user.id, roleIds: selected });
                await reload();
                setUser(null);
                setDirty(false);
              }, tr('User roles updated.'));
            }}
          >
            {user.id === actor.id && (
              <p className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-xs text-primary">
                {tr('You cannot modify your own roles.')}
              </p>
            )}
            <fieldset disabled={busy || user.id === actor.id} className="space-y-2">
              {data.roles.map((r) => (
                <label key={r.id} className="flex items-start gap-3 rounded-lg border p-4">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.includes(r.id)}
                    disabled={
                      r.systemKey === 'Owner' && !actor.roles.some((r) => r.systemKey === 'Owner')
                    }
                    onChange={(e) => {
                      setSelected(
                        e.target.checked
                          ? [...selected, r.id]
                          : selected.filter((id) => id !== r.id),
                      );
                      setDirty(true);
                    }}
                  />
                  <span>
                    <span className="text-sm">{r.name}</span>
                    <span className="mt-1 block text-xs font-normal text-muted">
                      {r.description}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div>
              <h3 className="mb-3 text-xs font-semibold">
                {tr('Effective permissions after saving')}
              </h3>
              <div className="flex flex-wrap gap-2">
                {[
                  ...new Set(
                    data.roles
                      .filter((r) => selected.includes(r.id))
                      .flatMap((r) => r.permissions.map((p) => p.permissionKey)),
                  ),
                ].map((p) => (
                  <Badge key={p} className="font-mono text-xs text-primary">
                    {p}
                  </Badge>
                ))}
              </div>
              {!selected.some((id) => data.roles.find((r) => r.id === id)?.permissions.length) && (
                <p className="text-xs text-muted">{tr('Public player access only.')}</p>
              )}
            </div>
            <SaveButton busy={busy} disabled={busy || user.id === actor.id || !dirty}>
              {tr('Save roles')}
            </SaveButton>
          </form>
        )}
      </Modal>
    </>
  );
}
