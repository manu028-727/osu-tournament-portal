import { localeTag } from '@/lib/i18n';
import { getLocale, getServerT } from '@/lib/server-locale';
import { PageHeading, EmptyState } from '@/components/content';
import { publicPage, getTournament } from '@/lib/queries';
import { siteCopy } from '@/lib/copy';
import { tableOfContents } from '@/lib/rich-text';
export async function generateMetadata() {
  const tr = await getServerT();
  return { title: tr('Regolamento') };
}
export default async function Rules() {
  const language = await getLocale();
  const tr = await getServerT();
  const [page, t] = await Promise.all([publicPage('rules'), getTournament()]);
  const copy = siteCopy(t.settings?.copy);
  if (!page)
    return (
      <div className="wrap py-20">
        <EmptyState
          title={tr('Regolamento in preparazione')}
          description={tr('Il regolamento ufficiale sara pubblicato dagli organizzatori.')}
        />
      </div>
    );
  const toc = tableOfContents(page.html);
  const contents = toc.map((h, i) => (
    <a
      key={h.id}
      href={`#${h.id}`}
      className="flex gap-3 py-2 text-sm leading-5 text-muted hover:text-primary"
    >
      <span className="font-mono text-xs text-muted">{String(i + 1).padStart(2, '0')}</span>
      {h.text}
    </a>
  ));
  return (
    <div className="wrap pb-20">
      <PageHeading
        eyebrow={copy.rulesEyebrow}
        title={page.title}
        description={copy.rulesDescription}
      />
      <div className="rules-layout grid items-start gap-8 lg:grid-cols-[240px_1fr]">
        <aside className="rules-contents border-l pl-4 lg:sticky lg:top-24">
          <div className="hidden lg:block">
            <p className="eyebrow mb-3">{tr('IN QUESTA PAGINA')}</p>
            <nav aria-label={tr('Rules sections')} className="space-y-1">
              {contents}
            </nav>
          </div>
          <details className="lg:hidden">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">
              {tr('In questa pagina')}
            </summary>
            <nav aria-label={tr('Rules sections')} className="space-y-1">
              {contents}
            </nav>
          </details>
          <p className="mt-6 border-t pt-4 text-xs text-muted">
            {tr('Aggiornato il')}{' '}
            {page.createdAt.toLocaleDateString(localeTag(language), {
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
