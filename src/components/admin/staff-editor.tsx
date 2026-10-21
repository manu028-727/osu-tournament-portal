'use client';
import { useState } from 'react';
import { Plus, Trash2, Users, EyeOff, ArrowUpRight } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { can, type Actor } from '@/lib/permissions';
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
type Category = { id: string; name: string; description: string; position: number };
type Member = {
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
type Draft = Omit<Member, 'id' | 'username' | 'avatarUrl' | 'profileUrl'> & { id?: string };
export function StaffEditor({ actor }: { actor: Actor }) {
  const { data, error, reload } = useResource<{ members: Member[]; categories: Category[] }>(
    'staff',
  );
  const { busy, run } = useTask();
  const [member, setMember] = useState<Draft | null>(null),
    [category, setCategory] = useState<Partial<Category> | null>(null),
    [categoryOpen, setCategoryOpen] = useState(false),
    [dirty, setDirty] = useState(false);
  useUnsaved(dirty);
  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
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
      {data.members.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.members.map((m) => (
            <div key={m.id} className="card p-6">
              <div className="flex items-center gap-4">
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
                      await action({ type: 'staff.delete', id: m.id });
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
      ) : (
        <div className="card py-20 text-center">
          <Users className="mx-auto mb-4 text-primary" size={28} />
          <h2 className="text-xl font-semibold">No public staff members yet</h2>
          <p className="mt-3 text-sm text-muted">
            Add the first staff member using their osu! user ID.
          </p>
        </div>
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
                await action({ type: 'staff.save', ...member });
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
                    await action({ type: 'staff.category.delete', id: c.id });
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
