'use client';
import { humanizeCode, localeTag } from '@/lib/i18n';
import { formatMapValue } from '@/lib/score-pipeline';
import { Feedback, useLocale, useT } from '@/components/locale';

import Link from '@/components/tournament-scope';
import { useState } from 'react';
import { Tabs } from 'radix-ui';
import {
  ArrowLeft,
  Ban,
  Copy,
  ExternalLink,
  Flag,
  RotateCcw,
  Undo2,
  Link2,
  Trash2,
} from 'lucide-react';
import { can, type Actor } from '@/lib/permissions';
import { tournamentAdminBase, tournamentPath } from '@/lib/tournament-paths';
import { DeleteMatchDialog, type DeleteMatchSelection } from './delete-match-dialog';
import { matchAccess, type MatchAccess } from '@/lib/match-access';
import { firstTo, type Side } from '@/lib/match-rules';
import { lobbyCommands } from '@/lib/match-engine';
import type { MatchView } from '@/lib/matches-types';
import { Button } from '../ui/button';
import { MatchStatusBadge } from '../ui/badge';
import {
  action,
  api,
  Field,
  LoadingState,
  Modal,
  SaveButton,
  useResource,
  useTask,
  usePolling,
} from './shared';
import { MatchScoreDialog, type ScoreSelection } from './match-score-dialog';
import { MatchTimer } from './match-timer';
import { MatchPurchases, RefereeRulesPanel } from './referee-rules-panel';
import { MATCH_STATUS_LABELS } from '@/lib/match-display';
import { useTournamentTime, useTournamentScope } from '@/components/tournament-scope';
import { GuidedMatch } from './guided-match';
import { MultiplayerGames } from './multiplayer-games';
import { FreeModCalculator } from './freemod-calculator';
import { matchDiscordResult, matchDiscordPreview, matchPing } from '@/lib/discord-result';
import { matchCredits } from '@/lib/match-display';
import { IrcPanel } from './irc-panel';
type Decision = {
  kind: 'confirm' | 'reopen' | 'cancel' | 'dispute' | 'undo' | 'forfeit';
  baseVersion: number;
  winnerSide: Side;
};
const decisionLabels = {
  confirm: 'Confirm result',
  reopen: 'Reopen match',
  cancel: 'Cancel match',
  dispute: 'Submit dispute',
  undo: 'Undo last action',
  forfeit: 'Record forfeit',
};
export function RefereePanel({
  actor,
  id,
  acronym,
  tournamentName,
  ircEnabled = false,
}: {
  actor: Actor;
  id: string;
  acronym: string;
  tournamentName: string;
  ircEnabled?: boolean;
}) {
  const language = useLocale();
  const tr = useT();
  const matchTime = useTournamentTime();
  const { timezone } = useTournamentScope();
  const { data, error, reload } = useResource<{
    match: MatchView;
    access: MatchAccess;
    discordContacts: string[];
    dependencies: {
      side: Side;
      label: string;
      id: string;
      code: string;
      matchNumber: number;
      version: number;
      team: string | null;
    }[];
    serverNow: string;
  }>(`match&id=${encodeURIComponent(id)}`);
  const { busy, run, notify } = useTask();
  const [score, setScore] = useState<ScoreSelection | null>(null),
    [roll, setRoll] = useState<{
      baseVersion: number;
      a: number;
      b: number;
      firstPick: Side;
      firstBan: Side;
      firstProtect: Side;
    } | null>(null),
    [decision, setDecision] = useState<Decision | null>(null),
    [reason, setReason] = useState('');
  const [progressionImpact, setProgressionImpact] = useState<{
      affected: { code: string | null; matchNumber: number | null }[];
      blocked: boolean;
      hash: string;
    } | null>(null),
    [approveProgression, setApproveProgression] = useState(false);
  const [submit, setSubmit] = useState<{ baseVersion: number; notes: string } | null>(null),
    [lobby, setLobby] = useState<{ baseVersion: number; url: string; mp: string } | null>(null);
  const [incident, setIncident] = useState<{
    baseVersion: number;
    kind: 'TIMEOUT' | 'DISCONNECT' | 'DELAY' | 'WARMUP';
    side: Side | '';
    notes: string;
  } | null>(null);
  const [revision, setRevision] = useState<unknown>(null),
    [olderEvents, setOlderEvents] = useState<NonNullable<MatchView['events']>>([]),
    [historyQuery, setHistoryQuery] = useState(''),
    [hasOlder, setHasOlder] = useState(true);
  const [summary, setSummary] = useState<{
    baseVersion: number;
    scoreA: number;
    scoreB: number;
    forfeitSide: Side | '';
    reason: string;
  } | null>(null);
  const [pendingVisibility, setPendingVisibility] = useState<boolean | null>(null);
  const [correction, setCorrection] = useState<{
    actionId: string;
    baseVersion: number;
    slotName: string;
    reason: string;
    discardFollowing: boolean;
  } | null>(null);
  const [deleting, setDeleting] = useState<DeleteMatchSelection | null>(null);
  usePolling(reload);
  if (!data) return <LoadingState error={error} retry={() => void reload().catch(() => {})} />;
  const m = data.match,
    active = m.status === 'IN_PROGRESS' && m.resultMode !== 'SUMMARY';
  const access = data.access || matchAccess(actor, m);
  const manager = access.manager,
    operate = access.operate,
    draftAllowed = access.draft;
  const actions = m.actions.filter((a) => !a.voided),
    results = m.results.filter((r) => !r.voided);
  const pending = actions.find(
    (a) => a.kind === 'PICK' && !results.some((r) => r.actionId === a.id),
  );
  const slots = m.poolRevision?.slots || [];
  const commands = lobbyCommands(
    m.rules,
    acronym,
    { code: String(m.matchNumber), teamA: m.participants.A.name, teamB: m.participants.B.name },
    pending ? slots.find((s) => s.name === pending.slotName) : undefined,
  );
  const post = async (body: object, message: string) =>
    run(async () => {
      await action(body);
      await reload();
    }, message);
  const choose = (kind: Decision['kind']) => {
    setProgressionImpact(null);
    setApproveProgression(false);
    if (
      ['reopen', 'cancel', 'dispute'].includes(kind) &&
      m.status === 'COMPLETED' &&
      access.manager
    )
      void run(async () => {
        setProgressionImpact(
          await api(
            `/api/admin/data?section=competition-correction&id=${encodeURIComponent(m.id)}`,
          ),
        );
        setDecision({ kind, baseVersion: m.version, winnerSide: 'A' });
      });
    else setDecision({ kind, baseVersion: m.version, winnerSide: 'A' });
    setReason('');
  };
  const stale = (version: number) => version !== m.version;
  const copy = (value: string) =>
    void navigator.clipboard
      .writeText(value)
      .then(() => notify('Copied to clipboard.'))
      .catch(() => notify('Clipboard unavailable.', true));
  const editLobby = () =>
    setLobby({
      baseVersion: m.version,
      url: m.lobbyUrl,
      mp: m.multiplayerId ? String(m.multiplayerId) : '',
    });
  const events = [
    ...new Map([...olderEvents, ...(m.events || [])].map((e) => [e.version, e])).values(),
  ].sort((a, b) => b.version - a.version);
  return (
    <>
      {error && (
        <p role="alert" className="mb-5 text-red-200">
          {tr('Updates unavailable:')} <Feedback message={error} />
        </p>
      )}
      <Link
        href="/admin/matches"
        className="mb-2 inline-flex items-center gap-2 text-sm text-primary"
      >
        <ArrowLeft size={18} />
        {tr('Back to matches')}
      </Link>
      <header className="referee-scoreboard border-b pb-3" aria-label={tr('Match scoreboard')}>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <p>
            {tournamentName} / {m.stage.name} / {tr('Match')} {m.matchNumber}
          </p>
          <MatchStatusBadge status={m.status}>{tr(MATCH_STATUS_LABELS[m.status])}</MatchStatusBadge>
          <span>
            {access.editable
              ? access.assigned
                ? tr('Editing match · Assigned referee')
                : tr('Editing match · Authorized override')
              : tr('Viewing match · Read only')}
          </span>
        </div>
        <h1 className="sr-only">
          {m.participants.A.name} {tr('versus')} {m.participants.B.name}
        </h1>
        <div className="my-2 grid grid-cols-2 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          {(['A', 'B'] as const).map((side, index) => (
            <div
              key={side}
              className={`min-w-0 flex items-center gap-2 ${index ? 'col-start-2 row-start-2 justify-end text-right sm:col-start-3 sm:row-start-1' : 'col-start-1 row-start-2 sm:row-start-1'}`}
            >
              {m.participants[side].logoImageId && (
                <img
                  src={`/api/media/${m.participants[side].logoImageId}`}
                  alt=""
                  className="size-8 shrink-0 rounded object-contain"
                />
              )}
              <p
                className={`min-w-0 [overflow-wrap:anywhere] text-base font-semibold ${index ? 'text-sky-200' : 'text-red-200'}`}
              >
                {m.participants[side].name}
              </p>
            </div>
          ))}
          <p
            aria-label={tr('Match score')}
            className="col-span-2 col-start-1 row-start-1 whitespace-nowrap text-center font-mono text-3xl font-bold sm:col-span-1 sm:col-start-2"
          >
            {m.scoreA} : {m.scoreB}
          </p>
        </div>
        <div className="flex flex-wrap justify-between gap-2 text-xs text-muted">
          <p>
            {tr('Best of')} {m.rules.bestOf} {tr('· First to')} {firstTo(m.rules)} ·{' '}
            {matchTime(m.scheduledAt)} · {timezone}
          </p>
          <p>
            {tr('Referees:')}{' '}
            {m.assignments.map((r) => r.user.username).join(', ') ||
              matchCredits(m.source).referee ||
              tr('Unassigned')}
          </p>
        </div>
        <details className="match-administration mt-2">
          <summary className="cursor-pointer text-sm text-muted">
            {tr('Match administration')}
          </summary>
          <div className="mt-5 flex flex-wrap gap-2">
            {manager && (
              <label className="flex items-center gap-3 border-r pr-4">
                <input
                  type="checkbox"
                  checked={pendingVisibility ?? m.published}
                  disabled={busy}
                  onChange={(e) => {
                    const published = e.target.checked;
                    setPendingVisibility(published);
                    void post(
                      { type: 'match.visibility', id: m.id, baseVersion: m.version, published },
                      'Match visibility updated.',
                    ).finally(() => setPendingVisibility(null));
                  }}
                />
                {tr('Public match')}
              </label>
            )}
            {['SCHEDULED', 'IN_PROGRESS'].includes(m.status) && !m.winnerSide && access.submit && (
              <Button variant="outline" onClick={() => choose('forfeit')}>
                <Flag size={17} />
                {tr('Record forfeit')}
              </Button>
            )}
            {active &&
              draftAllowed &&
              m.rules.rollRequired &&
              !actions.length &&
              m.firstPickSide && (
                <Button
                  variant="outline"
                  onClick={() =>
                    setRoll({
                      baseVersion: m.version,
                      a: m.rollA || 0,
                      b: m.rollB || 0,
                      firstPick: m.firstPickSide || 'A',
                      firstBan: m.firstBanSide || 'A',
                      firstProtect: m.firstProtectSide || m.firstBanSide || 'A',
                    })
                  }
                >
                  <Flag size={17} />
                  {tr('Record roll')}
                </Button>
              )}
            {active && draftAllowed && actions.length > 0 && (
              <Button variant="outline" onClick={() => choose('undo')}>
                <Undo2 size={17} />
                {tr('Undo last action')}
              </Button>
            )}
            {['COMPLETED', 'AWAITING_CONFIRMATION', 'DISPUTED', 'CANCELLED'].includes(m.status) &&
              manager && (
                <Button variant="outline" onClick={() => choose('reopen')}>
                  <RotateCcw size={17} />
                  {tr('Reopen for correction')}
                </Button>
              )}
            {['IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED'].includes(m.status) &&
              access.submit && (
                <Button variant="outline" onClick={() => choose('dispute')}>
                  <Flag size={17} />
                  {tr('Dispute result')}
                </Button>
              )}
            {!['COMPLETED', 'CANCELLED'].includes(m.status) && manager && (
              <Button variant="destructive" onClick={() => choose('cancel')}>
                <Ban size={17} />
                {tr('Cancel match')}
              </Button>
            )}
            {can(actor, 'matches.delete') && (
              <Button
                variant="outline"
                onClick={() =>
                  setDeleting({ id: m.id, code: String(m.matchNumber), version: m.version })
                }
              >
                <Trash2 size={17} className="text-red-200" />
                {tr('Delete match')}
              </Button>
            )}
          </div>
        </details>
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
          {m.lobbyUrl ? (
            <a
              href={m.lobbyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 break-all text-sm text-primary"
            >
              {m.lobbyUrl}
            </a>
          ) : (
            <span className="text-sm text-muted">{tr('No multiplayer link')}</span>
          )}
          {operate && !['COMPLETED', 'CANCELLED'].includes(m.status) && (
            <Button size="sm" variant="outline" onClick={editLobby}>
              <Link2 size={17} />
              {m.lobbyUrl ? tr('Edit multiplayer link') : tr('Add multiplayer link')}
            </Button>
          )}
        </div>
      </header>
      <MatchPurchases match={m} />
      <DeleteMatchDialog
        match={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={async () => {
          const slug = tournamentPath(window.location.pathname)?.slug;
          window.location.assign(
            slug ? `${tournamentAdminBase(slug)}/matches` : '/admin/tournaments',
          );
        }}
      />
      {m.forfeitSide && (
        <p className="mt-5 font-semibold text-amber-200">
          {tr('Win by forfeit ·')} {m.participants[m.forfeitSide].name} {tr('forfeited.')}
        </p>
      )}
      {m.resultMode === 'SUMMARY' && (
        <p className="mt-5 border-y py-4 text-sm text-muted">
          {tr(
            'Imported historical result. Only the final match score was supplied; no individual map results have been created.',
          )}
        </p>
      )}
      {!m.poolRevision && (
        <p className="mt-5 text-sm text-muted">
          {tr(
            'Stage mappool not yet published. Resolve opponents and publish the pool before starting this fixture.',
          )}
        </p>
      )}
      {!!data.dependencies?.length && (
        <section className="mt-4 space-y-2 border-y py-3" aria-label={tr('Bracket dependencies')}>
          {data.dependencies.map((dependency) => (
            <div
              key={dependency.side}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <Link href={`/admin/referee/${dependency.matchNumber}`} className="text-primary">
                {tr('Team')} {dependency.side}:{' '}
                {tr(
                  dependency.label.startsWith('W') ? 'Winner of match {0}' : 'Loser of match {0}',
                  dependency.matchNumber,
                )}{' '}
                · {dependency.team || tr('Awaiting confirmed result')}
              </Link>
              {manager && dependency.team && m.status === 'SCHEDULED' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        tr(
                          'Resolve {0} to {1}?',
                          tr('Match {0}', dependency.matchNumber),
                          dependency.team,
                        ),
                      )
                    )
                      void post(
                        {
                          type: 'match.resolve',
                          id: m.id,
                          baseVersion: m.version,
                          side: dependency.side,
                          dependencyVersion: dependency.version,
                          reason: 'Organizer confirmed bracket dependency',
                        },
                        'Bracket opponent resolved.',
                      );
                  }}
                >
                  {tr('Resolve opponent')}
                </Button>
              )}
            </div>
          ))}
        </section>
      )}
      <GuidedMatch
        key={m.id}
        match={m}
        access={access}
        acronym={acronym}
        busy={busy}
        post={post}
        copy={copy}
        onScore={(actionId) => setScore({ actionId, baseVersion: m.version })}
        onSubmit={() => setSubmit({ baseVersion: m.version, notes: m.notes })}
        onConfirm={() => choose('confirm')}
        onSummary={() =>
          setSummary({
            baseVersion: m.version,
            scoreA: m.scoreA,
            scoreB: m.scoreB,
            forfeitSide: m.forfeitSide || '',
            reason: '',
          })
        }
        onSync={() =>
          void run(async () => {
            await api('/api/admin/multiplayer', {
              method: 'POST',
              body: JSON.stringify({ id: m.id }),
            });
            await reload();
          }, tr('Multiplayer games synchronized for review.'))
        }
        onCorrect={(actionId) =>
          setCorrection({
            actionId,
            baseVersion: m.version,
            slotName: '',
            reason: '',
            discardFollowing: false,
          })
        }
      />
      <IrcPanel
        match={m}
        commands={commands}
        editable={operate && !['COMPLETED', 'CANCELLED'].includes(m.status)}
        enabled={ircEnabled}
        onLinked={reload}
      />
      <section className="mt-5 border-t pt-3" aria-label={tr('Secondary match tools')}>
        <Tabs.Root defaultValue="match" className="min-w-0">
          <Tabs.List
            aria-label={tr('Match views')}
            className="mb-7 flex flex-wrap gap-2 border-b pb-3"
          >
            {[
              'match',
              'multiplayer',
              'rosters',
              'rules',
              'discord',
              ...(m.events ? ['history'] : []),
            ].map((tab) => (
              <Tabs.Trigger
                key={tab}
                value={tab}
                className="rounded-md px-4 py-2 text-sm capitalize data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
              >
                {tr(humanizeCode(tab)).toLowerCase()}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <Tabs.Content value="match" className="space-y-7">
            {active && operate && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setIncident({ baseVersion: m.version, kind: 'TIMEOUT', side: '', notes: '' })
                }
              >
                <Flag size={16} />
                {tr('Record incident')}
              </Button>
            )}
            <MatchTimer
              match={m}
              serverNow={data.serverNow}
              busy={busy}
              disabled={!active || !operate}
              onCommand={(command, kind) =>
                void post(
                  { type: 'match.timer', id: m.id, baseVersion: m.version, command, kind },
                  'Timer updated.',
                )
              }
            />
            {active && operate && (
              <RefereeRulesPanel
                match={m}
                serverNow={data.serverNow}
                busy={busy}
                post={(input, message) => void post(input, message)}
              />
            )}
            {m.rollA !== null && (
              <p className="text-sm text-muted">
                {tr('Roll A:')} {m.rollA} {tr('· Roll B:')} {m.rollB} {tr('· First pick: Team')}{' '}
                {m.firstPickSide} {tr('· First ban: Team')} {m.firstBanSide}{' '}
                {tr('· First protect: Team')} {m.firstProtectSide || m.firstBanSide}
              </p>
            )}
            <section className="border-t pt-7">
              <h2 className="mb-4 text-xl font-semibold">{tr('Map results')}</h2>
              <div className="overflow-x-auto">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>{tr('Map')}</th>
                      <th>{tr('Pick')}</th>
                      <th>{tr('Team A')}</th>
                      <th>{tr('Team B')}</th>
                      <th>{tr('Winner')}</th>
                      <th>{tr('Notes')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actions
                      .filter((a) => a.kind === 'PICK')
                      .map((a) => {
                        const r = results.find((r) => r.actionId === a.id);
                        return (
                          <tr key={a.id}>
                            <td>{a.slotName}</td>
                            <td>
                              {tr('Team')} {a.side}
                            </td>
                            <td>
                              {(r?.scoreA != null
                                ? formatMapValue(r.scoreA, localeTag(language))
                                : null) ?? (r ? tr('Winner only') : tr('Pending'))}
                            </td>
                            <td>
                              {(r?.scoreB != null
                                ? formatMapValue(r.scoreB, localeTag(language))
                                : null) ?? (r ? tr('Winner only') : tr('Pending'))}
                            </td>
                            <td>{r ? m.participants[r.winnerSide].name : tr('Pending')}</td>
                            <td className="min-w-32 whitespace-pre-wrap">{r?.notes}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </section>
            <details className="border-y py-5">
              <summary className="cursor-pointer text-lg font-semibold">
                {tr('Lobby & clipboard commands')}
              </summary>
              <div className="mt-5 space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      copy(
                        [
                          commands.make,
                          commands.settings,
                          ...m.assignments.map((r) => `!mp addref #${r.user.osuId}`),
                          ...(['A', 'B'] as const).flatMap((side) =>
                            m.participants[side].members
                              .filter(
                                (p) =>
                                  m.rules.inviteWholeRoster ||
                                  p.captain ||
                                  m.participants[side].format === 'INDIVIDUAL',
                              )
                              .map((p) => `!mp invite #${p.osuId}`),
                          ),
                          commands.timer,
                        ].join('\n'),
                      )
                    }
                  >
                    <Copy size={16} />
                    {tr('Copy Setup Commands')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      copy(matchPing(m.stage.name, String(m.matchNumber), data.discordContacts))
                    }
                  >
                    <Copy size={16} />
                    {tr('Copy Match Ping')}
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {m.lobbyUrl && (
                    <Button asChild variant="outline">
                      <a href={m.lobbyUrl} target="_blank" rel="noopener noreferrer">
                        {tr('Open multiplayer lobby')}
                        <ExternalLink size={17} />
                      </a>
                    </Button>
                  )}
                  {operate && !['COMPLETED', 'CANCELLED'].includes(m.status) && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        setLobby({
                          baseVersion: m.version,
                          url: m.lobbyUrl,
                          mp: m.multiplayerId ? String(m.multiplayerId) : '',
                        })
                      }
                    >
                      {tr('Edit lobby details')}
                    </Button>
                  )}
                </div>
                {Object.entries(commands)
                  .filter(([, value]) => value)
                  .map(([key, value]) => (
                    <div key={key} className="flex items-start justify-between gap-3 border-b pb-3">
                      <code className="min-w-0 whitespace-pre-wrap break-words text-sm">
                        {value}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={tr('Copy {0} command', key)}
                        title={tr('Copy {0}', key)}
                        onClick={() => copy(value)}
                      >
                        <Copy size={17} />
                      </Button>
                    </div>
                  ))}
                {(['A', 'B'] as const).flatMap((side) =>
                  m.participants[side].members.map((p) => (
                    <div className="flex items-center justify-between gap-3" key={p.osuId}>
                      <p className="text-sm">{p.username}</p>
                      <code className="min-w-0 break-words text-sm">
                        {tr('!mp invite #')}
                        {p.osuId}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={tr('Copy invite {0}', p.username)}
                        title={tr('Copy invite command')}
                        onClick={() => copy(`!mp invite #${p.osuId}`)}
                      >
                        <Copy size={17} />
                      </Button>
                    </div>
                  )),
                )}
                {m.assignments.map((r) => (
                  <div key={r.userId} className="flex items-center justify-between gap-3">
                    <code className="break-words text-sm">
                      {tr('!mp addref #')}
                      {r.user.osuId}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={tr('Copy addref {0}', r.user.username)}
                      aria-label={tr('Copy addref {0}', r.user.username)}
                      onClick={() => copy(`!mp addref #${r.user.osuId}`)}
                    >
                      <Copy size={16} />
                    </Button>
                  </div>
                ))}
              </div>
            </details>
            <FreeModCalculator rules={m.rules} />
          </Tabs.Content>
          <Tabs.Content value="rosters">
            <div className="grid gap-8 lg:grid-cols-2">
              {(['A', 'B'] as const).map((side) => (
                <section key={side}>
                  <h2
                    className={`mb-5 text-xl font-semibold ${side === 'A' ? 'text-red-200' : 'text-sky-200'}`}
                  >
                    {m.participants[side].name}
                  </h2>
                  <div className="space-y-4">
                    {m.participants[side].members.map((p) => (
                      <a
                        key={p.osuId}
                        href={`https://osu.ppy.sh/users/${p.osuId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-4 border-b pb-4"
                      >
                        <img src={p.avatarUrl} alt="" className="size-12 rounded-md" />
                        <div className="min-w-0">
                          <p className="break-words font-semibold">{p.username}</p>
                          <p className="text-sm text-muted">
                            #{p.osuId} ·{' '}
                            {p.captain
                              ? tr('Captain')
                              : p.substitute
                                ? tr('Substitute')
                                : tr('Player')}
                          </p>
                        </div>
                      </a>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </Tabs.Content>
          <Tabs.Content value="multiplayer">
            <MultiplayerGames match={m} access={access} reload={reload} post={post} />
          </Tabs.Content>
          <Tabs.Content value="rules">
            <div className="space-y-7">
              <h2 className="text-xl font-semibold">{tr('Match rules snapshot')}</h2>
              <dl className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {[
                  ['Game mode', m.rules.gameMode],
                  ['Team mode', m.rules.teamMode],
                  ['Scoring', m.rules.scoreMode],
                  ['Team size', m.rules.teamSize],
                  ['Best of', m.rules.bestOf],
                  ['Bans per team', m.rules.bansPerTeam],
                  ['Protects per team', m.rules.protectsPerTeam],
                  ['Pick order', m.rules.pickOrder],
                  ['Ban order', m.rules.banOrder],
                  ['NoFail', m.rules.enforceNoFail ? tr('Required') : tr('Optional')],
                  ['Warmups per team', m.rules.warmupsPerTeam],
                  ['Timeouts per team', m.rules.timeoutsPerTeam],
                ].map(([label, value]) => (
                  <div key={label} className="border-b pb-3">
                    <dt className="text-sm text-muted">{tr(String(label))}</dt>
                    <dd className="mt-1 font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
              {[
                ['Late arrivals', m.rules.latePolicy],
                ['Rolls', m.rules.rollPolicy],
                ['FreeMod', m.rules.freeModPolicy],
                ['Tiebreaker', m.rules.tiebreakerPolicy],
                ['Disconnects', m.rules.disconnectPolicy],
                ['Warmups', m.rules.warmupPolicy || tr('{0} per team', m.rules.warmupsPerTeam)],
                [
                  'Timeouts',
                  m.rules.timeoutPolicy ||
                    tr(
                      '{0} per team, {1} seconds',
                      m.rules.timeoutsPerTeam,
                      m.rules.timeoutSeconds,
                    ),
                ],
                [
                  'Double picks',
                  m.rules.doublePickPolicy ||
                    (m.rules.allowDoublePicks ? tr('Allowed') : tr('Restricted')),
                ],
                [
                  'Double bans',
                  m.rules.doubleBanPolicy ||
                    (m.rules.allowDoubleBans ? tr('Allowed') : tr('Restricted')),
                ],
              ].map(([label, value]) => (
                <section key={label}>
                  <h3 className="mb-2 text-lg font-semibold">{tr(label)}</h3>
                  <p className="whitespace-pre-wrap text-muted">{value}</p>
                </section>
              ))}
              <pre className="overflow-auto border-y py-5 text-xs">
                {JSON.stringify(
                  { modMultipliers: m.rules.modMultipliers, categoryMods: m.rules.categoryMods },
                  null,
                  2,
                )}
              </pre>
            </div>
          </Tabs.Content>
          <Tabs.Content value="discord" className="space-y-4">
            <Button disabled={m.status !== 'COMPLETED'} onClick={() => copy(matchDiscordResult(m))}>
              <Copy size={17} />
              {tr('Copy Discord Result')}
            </Button>
            <pre
              aria-label={tr('Discord result preview')}
              className="overflow-auto whitespace-pre-wrap break-words border-y py-4 font-mono text-sm"
            >
              {matchDiscordPreview(m).replaceAll('\r', '\n')}
            </pre>
            {m.importedHistory?.discord && (
              <details className="border-t pt-3">
                <summary className="cursor-pointer text-sm">
                  {tr('Original spreadsheet result')}
                </summary>
                <p className="mt-2 text-xs text-muted">
                  {tr('Worksheet')} {m.importedHistory.worksheet} {tr('· Imported version')}{' '}
                  {m.importedHistory.version}
                </p>
                <pre
                  aria-label={tr('Original spreadsheet Discord result')}
                  className="mt-3 overflow-auto whitespace-pre-wrap break-words font-mono text-sm"
                >
                  {m.importedHistory.discord.replaceAll('\r', '\n')}
                </pre>
              </details>
            )}
          </Tabs.Content>
          <Tabs.Content value="history">
            <div className="space-y-8">
              <dl className="flex flex-wrap gap-6 text-sm">
                {(
                  [
                    ['Started', m.startedAt],
                    ['Submitted', m.submittedAt],
                    ['Confirmed', m.completedAt],
                  ] as const
                ).map(
                  ([label, value]) =>
                    value && (
                      <div key={label}>
                        <dt className="text-muted">{tr(label)}</dt>
                        <dd>{matchTime(value)}</dd>
                      </div>
                    ),
                )}
              </dl>
              <Field label={tr('Search match history')}>
                <input
                  type="search"
                  value={historyQuery}
                  onChange={(e) => setHistoryQuery(e.target.value)}
                />
              </Field>
              <section>
                <h2 className="mb-5 text-xl font-semibold">{tr('Result revisions')}</h2>
                <div className="space-y-3">
                  {m.revisions
                    ?.filter((r) =>
                      `${r.reason} ${r.kind} ${r.creator?.username}`
                        .toLowerCase()
                        .includes(historyQuery.toLowerCase()),
                    )
                    .map((r) => (
                      <div
                        className="flex flex-wrap items-center justify-between gap-3 border-b pb-4"
                        key={r.id}
                      >
                        <div>
                          <p className="font-semibold">
                            {tr('Version')} {r.version} · {r.kind.replace('match.', '')}
                          </p>
                          <p className="text-sm text-muted">
                            {r.reason} · {r.creator?.username || tr('System')} ·{' '}
                            {matchTime(r.createdAt)}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void run(async () => {
                              const value = await api<{ snapshot: unknown }>(
                                `/api/admin/data?section=match-revision&id=${encodeURIComponent(m.id)}&revision=${encodeURIComponent(r.id)}`,
                              );
                              setRevision(value.snapshot);
                            }, tr('Revision loaded.'))
                          }
                        >
                          {tr('View revision')}
                        </Button>
                      </div>
                    ))}
                </div>
              </section>
              <section>
                <h2 className="mb-5 text-xl font-semibold">{tr('Event log')}</h2>
                <ol className="space-y-4">
                  {events
                    .filter((e) =>
                      `${e.kind} ${e.notes} ${e.actor?.username} ${JSON.stringify(e.data)}`
                        .toLowerCase()
                        .includes(historyQuery.toLowerCase()),
                    )
                    .map((e) => (
                      <li className="border-b pb-4" key={e.id}>
                        <p className="font-semibold">
                          {tr('v')}
                          {e.version} · {e.kind}
                          {e.side ? tr(' · Team {0}', e.side) : ''}
                        </p>
                        <p className="mt-1 text-sm text-muted">
                          {e.actor?.username || tr('System')} · {matchTime(e.createdAt)}
                        </p>
                        {e.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{e.notes}</p>}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2"
                          onClick={() => setRevision(e)}
                        >
                          {tr('View event details')}
                        </Button>
                      </li>
                    ))}
                </ol>
                {hasOlder && (m.events?.length || 0) >= 250 && (
                  <Button
                    variant="outline"
                    className="mt-5"
                    onClick={() =>
                      void run(async () => {
                        const rows = await api<NonNullable<MatchView['events']>>(
                          `/api/admin/data?section=match-events&id=${encodeURIComponent(m.id)}&before=${events.at(-1)?.version}`,
                        );
                        setOlderEvents((old) => [...old, ...rows]);
                        setHasOlder(rows.length === 250);
                      }, tr('Earlier events loaded.'))
                    }
                  >
                    {tr('Load earlier events')}
                  </Button>
                )}
              </section>
            </div>
          </Tabs.Content>
        </Tabs.Root>
      </section>
      <Modal
        title={tr('Correct recorded map')}
        open={!!correction}
        onOpenChange={(open) => {
          if (!open) setCorrection(null);
        }}
      >
        {correction && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await action({ type: 'match.correct', id: m.id, ...correction });
                setCorrection(null);
                await reload();
              }, tr('Action corrected.'));
            }}
          >
            <p className="text-sm text-amber-200">
              {tr(
                'The selected action and its result will be replaced. Any following actions and results must also be discarded and recorded again. Previous records remain in the audit history.',
              )}
            </p>
            <Field label={tr('Replacement slot')}>
              <select
                required
                value={correction.slotName}
                onChange={(e) => setCorrection({ ...correction, slotName: e.target.value })}
              >
                <option value="">{tr('Select map')}</option>
                {slots.map((s) => (
                  <option key={s.name}>{s.name}</option>
                ))}
              </select>
            </Field>
            <Field label={tr('Correction reason')}>
              <input
                required
                minLength={3}
                value={correction.reason}
                onChange={(e) => setCorrection({ ...correction, reason: e.target.value })}
              />
            </Field>
            <label className="flex gap-3">
              <input
                type="checkbox"
                checked={correction.discardFollowing}
                onChange={(e) =>
                  setCorrection({ ...correction, discardFollowing: e.target.checked })
                }
              />
              {tr('Discard following actions and results')}
            </label>
            <SaveButton busy={busy} disabled={stale(correction.baseVersion)}>
              {tr('Confirm correction')}
            </SaveButton>
          </form>
        )}
      </Modal>
      <MatchScoreDialog
        match={m}
        selection={score}
        onClose={() => setScore(null)}
        onSaved={reload}
      />
      <Modal
        open={!!summary}
        onOpenChange={(open) => {
          if (!open) setSummary(null);
        }}
        title={tr('Correct historical result')}
      >
        {summary && (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await action({
                  type: 'match.summary',
                  id: m.id,
                  ...summary,
                  forfeitSide: summary.forfeitSide || null,
                });
                setSummary(null);
                await reload();
              }, tr('Corrected summary submitted for confirmation.'));
            }}
          >
            <Field label={tr('Team A match points')}>
              <input
                type="number"
                min={0}
                max={firstTo(m.rules)}
                value={summary.scoreA}
                onChange={(e) => setSummary({ ...summary, scoreA: Number(e.target.value) })}
              />
            </Field>
            <Field label={tr('Team B match points')}>
              <input
                type="number"
                min={0}
                max={firstTo(m.rules)}
                value={summary.scoreB}
                onChange={(e) => setSummary({ ...summary, scoreB: Number(e.target.value) })}
              />
            </Field>
            <Field label={tr('Forfeiting team')}>
              <select
                value={summary.forfeitSide}
                onChange={(e) =>
                  setSummary({ ...summary, forfeitSide: e.target.value as Side | '' })
                }
              >
                <option value="">{tr('No forfeit')}</option>
                <option value="A">
                  {tr('A ·')} {m.participants.A.name}
                </option>
                <option value="B">
                  {tr('B ·')} {m.participants.B.name}
                </option>
              </select>
            </Field>
            <Field label={tr('Correction reason')}>
              <textarea
                required
                minLength={3}
                value={summary.reason}
                onChange={(e) => setSummary({ ...summary, reason: e.target.value })}
              />
            </Field>
            <SaveButton busy={busy} disabled={stale(summary.baseVersion)}>
              {tr('Submit corrected summary')}
            </SaveButton>
          </form>
        )}
      </Modal>
      <Modal
        open={!!roll}
        onOpenChange={(open) => {
          if (!open) setRoll(null);
        }}
        title={tr('Record roll results')}
      >
        {roll && (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await action({
                  type: 'match.roll',
                  id: m.id,
                  baseVersion: roll.baseVersion,
                  rollA: roll.a,
                  rollB: roll.b,
                  firstPickSide: roll.firstPick,
                  firstBanSide: roll.firstBan,
                  firstProtectSide: roll.firstProtect,
                });
                setRoll(null);
                await reload();
              }, tr('Roll recorded.'));
            }}
          >
            <Field label={tr('Team A roll')}>
              <input
                type="number"
                min={1}
                max={100}
                required
                value={roll.a || ''}
                onChange={(e) => setRoll({ ...roll, a: Number(e.target.value) })}
              />
            </Field>
            <Field label={tr('Team B roll')}>
              <input
                type="number"
                min={1}
                max={100}
                required
                value={roll.b || ''}
                onChange={(e) => setRoll({ ...roll, b: Number(e.target.value) })}
              />
            </Field>
            <Field label={tr('First pick')}>
              <select
                value={roll.firstPick}
                onChange={(e) => setRoll({ ...roll, firstPick: e.target.value as Side })}
              >
                <option value="A">
                  {tr('A ·')} {m.participants.A.name}
                </option>
                <option value="B">
                  {tr('B ·')} {m.participants.B.name}
                </option>
              </select>
            </Field>
            <Field label={tr('First ban')}>
              <select
                value={roll.firstBan}
                onChange={(e) => setRoll({ ...roll, firstBan: e.target.value as Side })}
              >
                <option value="A">
                  {tr('A ·')} {m.participants.A.name}
                </option>
                <option value="B">
                  {tr('B ·')} {m.participants.B.name}
                </option>
              </select>
            </Field>
            <Field label={tr('First protect')}>
              <select
                value={roll.firstProtect}
                onChange={(e) => setRoll({ ...roll, firstProtect: e.target.value as Side })}
              >
                <option value="A">
                  {tr('A ·')} {m.participants.A.name}
                </option>
                <option value="B">
                  {tr('B ·')} {m.participants.B.name}
                </option>
              </select>
            </Field>
            <SaveButton busy={busy} disabled={stale(roll.baseVersion)}>
              {tr('Save roll')}
            </SaveButton>
          </form>
        )}
      </Modal>
      <Modal
        open={!!decision}
        onOpenChange={(open) => {
          if (!open) setDecision(null);
        }}
        title={decision ? tr(decisionLabels[decision.kind]) : tr('Review match')}
      >
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (decision)
              void run(async () => {
                await action({
                  type: `match.${decision.kind}`,
                  id: m.id,
                  baseVersion: decision.baseVersion,
                  reason,
                  ...(progressionImpact?.affected.length
                    ? { approveProgression, correctionHash: progressionImpact.hash }
                    : {}),
                  ...(decision.kind === 'forfeit' ? { winnerSide: decision.winnerSide } : {}),
                });
                setDecision(null);
                await reload();
              }, tr('Match updated.'));
          }}
        >
          <p>
            {m.participants.A.name} {m.scoreA} : {m.scoreB} {m.participants.B.name}
          </p>
          {decision?.kind === 'forfeit' && (
            <Field label={tr('Winning team')}>
              <select
                value={decision.winnerSide}
                onChange={(e) => setDecision({ ...decision, winnerSide: e.target.value as Side })}
              >
                <option value="A">
                  {tr('A ·')} {m.participants.A.name}
                </option>
                <option value="B">
                  {tr('B ·')} {m.participants.B.name}
                </option>
              </select>
            </Field>
          )}
          {!!progressionImpact?.affected.length && (
            <section className="space-y-3 text-sm">
              <h3 className="font-semibold">{tr('Affected downstream fixtures')}</h3>
              <ul>
                {progressionImpact.affected.map((change, i) => (
                  <li key={i}>
                    {change.matchNumber
                      ? tr('Match {0}', change.matchNumber)
                      : tr('Pending bracket position')}
                  </li>
                ))}
              </ul>
              {progressionImpact.blocked ? (
                <p role="alert">
                  {tr(
                    'Started or completed downstream matches require manual reconciliation. This change is blocked.',
                  )}
                </p>
              ) : (
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={approveProgression}
                    onChange={(e) => setApproveProgression(e.target.checked)}
                    required
                  />
                  {tr('Approve updating these unstarted fixtures')}
                </label>
              )}
            </section>
          )}
          <Field label={tr('Reason')}>
            <textarea
              required
              minLength={3}
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <SaveButton
            busy={busy}
            disabled={!decision || stale(decision.baseVersion) || progressionImpact?.blocked}
          >
            {decision ? tr(decisionLabels[decision.kind]) : tr('Confirm')}
          </SaveButton>
        </form>
      </Modal>
      <Modal
        open={!!submit}
        onOpenChange={(open) => {
          if (!open) setSubmit(null);
        }}
        title={tr('Review match result')}
      >
        {submit && (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await action({
                  type: 'match.submit',
                  id: m.id,
                  baseVersion: submit.baseVersion,
                  notes: submit.notes,
                });
                setSubmit(null);
                await reload();
              }, tr('Result submitted for confirmation.'));
            }}
          >
            <p className="text-xl font-semibold">
              {m.participants.A.name} {m.scoreA} : {m.scoreB} {m.participants.B.name}
            </p>
            <ul className="space-y-2">
              {actions.map((a) => {
                const r = results.find((r) => r.actionId === a.id);
                return (
                  <li key={a.id}>
                    {a.slotName} · {tr(humanizeCode(a.kind))} {tr('· Team')} {a.side}
                    {r && r.scoreA !== null && r.scoreB !== null
                      ? ` · ${formatMapValue(r.scoreA, localeTag(language))} : ${formatMapValue(r.scoreB, localeTag(language))}`
                      : ''}
                  </li>
                );
              })}
            </ul>
            <Field label={tr('Final match notes')}>
              <textarea
                value={submit.notes}
                onChange={(e) => setSubmit({ ...submit, notes: e.target.value })}
              />
            </Field>
            <SaveButton busy={busy} disabled={stale(submit.baseVersion)}>
              {tr('Submit result')}
            </SaveButton>
          </form>
        )}
      </Modal>
      <Modal
        open={!!lobby}
        onOpenChange={(open) => {
          if (!open) setLobby(null);
        }}
        title={tr('Multiplayer lobby')}
      >
        {lobby && (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await action({
                  type: 'match.lobby',
                  id: m.id,
                  baseVersion: lobby.baseVersion,
                  lobbyUrl: lobby.url,
                  multiplayerId: lobby.mp ? Number(lobby.mp) : null,
                });
                setLobby(null);
                await reload();
              }, tr('Lobby saved.'));
            }}
          >
            <Field label={tr('osu! multiplayer URL')}>
              <input
                type="url"
                value={lobby.url}
                onChange={(e) => {
                  const url = e.target.value;
                  let mp = '';
                  try {
                    const parsed = new URL(url);
                    if (parsed.origin === 'https://osu.ppy.sh')
                      mp = /^\/(?:community\/)?matches\/(\d+)\/?$/.exec(parsed.pathname)?.[1] || '';
                  } catch {}
                  setLobby({ ...lobby, url, mp });
                }}
              />
            </Field>
            <Field label={tr('Multiplayer match ID')}>
              <input
                type="number"
                min={1}
                value={lobby.mp}
                onChange={(e) =>
                  setLobby({
                    ...lobby,
                    mp: e.target.value,
                    url: e.target.value
                      ? `https://osu.ppy.sh/community/matches/${e.target.value}`
                      : '',
                  })
                }
              />
            </Field>
            <SaveButton busy={busy} disabled={stale(lobby.baseVersion)}>
              {tr('Save lobby')}
            </SaveButton>
          </form>
        )}
      </Modal>
      <Modal
        open={!!incident}
        onOpenChange={(open) => {
          if (!open) setIncident(null);
        }}
        title={tr('Record match incident')}
      >
        {incident && (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await action({
                  type: 'match.incident',
                  id: m.id,
                  baseVersion: incident.baseVersion,
                  kind: incident.kind,
                  side: incident.side || null,
                  notes: incident.notes,
                });
                setIncident(null);
                await reload();
              }, tr('Incident recorded.'));
            }}
          >
            <Field label={tr('Incident type')}>
              <select
                value={incident.kind}
                onChange={(e) =>
                  setIncident({ ...incident, kind: e.target.value as typeof incident.kind })
                }
              >
                {['TIMEOUT', 'DISCONNECT', 'DELAY', 'WARMUP'].map((type) => (
                  <option key={type} value={type}>
                    {tr(humanizeCode(type))}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={tr('Affected team')}>
              <select
                value={incident.side}
                onChange={(e) => setIncident({ ...incident, side: e.target.value as Side | '' })}
              >
                <option value="">{tr('Both / not applicable')}</option>
                <option value="A">
                  {tr('A ·')} {m.participants.A.name}
                </option>
                <option value="B">
                  {tr('B ·')} {m.participants.B.name}
                </option>
              </select>
            </Field>
            <Field label={tr('Incident notes')}>
              <textarea
                required
                minLength={3}
                value={incident.notes}
                onChange={(e) => setIncident({ ...incident, notes: e.target.value })}
              />
            </Field>
            <SaveButton busy={busy} disabled={stale(incident.baseVersion)}>
              {tr('Save incident')}
            </SaveButton>
          </form>
        )}
      </Modal>
      <Modal
        open={revision !== null}
        onOpenChange={(open) => {
          if (!open) setRevision(null);
        }}
        title={tr('Historical record')}
        wide
      >
        <pre className="max-w-full overflow-auto whitespace-pre-wrap break-words text-xs">
          {JSON.stringify(revision, null, 2)}
        </pre>
      </Modal>
    </>
  );
}
