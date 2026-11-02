'use client';
import { localeTag } from '@/lib/i18n';
import { useLocale, useT } from '@/components/locale';

import { useState } from 'react';
import { Plus, Trash2, Search, LockKeyhole } from 'lucide-react';
import { Button } from '../ui/button';
import { roleConfiguration } from '@/lib/role-configuration';
import { Badge } from '../ui/badge';
import {
  PERMISSIONS,
  PLATFORM_PERMISSIONS,
  type Actor,
  type PermissionKey,
} from '@/lib/permissions';
import {
  action,
  ConfirmButton,
  Field,
  LoadingState,
  EditorPanel,
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
      baseRole?: string;
    } | null>(null),
    [dirty, setDirty] = useState(false);
  useUnsaved(dirty);
  const closeRole = () => {
    if (busy || (dirty && !window.confirm(tr('Discard unsaved role changes?')))) return;
    setRole(null);
    setDirty(false);
  };
  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  return (
    <>
      <SectionTitle title={tr('Roles & permissions')}>
        <Button
          size="sm"
          onClick={() => {
            if (dirty && !window.confirm(tr('Discard unsaved role changes?'))) return;
            setRole({ name: '', description: '', permissions: [] });
            setDirty(false);
          }}
        >
          <Plus size={13} />
          {tr('Create role')}
        </Button>
      </SectionTitle>
      <div className="overflow-auto rounded-2xl border">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{tr('Role')}</th>
              <th>{tr('Description')}</th>
              <th>{tr('Permissions')}</th>
              <th>{tr('Users')}</th>
              <th>{tr('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {data.roles.map((r) => {
              const own = actor.roles.some((a) => a.id === r.id);
              return (
                <tr key={r.id}>
                  <td>
                    <span className="font-semibold">{r.name}</span>
                    {r.systemKey && (
                      <span className="ml-2">
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
                      </span>
                    )}
                  </td>
                  <td className="max-w-sm whitespace-normal text-xs text-muted">{r.description}</td>
                  <td>{r.permissions.length}</td>
                  <td>{r._count?.users || 0}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={r.systemKey === 'Owner' || own}
                        onClick={() => {
                          if (dirty && !window.confirm(tr('Discard unsaved role changes?'))) return;
                          setRole({
                            id: r.id,
                            name: r.name,
                            description: r.description,
                            permissions: r.permissions.map((p) => p.permissionKey),
                            baseRole: roleConfiguration(r),
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
                              await action({
                                type: 'role.delete',
                                id: r.id,
                                baseRole: roleConfiguration(r),
                              });
                              await reload();
                            }, tr('Role deleted.'))
                          }
                        >
                          <Trash2 size={13} />
                        </ConfirmButton>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <EditorPanel
        open={!!role}
        onOpenChange={closeRole}
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
            <Field label={tr('Copy permissions from')}>
              <select
                defaultValue=""
                onChange={(e) => {
                  const source = data.roles.find((r) => r.id === e.target.value);
                  if (source) {
                    setRole({
                      ...role,
                      permissions: source.permissions
                        .map((p) => p.permissionKey)
                        .filter(
                          (p) => actor.permissions.includes(p) && !PLATFORM_PERMISSIONS.includes(p),
                        ),
                    });
                    setDirty(true);
                  }
                  e.target.value = '';
                }}
              >
                <option value="">{tr('Choose role')}</option>
                {data.roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
            <fieldset className="space-y-2">
              <legend className="mb-3 text-xs font-semibold">{tr('Granular permissions')}</legend>
              {Object.entries(data.permissions).map(([key, description]) => (
                <label className="flex items-start gap-3 rounded-lg border p-3" key={key}>
                  <input
                    className="mt-1 shrink-0"
                    type="checkbox"
                    disabled={
                      !actor.permissions.includes(key as PermissionKey) ||
                      PLATFORM_PERMISSIONS.includes(key as PermissionKey)
                    }
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
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={closeRole}>
                {tr('Cancel')}
              </Button>
              <SaveButton busy={busy}>{tr('Save role')}</SaveButton>
            </div>
          </form>
        )}
      </EditorPanel>
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
  const [bulkUsers, setBulkUsers] = useState<string[]>([]),
    [bulkRole, setBulkRole] = useState(''),
    [bulkOperation, setBulkOperation] = useState('ADD');
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
          setBulkUsers([]);
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
      <div className="my-3 flex flex-wrap items-end gap-2">
        <span className="text-sm">{tr('{0} selected', bulkUsers.length)}</span>
        <Field label={tr('Role')}>
          <select value={bulkRole} onChange={(e) => setBulkRole(e.target.value)}>
            <option value="">{tr('Choose role')}</option>
            {data.roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr('Bulk role action')}>
          <select value={bulkOperation} onChange={(e) => setBulkOperation(e.target.value)}>
            <option value="ADD">{tr('Add role')}</option>
            <option value="REMOVE">{tr('Remove role')}</option>
          </select>
        </Field>
        <ConfirmButton
          title={tr('Update selected role assignments?')}
          description={tr(
            'Other roles are preserved. Self editing, protected permissions and the last Owner remain protected. The entire selection must pass validation.',
          )}
          disabled={busy || !bulkUsers.length || !bulkRole}
          onConfirm={() =>
            void run(async () => {
              await action({
                type: 'user.roles.bulk',
                users: data.users
                  .filter((u) => bulkUsers.includes(u.id))
                  .map((u) => ({ userId: u.id, baseRoleIds: u.roles.map((r) => r.roleId) })),
                roleIds: [bulkRole],
                operation: bulkOperation,
                baseRoles: data.roles.map((r) => ({
                  id: r.id,
                  permissions: r.permissions.map((p) => p.permissionKey),
                })),
              });
              setBulkUsers([]);
              await reload();
            }, tr('User roles updated.'))
          }
        >
          {tr('Apply to selected')}
        </ConfirmButton>
      </div>
      <div className="card relative overflow-x-auto">
        <table className="admin-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label={tr('Select eligible users')}
                  checked={
                    data.users.some((u) => u.id !== actor.id) &&
                    data.users
                      .filter((u) => u.id !== actor.id)
                      .every((u) => bulkUsers.includes(u.id))
                  }
                  onChange={(e) =>
                    setBulkUsers(
                      e.target.checked
                        ? data.users.filter((u) => u.id !== actor.id).map((u) => u.id)
                        : [],
                    )
                  }
                />
              </th>
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
                  <input
                    type="checkbox"
                    aria-label={tr('Select {0}', u.username)}
                    disabled={u.id === actor.id}
                    checked={bulkUsers.includes(u.id)}
                    onChange={(e) =>
                      setBulkUsers(
                        e.target.checked
                          ? [...bulkUsers, u.id]
                          : bulkUsers.filter((id) => id !== u.id),
                      )
                    }
                  />
                </td>
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
                      if (dirty && !window.confirm(tr('Discard unsaved role assignments?'))) return;
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
      <EditorPanel
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
                await action({
                  type: 'user.roles',
                  userId: user.id,
                  roleIds: selected,
                  baseRoleIds: user.roles.map((r) => r.roleId),
                  baseRoles: data.roles.map((r) => ({
                    id: r.id,
                    permissions: r.permissions.map((p) => p.permissionKey),
                  })),
                });
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
      </EditorPanel>
    </>
  );
}
