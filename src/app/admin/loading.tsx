import { getServerT } from '@/lib/server-locale';
export default async function Loading() {
  const tr = await getServerT();
  return (
    <div className="wrap space-y-6 py-20" role="status" aria-label={tr('Loading')}>
      <div className="skeleton h-8 w-40 rounded" />
      <div className="skeleton h-20 w-2/3 rounded" />
      <div className="skeleton h-64 rounded-lg" />
    </div>
  );
}
