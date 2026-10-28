'use client';
import { CalendarClock, Check, Users, X } from 'lucide-react';
import { useT } from '@/components/locale';
import { useTournamentTime } from '@/components/tournament-scope';
import type { MatchSummary, RefereeProfile } from '@/lib/matches-types';
import { Button } from '../ui/button';

export type InlineMatchEdit = {
  id: string;
  version: number;
  kind: 'time' | 'referees';
  time: string;
  referees: string[];
};
export function MatchInlineSchedule({
  match,
  kind,
  edit,
  referees,
  busy,
  onStart,
  onChange,
  onSave,
  onCancel,
}: {
  match: MatchSummary;
  kind: InlineMatchEdit['kind'];
  edit: InlineMatchEdit | null;
  referees: RefereeProfile[];
  busy: boolean;
  onStart: () => void;
  onChange: (value: InlineMatchEdit) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const tr = useT(),
    time = useTournamentTime();
  if (edit?.id !== match.id || edit.kind !== kind)
    return (
      <button
        type="button"
        disabled={!!edit || busy}
        className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm text-primary hover:underline disabled:opacity-40"
        aria-label={tr(
          kind === 'time' ? 'Edit time for match {0}' : 'Edit referees for match {0}',
          match.matchNumber,
        )}
        onClick={onStart}
      >
        {kind === 'time' ? <CalendarClock size={15} /> : <Users size={15} />}
        {kind === 'time' ? time(match.scheduledAt) : tr('Assign')}
      </button>
    );
  return (
    <div
      className="my-2 min-w-0 space-y-2 rounded-xl border bg-card p-3"
      aria-label={tr('Inline schedule for match {0}', match.matchNumber)}
    >
      {kind === 'time' ? (
        <input
          aria-label={tr('Scheduled time for match {0}', match.matchNumber)}
          type="datetime-local"
          value={edit.time}
          onChange={(e) => onChange({ ...edit, time: e.target.value })}
        />
      ) : (
        <div className="max-h-48 space-y-1 overflow-y-auto">
          {referees.map((ref) => (
            <label key={ref.id} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={edit.referees.includes(ref.id)}
                onChange={(e) =>
                  onChange({
                    ...edit,
                    referees: e.target.checked
                      ? [...edit.referees, ref.id]
                      : edit.referees.filter((id) => id !== ref.id),
                  })
                }
              />
              <span className="min-w-0 [overflow-wrap:anywhere]">{ref.username}</span>
            </label>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={onSave}>
          <Check size={14} />
          {tr('Save')}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          disabled={busy}
          aria-label={tr('Cancel inline edit')}
          onClick={onCancel}
        >
          <X size={16} />
        </Button>
      </div>
    </div>
  );
}
