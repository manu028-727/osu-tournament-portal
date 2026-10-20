import { PageHeading, EmptyState } from '@/components/content';
import { publicPage, getTournament } from '@/lib/queries';
import { siteCopy } from '@/lib/copy';
import { tableOfContents } from '@/lib/rich-text';
export const metadata = { title: 'Regolamento' };
export default async function Rules() {
  const [page, t] = await Promise.all([publicPage('rules'), getTournament()]);
  const copy = siteCopy(t.settings?.copy);
  if (!page)
    return (
      <div className="wrap py-20">
        <EmptyState
          title="Regolamento in preparazione"
          description="Il regolamento ufficiale sara pubblicato dagli organizzatori."
        />
      </div>
    );
  const toc = tableOfContents(page.html);
  return (
    <div className="wrap pb-20">
      <PageHeading
        eyebrow={copy.rulesEyebrow}
        title={page.title}
        description={copy.rulesDescription}
      />
      <div className="grid items-start gap-12 lg:grid-cols-[240px_1fr]">
        <aside className="border-l border-white/10 pl-6 lg:sticky lg:top-28">
          <p className="eyebrow mb-5">IN QUESTA PAGINA</p>
          <nav aria-label="Rules sections" className="space-y-4">
            {toc.map((h, i) => (
              <a
                key={h.id}
                href={`#${h.id}`}
                className="flex gap-3 text-xs leading-5 text-muted hover:text-primary"
              >
                <span className="text-white/25">{String(i + 1).padStart(2, '0')}</span>
                {h.text}
              </a>
            ))}
          </nav>
          <p className="mt-6 border-t border-white/5 pt-4 text-[10px] text-muted">
            Aggiornato il{' '}
            {page.createdAt.toLocaleDateString('it-IT', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC',
            })}
          </p>
        </aside>
        <article
          className="prose min-w-0 max-w-3xl [&>h2:first-child]:mt-0"
          dangerouslySetInnerHTML={{ __html: page.html }}
        />
      </div>
    </div>
  );
}
