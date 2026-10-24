'use client';
import { useT } from '@/components/locale';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { useEffect, useState } from 'react';
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Heading2,
  Heading3,
  Link2,
  ImageIcon,
  Minus,
  Table,
  Undo,
  Redo,
  Trash2,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Field, Modal } from './shared';
export function RichEditor({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const tr = useT();
  const [insert, setInsert] = useState<'link' | 'image' | null>(null),
    [url, setUrl] = useState('');
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false } }), Image, TableKit],
    content: value,
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: 'prose',
        role: 'textbox',
        'aria-label': tr('Rich text content'),
        'aria-multiline': 'true',
      },
    },
  });
  useEffect(() => {
    if (editor && value !== editor.getHTML())
      editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);
  if (!editor) return <div className="skeleton h-96 rounded-lg" />;
  const tools = [
    {
      label: tr('Bold'),
      Icon: Bold,
      active: editor.isActive('bold'),
      fn: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: tr('Italic'),
      Icon: Italic,
      active: editor.isActive('italic'),
      fn: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: tr('Underline'),
      Icon: Underline,
      active: editor.isActive('underline'),
      fn: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      label: tr('Heading 2'),
      Icon: Heading2,
      active: editor.isActive('heading', { level: 2 }),
      fn: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: tr('Heading 3'),
      Icon: Heading3,
      active: editor.isActive('heading', { level: 3 }),
      fn: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      label: tr('Bullet list'),
      Icon: List,
      active: editor.isActive('bulletList'),
      fn: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: tr('Numbered list'),
      Icon: ListOrdered,
      active: editor.isActive('orderedList'),
      fn: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: tr('Link'),
      Icon: Link2,
      active: editor.isActive('link'),
      fn: () => {
        setUrl(editor.getAttributes('link').href || '');
        setInsert('link');
      },
    },
    {
      label: tr('Insert image'),
      Icon: ImageIcon,
      fn: () => {
        setUrl('');
        setInsert('image');
      },
    },
    {
      label: tr('Divider'),
      Icon: Minus,
      fn: () => editor.chain().focus().setHorizontalRule().run(),
    },
    {
      label: tr('Insert table'),
      Icon: Table,
      fn: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    { label: tr('Undo'), Icon: Undo, fn: () => editor.chain().focus().undo().run() },
    { label: tr('Redo'), Icon: Redo, fn: () => editor.chain().focus().redo().run() },
  ];
  return (
    <>
      <div className="overflow-hidden rounded-lg border bg-background">
        <div className="flex flex-wrap gap-1 border-b bg-card p-2">
          {tools.map((t) => (
            <Button
              type="button"
              key={t.label}
              variant="ghost"
              size="icon"
              title={t.label}
              aria-label={t.label}
              aria-pressed={t.active}
              className={t.active ? 'bg-primary/10 text-primary' : ''}
              onClick={t.fn}
            >
              <t.Icon size={15} />
            </Button>
          ))}
          {editor.isActive('table') && (
            <>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => editor.chain().focus().addRowAfter().run()}
              >
                {tr('+ Row')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => editor.chain().focus().addColumnAfter().run()}
              >
                {tr('+ Column')}
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={tr('Delete table')}
                onClick={() => editor.chain().focus().deleteTable().run()}
              >
                <Trash2 size={14} />
              </Button>
            </>
          )}
        </div>
        <EditorContent editor={editor} />
      </div>
      <Modal
        open={!!insert}
        onOpenChange={() => setInsert(null)}
        title={insert === 'image' ? tr('Insert an image') : tr('Edit link')}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (insert === 'image') editor.chain().focus().setImage({ src: url }).run();
            else if (url)
              editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
            else editor.chain().focus().unsetLink().run();
            setInsert(null);
          }}
          className="space-y-5"
        >
          <Field
            label={tr('URL')}
            hint={tr('For uploaded images, copy the image URL from the media library.')}
          >
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://… or /api/media/…"
            />
          </Field>
          <Button type="submit">{tr('Insert')}</Button>
        </form>
      </Modal>
    </>
  );
}
