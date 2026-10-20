'use client';
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main" className="wrap py-24 text-center">
      <h1 className="text-3xl font-semibold">Unable to load this page</h1>
      <p className="mt-4 text-muted">Please try again shortly.</p>
      <button onClick={reset} className="mt-8 rounded-lg bg-primary px-5 py-3 text-sm text-black">
        Try again
      </button>
    </main>
  );
}
