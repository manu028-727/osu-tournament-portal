'use client';
import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from './locale';

type Guard = { dirty: boolean; message: string };
// One listener set and one prompt, even when several stage rows are dirty.
const guards = new Set<Guard>();
let approved: { href: string; expires: number } | null = null;
function samePage(href: string) {
  const target = new URL(href, location.href);
  return (
    target.origin === location.origin &&
    target.pathname === location.pathname &&
    target.search === location.search
  );
}
function activeGuard() {
  return [...guards].find((guard) => guard.dirty);
}
function isApproved(href?: string) {
  return (
    !!approved &&
    approved.expires > Date.now() &&
    (!href || approved.href === new URL(href, location.href).href)
  );
}
function allowNavigation(href: string) {
  if (samePage(href)) return true;
  approved = null;
  const guard = activeGuard();
  if (!guard) return true;
  if (!window.confirm(guard.message)) return false;
  approved = { href: new URL(href, location.href).href, expires: Date.now() + 10_000 };
  return true;
}
type NavigationEvent = Event & { destination: { url: string; sameDocument: boolean } };
function listen() {
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!activeGuard() || isApproved()) return;
    event.preventDefault();
    event.returnValue = '';
  };
  const click = (event: MouseEvent) => {
    const anchor = event.target instanceof Element ? event.target.closest('a') : null;
    if (
      !anchor ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (anchor.target && anchor.target !== '_self') ||
      anchor.hasAttribute('download') ||
      !/^https?:$/.test(anchor.protocol)
    )
      return;
    if (!allowNavigation(anchor.href)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const navigate = (event: Event) => {
    const { destination } = event as NavigationEvent;
    // Cross-document exits use the browser's unload prompt. Forced traversals
    // can be non-cancelable; never pretend that every browser exit is preventable.
    if (
      !event.cancelable ||
      !destination.sameDocument ||
      samePage(destination.url) ||
      isApproved(destination.url)
    )
      return;
    if (!allowNavigation(destination.url)) event.preventDefault();
  };
  const navigation = (window as Window & { navigation?: EventTarget }).navigation;
  window.addEventListener('beforeunload', beforeUnload);
  document.addEventListener('click', click, true);
  navigation?.addEventListener('navigate', navigate);
  return () => {
    window.removeEventListener('beforeunload', beforeUnload);
    document.removeEventListener('click', click, true);
    navigation?.removeEventListener('navigate', navigate);
    approved = null;
  };
}
let stopListening: (() => void) | undefined;
export function useUnsaved(dirty: boolean) {
  const tr = useT();
  const guard = useRef<Guard>({ dirty: false, message: '' });
  useEffect(() => {
    guard.current.dirty = dirty;
    guard.current.message = tr('You have unsaved changes. Leave this editor?');
  }, [dirty, tr]);
  useEffect(() => {
    if (!dirty) return;
    const entry = guard.current;
    guards.add(entry);
    if (guards.size === 1) stopListening = listen();
    return () => {
      guards.delete(entry);
      if (!guards.size) {
        stopListening?.();
        stopListening = undefined;
      }
    };
  }, [dirty]);
  // Call only after a successful save or an explicit discard confirmation.
  return useCallback(() => {
    guard.current.dirty = false;
  }, []);
}
export function useGuardedRouter() {
  const router = useRouter();
  return {
    ...router,
    push: (...args: Parameters<typeof router.push>) => {
      if (allowNavigation(args[0])) router.push(...args);
    },
    replace: (...args: Parameters<typeof router.replace>) => {
      if (allowNavigation(args[0])) router.replace(...args);
    },
  };
}
export function useDialogClose(dirty: boolean, busy: boolean, onClose: () => void) {
  const tr = useT();
  const acknowledge = useUnsaved(dirty);
  return (after = onClose) => {
    if (busy || (dirty && !window.confirm(tr('Discard unsaved changes?')))) return;
    acknowledge();
    after();
  };
}
