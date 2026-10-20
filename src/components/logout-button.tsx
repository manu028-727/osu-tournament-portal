'use client';
import { useState, type ComponentProps } from 'react';
import { Loader2, LogOut } from 'lucide-react';
export function LogoutButton({ children, onClick, ...props }: ComponentProps<'button'>) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <button
      {...props}
      type="button"
      disabled={busy || props.disabled}
      aria-busy={busy}
      title={error || props.title || 'Sign out'}
      onClick={async (event) => {
        event.preventDefault();
        onClick?.(event);
        if (busy) return;
        setBusy(true);
        setError('');
        try {
          const response = await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { Accept: 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store',
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Sign out failed. Please try again.');
          window.location.replace(result.redirectTo || '/');
        } catch (e) {
          setError((e as Error).message);
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 size={17} className="animate-spin" /> : <LogOut size={17} />}
      {error ? (
        <span role="alert" className="max-w-60 text-sm text-red-200">
          {error}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
