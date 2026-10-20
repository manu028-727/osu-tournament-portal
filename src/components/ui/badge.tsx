import { cn } from '@/lib/utils';
export function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-card px-2 py-0.5 text-xs font-semibold',
        className,
      )}
    >
      {children}
    </span>
  );
}
export function StateBadge({ state }: { state: string }) {
  return (
    <Badge
      className={
        state === 'PUBLISHED'
          ? 'border-emerald-300/20 bg-emerald-300/5 text-emerald-300'
          : state === 'UNPUBLISHED'
            ? 'text-muted'
            : 'border-amber-200/15 bg-amber-200/5 text-amber-200'
      }
    >
      <span className="size-1 rounded-full bg-current" />
      {state.charAt(0) + state.slice(1).toLowerCase()}
    </Badge>
  );
}
export function MatchStatusBadge({
  status,
  children,
}: {
  status: string;
  children: React.ReactNode;
}) {
  const tone =
    status === 'IN_PROGRESS'
      ? 'border-emerald-300/30 bg-emerald-300/5 text-emerald-200'
      : ['DISPUTED', 'AWAITING_CONFIRMATION'].includes(status)
        ? 'border-amber-200/30 bg-amber-200/5 text-amber-200'
        : status === 'COMPLETED'
          ? 'text-foreground'
          : 'text-muted';
  return (
    <Badge className={tone}>
      {status === 'IN_PROGRESS' && (
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      )}
      {children}
    </Badge>
  );
}
