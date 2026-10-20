'use client';
import { Button } from '@/components/ui/button';
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main" className="wrap py-12">
      <h1 className="text-2xl font-semibold">Unable to load this page</h1>
      <p className="mt-4 text-muted">Please try again shortly.</p>
      <Button onClick={reset} className="mt-6">
        Try again
      </Button>
    </main>
  );
}
