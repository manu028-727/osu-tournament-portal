'use client';
import { useEffect, useState } from 'react';
import { Eye, Plus, Trash2, Save, Send, ArrowUp, ArrowDown, Ellipsis } from 'lucide-react';
import { RichEditor } from './rich-editor';
import { MediaField } from './media';
import { Button } from '../ui/button';
import { StateBadge } from '../ui/badge';
import { ContentBlocks } from '../content';
import type { PageContent, TournamentView } from '@/lib/types';
import type { Block } from '@/lib/validation';
import type { Actor } from '@/lib/permissions';
import { can } from '@/lib/permissions';
import {
  action,
  ConfirmButton,
  Field,
  LoadingState,
  Modal,
  ReorderList,
  SaveButton,
  SectionTitle,
  useResource,
  useTask,
  useUnsaved,
} from './shared';
type PageData = {
  id: string | null;
  title: string;
  slug: 'home' | 'rules';
  state: string;
  draftRevisionId: string | null;
  publishedRevisionId: string | null;
  draftRevision: PageContent | null;
  publishedRevision: PageContent | null;
  revisions: { id: string; title: string; createdAt: string }[];
};
export function PageEditor({
  kind,
  actor,
  tournament,
}: {
  kind: 'homepage' | 'rules';
  actor: Actor;
  tournament: TournamentView;
}) {
  const { data, error, reload } = useResource<PageData>(kind);
  const [title, setTitle] = useState(''),
    [html, setHtml] = useState(''),
    [blocks, setBlocks] = useState<Block[]>([]),
    [base, setBase] = useState<string | null>(null),
    [dirty, setDirty] = useState(false),
    [preview, setPreview] = useState(false),
    [history, setHistory] = useState(false),
    [tools, setTools] = useState(false);
  const { busy, run } = useTask();
  useEffect(() => {
    if (data) {
      const revision = data.draftRevision || data.publishedRevision;
      setTitle(revision?.title || data.title);
      setHtml(revision?.html || '');
      setBlocks((revision?.blocks || []) as Block[]);
      setBase(data.draftRevisionId);
      setDirty(false);
    }
  }, [data]);
  useUnsaved(dirty);
  const edit = can(actor, kind === 'homepage' ? 'homepage.edit' : 'rules.edit'),
    publish = can(actor, kind === 'homepage' ? 'homepage.publish' : 'rules.publish');
  const update = (index: number, change: Partial<Block>) => {
    setBlocks((b) => b.map((block, i) => (i === index ? { ...block, ...change } : block)));
    setDirty(true);
  };
  const save = () =>
    run(async () => {
      await action({
        type: 'page.save',
        slug: kind === 'homepage' ? 'home' : 'rules',
        title,
        html,
        blocks,
        baseRevisionId: base,
      });
      await reload();
    }, 'Draft saved. The public version is unchanged.');
  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  const revision = data.draftRevision || data.publishedRevision;
  const ruleSections = html.split(/(?=<h2(?:\s|>))/).filter(Boolean);
  return (
    <>
      <SectionTitle title={kind === 'homepage' ? 'Homepage editor' : 'Rules editor'}>
        <div className="flex flex-wrap items-center gap-2">
          <StateBadge state={data.state} />
          {dirty && <span className="text-xs text-amber-200">Unsaved changes</span>}
        </div>
      </SectionTitle>
      <p role="status" className="mb-4 text-sm text-muted">
        {dirty
          ? 'Unsaved changes'
          : !data.draftRevisionId
            ? 'No saved draft yet'
            : data.draftRevisionId !== data.publishedRevisionId
              ? 'Saved draft · Unpublished changes'
              : 'Published · No unpublished changes'}
      </p>
      <div className="editor-actionbar mb-6 flex flex-wrap items-center justify-between gap-3 border-b bg-background pb-4">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPreview(true)}
            disabled={!revision || dirty}
          >
            <Eye size={14} />
            Preview draft
          </Button>
          {kind === 'rules' ? (
            <Button variant="ghost" size="sm" onClick={() => setHistory(true)}>
              Revision history
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Page options"
              title="Page options"
              onClick={() => setTools(true)}
            >
              <Ellipsis size={18} />
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {edit && (
            <SaveButton size="sm" busy={busy} onClick={() => void save()} disabled={busy || !dirty}>
              <Save size={13} />
              Save draft
            </SaveButton>
          )}
          {publish && (
            <ConfirmButton
              variant="default"
              title="Publish this draft?"
              description="The current saved draft will replace the page visitors see."
              disabled={
                busy ||
                dirty ||
                !data.draftRevisionId ||
                data.draftRevisionId === data.publishedRevisionId
              }
              onConfirm={() =>
                void run(async () => {
                  await action({
                    type: 'page.publish',
                    slug: data.slug,
                    revisionId: data.draftRevisionId,
                  });
                  await reload();
                }, 'Page published.')
              }
            >
              <Send size={13} />
              Publish
            </ConfirmButton>
          )}
          {kind === 'rules' && publish && data.state === 'PUBLISHED' && (
            <ConfirmButton
              title="Unpublish this page?"
              description="The public page will be hidden until a draft is published again."
              disabled={busy}
              onConfirm={() =>
                void run(async () => {
                  await action({ type: 'page.unpublish', slug: data.slug });
                  await reload();
                }, 'Page unpublished.')
              }
            >
              Unpublish
            </ConfirmButton>
          )}
        </div>
      </div>
      {dirty && (
        <p className="mb-5 text-xs text-muted">
          Save your draft to preview the sanitized content before publishing.
        </p>
      )}
      <fieldset disabled={!edit || busy} className="space-y-6">
        <div className="max-w-3xl">
          <Field label="Page title">
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
              maxLength={120}
            />
          </Field>
        </div>
        {kind === 'rules' ? (
          <>
            <RichEditor
              value={html}
              onChange={(value) => {
                if (edit) {
                  setHtml(value);
                  setDirty(true);
                }
              }}
            />
            {ruleSections.length > 1 && (
              <div className="card p-6">
                <h2 className="mb-4 text-sm font-semibold">Section order</h2>
                <p className="mb-4 text-xs text-muted">
                  Rename headings in the editor. Move major sections here.
                </p>
                {ruleSections.map((s, i) => (
                  <div key={i} className="flex items-center justify-between border-b py-2 text-xs">
                    <span>
                      {s.match(/<h2[^>]*>(.*?)<\/h2>/)?.[1].replace(/<[^>]+>/g, '') ||
                        'Introduction'}
                    </span>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={i === 0}
                        aria-label="Move section up"
                        onClick={() => {
                          const next = [...ruleSections];
                          [next[i - 1], next[i]] = [next[i], next[i - 1]];
                          setHtml(next.join(''));
                          setDirty(true);
                        }}
                      >
                        <ArrowUp size={13} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={i === ruleSections.length - 1}
                        aria-label="Move section down"
                        onClick={() => {
                          const next = [...ruleSections];
                          [next[i + 1], next[i]] = [next[i], next[i + 1]];
                          setHtml(next.join(''));
                          setDirty(true);
                        }}
                      >
                        <ArrowDown size={13} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <ReorderList
              items={blocks}
              keyOf={(_, i) => String(i)}
              onChange={(next) => {
                setBlocks(next);
                setDirty(true);
              }}
              renderItem={(b, i) => (
                <details className="cms-block" open={i === 0}>
                  <summary className="cursor-pointer py-2 font-semibold">
                    <span className="mr-3 font-mono text-xs text-muted">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    {b.content.title || b.type}
                    {!b.visible && (
                      <span className="ml-3 text-xs font-normal text-muted">Hidden</span>
                    )}
                  </summary>
                  <div className="space-y-5 border-t pt-4">
                    <div className="flex flex-wrap items-center gap-4">
                      <Field label="Block type">
                        <select
                          value={b.type}
                          onChange={(e) => update(i, { type: e.target.value as Block['type'] })}
                        >
                          {['hero', 'text', 'image', 'announcements', 'buttons', 'timeline'].map(
                            (v) => (
                              <option key={v} value={v}>
                                {v[0].toUpperCase() + v.slice(1)}
                              </option>
                            ),
                          )}
                        </select>
                      </Field>
                      <label className="ml-auto flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={b.visible}
                          onChange={(e) => update(i, { visible: e.target.checked })}
                        />
                        Visible
                      </label>
                      <ConfirmButton
                        title="Remove this section?"
                        description="Save the draft to persist this change. Previous revisions remain available."
                        onConfirm={() => {
                          setBlocks(blocks.filter((_, j) => j !== i));
                          setDirty(true);
                        }}
                      >
                        <Trash2 size={13} />
                      </ConfirmButton>
                    </div>
                    <div className="grid-fields">
                      <Field label="Eyebrow / small label">
                        <input
                          value={b.content.eyebrow || ''}
                          onChange={(e) =>
                            update(i, { content: { ...b.content, eyebrow: e.target.value } })
                          }
                        />
                      </Field>
                      <Field label="Section title">
                        <textarea
                          rows={2}
                          className="min-h-20"
                          value={b.content.title || ''}
                          onChange={(e) =>
                            update(i, { content: { ...b.content, title: e.target.value } })
                          }
                        />
                      </Field>
                    </div>
                    {b.type === 'text' ? (
                      <div className="space-y-2">
                        <p className="text-xs font-medium">Rich text content</p>
                        <RichEditor
                          value={
                            b.content.html ||
                            `<p>${(b.content.text || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</p>`
                          }
                          onChange={(html) => update(i, { content: { ...b.content, html } })}
                        />
                      </div>
                    ) : (
                      <Field label="Body text">
                        <textarea
                          value={b.content.text || ''}
                          onChange={(e) =>
                            update(i, { content: { ...b.content, text: e.target.value } })
                          }
                        />
                      </Field>
                    )}
                    {['hero', 'image', 'announcements'].includes(b.type) && (
                      <MediaField
                        label="Section image"
                        value={b.content.image || ''}
                        canUpload={can(actor, 'media.upload')}
                        onChange={(image) => update(i, { content: { ...b.content, image } })}
                      />
                    )}
                    <div className="space-y-3">
                      <p className="text-xs font-medium">Buttons</p>
                      {b.content.buttons?.map((button, j) => (
                        <div key={j} className="flex flex-wrap gap-2">
                          <input
                            aria-label={`Button ${j + 1} label`}
                            className="min-w-32 flex-1"
                            value={button.label}
                            placeholder="Button label"
                            onChange={(e) =>
                              update(i, {
                                content: {
                                  ...b.content,
                                  buttons: b.content.buttons!.map((v, k) =>
                                    k === j ? { ...v, label: e.target.value } : v,
                                  ),
                                },
                              })
                            }
                          />
                          <input
                            aria-label={`Button ${j + 1} link`}
                            className="min-w-40 flex-[2]"
                            value={button.href}
                            placeholder="/mappools or https://…"
                            onChange={(e) =>
                              update(i, {
                                content: {
                                  ...b.content,
                                  buttons: b.content.buttons!.map((v, k) =>
                                    k === j ? { ...v, href: e.target.value } : v,
                                  ),
                                },
                              })
                            }
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Remove button"
                            onClick={() =>
                              update(i, {
                                content: {
                                  ...b.content,
                                  buttons: b.content.buttons!.filter((_, k) => k !== j),
                                },
                              })
                            }
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          update(i, {
                            content: {
                              ...b.content,
                              buttons: [
                                ...(b.content.buttons || []),
                                { label: 'Learn more', href: '/rules' },
                              ],
                            },
                          })
                        }
                      >
                        <Plus size={13} />
                        Add button
                      </Button>
                    </div>
                    {b.type === 'timeline' && (
                      <p className="text-xs text-muted">
                        Dates are managed in Tournament settings.
                      </p>
                    )}
                  </div>
                </details>
              )}
            />
            <Button
              variant="outline"
              className="w-full border-dashed"
              onClick={() => {
                setBlocks([
                  ...blocks,
                  { type: 'text', visible: true, content: { title: 'New section', text: '' } },
                ]);
                setDirty(true);
              }}
            >
              <Plus size={15} />
              Add section
            </Button>
          </>
        )}
      </fieldset>
      {kind === 'homepage' && (
        <Modal open={tools} onOpenChange={setTools} title="Page options">
          <div className="flex flex-wrap items-center gap-4">
            <Button
              variant="outline"
              onClick={() => {
                setTools(false);
                setHistory(true);
              }}
            >
              Revision history
            </Button>
            {publish && data.state === 'PUBLISHED' && (
              <ConfirmButton
                title="Unpublish this page?"
                description="The public page will be hidden until a draft is published again."
                disabled={busy}
                onConfirm={() =>
                  void run(async () => {
                    await action({ type: 'page.unpublish', slug: data.slug });
                    await reload();
                    setTools(false);
                  }, 'Page unpublished.')
                }
              >
                Unpublish
              </ConfirmButton>
            )}
          </div>
        </Modal>
      )}
      <Modal
        open={preview}
        onOpenChange={setPreview}
        title="Draft preview"
        description="Only authorized editors can see this saved draft."
        wide
      >
        {revision &&
          (kind === 'homepage' ? (
            <ContentBlocks page={revision} tournament={tournament} />
          ) : (
            <div className="prose" dangerouslySetInnerHTML={{ __html: revision.html }} />
          ))}
      </Modal>
      <Modal
        open={history}
        onOpenChange={setHistory}
        title="Revision history"
        description="Restoring creates a new draft. The published page stays visible."
      >
        {data.revisions.map((r) => (
          <div className="flex items-center justify-between gap-4 border-b py-4" key={r.id}>
            <div>
              <p className="text-sm">{r.title}</p>
              <p className="mt-1 text-xs text-muted">
                {new Date(r.createdAt).toLocaleString()}{' '}
                {r.id === data.publishedRevisionId ? '· Published' : ''}
              </p>
            </div>
            {edit && (
              <ConfirmButton
                variant="outline"
                title="Restore this revision?"
                description="Your current draft will be replaced with a copy of this revision."
                disabled={busy || dirty}
                onConfirm={() =>
                  void run(async () => {
                    await action({
                      type: 'page.restore',
                      slug: data.slug,
                      revisionId: r.id,
                      baseRevisionId: data.draftRevisionId,
                    });
                    await reload();
                    setHistory(false);
                  }, 'Revision restored as a new draft.')
                }
              >
                Restore
              </ConfirmButton>
            )}
          </div>
        ))}
      </Modal>
    </>
  );
}
