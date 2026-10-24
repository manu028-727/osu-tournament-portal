'use client';
import Link from '@/components/tournament-scope';
import { useT } from '@/components/locale';

export function SectionNav({
  label,
  links,
  active,
}: {
  label: string;
  links: { label: string; href: string; value: string }[];
  active: string;
}) {
  const tr = useT();
  return (
    <nav
      aria-label={label}
      className="workspace-sections mb-6 flex gap-1 overflow-x-auto border-b pb-2"
    >
      {links.map((link) => (
        <Link
          key={link.value}
          href={link.href}
          aria-current={active === link.value ? 'page' : undefined}
          className="inline-flex min-h-11 shrink-0 items-center rounded-xl px-3 py-2 text-sm text-muted hover:bg-[var(--surface-hover)] aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary"
        >
          {tr(link.label)}
        </Link>
      ))}
    </nav>
  );
}
