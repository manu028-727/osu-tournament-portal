'use client';
import { useRef, useState } from 'react';
import { Upload, ImagePlus, Copy, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { ListPagination } from '../list-pagination';
import type { ListPage } from '@/lib/list-pagination';
import {
  api,
  ConfirmButton,
  Field,
  LoadingState,
  Modal,
  SectionTitle,
  useResource,
  useTask,
} from './shared';
type Asset = {
  id: string;
  name: string;
  width: number;
  height: number;
  size: number;
  createdAt: string;
};
export function MediaLibrary({ onSelect }: { onSelect?: (url: string) => void }) {
  const [page, setPage] = useState(1);
  const {
    data: result,
    error,
    reload,
    loading,
  } = useResource<ListPage<Asset>>(`media&paged=1&page=${page}`, true);
  const data = result?.items;
  const { busy, run, notify } = useTask();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const upload = (files: FileList | null) => {
    if (!files?.length) return;
    void run(async () => {
      for (const file of Array.from(files)) {
        if (file.size > 4 * 1024 * 1024)
          throw new Error(`${file.name}: choose an image up to 4 MB.`);
        const form = new FormData();
        form.append('file', file);
        await api('/api/media', { method: 'POST', body: form });
      }
      await reload();
    }, 'Images uploaded and optimized.');
  };
  return (
    <>
      {!onSelect && <SectionTitle title="Media library" />}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif"
        className="hidden"
        multiple
        onChange={(e) => {
          upload(e.target.files);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          upload(e.dataTransfer.files);
        }}
        className={`mb-6 flex w-full flex-wrap items-center justify-center gap-3 rounded-lg border border-dashed px-4 py-5 ${drag ? 'border-primary bg-primary/10' : 'bg-card hover:border-primary/40'}`}
      >
        <Upload size={24} className="text-primary" />
        <span className="text-sm font-medium">
          {busy ? 'Uploading images…' : 'Drop your images here, or click to browse'}
        </span>
        <span className="w-full text-xs text-muted">
          PNG, JPEG, WebP or AVIF · Up to 4 MB each · Optimized to WebP
        </span>
      </button>
      {!data ? (
        <LoadingState error={error} retry={() => void reload().catch(() => {})} />
      ) : data.length ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {data.map((a) => (
            <div key={a.id} className="card overflow-hidden">
              <button
                className="block aspect-video w-full overflow-hidden bg-black/20"
                disabled={!onSelect}
                onClick={() => onSelect?.(`/api/media/${a.id}`)}
                aria-label={`Select ${a.name}`}
              >
                <img src={`/api/media/${a.id}`} alt={a.name} className="size-full object-contain" />
              </button>
              <div className="p-4">
                <p className="truncate text-xs font-medium" title={a.name}>
                  {a.name}
                </p>
                <p className="mt-2 text-xs text-muted">
                  {a.width} × {a.height} · {Math.round(a.size / 1024)} KB
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {onSelect ? (
                    <Button size="sm" onClick={() => onSelect(`/api/media/${a.id}`)}>
                      Use image
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(`/api/media/${a.id}`)
                          .then(() => notify('Image URL copied.'))
                          .catch(() => notify('Could not access clipboard.', true))
                      }
                    >
                      <Copy size={12} />
                      URL
                    </Button>
                  )}
                  <ConfirmButton
                    title="Delete this image?"
                    description="Images used in content or revision history are protected from deletion."
                    disabled={busy}
                    onConfirm={() =>
                      void run(async () => {
                        await api(`/api/media/${a.id}`, { method: 'DELETE' });
                        await reload();
                      }, 'Image deleted.')
                    }
                  >
                    <Trash2 size={12} />
                  </ConfirmButton>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="border-b py-6">
          <p className="text-sm text-muted">No images uploaded.</p>
        </div>
      )}
      {result && <ListPagination {...result} onPage={setPage} busy={loading || busy} />}
    </>
  );
}
export function MediaField({
  label,
  value,
  onChange,
  canUpload = true,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  canUpload?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      <Field label={label}>
        <div className="flex gap-2">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Image URL or /api/media/…"
          />
          {canUpload && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(true)}
              aria-label={`Choose ${label}`}
            >
              <ImagePlus size={16} />
            </Button>
          )}
        </div>
      </Field>
      {value && (
        <img
          src={value}
          alt={`${label} preview`}
          className="h-28 max-w-full rounded-lg bg-black/20 object-contain"
        />
      )}
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Choose an image"
        description="Upload a replacement or reuse an image from your library."
        wide
      >
        {open && (
          <MediaLibrary
            onSelect={(url) => {
              onChange(url);
              setOpen(false);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
