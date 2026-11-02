import { localeTag } from '@/lib/i18n';
import { getLocale, getServerT } from '@/lib/server-locale';
import Link from '@/components/tournament-scope';
import { ArrowUpRight } from 'lucide-react';
import { PageHeading, EmptyState } from '@/components/content';
import { publicTeamsPage } from '@/lib/teams-service';
import { listPageSchema } from '@/lib/list-pagination';
import { ListPagination } from '@/components/list-pagination';
export async function generateMetadata() {
  const tr = await getServerT();
  return { title: tr('Team e giocatori') };
}
export default async function Teams({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const language = await getLocale();
  const tr = await getServerT();
  const page = listPageSchema.safeParse((await searchParams).page);
  const result = await publicTeamsPage(page.success ? page.data : 1);
  const teams = result.items;
  return (
    <div className="wrap pb-20">
      <PageHeading
        eyebrow={tr('I PARTECIPANTI')}
        title={tr('Team e giocatori')}
        description={tr('Tournament entrants and registration decisions.')}
      />
      <Link
        href="/register"
        className="mb-5 inline-flex rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
      >
        {tr('Manage tournament registration')}
      </Link>
      <Link
        href="/qualifier-booking"
        className="mb-5 ml-2 inline-flex rounded-full border px-5 py-2 text-sm font-semibold"
      >
        {tr('Qualifier booking')}
      </Link>
      <ListPagination
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        previousHref={`/teams?page=${result.page - 1}`}
        nextHref={`/teams?page=${result.page + 1}`}
      />
      {teams.length ? (
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
          {teams.map((team) => (
            <Link
              href={`/teams/${team.slug}`}
              key={team.id}
              className="card group min-w-0 p-4 hover:border-primary/40"
            >
              <div className="mb-3 flex items-start gap-3">
                {team.logoImageId ? (
                  <img
                    className="size-11 shrink-0 rounded object-contain"
                    src={`/api/media/${team.logoImageId}`}
                    alt=""
                  />
                ) : (
                  <div
                    className="flex size-11 shrink-0 items-center justify-center rounded border font-mono text-sm text-muted"
                    aria-hidden="true"
                  >
                    {team.seed ? String(team.seed).padStart(2, '0') : team.name.slice(0, 2)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="break-words text-lg font-semibold leading-snug">{team.name}</h2>
                  {team.status === 'REJECTED' && (
                    <p className="mt-2 whitespace-pre-line text-sm text-red-300">
                      <strong>{tr('Rejected')}</strong>
                      {team.rejectionReason ? `: ${team.rejectionReason}` : ''}
                    </p>
                  )}
                  {team.seed && (
                    <p className="mt-1 text-sm text-accent">
                      {tr('Seed #')}
                      {team.seed}
                    </p>
                  )}
                  {team.qualifierPlayed === false && (
                    <p className="mt-1 text-xs text-muted">{tr('Qualifiche non disputate')}</p>
                  )}
                </div>
                <ArrowUpRight size={20} className="shrink-0 text-primary" />
              </div>
              <p className="text-sm text-muted">
                {tr('Capitano:')}{' '}
                {team.members.find((m) => m.captain)?.registeredUsername ||
                  team.members.find((m) => m.captain)?.participant.username}
              </p>
              <p className="mt-1 text-sm text-muted">
                {team.members.length}{' '}
                {team.members.length === 1 ? tr('giocatore') : tr('giocatori')}
              </p>
              {team.rankSum && (
                <p className="mt-1 text-xs text-muted">
                  {tr('Rank sum all’iscrizione:')}{' '}
                  {team.rankSum.toLocaleString(localeTag(language))}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                {team.members.map((m) => (
                  <img
                    key={m.osuId}
                    src={m.participant.avatarUrl}
                    alt={m.participant.username}
                    title={m.participant.username}
                    className="size-8 rounded object-cover"
                  />
                ))}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState title={tr('Nessuna squadra pubblicata')} />
      )}
      <ListPagination
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        previousHref={`/teams?page=${result.page - 1}`}
        nextHref={`/teams?page=${result.page + 1}`}
      />
    </div>
  );
}
