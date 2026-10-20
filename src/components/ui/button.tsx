import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
export const buttonVariants = cva(
  'inline-flex max-w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold whitespace-normal text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-[#22151c] hover:brightness-110',
        outline: 'border border-white/15 bg-white/[.025] hover:bg-white/10 text-foreground',
        ghost: 'text-muted hover:text-foreground hover:bg-white/5',
        destructive: 'bg-red-500/15 text-red-300 hover:bg-red-500/25',
      },
      size: { default: 'min-h-11 px-5 py-2.5', sm: 'min-h-10 px-3 py-2', icon: 'size-10 shrink-0' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);
export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
