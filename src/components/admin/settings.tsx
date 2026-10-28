'use client';
import { humanizeCode } from '@/lib/i18n';
import { localDateTimeInput } from '@/lib/utils';
import { useT } from '@/components/locale';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Save, Eye, X } from 'lucide-react';
import Link from '@/components/tournament-scope';
import { Button } from '../ui/button';
import { TournamentProfileHeader } from '../tournament-profile';
import { TournamentTabs } from '../tournament-tabs';
import { themeStyle } from '@/lib/theme';
import type { TournamentView } from '@/lib/types';
import { MediaField } from './media';
import { ExportTournamentButton } from './tournament-export-button';
import { can, type Actor } from '@/lib/permissions';
import { DEFAULT_COPY, siteCopy } from '@/lib/copy';
import { settingsFieldsSchema } from '@/lib/validation';
import { SCORING_LABELS, SCORING_DESCRIPTIONS, type GameplayScoring } from '@/lib/gameplay-scoring';
import {
  action,
  Field,
  LoadingState,
  Modal,
  ReorderList,
  SaveButton,
  SectionTitle,
  useResource,
  useTask,
  useUnsaved,
} from './shared';
type SettingsData = TournamentView & {
  version: number;
  settings: TournamentView['settings'] & { favicon: string };
  scoringImpact?: {
    locked: boolean;
    affected: { id: string; code: string; matchNumber?: number; kind: string }[];
  };
};
type Form = Omit<SettingsData, 'settings'> & SettingsData['settings'];
export type SettingsArea = 'info' | 'branding' | 'navigation' | 'advanced';
const titles = {
  info: 'Tournament info',
  branding: 'Appearance',
  navigation: 'Navigation & text',
  advanced: 'Tournament settings',
};

