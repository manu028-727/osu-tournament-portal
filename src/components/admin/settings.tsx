'use client';
import { ExportTournamentButton } from './tournament-export-button';
import { useEffect, useState } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import { Tabs } from 'radix-ui';
import { Button } from '../ui/button';
import type { TournamentView } from '@/lib/types';
import { MediaField } from './media';
import { can, type Actor } from '@/lib/permissions';
import { DEFAULT_COPY, siteCopy } from '@/lib/copy';
import {
  action,
  Field,
  LoadingState,
  ReorderList,
  SaveButton,
  SectionTitle,
  useResource,
  useTask,
  useUnsaved,
} from './shared';
type SettingsData = TournamentView & { settings: TournamentView['settings'] & { favicon: string } };
type Form = Omit<SettingsData, 'settings'> & SettingsData['settings'];
export function SettingsEditor({ actor }: { actor: Actor }) {
  const { data, error, reload } = useResource<SettingsData>('settings');
  const [form, setForm] = useState<Form | null>(null),
    [dirty, setDirty] = useState(false);
  const { busy, run } = useTask();
  useUnsaved(dirty);
  useEffect(() => {
    if (data) {
      const { settings, ...t } = data;
      setForm({ ...t, ...settings, copy: siteCopy(settings.copy) });
      setDirty(false);
    }
  }, [data]);
  const update = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setDirty(true);
  };
  if (!form) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await action({ type: 'settings.save', ...form });
          await reload();
        }, 'Tournament settings saved. Refresh public pages to see the new branding.');
      }}
    >
      <SectionTitle title="Tournament settings">
        <SaveButton busy={busy} disabled={busy || !dirty}>
          <Save size={14} />
          Save settings
        </SaveButton>
      </SectionTitle>
      <fieldset disabled={busy} className="space-y-7">
        <Tabs.Root defaultValue="identity" className="space-y-6">
          <Tabs.List
            aria-label="Settings sections"
            className="flex flex-wrap gap-x-4 gap-y-1 border-b"
          >
            {[
              ['identity', 'Identity'],
              ['branding', 'Branding'],
              ['registration', 'Registration'],
              ['navigation', 'Navigation'],
              ['copy', 'Page labels & footer'],
            ].map(([value, label]) => (
              <Tabs.Trigger
                key={value}
                value={value}
                className="min-h-11 border-b-2 border-transparent px-1 py-2 text-sm text-muted data-[state=active]:border-primary data-[state=active]:text-primary"
              >
                {label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <Tabs.Content value="identity" className="space-y-6">
            <div className="form-section space-y-5">
              <h2 className="text-lg font-semibold tracking-normal">Tournament identity</h2>
              <div className="grid-fields">
                <Field label="Tournament name">
                  <input
                    required
                    maxLength={120}
                    value={form.name}
                    onChange={(e) => update('name', e.target.value)}
                  />
                </Field>
                <Field label="Acronym">
                  <input
                    required
                    maxLength={20}
                    value={form.acronym}
                    onChange={(e) => update('acronym', e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Description">
                <textarea
                  value={form.description}
                  onChange={(e) => update('description', e.target.value)}
                  maxLength={2000}
                />
              </Field>
              <div className="grid-fields">
                <Field label="Tournament status">
                  <select value={form.status} onChange={(e) => update('status', e.target.value)}>
                    {['DRAFT', 'UPCOMING', 'REGISTRATIONS_OPEN', 'ONGOING', 'COMPLETED'].map(
                      (s) => (
                        <option key={s} value={s}>
                          {s.replaceAll('_', ' ').toLowerCase()}
                        </option>
                      ),
                    )}
                  </select>
                </Field>
                <Field
                  label="Game mode"
                  hint="Unpublish existing pools before changing modes. Imported maps must match the selected mode."
                >
                  <select
                    value={form.gameMode}
                    onChange={(e) => update('gameMode', e.target.value)}
                  >
                    {['osu', 'taiko', 'fruits', 'mania'].map((m) => (
                      <option key={m} value={m}>
                        {m === 'osu' ? 'osu!standard' : `osu!${m}`}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
            <div className="grid-fields">
              <Field label="Timezone">
                <input
                  value={form.timezone || 'UTC'}
                  onChange={(e) => update('timezone', e.target.value)}
                  required
                />
              </Field>
              <Field label="Format">
                <select
                  value={form.format || 'CUSTOM'}
                  onChange={(e) => update('format', e.target.value)}
                >
                  <option value="SOLO">1v1</option>
                  <option value="TEAMS">Teams</option>
                  <option value="CUSTOM">Custom</option>
                </select>
              </Field>
              {(['startsAt', 'endsAt'] as const).map((key) => (
                <Field key={key} label={key === 'startsAt' ? 'Start date' : 'End date'}>
                  <input
                    type="datetime-local"
                    value={form[key]?.slice(0, 16) || ''}
                    onChange={(e) =>
                      update(key, e.target.value ? new Date(e.target.value).toISOString() : null)
                    }
                  />
                </Field>
              ))}
            </div>
          </Tabs.Content>
          <Tabs.Content value="branding">
            <div className="form-section space-y-5">
              <h2 className="text-lg font-semibold tracking-normal">Visual identity</h2>
              <div className="grid-fields">
                <MediaField
                  canUpload={can(actor, 'media.upload')}
                  label="Tournament logo"
                  value={form.logo}
                  onChange={(v) => update('logo', v)}
                />
                <MediaField
                  canUpload={can(actor, 'media.upload')}
                  label="Favicon"
                  value={form.favicon}
                  onChange={(v) => update('favicon', v)}
                />
              </div>
              <MediaField
                canUpload={can(actor, 'media.upload')}
                label="Main banner"
                value={form.banner}
                onChange={(v) => update('banner', v)}
              />
              <div className="grid-fields">
                <Field label="Primary color">
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={form.primaryColor}
                      onChange={(e) => update('primaryColor', e.target.value)}
                    />
                    <span className="font-mono text-xs text-muted">{form.primaryColor}</span>
                  </div>
                </Field>
                <Field label="Accent color">
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={form.accentColor}
                      onChange={(e) => update('accentColor', e.target.value)}
                    />
                    <span className="font-mono text-xs text-muted">{form.accentColor}</span>
                  </div>
                </Field>
              </div>
            </div>
          </Tabs.Content>
          <Tabs.Content value="registration">
            <div className="form-section space-y-5">
              <h2 className="text-lg font-semibold tracking-normal">
                Registration & important dates
              </h2>
              <Field label="Registration link">
                <input
                  value={form.registrationUrl}
                  onChange={(e) => update('registrationUrl', e.target.value)}
                  placeholder="https://…"
                />
              </Field>
              <ReorderList
                items={form.importantDates}
                keyOf={(_, i) => String(i)}
                onChange={(next) => update('importantDates', next)}
                renderItem={(date, i) => (
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-40 flex-1">
                      <Field label="Date label">
                        <input
                          required
                          value={date.label}
                          onChange={(e) =>
                            update(
                              'importantDates',
                              form.importantDates.map((v, j) =>
                                i === j ? { ...v, label: e.target.value } : v,
                              ),
                            )
                          }
                        />
                      </Field>
                    </div>
                    <div className="min-w-40 flex-1">
                      <Field label="Date (UTC)">
                        <input
                          type="date"
                          required
                          value={date.date}
                          onChange={(e) =>
                            update(
                              'importantDates',
                              form.importantDates.map((v, j) =>
                                i === j ? { ...v, date: e.target.value } : v,
                              ),
                            )
                          }
                        />
                      </Field>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remove date"
                      onClick={() =>
                        update(
                          'importantDates',
                          form.importantDates.filter((_, j) => i !== j),
                        )
                      }
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                )}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  update('importantDates', [
                    ...form.importantDates,
                    { label: 'New milestone', date: new Date().toISOString().slice(0, 10) },
                  ])
                }
              >
                <Plus size={13} />
                Add date
              </Button>
            </div>
          </Tabs.Content>
          <Tabs.Content value="navigation" className="space-y-6">
            {(['navigation', 'socialLinks'] as const).map((key) => (
              <div className="form-section space-y-5" key={key}>
                <h2 className="text-lg font-semibold tracking-normal">
                  {key === 'navigation' ? 'Website navigation' : 'Social links'}
                </h2>
                <ReorderList
                  items={form[key]}
                  keyOf={(_, i) => String(i)}
                  onChange={(next) => update(key, next)}
                  renderItem={(link, i) => (
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="min-w-32 flex-1">
                        <Field label="Label">
                          <input
                            required
                            value={link.label}
                            onChange={(e) =>
                              update(
                                key,
                                form[key].map((v, j) =>
                                  i === j ? { ...v, label: e.target.value } : v,
                                ),
                              )
                            }
                          />
                        </Field>
                      </div>
                      <div className="min-w-40 flex-[2]">
                        <Field label="URL">
                          <input
                            value={link.href}
                            onChange={(e) =>
                              update(
                                key,
                                form[key].map((v, j) =>
                                  i === j ? { ...v, href: e.target.value } : v,
                                ),
                              )
                            }
                          />
                        </Field>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Remove link"
                        onClick={() =>
                          update(
                            key,
                            form[key].filter((_, j) => i !== j),
                          )
                        }
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  )}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => update(key, [...form[key], { label: 'New link', href: '/' }])}
                >
                  <Plus size={13} />
                  Add link
                </Button>
              </div>
            ))}
          </Tabs.Content>
          <Tabs.Content value="copy" className="space-y-6">
            <div className="form-section space-y-5">
              <h2 className="text-lg font-semibold tracking-normal">
                Public page introductions & labels
              </h2>
              <p className="text-xs text-muted">
                Customize page headings, introductions, and reusable labels without changing source
                code.
              </p>
              <div className="grid-fields">
                {Object.keys(DEFAULT_COPY).map((key) => (
                  <Field
                    key={key}
                    label={key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}
                  >
                    <textarea
                      className="min-h-20"
                      value={siteCopy(form.copy)[key as keyof typeof DEFAULT_COPY]}
                      onChange={(e) =>
                        update('copy', { ...siteCopy(form.copy), [key]: e.target.value })
                      }
                    />
                  </Field>
                ))}
              </div>
            </div>
            <div className="form-section space-y-5">
              <h2 className="text-lg font-semibold tracking-normal">Footer & credits</h2>
              <Field label="Footer content">
                <textarea
                  value={form.footer}
                  onChange={(e) => update('footer', e.target.value)}
                  maxLength={1000}
                />
              </Field>
            </div>
          </Tabs.Content>
        </Tabs.Root>
        <div className="flex items-center justify-end gap-4">
          {can(actor, 'users.manage') && can(actor, 'roles.manage') && <ExportTournamentButton />}
          {dirty && <span className="text-xs text-amber-200">Unsaved changes</span>}
          <SaveButton busy={busy} disabled={busy || !dirty}>
            Save settings
          </SaveButton>
        </div>
      </fieldset>
    </form>
  );
}
