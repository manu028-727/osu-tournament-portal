'use client';
import { useLocale, useT } from '@/components/locale';
import { translateGeneratedMessage } from '@/lib/i18n';
import { validationFeedback } from '@/lib/validation-feedback';

import { tournamentApiUrl } from '@/components/tournament-scope';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useId,
  isValidElement,
  cloneElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { AlertDialog, Dialog } from 'radix-ui';
import { X, Check, AlertCircle, Loader2, ArrowUp, ArrowDown, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { startPolling } from '@/lib/polling';
export { useUnsaved } from '@/components/unsaved-navigation';
export { EditorPanel, EditingWorkspace } from './editing-workspace';
export function usePolling(reload: () => Promise<unknown>, delay = 3000, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    return startPolling(reload, delay, {
      active: () => document.visibilityState === 'visible' && navigator.onLine,
      listen: (resume) => {
        document.addEventListener('visibilitychange', resume);
        window.addEventListener('online', resume);
        window.addEventListener('offline', resume);
        return () => {
          document.removeEventListener('visibilitychange', resume);
          window.removeEventListener('online', resume);
          window.removeEventListener('offline', resume);
        };
      },
    });
  }, [reload, delay, enabled]);
}
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  url = tournamentApiUrl(url);
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options?.headers,
    },
    cache: 'no-store',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
export const action = <T,>(body: unknown) =>
  api<T>('/api/admin/action', { method: 'POST', body: JSON.stringify(body) });
