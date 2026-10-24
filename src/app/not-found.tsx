import { getServerT } from '@/lib/server-locale';
import Link from 'next/link';
export default async function NotFound() {
  const tr = await getServerT();
  return (
    <main id="main" className="wrap py-12">
      <p className="eyebrow">{tr('404 / NOT FOUND')}</p>
      <h1 className="mt-4 text-3xl font-semibold">{tr('Page not found')}</h1>
      <p className="mt-4 text-muted">
        {tr('The page may be unavailable or hasn’t been published.')}
      </p>
      <Link href="/" className="mt-8 inline-block text-sm text-primary">
        {tr('Back to home')}
      </Link>
    </main>
  );
}
