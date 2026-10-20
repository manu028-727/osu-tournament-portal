export default function Loading() {
  return (
    <div className="wrap space-y-6 py-20" role="status" aria-label="Loading">
      <div className="skeleton h-8 w-40 rounded" />
      <div className="skeleton h-20 w-2/3 rounded" />
      <div className="skeleton h-64 rounded-2xl" />
    </div>
  );
}
