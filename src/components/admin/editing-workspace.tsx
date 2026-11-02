'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '../ui/button';
import { useT } from '../locale';
import { useUnsaved } from '../unsaved-navigation';
import styles from './editing-workspace.module.css';

const EditorHost = createContext<HTMLElement | null>(null);

export function EditingWorkspace({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  return (
    <EditorHost.Provider value={host}>
      <div className={styles.layout}>
        <div className={styles.content}>{children}</div>
        <aside ref={setHost} className={styles.sidebar} />
      </div>
    </EditorHost.Provider>
  );
}

// Routine forms stay beside their source collection. Destructive confirmations,
// private previews and Referee Mode continue using the established Modal.
export function EditorPanel({
  open,
  onOpenChange,
  title,
  description,
  children,
  guardChanges = false,
  busy = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
  guardChanges?: boolean;
  busy?: boolean;
}) {
  const host = useContext(EditorHost);
  const element = useRef<HTMLElement | null>(null);
  const tr = useT();
  const [changed, setChanged] = useState(false);
  const acknowledge = useUnsaved(open && guardChanges && changed);
  useEffect(() => {
    if (!open) setChanged(false);
  }, [open]);
  const close = () => {
    if (busy || (guardChanges && changed && !window.confirm(tr('Discard unsaved changes?'))))
      return;
    acknowledge();
    onOpenChange(false);
  };
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      const first = element.current?.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not(:disabled),select:not(:disabled),textarea:not(:disabled)',
      );
      (first || element.current)?.focus({ preventScroll: true });
      element.current?.scrollIntoView({ block: 'nearest' });
    });
    return () => {
      cancelAnimationFrame(frame);
      if (opener?.isConnected) opener.focus();
    };
  }, [open, host]);
  if (!open) return null;
  const panel = (
    <section
      ref={element}
      role="dialog"
      aria-modal={false}
      aria-label={title}
      tabIndex={-1}
      onChangeCapture={() => {
        if (guardChanges) setChanged(true);
      }}
      className={styles.panel}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <header className="mb-4 flex items-start justify-between gap-3 border-b pb-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold break-words">{title}</h2>
          {description && <p className="mt-2 text-sm text-muted">{description}</p>}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={tr('Close dialog')}
          disabled={busy}
          onClick={close}
        >
          <X size={18} />
        </Button>
      </header>
      {children}
    </section>
  );
  return host ? createPortal(panel, host) : panel;
}
