'use client';
import { useState } from 'react';
import { useT } from '@/components/locale';
import { Button } from '@/components/ui/button';
import { ELIGIBILITY_EXCEPTIONS } from '@/lib/eligibility';
import type { EligibilityIssue } from '@/lib/eligibility';
import type { EligibilityReview } from '@/lib/eligibility-service';
import { action, ConfirmButton, Field, useTask } from '../shared';
import styles from './setup.module.css';

const KIND_LABELS: Record<string, string> = {
  RANK: 'Rank limit',
  COUNTRY: 'Country limit',
  RANK_SUM: 'Team rank sum',
};
const RANK_BATCH = 25;

// One problem on one roster, with the decision that clears it right beside it.
function IssueRow({ issue, reload }: { issue: EligibilityIssue; reload: () => Promise<unknown> }) {
  const tr = useT();
  const { busy, run } = useTask();
  const [reason, setReason] = useState('');
  return (
    <li className={styles.reviewIssue}>
      <span>{tr(issue.message, ...issue.values)}</span>
      <form
        className={styles.inlineDecision}
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await action({
              type: 'eligibility.exception.grant',
              osuId: issue.osuId,
              kind: issue.kind,
              reason,
            });
            setReason('');
            await reload();
          }, tr('Exception recorded.'));
        }}
      >
        <input
          aria-label={tr('Why this is allowed')}
          placeholder={tr('Why this is allowed')}
          value={reason}
          minLength={3}
          maxLength={1000}
          required
          onChange={(event) => setReason(event.target.value)}
        />
        <Button type="submit" size="sm" variant="outline" disabled={busy}>
          {tr('Allow')}
        </Button>
      </form>
    </li>
  );
}

export function EligibilityPanel({
  review,
  reload,
}: {
  review: EligibilityReview;
  reload: () => Promise<unknown>;
}) {
  const tr = useT();
  const { busy, run } = useTask();
  const [progress, setProgress] = useState<number | null>(null);
  const [granting, setGranting] = useState({ osuId: '', kind: 'COUNTRY', reason: '' });
  const [revoking, setRevoking] = useState<Record<string, string>>({});
  const captureRanks = () =>
    void run(async () => {
      const targets = review.rankTargets;
      for (let done = 0; done < targets.length; done += RANK_BATCH) {
        setProgress(done);
        await action({
          type: 'eligibility.ranks.capture',
          osuIds: targets.slice(done, done + RANK_BATCH),
        });
      }
      setProgress(null);
      await reload();
    }, tr('Ranks recorded.')).finally(() => setProgress(null));
  const flagged = review.rows.filter((row) => row.issues.length);
  return (
    <section className="grid gap-3" aria-labelledby="eligibility-review">
      <h3 id="eligibility-review" className="font-semibold">
        {tr('Eligibility review')}
      </h3>
      <p className="text-sm text-muted">
        {review.limited
          ? flagged.length
            ? tr('{0} of {1} teams need a decision.', flagged.length, review.teams)
            : tr('All {0} teams meet the limits above.', review.teams)
          : tr('No limits are set, so every player is eligible.')}
      </p>
      {review.players > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || !review.rankTargets.length}
            onClick={captureRanks}
          >
            {progress !== null
              ? tr('Reading ranks: {0} of {1}', progress, review.rankTargets.length)
              : review.rankLockPassed
                ? tr('Record locked ranks ({0} players left)', review.rankTargets.length)
                : tr('Read current ranks ({0} players)', review.rankTargets.length)}
          </Button>
          <span className="text-xs text-muted">
            {review.rankLockPassed
              ? tr('Ranks read after the lock are never read again, so they stay fixed.')
              : review.rankLockAt
                ? tr('Read ranks once more after the lock date to fix them.')
                : tr('Each captain save also records the current rank.')}
          </span>
        </div>
      )}
      {review.rows.length > 0 && (
        <ul className={styles.reviewList}>
          {review.rows.map((row) => (
            <li key={row.id} className={styles.reviewTeam}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{row.name}</strong>
                {row.status === 'PENDING' && (
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await action({
                          type: 'team.status',
                          id: row.id,
                          baseVersion: row.version,
                          status: 'APPROVED',
                          published: true,
                          rejectionReason: '',
                        });
                        await reload();
                      }, tr('Team approved.'))
                    }
                  >
                    {tr('Approve')}
                  </Button>
                )}
              </div>
              {row.issues.length > 0 && (
                <ul className="grid gap-2">
                  {row.issues.map((issue) => (
                    <IssueRow key={`${issue.code}-${issue.osuId}`} issue={issue} reload={reload} />
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <details className={styles.reviewDetails}>
        <summary>
          {tr('Allowed exceptions')} ({review.exceptions.length})
        </summary>
        <div className="grid gap-3 pt-3">
          {review.exceptions.map((item) => (
            <div key={item.id} className={styles.reviewTeam}>
              <div>
                <strong>{item.username}</strong> &middot; {tr(KIND_LABELS[item.kind])}
              </div>
              <p className="text-sm text-muted">{item.reason}</p>
              <div className={styles.inlineDecision}>
                <input
                  aria-label={tr('Why this is removed')}
                  placeholder={tr('Why this is removed')}
                  value={revoking[item.id] ?? ''}
                  maxLength={1000}
                  onChange={(event) => setRevoking({ ...revoking, [item.id]: event.target.value })}
                />
                <ConfirmButton
                  variant="outline"
                  disabled={busy || (revoking[item.id] ?? '').trim().length < 3}
                  title={tr('Remove this exception?')}
                  description={tr('The player will be checked against the limits again.')}
                  onConfirm={() =>
                    void run(async () => {
                      await action({
                        type: 'eligibility.exception.revoke',
                        id: item.id,
                        reason: revoking[item.id],
                      });
                      await reload();
                    }, tr('Exception removed.'))
                  }
                >
                  {tr('Remove')}
                </ConfirmButton>
              </div>
            </div>
          ))}
          <form
            className={styles.reviewGrant}
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await action({
                  type: 'eligibility.exception.grant',
                  osuId: Number(granting.osuId),
                  kind: granting.kind,
                  reason: granting.reason,
                });
                setGranting({ osuId: '', kind: 'COUNTRY', reason: '' });
                await reload();
              }, tr('Exception recorded.'));
            }}
          >
            <Field label={tr('osu! ID')}>
              <input
                type="number"
                min={1}
                required
                value={granting.osuId}
                onChange={(event) => setGranting({ ...granting, osuId: event.target.value })}
              />
            </Field>
            <Field label={tr('Limit to lift')}>
              <select
                value={granting.kind}
                onChange={(event) => setGranting({ ...granting, kind: event.target.value })}
              >
                {ELIGIBILITY_EXCEPTIONS.map((kind) => (
                  <option key={kind} value={kind}>
                    {tr(KIND_LABELS[kind])}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={tr('Reason')}
              hint={tr('For example, the outcome of an interview. Staff can read this.')}
            >
              <input
                required
                minLength={3}
                maxLength={1000}
                value={granting.reason}
                onChange={(event) => setGranting({ ...granting, reason: event.target.value })}
              />
            </Field>
            <div>
              <Button type="submit" size="sm" variant="outline" disabled={busy}>
                {tr('Allow this player')}
              </Button>
            </div>
          </form>
        </div>
      </details>
    </section>
  );
}
