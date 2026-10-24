'use client';
import { useT } from '@/components/locale';

import { useState } from 'react';
import { Upload, Save, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, Field, useTask } from './shared';
export type PlatformConfig = {
  name: string;
  rootMode: string;
  defaultTournamentId: string | null;
  description: string;
  logo: string;
  favicon: string;
  socialImage: string;
  primaryDomain: string;
  footer: string;
  contact: string;
  timezone: string;
  locale: string;
  primaryColor: string;
  accentColor: string;
  socialLinks: { label: string; href: string }[];
};
export function PlatformSettingsEditor({
  platform,
  tournaments,
  onSave,
}: {
  platform: PlatformConfig;
  tournaments: { id: string; name: string; published: boolean }[];
  onSave: (body: unknown) => Promise<unknown>;
}) {
  const tr = useT();
  const { busy, run } = useTask();
  const [links, setLinks] = useState(platform.socialLinks);
  const [images, setImages] = useState({
    logo: platform.logo,
    favicon: platform.favicon,
    socialImage: platform.socialImage,
  });
  return (
    <form
      className="mt-12 space-y-5 border-t pt-8"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void run(
          () =>
            onSave({ type: 'platform', ...Object.fromEntries(f), ...images, socialLinks: links }),
          tr('Platform settings saved.'),
        );
      }}
    >
      <h2 className="text-xl font-semibold">{tr('Platform settings')}</h2>
      <div className="grid-fields">
        {(['name', 'description', 'primaryDomain', 'footer', 'contact', 'timezone'] as const).map(
          (key) => (
            <Field
              key={key}
              label={tr(
                {
                  name: 'Platform name',
                  description: 'Description',
                  primaryDomain: 'Primary domain',
                  footer: 'Footer',
                  contact: 'Contact',
                  timezone: 'Default timezone',
                }[key],
              )}
            >
              <input
                name={key}
                defaultValue={platform[key]}
                required={key === 'name' || key === 'timezone'}
              />
            </Field>
          ),
        )}
        <Field
          label={tr('Default interface language')}
          hint={tr(
            'Visitors can choose English or Italian. Other saved language codes fall back to English.',
          )}
        >
          <select name="locale" defaultValue={platform.locale}>
            {['en', 'it', 'de', 'fr', 'es', 'ja'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label={tr('Root page')}>
          <select name="rootMode" defaultValue={platform.rootMode}>
            <option value="DIRECTORY">{tr('Tournament directory')}</option>
            <option value="FEATURED">{tr('Featured tournament')}</option>
          </select>
        </Field>
        <Field label={tr('Featured tournament')}>
          <select name="defaultTournamentId" defaultValue={platform.defaultTournamentId || ''}>
            <option value="">{tr('None')}</option>
            {tournaments
              .filter((t) => t.published)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </Field>
        {(['primaryColor', 'accentColor'] as const).map((key) => (
          <Field
            key={key}
            label={key === 'primaryColor' ? tr('Primary color') : tr('Accent color')}
          >
            <input type="color" name={key} defaultValue={platform[key]} />
          </Field>
        ))}
        {(['logo', 'favicon', 'socialImage'] as const).map((key) => (
          <div key={key} className="space-y-2 min-w-0">
            <Field
              label={tr(
                { logo: 'Site logo', favicon: 'Favicon', socialImage: 'Social preview image' }[key],
              )}
            >
              <input
                value={images[key]}
                onChange={(e) => setImages({ ...images, [key]: e.target.value })}
              />
            </Field>
            <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-primary">
              <Upload size={16} />
              {tr('Upload image')}
              <input
                className="sr-only"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/avif"
                aria-label={tr('Upload {0}', key)}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file)
                    void run(async () => {
                      const form = new FormData();
                      form.set('file', file);
                      const result = await api<{ url: string }>('/api/platform/media', {
                        method: 'POST',
                        body: form,
                      });
                      setImages((current) => ({ ...current, [key]: result.url }));
                    }, tr('Image uploaded. Save settings to apply.'));
                }}
              />
            </label>
            {images[key] && (
              <img src={images[key]} alt="" className="h-12 max-w-full object-contain" />
            )}
          </div>
        ))}
      </div>
      <fieldset className="space-y-3">
        <legend className="mb-3">{tr('Social links')}</legend>
        {links.map((l, i) => (
          <div className="flex flex-wrap items-end gap-3" key={i}>
            <Field label={tr('Link {0} label', i + 1)}>
              <input
                value={l.label}
                required
                onChange={(e) =>
                  setLinks((current) =>
                    current.map((v, j) => (j === i ? { ...v, label: e.target.value } : v)),
                  )
                }
              />
            </Field>
            <Field label={tr('Link {0} URL', i + 1)}>
              <input
                value={l.href}
                required
                onChange={(e) =>
                  setLinks((current) =>
                    current.map((v, j) => (j === i ? { ...v, href: e.target.value } : v)),
                  )
                }
              />
            </Field>
            <Button
              type="button"
              variant="outline"
              size="icon"
              title={tr('Remove social link')}
              onClick={() => setLinks((current) => current.filter((_, j) => j !== i))}
            >
              <Trash2 size={16} />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={links.length >= 15}
          onClick={() => setLinks([...links, { label: '', href: '' }])}
        >
          <Plus size={16} />
          {tr('Add social link')}
        </Button>
      </fieldset>
      <Button disabled={busy}>
        <Save size={16} />
        {tr('Save platform settings')}
      </Button>
    </form>
  );
}
