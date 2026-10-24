'use client';
import { useRef, useState } from 'react';
import { Plus, Trash2, Users, Eye, EyeOff, ArrowUpRight, Search, Pencil, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { can, type Actor } from '@/lib/permissions';
import type { StaffBulkAction, StaffAssignmentPatch } from '@/lib/staff-bulk-validation';
import { MediaField } from './media';
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
type Category = {
  id: string;
  version: number;
  name: string;
  description: string;
  position: number;
};
type Member = {
  version: number;
  id: string;
  osuId: number;
  username: string;
  avatarUrl: string;
  profileUrl: string;
  bio: string;
  customImage: string;
  visible: boolean;
  position: number;
  assignments: { categoryId: string; position: string }[];
};
type Draft = Omit<Member, 'id' | 'username' | 'avatarUrl' | 'profileUrl' | 'version'> & {
  id?: string;
  version?: number;
};
export function StaffEditor({ actor }: { actor: Actor }) {
  const { data, error, reload } = useResource<{ members: Member[]; categories: Category[] }>(
    'staff',
  );
  const { busy, run } = useTask();
  const [member, setMember] = useState<Draft | null>(null),
    [category, setCategory] = useState<Partial<Category> | null>(null),
    [categoryOpen, setCategoryOpen] = useState(false),
    [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState(''),
    [categoryFilter, setCategoryFilter] = useState(''),
    [visibilityFilter, setVisibilityFilter] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const [bulk, setBulk] = useState<{
    members: Member[];
    visibility: 'KEEP' | 'SHOW' | 'HIDE';
  } | null>(null);
  useUnsaved(dirty);
  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  const editable = can(actor, 'staff.edit');
  const visibleMembers = data.members.filter(
    (entry) =>
      (!categoryFilter ||
        (categoryFilter === 'none'
          ? !entry.assignments.length
          : entry.assignments.some((assignment) => assignment.categoryId === categoryFilter))) &&
      (!visibilityFilter || entry.visible === (visibilityFilter === 'shown')) &&
      (!search.trim() ||
        [
          entry.username,
          entry.osuId,
          entry.bio,
          ...entry.assignments.map((assignment) => assignment.position),
        ]
          .join(' ')
          .toLowerCase()
          .includes(search.trim().toLowerCase())),
  );
  const selectedMembers = visibleMembers.filter((entry) => selected.includes(entry.id));
  const clearSelection = () => {
    setSelected([]);
    anchor.current = null;
  };
  const toggleSelected = (id: string, checked: boolean, shift: boolean) => {
    const from = visibleMembers.findIndex((entry) => entry.id === anchor.current);
    const to = visibleMembers.findIndex((entry) => entry.id === id);
    const ids =
      shift && from !== -1
        ? visibleMembers.slice(Math.min(from, to), Math.max(from, to) + 1).map((entry) => entry.id)
        : [id];
    setSelected((current) =>
      checked
        ? [...new Set([...current, ...ids])]
        : current.filter((entry) => !ids.includes(entry)),
    );
    anchor.current = id;
  };
  const closeMember = () => {
    if (dirty && !window.confirm('Discard unsaved staff changes?')) return;
    setMember(null);
    setDirty(false);
  };
  return (
    <>
      <SectionTitle
        title="Staff manager"
        description="Public staff positions do not grant website access."
      >
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setCategoryOpen(true)}>
            Staff categories
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setMember({
                osuId: 0,
                bio: '',
                customImage: '',
                visible: true,
                position: data.members.length,
                assignments: [],
              });
              setDirty(false);
            }}
          >
            <Plus size={14} />
            Add staff member
          </Button>
        </div>
      </SectionTitle>
      {data.members.length > 0 && (
        <div className="mb-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="relative min-w-44 flex-1">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                aria-label="Search staff"
                placeholder="Search username, osu! ID or position"
                className="!pl-9"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  clearSelection();
                }}
              />
            </div>
            <Field label="Category">
              <select
                value={categoryFilter}
                onChange={(event) => {
                  setCategoryFilter(event.target.value);
                  clearSelection();
                }}
              >
                <option value="">All categories</option>
                <option value="none">No category</option>
                {data.categories.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Public visibility">
              <select
                value={visibilityFilter}
                onChange={(event) => {
                  setVisibilityFilter(event.target.value);
                  clearSelection();
                }}
              >
                <option value="">All staff</option>
                <option value="shown">Shown</option>
                <option value="hidden">Hidden</option>
              </select>
            </Field>
            <span className="py-3 text-xs text-muted">
              {visibleMembers.length} of {data.members.length} staff
            </span>
          </div>
          {editable && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={
                  !!visibleMembers.length && selectedMembers.length === visibleMembers.length
                }
                disabled={!visibleMembers.length}
                onChange={(event) => {
                  setSelected(event.target.checked ? visibleMembers.map((entry) => entry.id) : []);
                  anchor.current = null;
                }}
              />
              Select all {visibleMembers.length} matching staff
            </label>
          )}
        </div>
      )}
      {editable && selectedMembers.length > 0 && (
        <div
          className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-card p-3"
          role="region"
          aria-label="Staff bulk actions"
        >
          <span className="mr-2 text-sm font-medium">{selectedMembers.length} selected</span>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || selectedMembers.length > 200}
            onClick={() => setBulk({ members: [...selectedMembers], visibility: 'SHOW' })}
          >
            <Eye size={14} />
            Show
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || selectedMembers.length > 200}
            onClick={() => setBulk({ members: [...selectedMembers], visibility: 'HIDE' })}
          >
            <EyeOff size={14} />
            Hide
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || selectedMembers.length > 200}
            onClick={() => setBulk({ members: [...selectedMembers], visibility: 'KEEP' })}
          >
            <Pencil size={14} />
            Edit positions
          </Button>
          <Button variant="ghost" size="sm" onClick={clearSelection}>
            <X size={14} />
            Clear
          </Button>
          {selectedMembers.length > 200 && (
            <span className="text-xs text-amber-400">Select up to 200 staff per operation.</span>
          )}
        </div>
      )}
      {visibleMembers.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleMembers.map((m) => (
            <div key={m.id} className="card p-6">
              <div className="flex items-center gap-4">
                {editable && (
                  <input
                    type="checkbox"
                    aria-label={`Select ${m.username}`}
                    checked={selectedMembers.some((entry) => entry.id === m.id)}
                    onChange={(event) =>
                      toggleSelected(
                        m.id,
                        event.target.checked,
                        (event.nativeEvent as MouseEvent).shiftKey,
                      )
                    }
                  />
                )}
                <img
                  src={m.customImage || m.avatarUrl}
                  alt=""
                  className="size-12 rounded-lg object-cover"
                />
                <div className="min-w-0 flex-1">
                  <a
                    href={m.profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm font-semibold"
                  >
                    {m.username}
                    <ArrowUpRight size={12} className="text-muted" />
                  </a>
                  <span className="text-xs text-muted">osu! #{m.osuId}</span>
                </div>
                {!m.visible && <EyeOff size={16} className="text-muted" />}
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                {m.assignments.map((a) => (
                  <Badge key={a.categoryId} className="text-primary">
                    {a.position || data.categories.find((c) => c.id === a.categoryId)?.name}
                  </Badge>
                ))}
              </div>
              <p className="mt-4 line-clamp-2 text-xs text-muted">
                {m.bio || 'No biography added.'}
              </p>
              <div className="mt-5 flex justify-between border-t pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setMember({ ...m });
                    setDirty(false);
                  }}
                >
                  Edit profile
                </Button>
                <ConfirmButton
                  title={`Remove ${m.username} from staff?`}
                  description="Their website account and access roles are unaffected."
                  disabled={busy}
                  onConfirm={() =>
                    void run(async () => {
                      await action({ type: 'staff.delete', id: m.id, baseVersion: m.version });
                      await reload();
                    }, 'Staff member removed.')
                  }
                >
                  <Trash2 size={13} />
                </ConfirmButton>
              </div>
            </div>
          ))}
        </div>
      ) : data.members.length ? (
        <p className="rounded-lg border p-8 text-center text-sm text-muted">
          No staff match the current filters.
        </p>
      ) : (
        <div className="card py-20 text-center">
          <Users className="mx-auto mb-4 text-primary" size={28} />
          <h2 className="text-xl font-semibold">No public staff members yet</h2>
          <p className="mt-3 text-sm text-muted">
            Add the first staff member using their osu! user ID.
          </p>
        </div>
      )}
      {bulk && (
        <StaffBulkDialog
          key={bulk.members.map((entry) => entry.id).join(',') + bulk.visibility}
          members={bulk.members}
          categories={data.categories}
          initialVisibility={bulk.visibility}
          initialCategoryId={categoryFilter === 'none' ? '' : categoryFilter}
          busy={busy}
          onClose={() => {
            if (!busy) setBulk(null);
          }}
          onSave={(payload) =>
            void run(async () => {
              await action(payload);
              await reload();
              setBulk(null);
              clearSelection();
            }, 'Public staff listings updated.')
          }
        />
      )}
      <Modal
        open={!!member}
        onOpenChange={closeMember}
        title={member?.id ? 'Edit staff profile' : 'Add staff member'}
        description="osu! profile details are retrieved from the official API. Assign one or more public staff positions."
      >
        {member && (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await action({ type: 'staff.save', ...member, baseVersion: member.version });
                await reload();
                setMember(null);
                setDirty(false);
              }, 'Staff profile saved.');
            }}
          >
            <div className="grid-fields">
              <Field label="osu! user ID" hint="The number in osu.ppy.sh/users/123456">
                <input
                  type="number"
                  required
                  min={1}
                  value={member.osuId || ''}
                  onChange={(e) => {
                    setMember({ ...member, osuId: Number(e.target.value) });
                    setDirty(true);
                  }}
                />
              </Field>
              <Field label="Display order">
                <input
                  type="number"
                  min={0}
                  value={member.position}
                  onChange={(e) => {
                    setMember({ ...member, position: Number(e.target.value) });
                    setDirty(true);
                  }}
                />
              </Field>
            </div>
            <Field label="Biography">
              <textarea
                value={member.bio}
                onChange={(e) => {
                  setMember({ ...member, bio: e.target.value });
                  setDirty(true);
                }}
                maxLength={2000}
              />
            </Field>
            <MediaField
              label="Custom profile image (optional)"
              value={member.customImage}
              canUpload={can(actor, 'media.upload')}
              onChange={(customImage) => {
                setMember({ ...member, customImage });
                setDirty(true);
              }}
            />
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={member.visible}
                onChange={(e) => {
                  setMember({ ...member, visible: e.target.checked });
                  setDirty(true);
                }}
              />
              Show on the public staff page
            </label>
            <div className="space-y-3">
              <p className="text-xs font-semibold">Public staff positions</p>
              {data.categories.map((c) => {
                const assignment = member.assignments.find((a) => a.categoryId === c.id);
                return (
                  <div className="space-y-3 rounded-lg border p-4" key={c.id}>
                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={!!assignment}
                        onChange={(e) => {
                          setMember({
                            ...member,
                            assignments: e.target.checked
                              ? [...member.assignments, { categoryId: c.id, position: '' }]
                              : member.assignments.filter((a) => a.categoryId !== c.id),
                          });
                          setDirty(true);
                        }}
                      />
                      {c.name}
                    </label>
                    {assignment && (
                      <input
                        aria-label={`Position in ${c.name}`}
                        placeholder="Custom position title (optional)"
                        value={assignment.position}
                        onChange={(e) => {
                          setMember({
                            ...member,
                            assignments: member.assignments.map((a) =>
                              a.categoryId === c.id ? { ...a, position: e.target.value } : a,
                            ),
                          });
                          setDirty(true);
                        }}
                      />
                    )}
                  </div>
                );
              })}
              {!data.categories.length && (
                <p className="text-xs text-muted">Create a staff category to organize your team.</p>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" disabled={busy} onClick={closeMember}>
                Cancel
              </Button>
              <SaveButton busy={busy}>Save staff profile</SaveButton>
            </div>
          </form>
        )}
      </Modal>
      <Modal open={categoryOpen} onOpenChange={setCategoryOpen} title="Staff categories">
        <div className="mb-6 space-y-2">
          {data.categories.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-lg border p-3">
              <span className="text-xs text-muted">{c.position + 1}</span>
              <span className="flex-1 text-xs">{c.name}</span>
              <Button size="sm" variant="ghost" onClick={() => setCategory(c)}>
                Edit
              </Button>
              <ConfirmButton
                title={`Delete ${c.name}?`}
                description="Staff members will remain, but their assignments to this category will be removed."
                onConfirm={() =>
                  void run(async () => {
                    await action({
                      type: 'staff.category.delete',
                      id: c.id,
                      baseVersion: c.version,
                    });
                    await reload();
                  }, 'Category removed.')
                }
              >
                <Trash2 size={12} />
              </ConfirmButton>
            </div>
          ))}
        </div>
        <form
          className="space-y-4 border-t pt-5"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await action({
                type: 'staff.category.save',
                description: '',
                position: data.categories.length,
                ...category,
                baseVersion: category?.version,
              });
              setCategory(null);
              await reload();
            }, 'Category saved.');
          }}
        >
          <h3 className="text-sm font-semibold">
            {category?.id ? 'Edit category' : 'Add category'}
          </h3>
          <Field label="Category name">
            <input
              required
              value={category?.name || ''}
              onChange={(e) => setCategory({ ...category, name: e.target.value })}
            />
          </Field>
          <Field label="Description">
            <textarea
              value={category?.description || ''}
              onChange={(e) => setCategory({ ...category, description: e.target.value })}
            />
          </Field>
          <Field label="Display order">
            <input
              type="number"
              min={0}
              value={category?.position ?? data.categories.length}
              onChange={(e) => setCategory({ ...category, position: Number(e.target.value) })}
            />
          </Field>
          <div className="flex gap-3">
            <SaveButton busy={busy}>Save category</SaveButton>
            {category?.id && (
              <Button type="button" variant="ghost" onClick={() => setCategory(null)}>
                Cancel edit
              </Button>
            )}
          </div>
        </form>
      </Modal>
    </>
  );
}

