'use client';
import { useLocale, useT } from '@/components/locale';
import { localeTag } from '@/lib/i18n';

import { useId, useMemo, useRef, useState, useSyncExternalStore, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { Dialog, HoverCard } from 'radix-ui';
import { Check, Copy, ExternalLink, Info, X } from 'lucide-react';
import type { PoolContent } from '@/lib/types';
import { sortPoolSlots } from '@/lib/mappool-order';
import { duration } from '@/lib/utils';
import { Button } from './ui/button';
import styles from './public-mappool.module.css';

type Slot = PoolContent['slots'][number];
const hoverQuery = '(min-width: 1024px) and (hover: hover) and (pointer: fine)';
function subscribeHover(callback: () => void) {
  const query = window.matchMedia(hoverQuery);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}
const getHover = () => window.matchMedia(hoverQuery).matches;
const noHover = () => false;

function SlotBadge({ slot }: { slot: Pick<Slot, 'name' | 'color'> }) {
  return (
    <span
      className={styles.slot}
      style={{ '--slot-color': slot.color, background: `${slot.color}20` } as CSSProperties}
    >
      {slot.name}
    </span>
  );
}

function MapStats({ slot }: { slot: Slot }) {
  const tr = useT();
  const language = useLocale();
  const map = slot.metadata;
  return (
    <>
      <dl className={styles.stats}>
        {[
          [
            'Stelle',
            `${map.stars.toLocaleString(localeTag(language), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ★`,
          ],
          ['BPM', map.bpm],
          ['Durata', duration(map.length)],
          ['AR', map.ar],
          ['CS', map.cs],
          ['OD', map.od],
          [map.statisticsSource ? 'HP base' : 'HP', map.hp ?? tr('n/d')],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{tr(String(label))}</dt>
            <dd>{typeof value === 'number' ? value.toLocaleString(localeTag(language)) : value}</dd>
          </div>
        ))}
      </dl>
      <dl className={styles.mapper}>
        <dt>{tr('Mapper')}</dt>
        <dd>{map.mapper}</dd>
      </dl>
      {map.unavailable && (
        <p className={styles.warning}>
          {tr("Mappa non disponibile nell'API osu!; dati dal main sheet.")}
        </p>
      )}
    </>
  );
}

function MapCard({
  slot,
  hoverEnabled,
  detailsOpen,
  selected,
  dialogId,
  theme,
  captureTheme,
  showDetails,
}: {
  slot: Slot;
  hoverEnabled: boolean;
  detailsOpen: boolean;
  selected: boolean;
  dialogId: string;
  theme: CSSProperties;
  captureTheme: () => void;
  showDetails: (slot: Slot, trigger: HTMLButtonElement) => void;
}) {
  const tr = useT();
  const [hovered, setHovered] = useState(false);
  const previewId = useId();
  const map = slot.metadata;
  const open = hoverEnabled && !detailsOpen && hovered;
  const link = (
    <a
      href={map.url}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.mapLink}
      aria-label={tr(
        '{0}: {1} - {2} [{3}], apri su osu!',
        slot.name,
        map.artist,
        map.title,
        map.difficulty,
      )}
      aria-describedby={open ? previewId : undefined}
    >
      <SlotBadge slot={slot} />
      <span className={styles.track}>
        <span className={styles.title}>
          {map.artist} - {map.title}
        </span>
        <span className={styles.difficulty}>[{map.difficulty}]</span>
      </span>
    </a>
  );
  return (
    <HoverCard.Root
      open={open}
      openDelay={180}
      closeDelay={120}
      onOpenChange={(next) => {
        if (next) captureTheme();
        setHovered(next && hoverEnabled);
      }}
    >
      <li className={styles.card} data-slot={slot.name}>
        {map.cover && <img src={map.cover} alt="" loading="lazy" className={styles.artwork} />}
        <div className={styles.shade} aria-hidden="true" />
        {hoverEnabled ? <HoverCard.Trigger asChild>{link}</HoverCard.Trigger> : link}
        <button
          type="button"
          className={styles.info}
          aria-label={tr('Dettagli {0}', slot.name)}
          title={tr('Dettagli {0}', slot.name)}
          aria-haspopup="dialog"
          aria-expanded={selected}
          aria-controls={selected ? dialogId : undefined}
          onClick={(event) => {
            setHovered(false);
            showDetails(slot, event.currentTarget);
          }}
        >
          <Info size={19} aria-hidden="true" />
        </button>
      </li>
      <HoverCard.Portal>
        <HoverCard.Content
          id={previewId}
          role="tooltip"
          aria-label={tr('Anteprima {0}', slot.name)}
          className={styles.preview}
          style={theme}
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          avoidCollisions
        >
          <div className={styles.previewHeader}>
            <SlotBadge slot={slot} />
            <span>#{slot.beatmapId}</span>
          </div>
          <p className={styles.fullTitle}>
            {map.artist} - {map.title}
          </p>
          <p className={styles.fullDifficulty}>[{map.difficulty}]</p>
          <MapStats slot={slot} />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}

