'use client';
import { useEffect, useState } from 'react';
import { Play, Pause, RotateCcw, Timer } from 'lucide-react';
import { Button } from '../ui/button';
import type { MatchView } from '@/lib/matches-types';
type Kind = 'PICK' | 'BAN' | 'READY' | 'TIMEOUT';
export function MatchTimer({
  match,
  serverNow,
  disabled,
  busy,
  onCommand,
}: {
  match: MatchView;
  serverNow: string;
  disabled: boolean;
  busy: boolean;
  onCommand: (command: 'START' | 'PAUSE' | 'RESET', kind: Kind) => void;
}) {
  const [now, setNow] = useState(Date.now()),
    [offset, setOffset] = useState(0),
    [kind, setKind] = useState<Kind>((match.timerKind || 'PICK') as Kind);
  useEffect(() => {
    setOffset(new Date(serverNow).getTime() - Date.now());
  }, [serverNow]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (match.timerKind) setKind(match.timerKind as Kind);
  }, [match.timerKind]);
  const remaining = match.timerStartedAt
    ? Math.max(
        0,
        Math.ceil(
          (new Date(match.timerStartedAt).getTime() +
            match.timerRemainingSeconds * 1000 -
            now -
            offset) /
            1000,
        ),
      )
    : match.timerRemainingSeconds;
  return (
    <section className="flex flex-wrap items-center gap-4 border-y py-4">
      <Timer size={21} className="text-primary" />
      <select
        aria-label="Timer type"
        className="!w-auto max-w-full"
        value={kind}
        onChange={(e) => setKind(e.target.value as Kind)}
      >
        {['PICK', 'BAN', 'READY', 'TIMEOUT'].map((value) => (
          <option key={value}>{value}</option>
        ))}
      </select>
      <span
        role="timer"
        aria-label={`${match.timerKind || kind} countdown`}
        className={`min-w-20 font-mono text-2xl font-semibold ${remaining === 0 && match.timerStartedAt ? 'text-red-200' : ''}`}
      >
        {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
      </span>
      <div className="flex gap-2">
        <Button
          size="icon"
          variant="outline"
          disabled={disabled || busy || kind === 'TIMEOUT'}
          aria-label="Start timer"
          title="Start or resume timer"
          onClick={() => onCommand('START', kind)}
        >
          <Play size={18} />
        </Button>
        <Button
          size="icon"
          variant="outline"
          disabled={disabled || busy || !match.timerStartedAt}
          aria-label="Pause timer"
          title="Pause timer"
          onClick={() => onCommand('PAUSE', kind)}
        >
          <Pause size={18} />
        </Button>
        <Button
          size="icon"
          variant="outline"
          disabled={disabled || busy}
          aria-label="Reset timer"
          title="Reset timer"
          onClick={() => onCommand('RESET', kind)}
        >
          <RotateCcw size={18} />
        </Button>
      </div>
    </section>
  );
}
