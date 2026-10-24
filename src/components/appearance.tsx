'use client';
import { LanguageControl, useT } from '@/components/locale';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { DropdownMenu } from 'radix-ui';
import { Monitor, Moon, Sun, Check } from 'lucide-react';
import { Button } from './ui/button';
import { appearance, type Appearance } from '@/lib/theme';
const Context = createContext<{ value: Appearance; set: (value: Appearance) => void }>({
  value: 'system',
  set: () => {},
});
export function AppearanceProvider({
  initial,
  children,
}: {
  initial: Appearance;
  children: ReactNode;
}) {
  const [value, setValue] = useState(initial);
  function set(next: Appearance) {
    next = appearance(next);
    document.documentElement.dataset.appearance = next;
    document.cookie = `portal_appearance=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    setValue(next);
  }
  return <Context.Provider value={{ value, set }}>{children}</Context.Provider>;
}
export function AppearanceControl() {
  const tr = useT();
  const { value, set } = useContext(Context);
  const Icon = value === 'system' ? Monitor : value === 'light' ? Sun : Moon;
  return (
    <>
      <LanguageControl />
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={tr('Appearance')}
            title={tr('Appearance')}
          >
            <Icon size={19} />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={8}
            collisionPadding={12}
            className="appearance-menu"
          >
            <DropdownMenu.Label className="px-3 py-2 text-sm text-muted">
              {tr('Appearance')}
            </DropdownMenu.Label>
            <DropdownMenu.RadioGroup value={value} onValueChange={(next) => set(appearance(next))}>
              {(
                [
                  ['system', 'System', Monitor],
                  ['light', 'Light', Sun],
                  ['dark', 'Dark', Moon],
                ] as const
              ).map(([mode, label, ModeIcon]) => (
                <DropdownMenu.RadioItem key={mode} value={mode} className="appearance-option">
                  <ModeIcon size={17} />
                  <span>{tr(label)}</span>
                  <DropdownMenu.ItemIndicator>
                    <Check size={16} />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>
  );
}
