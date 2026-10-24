'use client';
import { useT } from '@/components/locale';

import { Button } from '@/components/ui/button';
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const tr = useT();
  return (
    <main id="main" className="wrap py-12">
      <h1 className="text-2xl font-semibold">{tr('Unable to load this page')}</h1>
      <p className="mt-4 text-muted">{tr('Please try again shortly.')}</p>
      <Button onClick={reset} className="mt-6">
        {tr('Try again')}
      </Button>
    </main>
  );
}