function StaffBulkDialog({
  members,
  categories,
  initialVisibility,
  initialCategoryId,
  busy,
  onClose,
  onSave,
}: {
  members: Member[];
  categories: Category[];
  initialVisibility: 'KEEP' | 'SHOW' | 'HIDE';
  initialCategoryId: string;
  busy: boolean;
  onClose: () => void;
  onSave: (payload: StaffBulkAction) => void;
}) {
  const [visibility, setVisibility] = useState(initialVisibility);
  const [operation, setOperation] = useState<StaffAssignmentPatch['operation'] | ''>('');
  const [categoryId, setCategoryId] = useState(initialCategoryId),
    [destinationCategoryId, setDestinationCategoryId] = useState('');
  const [changeLabel, setChangeLabel] = useState(false),
    [position, setPosition] = useState('');
  const sourceAssignments = members.map((member) =>
    member.assignments.find((entry) => entry.categoryId === categoryId),
  );
  const missing = sourceAssignments.filter((entry) => !entry).length;
  const needsExisting = operation === 'LABEL' || operation === 'REASSIGN';
  const currentLabels = [
    ...new Set(sourceAssignments.filter((entry) => !!entry).map((entry) => entry!.position)),
  ];
  const valid =
    (visibility !== 'KEEP' || !!operation) &&
    (!operation || !!categoryId) &&
    (!needsExisting || !missing) &&
    (operation !== 'REASSIGN' || (!!destinationCategoryId && destinationCategoryId !== categoryId));
  return (
    <Modal
      open
      title={`Update ${members.length} public staff listings`}
      onOpenChange={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          const assignment: StaffAssignmentPatch | undefined =
            operation === 'ADD'
              ? { operation, categoryId, ...(changeLabel ? { position } : {}) }
              : operation === 'REMOVE'
                ? { operation, categoryId }
                : operation === 'LABEL'
                  ? { operation, categoryId, position }
                  : operation === 'REASSIGN'
                    ? {
                        operation,
                        categoryId,
                        destinationCategoryId,
                        ...(changeLabel ? { position } : {}),
                      }
                    : undefined;
          onSave({
            type: 'staff.bulk',
            memberIds: members.map((member) => member.id),
            baseVersions: Object.fromEntries(members.map((member) => [member.id, member.version])),
            patch: {
              ...(visibility !== 'KEEP' ? { visible: visibility === 'SHOW' } : {}),
              ...(assignment ? { assignment } : {}),
            },
          });
        }}
      >
        <Field label="Public visibility">
          <select
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as typeof visibility)}
          >
            <option value="KEEP">
              Keep current visibility
              {members.some((member) => member.visible !== members[0].visible) ? ' (mixed)' : ''}
            </option>
            <option value="SHOW">Show all selected staff</option>
            <option value="HIDE">Hide all selected staff</option>
          </select>
        </Field>
        <Field label="Public staff category">
          <select
            value={operation}
            onChange={(event) => setOperation(event.target.value as typeof operation)}
          >
            <option value="">Keep current categories and position labels</option>
            <option value="ADD">Add to category</option>
            <option value="REMOVE">Remove from category</option>
            <option value="REASSIGN">Move between categories</option>
            <option value="LABEL">Change position label in category</option>
          </select>
        </Field>
        {operation && (
          <Field label={operation === 'REASSIGN' ? 'Source category' : 'Category'}>
            <select
              required
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="" disabled>
                Choose public category
              </option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {operation === 'REASSIGN' && (
          <Field label="Destination category">
            <select
              required
              value={destinationCategoryId}
              onChange={(event) => setDestinationCategoryId(event.target.value)}
            >
              <option value="" disabled>
                Choose destination category
              </option>
              {categories
                .filter((category) => category.id !== categoryId)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </select>
          </Field>
        )}
        {(operation === 'ADD' || operation === 'REASSIGN') && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={changeLabel}
              onChange={(event) => setChangeLabel(event.target.checked)}
            />
            Set a shared position label
          </label>
        )}
        {(operation === 'LABEL' ||
          ((operation === 'ADD' || operation === 'REASSIGN') && changeLabel)) && (
          <Field label="Position label" hint="Leave empty to display the category name.">
            <input
              maxLength={100}
              value={position}
              onChange={(event) => setPosition(event.target.value)}
            />
          </Field>
        )}
        {operation === 'LABEL' && categoryId && (
          <p className="text-xs text-muted">
            Current labels:{' '}
            {currentLabels.length > 1 ? 'Mixed' : currentLabels[0] || 'Category name'}.
          </p>
        )}
        {needsExisting && categoryId && missing > 0 && (
          <p role="alert" className="text-sm text-amber-400">
            {missing} selected staff {missing === 1 ? 'is' : 'are'} not assigned to this source
            category. Filter by the category and select its members first.
          </p>
        )}
        {operation === 'REASSIGN' && (
          <p className="text-xs text-muted">
            Other categories are kept. Existing destination labels are kept unless a shared label is
            set; new destination assignments inherit the source label.
          </p>
        )}
        {operation === 'ADD' && !changeLabel && (
          <p className="text-xs text-muted">
            Existing position labels are kept. New assignments display the category name.
          </p>
        )}
        {operation === 'REMOVE' && (
          <p className="text-xs text-muted">
            Only this category is removed; other public positions are kept.
          </p>
        )}
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            Review {members.length} selected staff
          </summary>
          <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-sm text-muted">
            {members.map((member) => (
              <li key={member.id}>
                {member.username} · {member.visible ? 'Shown' : 'Hidden'}
              </li>
            ))}
          </ul>
        </details>
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <SaveButton busy={busy} disabled={busy || !valid}>
            Apply to {members.length} staff
          </SaveButton>
        </div>
      </form>
    </Modal>
  );
}