export function useResource<T>(section: string, keepPreviousData = false) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const seq = ++generation.current;
    try {
      const value = await api<T>(`/api/admin/data?section=${section}`);
      if (seq === generation.current) {
        setData(value);
        setError('');
      }
      return value;
    } catch (e) {
      if (seq === generation.current) setError((e as Error).message);
      throw e;
    } finally {
      if (seq === generation.current) setLoading(false);
    }
  }, [section]);
  useEffect(() => {
    setLoading(true);
    if (!keepPreviousData) setData(null);
    void reload().catch(() => {});
    return () => {
      generation.current++;
    };
  }, [reload, keepPreviousData]);
  return { data, error, loading, reload };
}
const NoticeContext = createContext<(message: string, error?: boolean) => void>(() => {});
export function Notices({ children }: { children: ReactNode }) {
  const tr = useT();
  const language = useLocale();
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const notify = useCallback((message: string, error = false) => {
    setNotice({ message, error });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 6500);
  }, []);
  return (
    <NoticeContext.Provider value={notify}>
      {children}
      <div aria-live={notice?.error ? 'assertive' : 'polite'} aria-atomic="true">
        {notice && (
          <div
            role={notice.error ? 'alert' : 'status'}
            className={`toast fixed bottom-4 right-4 z-[100] flex max-w-[calc(100vw-32px)] items-start gap-3 rounded-md border bg-card p-4 text-sm shadow-lg ${notice.error ? 'border-red-300/50' : 'border-primary/40'}`}
          >
            {notice.error ? (
              <AlertCircle size={18} className="shrink-0 text-red-300" />
            ) : (
              <Check size={18} className="shrink-0 text-primary" />
            )}
            <span>{translateGeneratedMessage(language, notice.message)}</span>
            <button aria-label={tr('Dismiss notification')} onClick={() => setNotice(null)}>
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </NoticeContext.Provider>
  );
}
export function useTask() {
  const language = useLocale();
  const notify = useContext(NoticeContext);
  const [busy, setBusy] = useState(false);
  const run = async <T,>(fn: () => Promise<T>, message = 'Changes saved.') => {
    setBusy(true);
    try {
      const value = await fn();
      notify(message);
      return value;
    } catch (e) {
      notify(
        e && typeof e === 'object' && 'issues' in e && Array.isArray(e.issues)
          ? validationFeedback(e.issues, language)
          : (e as Error).message,
        true,
      );
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, notify };
}
export function useWorkspacePortal() {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setContainer(document.getElementById('workspace'));
  }, []);
  return container;
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const tr = useT();
  const container = useWorkspacePortal();
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/75" />
        <Dialog.Content
          onOpenAutoFocus={() => {
            returnFocus.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            if (returnFocus.current?.isConnected) {
              event.preventDefault();
              returnFocus.current.focus({ preventScroll: true });
            }
          }}
          className={`workspace-dialog fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-card p-5 shadow-xl md:p-6 ${wide ? 'max-w-6xl' : 'max-w-xl'}`}
        >
          <Dialog.Title className="pr-10 text-xl font-semibold">{title}</Dialog.Title>
          <Dialog.Description className={description ? 'mt-2 text-xs text-muted' : 'sr-only'}>
            {description || title}
          </Dialog.Description>
          <Dialog.Close
            className="absolute right-2 top-2 flex size-11 items-center justify-center rounded-xl text-muted hover:bg-[var(--surface-hover)] hover:text-foreground"
            aria-label={tr('Close dialog')}
          >
            <X size={18} />
          </Dialog.Close>
          <div className="mt-6">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function ConfirmButton({
  onConfirm,
  children,
  title,
  description,
  disabled = false,
  variant = 'destructive',
}: {
  onConfirm: () => void;
  children: ReactNode;
  title?: string;
  description?: string;
  disabled?: boolean;
  variant?: 'destructive' | 'outline' | 'default';
}) {
  const tr = useT();
  const container = useWorkspacePortal();
  const iconOnly = isValidElement<{ size?: number }>(children) && children.props.size !== undefined;
  title ??= tr('Confirm this action');
  description ??= tr('This action takes effect immediately. Please review before continuing.');
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <Button
          type="button"
          variant={variant}
          size="sm"
          disabled={disabled}
          title={title}
          aria-label={iconOnly ? title : undefined}
        >
          {children}
        </Button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal container={container}>
        <AlertDialog.Overlay className="fixed inset-0 z-[60] bg-black/75" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[60] max-h-[90dvh] w-[calc(100%-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-card p-5">
          <AlertDialog.Title className="text-lg font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-3 text-sm leading-6 text-muted">
            {description}
          </AlertDialog.Description>
          <div className="mt-7 flex justify-end gap-3">
            <AlertDialog.Cancel asChild>
              <Button type="button" variant="outline" size="sm">
                {tr('Cancel')}
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button type="button" variant={variant} size="sm" onClick={onConfirm}>
                {tr('Confirm')}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const labelId = useId();
  const control =
    isValidElement(children) &&
    typeof children.type === 'string' &&
    ['input', 'select', 'textarea'].includes(children.type)
      ? cloneElement(children as ReactElement<Record<string, unknown>>, {
          'aria-labelledby': labelId,
          ...(hint ? { 'aria-describedby': `${labelId}-hint` } : {}),
        })
      : children;
  return (
    <label className="field">
      <span id={labelId}>{label}</span>
      {control}
      {hint && (
        <span id={`${labelId}-hint`} className="text-xs font-normal leading-5 text-muted">
          {hint}
        </span>
      )}
    </label>
  );
}
export function LoadingState({ error, retry }: { error?: string; retry?: () => void }) {
  const tr = useT();
  const language = useLocale();
  return error ? (
    <div role="alert" className="border-l-2 border-red-300 bg-red-300/5 p-5">
      <AlertCircle size={20} className="mb-3 text-red-300" />
      <p className="mb-4 text-sm">{translateGeneratedMessage(language, error)}</p>
      <Button variant="outline" onClick={retry}>
        {tr('Try again')}
      </Button>
    </div>
  ) : (
    <div role="status" aria-label={tr('Loading')} className="space-y-3">
      <div className="skeleton h-8 max-w-64 rounded" />
      <div className="skeleton h-12 rounded" />
      <div className="skeleton h-12 rounded" />
      <div className="skeleton h-12 rounded" />
    </div>
  );
}
export function SaveButton({
  busy,
  children,
  ...props
}: { busy: boolean; children?: ReactNode } & React.ComponentProps<typeof Button>) {
  const tr = useT();
  return (
    <Button type="submit" disabled={busy} {...props}>
      {busy && <Loader2 size={14} className="animate-spin" />}
      {children === undefined ? tr('Save changes') : children}
    </Button>
  );
}
export function ReorderList<T>({
  items,
  onChange,
  renderItem,
  keyOf,
  compact = false,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  renderItem: (item: T, index: number) => ReactNode;
  keyOf: (item: T, index: number) => string;
  compact?: boolean;
}) {
  const tr = useT();
  const drag = useRef<number | null>(null);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    next.splice(to, 0, next.splice(from, 1)[0]);
    onChange(next);
  };
  return (
    <div className={compact ? 'divide-y' : 'space-y-3'}>
      {items.map((item, i) => (
        <div
          key={keyOf(item, i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (drag.current !== null) move(drag.current, i);
            drag.current = null;
          }}
          className={compact ? 'flex min-w-0 items-center gap-3 py-3' : 'card p-4'}
        >
          <div
            className={
              compact
                ? 'flex shrink-0 flex-col items-center sm:flex-row'
                : 'mb-3 flex items-center justify-between'
            }
          >
            <span
              draggable
              onDragStart={() => {
                drag.current = i;
              }}
              className={`cursor-grab p-1 text-muted ${compact ? 'hidden sm:inline-flex' : ''}`}
              title={tr('Drag to reorder')}
            >
              <GripVertical size={16} />
            </span>
            <div className={compact ? 'flex flex-col gap-1 sm:flex-row' : 'flex gap-1'}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => move(i, i - 1)}
                disabled={i === 0}
                aria-label={tr('Move up')}
              >
                <ArrowUp size={14} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => move(i, i + 1)}
                disabled={i === items.length - 1}
                aria-label={tr('Move down')}
              >
                <ArrowDown size={14} />
              </Button>
            </div>
          </div>
          {compact ? (
            <div className="min-w-0 flex-1">{renderItem(item, i)}</div>
          ) : (
            renderItem(item, i)
          )}
        </div>
      ))}
    </div>
  );
}
export function SectionTitle({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="workspace-heading mb-6 flex min-w-0 flex-wrap items-center justify-between gap-4 border-b pb-5">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {children}
    </div>
  );
}
