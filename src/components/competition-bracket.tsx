'use client';
import { humanizeCode } from '@/lib/i18n';
import { useT } from '@/components/locale';

import { useMemo, useRef, useState, type PointerEvent } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  GitBranch,
  List,
  LockKeyhole,
  Maximize,
  Minus,
  Plus,
  Hand,
} from 'lucide-react';
import { Button } from './ui/button';
import type { CompetitionBracketData, CompetitionNode } from '@/lib/competition-types';
import { useTournamentTime } from './tournament-scope';
import styles from './competition-bracket.module.css';
import {
  bracketPresentation,
  bracketRoundDetails,
  bracketSlotLabel,
  BRACKET_CARD_WIDTH,
  groupHeading,
} from '@/lib/bracket-presentation';

export function CompetitionViewToggle({
  value,
  onChange,
}: {
  value: 'list' | 'bracket';
  onChange: (value: 'list' | 'bracket') => void;
}) {
  const tr = useT();
  return (
    <div className="flex gap-1" role="group" aria-label={tr('Match view')}>
      <Button
        size="sm"
        variant={value === 'list' ? 'default' : 'ghost'}
        aria-pressed={value === 'list'}
        onClick={() => onChange('list')}
      >
        <List size={16} />
        {tr('List')}
      </Button>
      <Button
        size="sm"
        variant={value === 'bracket' ? 'default' : 'ghost'}
        aria-pressed={value === 'bracket'}
        onClick={() => onChange('bracket')}
      >
        <GitBranch size={16} />
        {tr('Bracket')}
      </Button>
    </div>
  );
}
export function CompetitionBracket({
  bracket,
  onOpenMatch,
  onSelectNode,
  selectedNodeId,
  onRegenerateNode,
}: {
  bracket: CompetitionBracketData;
  onOpenMatch?: (matchId: string) => void;
  onSelectNode?: (nodeId: string) => void;
  selectedNodeId?: string;
  onRegenerateNode?: (nodeId: string) => void;
}) {
  const tr = useT();
  const time = useTournamentTime();
  const [search, setSearch] = useState('');
  const [zoom, setZoom] = useState(1),
    [roundIndex, setRoundIndex] = useState(0);
  const viewport = useRef<HTMLDivElement>(null),
    drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  // The same name the bracket shows above, and in that order, even when letters follow strength.
  const standingRows = (bracket.standings ?? [])
    .map((row) => ({
      row,
      heading: groupHeading(
        bracket.rounds.find((round) => round.lane === row.group) ?? { lane: row.group },
        tr,
      ),
    }))
    .sort(
      (a, b) =>
        a.heading.localeCompare(b.heading, 'en', { numeric: true }) || a.row.rank - b.row.rank,
    );
  const layout = useMemo(() => bracketPresentation(bracket), [bracket]);
  const currentRound = layout.rounds[Math.min(roundIndex, Math.max(0, layout.rounds.length - 1))];
  const currentDetails = currentRound ? bracketRoundDetails(bracket, currentRound, tr) : null;
  const select = (node: CompetitionNode) => {
    if (onSelectNode) onSelectNode(node.id);
    else if (node.matchId && onOpenMatch) onOpenMatch(node.matchId);
  };
  const searchTerm = search
    .trim()
    .replace(/^#(?=\d+$)/, '')
    .toLocaleLowerCase();
  const matchesSearch = (node: CompetitionNode) =>
    !searchTerm ||
    [
      String(node.match?.matchNumber || node.matchNumber || ''),
      ...node.slots.map((slot) => bracketSlotLabel(bracket, node, slot.side, tr)),
    ].some((value) => value.toLocaleLowerCase().includes(searchTerm));
  const nodeContent = (node: CompetitionNode) => (
    <>
      <div className={styles.matchHeader}>
        <span className="truncate">
          {node.match
            ? tr('Match {0}', node.match.matchNumber)
            : node.matchNumber
              ? tr('Match {0}', node.matchNumber)
              : node.key}
        </span>
        <span className={styles.status}>
          {node.match?.deletedAt || node.state === 'DELETED'
            ? tr('Deleted')
            : node.state === 'BYE'
              ? tr('Bye')
              : node.state === 'SKIPPED'
                ? tr('Not required')
                : tr(humanizeCode(node.match?.status || node.state))}
        </span>
      </div>
      {(['A', 'B'] as const).map((side) => {
        const slot = node.slots.find((s) => s.side === side),
          entry = bracket.entries.find((e) => e.teamId === slot?.teamId);
        const winner =
          !node.match?.deletedAt &&
          node.match?.status === 'COMPLETED' &&
          node.match.winnerSide === side;
        const label = bracketSlotLabel(bracket, node, side, tr);
        return (
          <div
            key={side}
            className={`${styles.entrant} ${winner ? styles.winner : ''}`}
            data-side={side}
          >
            <span className={styles.seed}>{entry?.seed || '-'}</span>
            <span className={styles.entrantName} title={label}>
              {label}
            </span>
            {slot?.mode === 'LOCKED' ? (
              <LockKeyhole size={12} aria-label={tr('Locked position')} />
            ) : slot?.mode === 'MANUAL' ? (
              <Hand size={12} aria-label={tr('Manual position')} />
            ) : null}
            <span className={styles.score}>
              {node.match
                ? node.match.forfeitSide === side
                  ? tr('FF')
                  : side === 'A'
                    ? node.match.scoreA
                    : node.match.scoreB
                : ''}
            </span>
          </div>
        );
      })}
      <div className={styles.matchFooter}>
        {node.match?.deletedAt
          ? tr('History retained')
          : node.match?.scheduledAt
            ? time(node.match.scheduledAt)
            : node.match?.status === 'COMPLETED'
              ? tr('Completed')
              : node.state === 'BYE'
                ? tr('Bye')
                : node.state === 'SKIPPED'
                  ? tr('Not required')
                  : node.state === 'READY'
                    ? tr('Ready to schedule')
                    : bracket.rounds.find((round) => round.id === node.roundId)?.lane ===
                          'FINALS' && node.slots.some((slot) => slot.outcome?.startsWith('RESET_'))
                      ? tr('Only played if a reset is required')
                      : tr('Awaiting progression')}
      </div>
    </>
  );
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button || (event.target as HTMLElement).closest('button')) return;
    const element = viewport.current!;
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      left: element.scrollLeft,
      top: element.scrollTop,
    };
    element.setPointerCapture(event.pointerId);
  };
  const fit = () => {
    if (viewport.current)
      setZoom(Math.min(1, Math.max(0.25, (viewport.current.clientWidth - 24) / layout.width)));
  };
  const changeRound = (index: number) => {
    setRoundIndex(index);
    const header = layout.headers.find((h) => h.round.id === layout.rounds[index]?.id);
    if (header && viewport.current)
      viewport.current.scrollTo({
        left: header.x * zoom,
        top: header.y * zoom,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
  };
  return (
    <section aria-label={tr('{0} bracket', bracket.name)} className="min-w-0">
      <input
        type="search"
        aria-label={tr('Search bracket')}
        placeholder={tr('Find a match number or participant')}
        className="mb-3 w-full md:max-w-sm"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || !search.trim()) return;
          const number = /^#?\d+$/.test(search.trim()) ? Number(searchTerm) : null;
          const node =
            bracket.nodes.find(
              (item) => number && (item.match?.matchNumber || item.matchNumber) === number,
            ) || bracket.nodes.find(matchesSearch);
          if (!node) return;
          changeRound(layout.rounds.findIndex((round) => round.id === node.roundId));
          select(node);
        }}
      />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            title={tr('Previous round')}
            aria-label={tr('Previous round')}
            disabled={roundIndex <= 0}
            onClick={() => changeRound(Math.max(0, roundIndex - 1))}
          >
            <ChevronLeft size={18} />
          </Button>
          <select
            aria-label={tr('Bracket round')}
            className="min-w-0 max-w-64"
            value={currentRound?.id || ''}
            onChange={(e) => {
              const i = layout.rounds.findIndex((r) => r.id === e.target.value);
              changeRound(i);
            }}
          >
            {layout.rounds.map((r) => (
              <option key={r.id} value={r.id}>
                {bracketRoundDetails(bracket, r, tr).label}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="icon"
            title={tr('Next round')}
            aria-label={tr('Next round')}
            disabled={roundIndex >= layout.rounds.length - 1}
            onClick={() => changeRound(Math.min(layout.rounds.length - 1, roundIndex + 1))}
          >
            <ChevronRight size={18} />
          </Button>
        </div>
        <div className="hidden items-center gap-1 md:flex">
          <Button
            variant="ghost"
            size="icon"
            title={tr('Zoom out')}
            aria-label={tr('Zoom out')}
            disabled={zoom <= 0.25}
            onClick={() => setZoom((z) => Math.max(0.25, z - 0.1))}
          >
            <Minus size={16} />
          </Button>
          <button
            type="button"
            aria-label={tr('Reset zoom')}
            className="min-h-11 w-14 text-center text-xs tabular-nums"
            onClick={() => setZoom(1)}
          >
            {Math.round(zoom * 100)}%
          </button>
          <Button
            variant="ghost"
            size="icon"
            title={tr('Zoom in')}
            aria-label={tr('Zoom in')}
            disabled={zoom >= 2}
            onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
          >
            <Plus size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title={tr('Fit bracket')}
            aria-label={tr('Fit bracket')}
            onClick={fit}
          >
            <Maximize size={16} />
          </Button>
        </div>
      </div>
      {!!search && !bracket.nodes.some(matchesSearch) && (
        <p role="status" className="py-3 text-sm text-muted">
          {tr('No matches found.')}
        </p>
      )}
      <div className="space-y-3 md:hidden">
        {currentDetails && !search.trim() && (
          <div className={styles.mobileHeading}>
            {currentDetails.group && <h2>{currentDetails.group}</h2>}
            <h3>{currentDetails.stage}</h3>
            <p>{currentDetails.role}</p>
          </div>
        )}
        {bracket.nodes
          .filter((n) => (search.trim() ? matchesSearch(n) : n.roundId === currentRound?.id))
          .map((node) => (
            <div key={node.id} className={styles.mobileCard}>
              <button
                type="button"
                className={styles.card}
                data-round={node.roundId}
                data-lane={bracket.rounds.find((round) => round.id === node.roundId)?.lane}
                data-conclusion={
                  bracket.rounds.find((round) => round.id === node.roundId)?.lane === 'FINALS' ||
                  undefined
                }
                data-selected={selectedNodeId === node.id}
                data-deleted={!!node.match?.deletedAt}
                aria-pressed={onSelectNode ? selectedNodeId === node.id : undefined}
                aria-label={
                  node.matchNumber
                    ? tr('Match {0}', node.matchNumber)
                    : tr('Bracket position {0}', node.position)
                }
                disabled={!onSelectNode && !(node.matchId && onOpenMatch)}
                onClick={() => select(node)}
              >
                {nodeContent(node)}
              </button>
              {node.match?.deletedAt && onRegenerateNode && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1 w-full"
                  onClick={() => onRegenerateNode(node.id)}
                >
                  {tr('Regenerate Match')}
                </Button>
              )}
            </div>
          ))}
      </div>
      <div
        ref={viewport}
        className={`hidden max-h-[70vh] min-h-64 overflow-auto overscroll-contain md:block ${styles.canvas}`}
        tabIndex={0}
        aria-label={tr('Bracket canvas')}
        onPointerDown={pointerDown}
        onPointerMove={(event) => {
          if (drag.current && viewport.current) {
            viewport.current.scrollLeft = drag.current.left - event.clientX + drag.current.x;
            viewport.current.scrollTop = drag.current.top - event.clientY + drag.current.y;
          }
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div
          style={{ width: layout.width * zoom, height: layout.height * zoom, position: 'relative' }}
        >
          <div
            style={{
              width: layout.width,
              height: layout.height,
              transform: `scale(${zoom})`,
              transformOrigin: '0 0',
              position: 'absolute',
            }}
          >
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 text-muted/35"
              width={layout.width}
              height={layout.height}
            >
              {layout.connectors.map((connector) => {
                const source = layout.positions.get(connector.sourceId),
                  target = layout.positions.get(connector.targetId);
                if (!source || !target) return null;
                const x1 = source.x + BRACKET_CARD_WIDTH,
                  y1 = source.y + 68,
                  x2 = target.x,
                  y2 = target.y + (connector.side === 'A' ? 48 : 88),
                  middle = (x1 + x2) / 2;
                return (
                  <path
                    key={`${connector.targetId}-${connector.side}`}
                    data-progression-lane={connector.lane}
                    data-source={connector.sourceId}
                    data-target={connector.targetId}
                    d={`M${x1},${y1} H${middle} V${y2} H${x2}`}
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeDasharray={connector.outcome === 'LOSER' ? '4 4' : undefined}
                    fill="none"
                  />
                );
              })}
            </svg>
            {layout.sections.map((section) => (
              <h2
                key={section.lane}
                data-bracket-section={section.lane}
                className={styles.section}
                style={{ left: section.x, top: section.y, width: section.width }}
              >
                {section.lane === 'WINNERS'
                  ? tr('Winners Bracket')
                  : section.lane === 'LOSERS'
                    ? tr('Losers Bracket')
                    : section.lane.startsWith('GROUP_')
                      ? groupHeading(
                          bracket.rounds.find((round) => round.lane === section.lane) ?? {
                            lane: section.lane,
                            name: '',
                          },
                          tr,
                        )
                      : tr('Third-place match')}
              </h2>
            ))}
            {layout.headers.map((header) => (
              <h3
                key={header.round.id}
                data-round-heading={header.round.id}
                data-conclusion={header.round.lane === 'FINALS' || undefined}
                className={`absolute m-0 ${styles.round}`}
                style={{ left: header.x, top: header.y, width: BRACKET_CARD_WIDTH }}
                title={bracketRoundDetails(bracket, header.round, tr).label}
              >
                <span className="block truncate">
                  {bracketRoundDetails(bracket, header.round, tr).stage}
                </span>
                <span className="mt-1 block text-[11px] font-normal text-muted">
                  {bracketRoundDetails(bracket, header.round, tr).role}
                </span>
              </h3>
            ))}
            {bracket.nodes.map((node) => {
              const position = layout.positions.get(node.id)!;
              return (
                <div
                  key={node.id}
                  style={{
                    left: position.x,
                    top: position.y,
                    position: 'absolute',
                    width: BRACKET_CARD_WIDTH,
                  }}
                  className={!matchesSearch(node) ? styles.dimmed : undefined}
                >
                  <button
                    type="button"
                    aria-label={
                      node.matchNumber || node.match?.matchNumber
                        ? tr('Match {0}', node.match?.matchNumber || node.matchNumber)
                        : node.key
                    }
                    className={styles.card}
                    data-round={node.roundId}
                    data-lane={bracket.rounds.find((round) => round.id === node.roundId)?.lane}
                    data-conclusion={
                      bracket.rounds.find((round) => round.id === node.roundId)?.lane ===
                        'FINALS' || undefined
                    }
                    data-selected={selectedNodeId === node.id}
                    data-deleted={!!node.match?.deletedAt}
                    aria-pressed={onSelectNode ? selectedNodeId === node.id : undefined}
                    onClick={() => select(node)}
                    disabled={!onSelectNode && !(node.matchId && onOpenMatch)}
                  >
                    {nodeContent(node)}
                  </button>
                  {node.match?.deletedAt && onRegenerateNode && (
                    <button
                      type="button"
                      className={styles.regenerate}
                      onClick={() => onRegenerateNode(node.id)}
                    >
                      {tr('Regenerate Match')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {!!bracket.standings?.length && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted">
                <th className="p-2">{tr('Group')}</th>
                <th className="p-2">{tr('Rank')}</th>
                <th className="p-2">{tr('Participant')}</th>
                <th className="p-2">{tr('W')}</th>
                <th className="p-2">{tr('L')}</th>
                <th className="p-2">{tr('Map +/-')}</th>
                <th className="p-2">{tr('Status')}</th>
              </tr>
            </thead>
            <tbody>
              {standingRows.map(({ row, heading }) => (
                <tr key={`${row.group}-${row.teamId}`} className="border-b border-border">
                  <td className="p-2">{heading}</td>
                  <td className="p-2 tabular-nums">{row.rank}</td>
                  <td className="p-2">
                    {bracket.entries.find((e) => e.teamId === row.teamId)?.team.name}
                  </td>
                  <td className="p-2 tabular-nums">{row.wins}</td>
                  <td className="p-2 tabular-nums">{row.losses}</td>
                  <td className="p-2 tabular-nums">{row.mapDifference}</td>
                  <td className="p-2 text-muted">
                    {row.qualified
                      ? tr('Qualified')
                      : row.tied
                        ? tr('Tiebreak pending')
                        : row.tieResolved
                          ? tr('Tiebreak approved')
                          : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
