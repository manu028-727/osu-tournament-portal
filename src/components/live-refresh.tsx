'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Keeps a read-only page current while something is happening on it.
export function LiveRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
