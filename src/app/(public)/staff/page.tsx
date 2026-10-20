import { ArrowUpRight } from 'lucide-react';
import { PageHeading, EmptyState } from '@/components/content';
import { publicStaff, getTournament } from '@/lib/queries';
import { siteCopy } from '@/lib/copy';
export const metadata = { title: 'Staff' };
export default async function Staff() {
  const [groups, t] = await Promise.all([publicStaff(), getTournament()]);
  const categories = groups.filter((c) => c.assignments.length);
  const copy = siteCopy(t.settings?.copy);
  return (
    <div className="wrap pb-20">
      <PageHeading
        eyebrow={copy.staffEyebrow}
        title={copy.staffTitle}
        description={copy.staffDescription}
      />
      {categories.length ? (
        <div className="space-y-12">
          {categories.map((c) => (
            <section key={c.id}>
              <div className="mb-6 flex items-center gap-4">
                <h2 className="text-xl font-semibold tracking-tight">{c.name}</h2>
                <span className="text-xs text-muted">
                  {String(c.assignments.length).padStart(2, '0')}
                </span>
                <div className="h-px flex-1 bg-white/5" />
              </div>
              {c.description && <p className="mb-5 text-sm text-muted">{c.description}</p>}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {c.assignments.map(({ member: m, position }) => (
                  <a
                    key={m.id}
                    href={m.profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="card group flex gap-4 p-6 hover:border-primary/25"
                  >
                    <img
                      src={m.customImage || m.avatarUrl}
                      alt={`Avatar di ${m.username}`}
                      className="size-14 rounded-xl object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <h3 className="truncate font-semibold">{m.username}</h3>
                        <ArrowUpRight size={14} className="text-muted group-hover:text-primary" />
                      </div>
                      <p className="mt-1 text-[11px] text-primary">{position || c.name}</p>
                      {m.bio && <p className="mt-3 text-xs text-muted">{m.bio}</p>}
                    </div>
                  </a>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState title="Nessun membro dello staff pubblicato" />
      )}
    </div>
  );
}
