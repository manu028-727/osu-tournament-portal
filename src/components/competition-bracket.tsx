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
  const layout = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    const lanes = [...new Set(bracket.rounds.map((r) => r.lane))];
    let height = 0,
      width = 280;
    const headers: { id: string; name: string; x: number; y: number }[] = [];
    for (const lane of lanes) {
      const rounds = bracket.rounds.filter((r) => r.lane === lane);
      const maxCount = Math.max(
        1,
        ...rounds.map((r) => bracket.nodes.filter((n) => n.roundId === r.id).length),
      );
      const laneHeight = maxCount * 148;
      rounds.forEach((round, column) => {
        const x = column * 296 + 16;
        headers.push({ id: round.id, name: round.name, x, y: height });
        const nodes = bracket.nodes
          .filter((n) => n.roundId === round.id)
          .sort((a, b) => a.position - b.position);
        nodes.forEach((node, index) =>
          positions.set(node.id, {
            x,
            y: height + 50 + ((index + 0.5) * laneHeight) / Math.max(1, nodes.length) - 56,
          }),
        );
      });
      width = Math.max(width, rounds.length * 296);
      height += laneHeight + 64;
    }
    return { positions, headers, width, height: Math.max(180, height) };
  }, [bracket]);
  const currentRound = bracket.rounds[Math.min(roundIndex, Math.max(0, bracket.rounds.length - 1))];
  const select = (node: CompetitionNode) => {
    if (onSelectNode) onSelectNode(node.id);
    else if (node.matchId && onOpenMatch) onOpenMatch(node.matchId);
  };
  const matchesSearch = (node: CompetitionNode) =>
    !search.trim() ||
    [
      String(node.match?.matchNumber || node.matchNumber || ''),
      ...node.slots.map(
        (slot) => bracket.entries.find((entry) => entry.teamId === slot.teamId)?.team.name || '',
      ),
    ].some((value) => value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
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
        return (
          <div
            key={side}
            className={`${styles.entrant} ${winner ? styles.winner : ''}`}
            data-side={side}
          >
            <span className={styles.seed}>{entry?.seed || '-'}</span>
            <span className="min-w-0 flex-1 truncate text-left text-sm" title={entry?.team.name}>
              {entry?.team.name ||
                (slot?.teamId ? tr('Participant') : slot?.resolved ? tr('Bye') : tr('Pending'))}
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
    const header = layout.headers.find((h) => h.id === bracket.rounds[index]?.id);
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
          const node = bracket.nodes.find(matchesSearch);
          if (!node) return;
          changeRound(bracket.rounds.findIndex((round) => round.id === node.roundId));
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
              const i = bracket.rounds.findIndex((r) => r.id === e.target.value);
              changeRound(i);
            }}
          >
            {bracket.rounds.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="icon"
            title={tr('Next round')}
            aria-label={tr('Next round')}
            disabled={roundIndex >= bracket.rounds.length - 1}
            onClick={() => changeRound(Math.min(bracket.rounds.length - 1, roundIndex + 1))}
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
        {bracket.nodes
          .filter((n) => (search.trim() ? matchesSearch(n) : n.roundId === currentRound?.id))
          .map((node) => (
            <div key={node.id} className={styles.mobileCard}>
              <button
                type="button"
                className={styles.card}
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
              {bracket.nodes.flatMap((node) =>
                node.slots
                  .filter((s) => s.sourceNodeId)
                  .map((slot) => {
                    const source = layout.positions.get(slot.sourceNodeId!),
                      target = layout.positions.get(node.id);
                    if (!source || !target) return null;
                    const x1 = source.x + 248,
                      y1 = source.y + 56,
                      x2 = target.x,
                      y2 = target.y + (slot.side === 'A' ? 44 : 76),
                      middle = (x1 + x2) / 2;
                    return (
                      <path
                        key={`${node.id}-${slot.side}`}
                        d={`M${x1},${y1} H${middle} V${y2} H${x2}`}
                        stroke="currentColor"
                        strokeWidth={1.5}
                        strokeDasharray={slot.outcome === 'LOSER' ? '4 4' : undefined}
                        fill="none"
                      />
                    );
                  }),
              )}
            </svg>
            {layout.headers.map((header) => (
              <h3
                key={header.id}
                className={`absolute m-0 w-[248px] truncate ${styles.round}`}
                style={{ left: header.x, top: header.y + 8 }}
              >
                {header.name}
                <span className="mt-1 block text-[11px] font-normal text-muted">
                  {bracket.nodes.filter((node) => node.roundId === header.id).length === 1
                    ? tr('1 match')
                    : tr(
                        '{0} matches',
                        bracket.nodes.filter((node) => node.roundId === header.id).length,
                      )}
                </span>
              </h3>
            ))}
            {bracket.nodes.map((node) => {
              const position = layout.positions.get(node.id)!;
              return (
                <div
                  key={node.id}
                  style={{ left: position.x, top: position.y, position: 'absolute', width: 248 }}
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
              {bracket.standings.map((row) => (
                <tr key={`${row.group}-${row.teamId}`} className="border-b border-border">
                  <td className="p-2">{row.group.replace('_', ' ')}</td>
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
