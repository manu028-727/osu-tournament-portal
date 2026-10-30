'use client';
import { useLocale, useT } from '@/components/locale';
import { formatNumber } from '@/lib/i18n';

import type { ReactNode } from 'react';
import { Copy, Terminal, SlidersHorizontal } from 'lucide-react';
import { Button } from '../ui/button';
import { sortPoolSlots } from '@/lib/mappool-order';
import { lobbyCommands } from '@/lib/match-engine';
import type { MatchRules } from '@/lib/match-rules';
import type { MatchView } from '@/lib/matches-types';
import { themeStyle } from '@/lib/theme';
type Slot = NonNullable<MatchView['poolRevision']>['slots'][number];
export function RefereePool({
  slots,
  rules,
  copy,
  state,
  action,
  dense = false,
  label,
  textActions = false,
}: {
  slots: Slot[];
  rules: MatchRules;
  copy: (value: string) => void;
  state?: (slot: Slot) => ReactNode;
  action?: (slot: Slot) => ReactNode;
  dense?: boolean;
  label?: string;
  textActions?: boolean;
}) {
  const tr = useT();
  const language = useLocale();
  return (
    <section
      aria-label={label || tr('Match mappool')}
      className="min-w-0 [container-type:inline-size]"
    >
      <h2 className="mb-3 text-base font-semibold">
        {tr('Mappool')}{' '}
        <span className="text-sm font-normal text-muted">
          {tr(slots.length === 1 ? '{0} map' : '{0} maps', slots.length)}
        </span>
      </h2>
      <div
        className={`${dense ? 'referee-scroll max-h-[56vh]' : 'max-h-[65vh]'} overflow-auto border-y`}
      >
        <table
          className={`referee-pool ${dense ? 'referee-pool-dense' : ''} w-full table-fixed text-sm`}
        >
          <thead className="sticky top-0 z-10 bg-background text-left text-xs text-muted">
            <tr>
              <th className="pool-slot w-16">{tr('Slot')}</th>
              <th>{tr('Beatmap')}</th>
              <th className="pool-id w-24">{tr('ID')}</th>
              <th className="pool-copy w-28">{tr('Copy')}</th>
              {action && <th className={textActions ? 'w-24' : 'w-12'}>{tr('Action')}</th>}
            </tr>
          </thead>
          <tbody>
            {sortPoolSlots(slots).map((slot) => {
              const commands = lobbyCommands(rules, '', { code: '', teamA: '', teamB: '' }, slot);
              return (
                <tr
                  key={slot.name}
                  className={`${dense ? 'h-11' : 'h-14'} border-t align-middle`}
                  data-slot={slot.name}
                >
                  <td
                    className="font-mono font-semibold"
                    style={{ color: themeStyle(slot.color)['--brand'] }}
                  >
                    <span className="block truncate" title={slot.name}>
                      {slot.name}
                    </span>
                  </td>
                  <td className="min-w-0">
                    <div className="flex items-center gap-2">
                      {slot.metadata.cover && (
                        <img
                          className="pool-cover size-8 shrink-0 rounded object-cover"
                          src={slot.metadata.cover}
                          alt=""
                        />
                      )}
                      <div className="min-w-0">
                        <a
                          href={slot.metadata.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`${slot.metadata.artist} - ${slot.metadata.title} [${slot.metadata.difficulty}]`}
                          className="block truncate hover:text-primary"
                        >
                          {slot.metadata.artist} - {slot.metadata.title} [{slot.metadata.difficulty}
                          ]
                        </a>
                        <div className="truncate text-xs text-muted">
                          {state?.(slot) ||
                            (slot.category === rules.tiebreakerCategory
                              ? tr('Tiebreaker')
                              : tr('Available'))}{' '}
                          · {formatNumber(slot.metadata.stars, language, 2)}★
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="pool-id whitespace-nowrap text-xs text-muted">{slot.beatmapId}</td>
                  <td>
                    <div className="flex">
                      {(
                        [
                          ['ID', String(slot.beatmapId), Copy],
                          ['map command', commands.map, Terminal],
                          ['mod command', commands.mods, SlidersHorizontal],
                        ] as const
                      )
                        .filter(([, value]) => value)
                        .map(([label, value, Icon]) => (
                          <Button
                            key={label}
                            size="icon"
                            variant="ghost"
                            title={tr('Copy {0} {1}', slot.name, tr(label))}
                            aria-label={tr('Copy {0} {1}', slot.name, tr(label))}
                            onClick={() => copy(value)}
                          >
                            <Icon size={15} />
                          </Button>
                        ))}
                    </div>
                  </td>
                  {action && <td>{action(slot)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