export function PublicMappool({ pool }: { pool: PoolContent }) {
  const tr = useT();
  const slots = useMemo(() => sortPoolSlots(pool.slots), [pool.slots]);
  const groups = useMemo(() => {
    const categories = new Map<string, Slot[]>();
    for (const slot of slots) {
      const group = categories.get(slot.category);
      if (group) group.push(slot);
      else categories.set(slot.category, [slot]);
    }
    return [...categories].map(([category, maps]) => ({ category, maps }));
  }, [slots]);
  const hoverEnabled = useSyncExternalStore(subscribeHover, getHover, noHover);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dialogId = useId();
  const [selected, setSelected] = useState<Slot | null>(null);
  const [theme, setTheme] = useState<CSSProperties>({});
  const [copied, setCopied] = useState<{ id: number; state: 'success' | 'error' } | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const captureTheme = () => {
    if (!root.current) return;
    const palette = getComputedStyle(root.current);
    setTheme({
      '--brand': palette.getPropertyValue('--brand'),
      '--accent': palette.getPropertyValue('--accent'),
    } as CSSProperties);
  };
  const showDetails = (slot: Slot, button: HTMLButtonElement) => {
    captureTheme();
    trigger.current = button;
    setCopied(null);
    setSelected(slot);
  };
  const copyId = async (slot: Slot) => {
    try {
      await navigator.clipboard.writeText(String(slot.beatmapId));
      setCopied({ id: slot.beatmapId, state: 'success' });
    } catch {
      setCopied({ id: slot.beatmapId, state: 'error' });
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 2500);
  };
  return (
    <div ref={root} className={styles.pool}>
      {pool.notes && <p className={styles.notes}>{pool.notes}</p>}
      <p className={styles.count}>
        {slots.length} {tr('mappe')}
      </p>
      <div role="group" aria-label={tr('Mappool')} className={styles.groups}>
        {groups.map(({ category, maps }) => (
          <section
            key={category}
            aria-label={tr('Categoria {0}', category)}
            style={{ '--mod-color': maps[0].color } as CSSProperties}
          >
            <ul aria-label={tr('Mappe {0}', category)} className={styles.grid}>
              {maps.map((slot) => (
                <MapCard
                  key={slot.id || slot.name}
                  slot={slot}
                  hoverEnabled={hoverEnabled}
                  detailsOpen={!!selected}
                  selected={selected?.name === slot.name}
                  dialogId={dialogId}
                  theme={theme}
                  captureTheme={captureTheme}
                  showDetails={showDetails}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
      {!slots.length && <p className={styles.notes}>{tr('Nessuna mappa pubblicata.')}</p>}
      <Dialog.Root
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        {selected && (
          <Dialog.Portal>
            <Dialog.Overlay className={styles.backdrop} />
            <Dialog.Content
              id={dialogId}
              className={styles.sheet}
              style={theme}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                trigger.current?.focus({ preventScroll: true });
              }}
            >
              <div className={styles.sheetHeader}>
                <SlotBadge slot={selected} />
                <Dialog.Close
                  className={styles.close}
                  aria-label={tr('Chiudi')}
                  title={tr('Chiudi')}
                >
                  <X size={20} aria-hidden="true" />
                </Dialog.Close>
              </div>
              <div className={styles.sheetBody}>
                <Dialog.Title className={styles.fullTitle}>
                  {selected.metadata.artist} - {selected.metadata.title}
                </Dialog.Title>
                <Dialog.Description className={styles.fullDifficulty}>
                  [{selected.metadata.difficulty}]
                </Dialog.Description>
                <MapStats slot={selected} />
                <div className={styles.idRow}>
                  <div>
                    <span>{tr('Beatmap ID')}</span>
                    <code>{selected.beatmapId}</code>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="size-11"
                    onClick={() => void copyId(selected)}
                    aria-label={tr('Copia beatmap ID')}
                    title={tr('Copia beatmap ID')}
                  >
                    {copied?.id === selected.beatmapId && copied.state === 'success' ? (
                      <Check size={18} />
                    ) : (
                      <Copy size={18} />
                    )}
                  </Button>
                </div>
                <p role="status" aria-live="polite" className={styles.copyStatus}>
                  {copied?.id === selected.beatmapId
                    ? copied.state === 'success'
                      ? tr('ID copiato')
                      : tr("Impossibile copiare l'ID.")
                    : ''}
                </p>
                <Button asChild className="w-full">
                  <a href={selected.metadata.url} target="_blank" rel="noopener noreferrer">
                    {tr('Apri su osu!')}
                    <ExternalLink size={16} />
                  </a>
                </Button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </Dialog.Root>
    </div>
  );
}
