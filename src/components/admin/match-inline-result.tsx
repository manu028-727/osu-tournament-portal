'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/components/locale';
import type { MatchView } from '@/lib/matches-types';
import type { MatchResultImpact } from '@/lib/match-results-contract';
import { firstTo } from '@/lib/match-rules';
import { Button } from '../ui/button';
import {
  action,
  api,
  Field,
  LoadingState,
  SaveButton,
  useResource,
  useTask,
  useUnsaved,
} from './shared';

export function MatchInlineResult({
  id,
  onClose,
  onSaved,
  onCancel,
  onStateChange,
  inRow = false,
}: {
  id: string;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
  onCancel?: () => void;
  onStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
  inRow?: boolean;
}) {
  const tr = useT();
  const { data, error, reload } = useResource<{ match: MatchView }>(
    `match&id=${encodeURIComponent(id)}`,
  );
  const m = data?.match;
  const [scoreA, setA] = useState(0),
    [scoreB, setB] = useState(0);
  const [ff, setFF] = useState<'A' | 'B' | ''>('');
  const [reason, setReason] = useState(''),
    [credit, setCredit] = useState('');
  const [dirty, setDirty] = useState(false),
    [approve, setApprove] = useState(false);
  const [impact, setImpact] = useState<MatchResultImpact | null>(null),
    [impactError, setImpactError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!inRow) return;
    const locate = () =>
      setHost(
        [...document.querySelectorAll<HTMLElement>('[data-match-result-slot]')].find(
          (node) => node.dataset.matchResultSlot === id && node.getClientRects().length > 0,
        ) || null,
      );
    locate();
    window.addEventListener('resize', locate);
    return () => window.removeEventListener('resize', locate);
  }, [id, inRow]);
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.scrollIntoView({ block: 'nearest' });
  }, [host, m?.id]);
  const { busy, run } = useTask();
  useUnsaved(dirty);
  useEffect(() => {
    onStateChange?.({ dirty, busy });
    return () => onStateChange?.({ dirty: false, busy: false });
  }, [dirty, busy, onStateChange]);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  const target = m ? firstTo(m.rules) : 1;
  const winner =
    scoreA === target && scoreB < target ? 'A' : scoreB === target && scoreA < target ? 'B' : null;
  useEffect(() => {
    if (!m) return;
    setA(m.scoreA);
    setB(m.scoreB);
    setFF(m.forfeitSide || '');
    setCredit(m.source?.referee || '');
    input.current?.focus({ preventScroll: true });
  }, [m]);
  useEffect(() => {
    if (!m) return;
    let active = true;
    setImpact(null);
    setImpactError('');
    setApprove(false);
    void api<MatchResultImpact>('/api/admin/match-results', {
      method: 'POST',
      body: JSON.stringify({
        type: 'impact',
        id: m.id,
        baseVersion: m.version,
        winnerSide: winner,
      }),
    })
      .then((value) => {
        if (active) setImpact(value);
      })
      .catch((e: Error) => {
        if (active) setImpactError(e.message);
      });
    return () => {
      active = false;
    };
  }, [m?.id, m?.version, winner]);
  const close = () => {
    if (onCancel) {
      if (!busy) onCancel();
      return;
    }
    if (!busy && (!dirty || window.confirm(tr('Discard unsaved changes?')))) onClose();
  };
  if (!m) {
    const loading = (
      <div className="p-3">
        <LoadingState error={error} retry={() => void reload().catch(() => {})} />
        <Button variant="ghost" onClick={onClose}>
          {tr('Cancel')}
        </Button>
      </div>
    );
    return inRow ? host && createPortal(loading, host) : loading;
  }
  const choose = (side: 'A' | 'B' | '') => {
    setFF('');
    setDirty(true);
    if (side === 'A') {
      setA(target);
      setB(Math.min(scoreB, target - 1));
    }
    if (side === 'B') {
      setB(target);
      setA(Math.min(scoreA, target - 1));
    }
    if (!side) {
      setA(Math.min(scoreA, target - 1));
      setB(Math.min(scoreB, target - 1));
    }
  };
  const form = (
    <form
      aria-label={tr('Result editor for match {0}', m.matchNumber)}
      className="min-w-0 space-y-3 rounded-xl border border-[var(--accent-border)] bg-card p-3 [overflow-wrap:anywhere]"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await action({
            type: 'match.result.set',
            id: m.id,
            baseVersion: m.version,
            scoreA,
            scoreB,
            winnerSide: winner,
            forfeitSide: ff || null,
            externalReferee: credit,
            reason:
              reason.trim() ||
              (m.status === 'COMPLETED'
                ? 'Organizer corrected match result'
                : 'Organizer entered match result'),
            confirm: true,
            approveProgression: approve,
            correctionHash: impact?.hash || undefined,
          });
          setDirty(false);
          await onSaved();
          onClose();
        }, tr('Match result saved.'));
      }}
    >
      <h3 className="text-xs font-semibold">
        {tr('Match {0}', m.matchNumber)} · {tr('Result')} · {tr('First to {0}', target)}
      </h3>
      <fieldset disabled={busy} className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
        <Field label={tr('Score for {0}', m.participants.A.name)}>
          <input
            ref={input}
            type="number"
            min={0}
            max={target}
            value={scoreA}
            onChange={(e) => {
              setA(Number(e.target.value));
              setFF('');
              setDirty(true);
            }}
          />
        </Field>
        <Field label={tr('Score for {0}', m.participants.B.name)}>
          <input
            type="number"
            min={0}
            max={target}
            value={scoreB}
            onChange={(e) => {
              setB(Number(e.target.value));
              setFF('');
              setDirty(true);
            }}
          />
        </Field>
        <Field label={tr('Winner')}>
          <select value={winner || ''} onChange={(e) => choose(e.target.value as 'A' | 'B' | '')}>
            <option value="">{tr('In progress')}</option>
            <option value="A">{m.participants.A.name}</option>
            <option value="B">{m.participants.B.name}</option>
          </select>
        </Field>
        <Field label={tr('Forfeit (FF)')}>
          <select
            value={ff}
            onChange={(e) => {
              const value = e.target.value as 'A' | 'B' | '';
              if (value) choose(value === 'A' ? 'B' : 'A');
              setFF(value);
              setDirty(true);
            }}
          >
            <option value="">{tr('No forfeit')}</option>
            <option value="A">{m.participants.A.name}</option>
            <option value="B">{m.participants.B.name}</option>
          </select>
        </Field>
      </fieldset>
      <details>
        <summary className="cursor-pointer text-xs text-muted">
          {tr('Result notes and external referee')}
        </summary>
        <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label={tr('Result reason / source')}>
            <input
              maxLength={2000}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setDirty(true);
              }}
            />
          </Field>
          <Field label={tr('External referee credit (optional)')}>
            <input
              maxLength={120}
              value={credit}
              onChange={(e) => {
                setCredit(e.target.value);
                setDirty(true);
              }}
            />
          </Field>
        </div>
      </details>
      {impactError && (
        <p role="alert" className="text-sm text-red-200">
          {impactError}
        </p>
      )}
      {impact?.blocked && (
        <p role="alert" className="text-sm text-red-200">
          {tr(
            'Downstream matches or frozen standings protect this result. Reconcile them before changing the winner.',
          )}
        </p>
      )}
      {impact?.requiresApproval && (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} />
          {tr('Approve corrections to unstarted downstream fixtures')}{' '}
          {impact.affected.map((row) => row.matchNumber).join(', ')}
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <SaveButton
          busy={busy}
          disabled={!impact || impact.blocked || (!!impact.requiresApproval && !approve)}
        >
          {tr('Save result')}
        </SaveButton>
        <Button variant="ghost" disabled={busy} onClick={close}>
          {tr('Cancel')}
        </Button>
      </div>
    </form>
  );
  return inRow ? host && createPortal(form, host) : form;
}
