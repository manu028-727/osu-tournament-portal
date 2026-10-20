'use client';
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
      <SectionTitle title="Roles & permissions">
        <Button
          size="sm"
          onClick={() => {
            setRole({ name: '', description: '', permissions: [] });
            setDirty(false);
          }}
        >
          <Plus size={13} />
          Create role
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
                        Protected
                      </>
                    ) : (
                      'System role'
                    )}
                  </Badge>
                )}
              </div>
              <p className="mt-2 text-xs text-muted">{r.description}</p>
              <p className="mb-6 mt-4 text-xs text-muted">
                {r.permissions.length} permissions · {r._count?.users || 0} users
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
                  {own ? 'Assigned to you' : 'Edit role'}
                </Button>
                {!r.systemKey && !own && (
                  <ConfirmButton
                    title={`Delete ${r.name}?`}
                    description="This role will be removed from every user who has it."
                    disabled={busy}
                    onConfirm={() =>
                      void run(async () => {
                        await action({ type: 'role.delete', id: r.id });
                        await reload();
                      }, 'Role deleted.')
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
          if (dirty && !window.confirm('Discard unsaved role changes?')) return;
          setRole(null);
          setDirty(false);
        }}
        title={role?.id ? 'Edit role' : 'Create role'}
        description="You can grant only permissions you hold. Your own roles and the Owner role are protected."
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
              }, 'Role saved.');
            }}
          >
            <Field label="Role name">
              <input
                required
                value={role.name}
                onChange={(e) => {
                  setRole({ ...role, name: e.target.value });
                  setDirty(true);
                }}
              />
            </Field>
            <Field label="Description">
              <textarea
                value={role.description}
                onChange={(e) => {
                  setRole({ ...role, description: e.target.value });
                  setDirty(true);
                }}
              />
            </Field>
            <fieldset className="space-y-2">
              <legend className="mb-3 text-xs font-semibold">Granular permissions</legend>
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
                    <span className="mt-1 block text-xs font-normal text-muted">{description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <SaveButton busy={busy}>Save role</SaveButton>
          </form>
        )}
      </Modal>
    </>
  );
}
export function UsersEditor({ actor }: { actor: Actor }) {
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
      <SectionTitle title="User management" />
      <form
        className="mb-6 flex min-w-0 max-w-lg gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(query);
        }}
      >
        <input
          aria-label="Search users"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by osu! username or ID…"
        />
        <Button type="submit" variant="outline" className="shrink-0">
          <Search size={15} />
          Search
        </Button>
      </form>
      <div className="card relative overflow-x-auto">
        <table className="admin-table">
          <thead>
            <tr>
              <th>User</th>
              <th>osu! ID</th>
              <th>Roles</th>
              <th>Last login</th>
              <th>
                <span className="sr-only">Manage</span>
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
                      {u.id === actor.id && <span className="ml-2 text-xs text-muted">You</span>}
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
                  {new Date(u.lastLoginAt).toLocaleDateString()}
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
                    Manage
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.users.length && (
          <div className="py-16 text-center text-sm text-muted">No users match your search.</div>
        )}
      </div>
      <p className="mt-4 text-xs text-muted">
        Showing up to 100 matching users. Refine your search to find a specific account.
      </p>
      <Modal
        open={!!user}
        onOpenChange={() => {
          if (dirty && !window.confirm('Discard unsaved role assignments?')) return;
          setUser(null);
          setDirty(false);
        }}
        title={user ? `Manage ${user.username}` : 'User roles'}
        description="Assign multiple roles. Public staff positions are managed separately."
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
              }, 'User roles updated.');
            }}
          >
            {user.id === actor.id && (
              <p className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-xs text-primary">
                You cannot modify your own roles.
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
              <h3 className="mb-3 text-xs font-semibold">Effective permissions after saving</h3>
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
                <p className="text-xs text-muted">Public player access only.</p>
              )}
            </div>
            <SaveButton busy={busy} disabled={busy || user.id === actor.id || !dirty}>
              Save roles
            </SaveButton>
          </form>
        )}
      </Modal>
    </>
  );
}
