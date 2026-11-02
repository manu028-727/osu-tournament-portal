'use client';
import { useT } from '@/components/locale';
import { useState } from 'react';
import { useDialogClose } from '@/components/unsaved-navigation';
import { Pencil, ShieldAlert, Tags, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PoolingData } from '@/lib/pooling-types';
import { ConfirmButton, Field, EditorPanel, SaveButton } from './shared';
import { type Mutate } from './pooling-display';

export function ConfigurationDialog({
  data,
  section,
  setSection,
  busy,
  mutate,
  onClose,
}: {
  data: PoolingData;
  section: 'skillsets' | 'warnings';
  setSection: (value: 'skillsets' | 'warnings') => void;
  busy: boolean;
  mutate: Mutate;
  onClose: () => void;
}) {
  const tr = useT();
  const [skillset, setSkillset] = useState<{ id?: string; name: string; group: string }>({
    name: '',
    group: '',
  });
  const [warning, setWarning] = useState<{
    id?: string;
    artist: string;
    severity: 'WARN' | 'BANNED';
    reason: string;
    source: string;
  }>({ artist: '', severity: 'WARN', reason: '', source: '' });
  const savedSkillset = data.skillsets.find((entry) => entry.id === skillset.id);
  const savedWarning = data.warnings.find((entry) => entry.id === warning.id);
  const skillsetDirty =
    skillset.name !== (savedSkillset?.name || '') ||
    skillset.group !== (savedSkillset?.group || '');
  const warningDirty =
    warning.artist !== (savedWarning?.artist || '') ||
    warning.severity !== (savedWarning?.severity || 'WARN') ||
    warning.reason !== (savedWarning?.reason || '') ||
    warning.source !== (savedWarning?.source || '');
  const close = useDialogClose(skillsetDirty || warningDirty, busy, onClose);
  const editSkillset = (next: typeof skillset) => {
    if (!skillsetDirty || window.confirm(tr('Discard unsaved changes?'))) setSkillset(next);
  };
  const editWarning = (next: typeof warning) => {
    if (!warningDirty || window.confirm(tr('Discard unsaved changes?'))) setWarning(next);
  };
  return (
    <EditorPanel open title={tr('Pooling configuration')} wide onOpenChange={() => close()}>
      <div
        className="flex gap-2 border-b pb-3"
        role="group"
        aria-label={tr('Pooling configuration section')}
      >
        <Button
          variant={section === 'skillsets' ? 'default' : 'ghost'}
          size="sm"
          aria-pressed={section === 'skillsets'}
          onClick={() => setSection('skillsets')}
        >
          <Tags size={14} />
          {tr('Skillsets')}
        </Button>
        <Button
          variant={section === 'warnings' ? 'default' : 'ghost'}
          size="sm"
          aria-pressed={section === 'warnings'}
          onClick={() => setSection('warnings')}
        >
          <ShieldAlert size={14} />
          {tr('Artist warnings')}
        </Button>
      </div>
      {section === 'skillsets' ? (
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <div className="max-h-96 divide-y overflow-y-auto">
            {data.skillsets.length ? (
              data.skillsets.map((entry) => (
                <div key={entry.id} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm">{entry.name}</p>
                    <p className="text-xs text-muted">{entry.group || tr('No group')}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={tr('Edit {0}', entry.name)}
                    aria-label={tr('Edit {0}', entry.name)}
                    disabled={busy}
                    onClick={() =>
                      editSkillset({ id: entry.id, name: entry.name, group: entry.group })
                    }
                  >
                    <Pencil size={14} />
                  </Button>
                  <ConfirmButton
                    title={tr('Delete skillset {0}?', entry.name)}
                    description={tr(
                      'Skillsets currently used on suggestions must be removed from those suggestions first.',
                    )}
                    disabled={busy}
                    onConfirm={() =>
                      mutate(
                        { type: 'pooling.skillset.delete', id: entry.id },
                        'Skillset deleted.',
                        () => {
                          if (skillset.id === entry.id) setSkillset({ name: '', group: '' });
                        },
                      )
                    }
                  >
                    <Trash2 size={14} />
                  </ConfirmButton>
                </div>
              ))
            ) : (
              <p className="py-3 text-sm text-muted">{tr('No custom skillsets yet.')}</p>
            )}
          </div>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              mutate({ type: 'pooling.skillset.save', ...skillset }, 'Skillset saved.', () =>
                setSkillset({ name: '', group: '' }),
              );
            }}
          >
            <h3 className="text-sm font-semibold">
              {skillset.id ? tr('Edit skillset') : tr('Add skillset')}
            </h3>
            <Field label={tr('Name')}>
              <input
                required
                maxLength={80}
                value={skillset.name}
                onChange={(event) => setSkillset({ ...skillset, name: event.target.value })}
              />
            </Field>
            <Field label={tr('Group')}>
              <input
                maxLength={80}
                value={skillset.group}
                onChange={(event) => setSkillset({ ...skillset, group: event.target.value })}
              />
            </Field>
            <div className="flex gap-2">
              <SaveButton busy={busy}>{tr('Save skillset')}</SaveButton>
              {skillset.id && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => editSkillset({ name: '', group: '' })}
                >
                  {tr('Cancel edit')}
                </Button>
              )}
            </div>
          </form>
        </div>
      ) : (
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <div className="max-h-[32rem] divide-y overflow-y-auto">
            {data.warnings.length ? (
              data.warnings.map((entry) => (
                <div key={entry.id} className="py-3">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-medium">{entry.artist}</p>
                      <span
                        className={`text-xs ${entry.severity === 'BANNED' ? 'text-red-400' : 'text-amber-400'}`}
                      >
                        {entry.severity === 'BANNED' ? tr('Banned') : tr('Warning')}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={tr('Edit warning for {0}', entry.artist)}
                      aria-label={tr('Edit warning for {0}', entry.artist)}
                      disabled={busy}
                      onClick={() =>
                        editWarning({
                          id: entry.id,
                          artist: entry.artist,
                          severity: entry.severity as 'WARN' | 'BANNED',
                          reason: entry.reason,
                          source: entry.source,
                        })
                      }
                    >
                      <Pencil size={14} />
                    </Button>
                    <ConfirmButton
                      title={tr('Delete warning for {0}?', entry.artist)}
                      description={tr(
                        'This removes the tournament warning and its publication restriction.',
                      )}
                      disabled={busy}
                      onConfirm={() =>
                        mutate(
                          { type: 'pooling.warning.delete', id: entry.id },
                          'Artist warning deleted.',
                          () => {
                            if (warning.id === entry.id)
                              setWarning({ artist: '', severity: 'WARN', reason: '', source: '' });
                          },
                        )
                      }
                    >
                      <Trash2 size={14} />
                    </ConfirmButton>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted">
                    {entry.reason}
                  </p>
                </div>
              ))
            ) : (
              <p className="py-3 text-sm text-muted">{tr('No tournament artist warnings.')}</p>
            )}
          </div>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              mutate({ type: 'pooling.warning.save', ...warning }, 'Artist warning saved.', () =>
                setWarning({ artist: '', severity: 'WARN', reason: '', source: '' }),
              );
            }}
          >
            <h3 className="text-sm font-semibold">
              {warning.id ? tr('Edit artist warning') : tr('Add artist warning')}
            </h3>
            <Field label={tr('Artist')}>
              <input
                required
                maxLength={200}
                value={warning.artist}
                onChange={(event) => setWarning({ ...warning, artist: event.target.value })}
              />
            </Field>
            <Field label={tr('Severity')}>
              <select
                value={warning.severity}
                onChange={(event) =>
                  setWarning({ ...warning, severity: event.target.value as 'WARN' | 'BANNED' })
                }
              >
                <option value="WARN">{tr('Warning')}</option>
                <option value="BANNED">{tr('Banned - requires resolution')}</option>
              </select>
            </Field>
            <Field label={tr('Reason')}>
              <textarea
                required
                maxLength={2000}
                rows={3}
                value={warning.reason}
                onChange={(event) => setWarning({ ...warning, reason: event.target.value })}
              />
            </Field>
            <Field label={tr('Source URL (optional)')}>
              <input
                type="url"
                maxLength={2048}
                value={warning.source}
                onChange={(event) => setWarning({ ...warning, source: event.target.value })}
              />
            </Field>
            <div className="flex gap-2">
              <SaveButton busy={busy}>{tr('Save warning')}</SaveButton>
              {warning.id && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    editWarning({ artist: '', severity: 'WARN', reason: '', source: '' })
                  }
                >
                  {tr('Cancel edit')}
                </Button>
              )}
            </div>
          </form>
        </div>
      )}
    </EditorPanel>
  );
}
