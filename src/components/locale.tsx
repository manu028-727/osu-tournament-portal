'use client';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { DropdownMenu } from 'radix-ui';
import { Check } from 'lucide-react';
import { translator, translateGeneratedMessage, type Locale } from '@/lib/i18n';
import { Button } from './ui/button';

const Context = createContext<{ language: Locale; set: (language: Locale) => void }>({
  language: 'en',
  set: () => {},
});
export function LocaleProvider({ initial, children }: { initial: Locale; children: ReactNode }) {
  const [language, setLanguage] = useState(initial);
  const router = useRouter();
  function set(next: Locale) {
    document.cookie = `portal_language=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    document.documentElement.lang = next;
    setLanguage(next);
    // Refresh server-rendered copy while retaining mounted editors and unsaved values.
    router.refresh();
  }
  return <Context.Provider value={{ language, set }}>{children}</Context.Provider>;
}
export const useLocale = () => useContext(Context).language;
export function useT() {
  const language = useLocale();
  return useMemo(() => translator(language), [language]);
}
// Use only for generated validation/provider feedback, never authored content.
export function Feedback({ message }: { message: string }) {
  return translateGeneratedMessage(useLocale(), message);
}
export function LanguageControl() {
  const { language, set } = useContext(Context);
  const t = useT();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('Interface language')}
          title={t('Interface language')}
        >
          <span className="font-mono text-xs font-semibold">{language.toUpperCase()}</span>
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="appearance-menu"
        >
          <DropdownMenu.RadioGroup
            value={language}
            onValueChange={(value) => {
              if (value === 'en' || value === 'it') set(value);
            }}
          >
            {(
              [
                ['en', 'English'],
                ['it', 'Italiano'],
              ] as const
            ).map(([value, name]) => (
              <DropdownMenu.RadioItem
                key={value}
                value={value}
                lang={value}
                className="appearance-option"
              >
                <span>{name}</span>
                <DropdownMenu.ItemIndicator>
                  <Check size={16} />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
