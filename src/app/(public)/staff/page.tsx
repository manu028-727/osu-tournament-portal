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
        <div className="space-y-8">
          {categories.map((c) => (
            <section key={c.id}>
              <div className="mb-3 flex items-center gap-3 border-b pb-3">
                <h2 className="text-lg font-semibold">{c.name}</h2>
                <span className="text-xs text-muted">
                  {String(c.assignments.length).padStart(2, '0')}
                </span>
              </div>
              {c.description && <p className="mb-5 text-sm text-muted">{c.description}</p>}
              <div className="grid gap-x-7 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                {c.assignments.map(({ member: m, position }) => (
                  <a
                    key={m.id}
                    href={m.profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex min-w-0 gap-3 border-b py-4 hover:border-primary/40"
                  >
                    <img
                      src={m.customImage || m.avatarUrl}
                      alt={`Avatar di ${m.username}`}
                      className="size-11 shrink-0 rounded object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <h3 className="truncate font-semibold">{m.username}</h3>
                        <ArrowUpRight size={14} className="text-muted group-hover:text-primary" />
                      </div>
                      <p className="mt-0.5 text-sm text-primary">{position || c.name}</p>
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
