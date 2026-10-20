import { cn } from '@/lib/utils';
export function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold tracking-wide',
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
