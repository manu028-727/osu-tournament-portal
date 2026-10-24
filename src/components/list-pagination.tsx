'use client';
import { useT } from '@/components/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from './tournament-scope';
import { Button } from './ui/button';

export function ListPagination({
  page,
  pageSize,
  total,
  previousHref,
  nextHref,
  onPage,
  busy = false,
}: {
  page: number;
  pageSize: number;
  total: number;
  previousHref?: string;
  nextHref?: string;
  onPage?: (page: number) => void;
  busy?: boolean;
}) {
  const tr = useT();
  const last = Math.max(1, Math.ceil(total / pageSize));
  if (last === 1) return null;
  return (
    <nav
      aria-label={tr('Pagination')}
      className="my-5 flex flex-wrap items-center justify-between gap-3"
    >
      <p className="text-sm text-muted">
        {tr('Page')} {page} {tr('of')} {last} · {total} {tr('entries')}
      </p>
      <div className="flex gap-2">
        {previousHref && page > 1 ? (
          <Button asChild variant="outline" size="sm">
            <Link href={previousHref}>
              <ChevronLeft size={16} />
              {tr('Previous')}
            </Link>
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={busy || page === 1}
            onClick={onPage ? () => onPage(page - 1) : undefined}
          >
            <ChevronLeft size={16} />
            {tr('Previous')}
          </Button>
        )}
        {nextHref && page < last ? (
          <Button asChild variant="outline" size="sm">
            <Link href={nextHref}>
              {tr('Next')}
              <ChevronRight size={16} />
            </Link>
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={busy || page === last}
            onClick={onPage ? () => onPage(page + 1) : undefined}
          >
            {tr('Next')}
            <ChevronRight size={16} />
          </Button>
        )}
      </div>
    </nav>
  );
}