export function SettingsEditor({
  actor,
  area = 'advanced',
}: {
  actor: Actor;
  area?: SettingsArea;
}) {
  const tr = useT();
  const { data, error, reload } = useResource<SettingsData>('settings');
  const [form, setForm] = useState<Form | null>(null),
    [dirty, setDirty] = useState(false),
    [preview, setPreview] = useState(false);
  const [scoringReview, setScoringReview] = useState(false);
  const { busy, run } = useTask();
  const router = useRouter();
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
  if (!form || !data)
    return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  const text = (
    key: 'name' | 'acronym' | 'description' | 'registrationUrl' | 'timezone' | 'footer',
    label: string,
    multiline = false,
  ) => (
    <Field label={label}>
      {multiline ? (
        <textarea
          value={form[key]}
          maxLength={key === 'footer' ? 1000 : 2000}
          onChange={(e) => update(key, e.target.value)}
        />
      ) : (
        <input
          required={['name', 'acronym', 'timezone'].includes(key)}
          value={form[key]}
          maxLength={key === 'name' ? 120 : key === 'acronym' ? 20 : 2000}
          onChange={(e) => update(key, e.target.value)}
        />
      )}
    </Field>
  );
  const saveLabel = area === 'advanced' ? 'Save settings' : 'Save changes';
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const original = settingsFieldsSchema.parse({
              ...data,
              ...data.settings,
              copy: siteCopy(data.settings.copy),
            });
            const patch = Object.fromEntries(
              Object.entries(settingsFieldsSchema.parse(form)).filter(
                ([key, value]) =>
                  JSON.stringify(value) !== JSON.stringify(original[key as keyof typeof original]),
              ),
            );
            await action({
              type: 'settings.save',
              baseVersion: data.version,
              ...patch,
              scoringReview,
            });
            await reload();
            router.refresh();
          }, tr('Saved. Website settings take effect immediately; page and mappool drafts are unchanged.'));
        }}
      >
        <SectionTitle title={tr(titles[area])}>
          {area === 'branding' && (
            <Button type="button" variant="outline" onClick={() => setPreview(true)}>
              <Eye size={16} />
              {tr('Preview appearance')}
            </Button>
          )}
          <SaveButton busy={busy} disabled={busy || !dirty}>
            <Save size={15} />
            {tr(saveLabel)}
          </SaveButton>
        </SectionTitle>
        <p role="status" className="mb-5 text-sm text-muted">
          {dirty ? tr('Unsaved changes') : tr('All changes saved')}{' '}
          {tr('· Website settings take effect immediately.')}
        </p>
        <fieldset disabled={busy} className="space-y-6">
          {area === 'info' && (
            <>
              <div className="grid-fields">
                {text('name', tr('Tournament name'))}
                {text('acronym', tr('Acronym'))}
              </div>
              {text('description', tr('Description'), true)}
              <Field label={tr('Tournament status')}>
                <select value={form.status} onChange={(e) => update('status', e.target.value)}>
                  {['DRAFT', 'UPCOMING', 'REGISTRATIONS_OPEN', 'ONGOING', 'COMPLETED'].map(
                    (status) => (
                      <option key={status} value={status}>
                        {tr(humanizeCode(status))}
                      </option>
                    ),
                  )}
                </select>
              </Field>
              <div className="grid-fields">
                {(['startsAt', 'endsAt'] as const).map((key) => (
                  <Field key={key} label={key === 'startsAt' ? tr('Start date') : tr('End date')}>
                    <input
                      type="datetime-local"
                      value={localDateTimeInput(form[key])}
                      onChange={(e) =>
                        update(key, e.target.value ? new Date(e.target.value).toISOString() : null)
                      }
                    />
                  </Field>
                ))}
              </div>
              {text('registrationUrl', tr('Registration link'))}
              <section className="form-section space-y-4">
                <h2 className="text-lg font-semibold">{tr('Important dates')}</h2>
                <ReorderList
                  compact
                  items={form.importantDates}
                  keyOf={(_, i) => String(i)}
                  onChange={(items) => update('importantDates', items)}
                  renderItem={(date, i) => (
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="min-w-0 flex-1">
                        <Field label={tr('Date label')}>
                          <input
                            required
                            value={date.label}
                            onChange={(e) =>
                              update(
                                'importantDates',
                                form.importantDates.map((value, j) =>
                                  j === i ? { ...value, label: e.target.value } : value,
                                ),
                              )
                            }
                          />
                        </Field>
                      </div>
                      <div className="min-w-0 flex-1">
                        <Field label={tr('Date (UTC)')}>
                          <input
                            required
                            type="date"
                            value={date.date}
                            onChange={(e) =>
                              update(
                                'importantDates',
                                form.importantDates.map((value, j) =>
                                  j === i ? { ...value, date: e.target.value } : value,
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
                        aria-label={tr('Remove date')}
                        onClick={() =>
                          update(
                            'importantDates',
                            form.importantDates.filter((_, j) => i !== j),
                          )
                        }
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  )}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    update('importantDates', [
                      ...form.importantDates,
                      { label: 'New milestone', date: new Date().toISOString().slice(0, 10) },
                    ])
                  }
                >
                  <Plus size={16} />
                  {tr('Add date')}
                </Button>
              </section>
            </>
          )}
          {area === 'branding' && (
            <>
              <div className="grid-fields">
                {(['logo', 'favicon'] as const).map((key) => (
                  <MediaField
                    key={key}
                    canUpload={can(actor, 'media.upload')}
                    label={key === 'logo' ? tr('Tournament logo') : tr('Favicon')}
                    value={form[key]}
                    onChange={(url) => update(key, url)}
                  />
                ))}
              </div>
              <MediaField
                canUpload={can(actor, 'media.upload')}
                label={tr('Main banner')}
                value={form.banner}
                onChange={(url) => update('banner', url)}
              />
              <div className="grid-fields">
                {(['primaryColor', 'accentColor'] as const).map((key) => (
                  <Field
                    key={key}
                    label={key === 'primaryColor' ? tr('Primary color') : tr('Accent color')}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        aria-label={
                          key === 'primaryColor' ? tr('Primary color') : tr('Accent color')
                        }
                        type="color"
                        value={form[key]}
                        onChange={(e) => update(key, e.target.value)}
                      />
                      <span className="font-mono text-xs text-muted">{form[key]}</span>
                    </div>
                  </Field>
                ))}
              </div>
              <Link
                href="/admin/mappools?view=stages"
                className="inline-flex min-h-11 items-center text-sm text-primary"
              >
                {tr('Stage-specific banners')}
              </Link>
            </>
          )}
          {area === 'navigation' && (
            <>
              <section aria-label={tr('Navigation preview')} className="min-w-0 overflow-hidden">
                <h2 className="mb-2 text-lg font-semibold">{tr('Navigation labels')}</h2>
                <div inert>
                  <TournamentTabs links={form.navigation} />
                </div>
              </section>
              {(['navigation', 'socialLinks'] as const).map((key) => (
                <section className="form-section space-y-4" key={key}>
                  <h2 className="text-lg font-semibold">
                    {key === 'navigation' ? tr('Website navigation') : tr('Social links')}
                  </h2>
                  <ReorderList
                    compact
                    items={form[key]}
                    keyOf={(_, i) => String(i)}
                    onChange={(items) => update(key, items)}
                    renderItem={(link, i) => (
                      <div className="grid grid-cols-[minmax(0,1fr)_44px] items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_44px]">
                        <div className="min-w-0 flex-1">
                          <Field
                            label={key === 'navigation' ? tr('Navigation label') : tr('Link label')}
                          >
                            <input
                              required
                              value={link.label}
                              onChange={(e) =>
                                update(
                                  key,
                                  form[key].map((item, j) =>
                                    j === i ? { ...item, label: e.target.value } : item,
                                  ),
                                )
                              }
                            />
                          </Field>
                        </div>
                        <div className="col-span-2 min-w-0 sm:col-span-1">
                          <Field label={tr('URL')}>
                            <input
                              value={link.href}
                              onChange={(e) =>
                                update(
                                  key,
                                  form[key].map((item, j) =>
                                    j === i ? { ...item, href: e.target.value } : item,
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
                          aria-label={tr('Remove link')}
                          className="col-start-2 row-start-1 sm:col-auto sm:row-auto"
                          onClick={() =>
                            update(
                              key,
                              form[key].filter((_, j) => j !== i),
                            )
                          }
                        >
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    )}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => update(key, [...form[key], { label: 'New link', href: '/' }])}
                  >
                    <Plus size={16} />
                    {tr('Add link')}
                  </Button>
                </section>
              ))}
              <section className="form-section space-y-5">
                <h2 className="text-lg font-semibold">{tr('Public page text')}</h2>
                {[
                  {
                    label: 'Mappools page',
                    keys: ['mappoolsEyebrow', 'mappoolsTitle', 'mappoolsDescription'],
                  },
                  {
                    label: 'Staff page',
                    keys: ['staffEyebrow', 'staffTitle', 'staffDescription'],
                  },
                  { label: 'Rules page', keys: ['rulesEyebrow', 'rulesDescription'] },
                  {
                    label: 'Homepage labels & timeline',
                    keys: [
                      'communityLabel',
                      'competitionLabel',
                      'formatLabel',
                      'finalsLabel',
                      'timelineNote',
                    ],
                  },
                  { label: 'Footer tagline', keys: ['footerTagline'] },
                  {
                    label: 'Legacy text values',
                    keys: [
                      'artworkCaption',
                      'announcementLabel',
                      'announcementAside',
                      'artworkTagline',
                    ],
                  },
                ].map((group) => (
                  <details key={group.label} className="border-b pb-3">
                    <summary className="min-h-11 cursor-pointer py-2">{tr(group.label)}</summary>
                    <div className="grid-fields mt-3">
                      {group.keys.map((key) => (
                        <Field
                          key={key}
                          label={tr(
                            key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
                          )}
                        >
                          <textarea
                            className="min-h-20"
                            maxLength={2000}
                            value={siteCopy(form.copy)[key as keyof typeof DEFAULT_COPY]}
                            onChange={(e) =>
                              update('copy', { ...siteCopy(form.copy), [key]: e.target.value })
                            }
                          />
                        </Field>
                      ))}
                    </div>
                  </details>
                ))}
              </section>
              {text('footer', tr('Footer content'), true)}
            </>
          )}
          {area === 'advanced' && (
            <>
              <div className="grid-fields">
                <Field
                  label={tr('Game mode')}
                  hint={tr('Unpublish mappools before changing the game mode.')}
                >
                  <select
                    value={form.gameMode}
                    onChange={(e) => update('gameMode', e.target.value)}
                  >
                    {['osu', 'taiko', 'fruits', 'mania'].map((mode) => (
                      <option key={mode} value={mode}>
                        {mode === 'osu' ? tr('osu!standard') : tr('osu!{0}', mode)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label={tr('Scoring System')}
                  hint={
                    form.gameplayScoring
                      ? tr(SCORING_DESCRIPTIONS[form.gameplayScoring])
                      : tr('Legacy scoring configuration requires review.')
                  }
                >
                  <select
                    value={form.gameplayScoring || ''}
                    disabled={data.scoringImpact?.locked && !!data.settings.gameplayScoring}
                    onChange={(e) => update('gameplayScoring', e.target.value as GameplayScoring)}
                    required
                  >
                    <option value="" disabled>
                      {tr('Review scoring configuration')}
                    </option>
                    {Object.entries(SCORING_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {tr(label)}
                      </option>
                    ))}
                  </select>
                </Field>
                {!data.settings.gameplayScoring && data.scoringImpact?.locked && (
                  <label className="flex items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      required
                      checked={scoringReview}
                      onChange={(e) => setScoringReview(e.target.checked)}
                    />
                    {tr(
                      'I reviewed the historical records. The chosen scoring system must match every recorded result; no scores will be converted.',
                    )}
                  </label>
                )}
                {data.scoringImpact?.locked && (
                  <details className="text-sm text-muted">
                    <summary>
                      {tr('Scoring locked:')} {data.scoringImpact.affected.length}{' '}
                      {tr('started or scored records')}
                    </summary>
                    <ul>
                      {data.scoringImpact.affected.map((record) => (
                        <li key={record.id}>
                          {record.kind === 'match'
                            ? tr('Match {0}', record.matchNumber || '-')
                            : `${record.kind}: ${record.code}`}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {text('timezone', tr('Timezone'))}
                <Field label={tr('Format')}>
                  <select
                    value={form.format || 'CUSTOM'}
                    onChange={(e) => update('format', e.target.value)}
                  >
                    <option value="SOLO">{tr('1v1')}</option>
                    <option value="TEAMS">{tr('Teams')}</option>
                    <option value="CUSTOM">{tr('Custom')}</option>
                  </select>
                </Field>
              </div>
              {can(actor, 'matches.manage') && (
                <Link
                  href="/admin/matches?rules=1"
                  className="inline-flex min-h-11 items-center text-sm text-primary"
                >
                  {tr('Default match rules & stage overrides')}
                </Link>
              )}
              <section className="form-section space-y-4">
                <h2 className="text-lg font-semibold">{tr('Tournament archive')}</h2>
                {can(actor, 'users.manage') && can(actor, 'roles.manage') && (
                  <ExportTournamentButton />
                )}
              </section>
            </>
          )}
          <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
            {dirty && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (window.confirm(tr('Discard unsaved changes?'))) {
                    const { settings, ...t } = data;
                    setForm({ ...t, ...settings, copy: siteCopy(settings.copy) });
                    setDirty(false);
                  }
                }}
              >
                <X size={16} />
                {tr('Discard changes')}
              </Button>
            )}
            <SaveButton busy={busy} disabled={busy || !dirty}>
              {tr(saveLabel)}
            </SaveButton>
          </div>
        </fieldset>
      </form>
      <Modal open={preview} onOpenChange={setPreview} title={tr('Appearance preview')} wide>
        <div inert style={themeStyle(form.primaryColor, form.accentColor) as React.CSSProperties}>
          <TournamentProfileHeader
            tournament={{ ...data, ...form, settings: { ...data.settings, ...form } }}
          />
        </div>
      </Modal>
    </>
  );
}
