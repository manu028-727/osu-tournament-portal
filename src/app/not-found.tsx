import Link from 'next/link';
export default function NotFound() {
  return (
    <main id="main" className="wrap py-12">
      <p className="eyebrow">404 / NOT FOUND</p>
      <h1 className="mt-4 text-3xl font-semibold">Page not found</h1>
      <p className="mt-4 text-muted">The page may be unavailable or hasn’t been published.</p>
      <Link href="/" className="mt-8 inline-block text-sm text-primary">
        Back to home
      </Link>
    </main>
  );
}
