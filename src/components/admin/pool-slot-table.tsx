'use client';
import { Fragment, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ArrowDown,
  Copy,
  ChevronDown,
  ChevronUp,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import type { BeatmapMetadata } from '@/lib/osu';
import { themeStyle } from '@/lib/theme';
import {
  poolSlotErrors,
  sortPoolSlots,
  nextSlotName,
  type OrderedSlot,
  type SortCategory,
} from '@/lib/mappool-order';

export type EditorSlot = OrderedSlot & { editorId: string };
export function PoolSlotTable({
  slots,
  categories,
  metadata,
  errors,
  disabled,
  onUpdate,
  onMove,
  onRemove,
  onCopy,
  onBulkRemove,
  onBulkCategory,
  onBulkTransfer,
  transferDisabled,
}: {
  slots: EditorSlot[];
  categories: (SortCategory & { color: string })[];
  metadata: Record<number, BeatmapMetadata>;
  errors: Record<number, string>;
  disabled: boolean;
  onUpdate: (id: string, change: Partial<OrderedSlot>) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
  onCopy: (text: string) => void;
  onBulkRemove: (ids: string[]) => void;
  onBulkCategory: (ids: string[], category: string) => void;
  onBulkTransfer?: (names: string[]) => void;
  transferDisabled?: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const lastSelected = useRef<string | null>(null);
  const canonical = sortPoolSlots(slots, categories);
  useEffect(() => {
    const currentIds = new Set(slots.map((slot) => slot.editorId));
    setSelected((current) => {
      const next = new Set([...current].filter((id) => currentIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [slots]);
  return (
    <div className="space-y-2">
      {slots.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              aria-label="Select all mappool slots"
              checked={selected.size === slots.length}
              onChange={(event) =>
                setSelected(
                  event.target.checked ? new Set(slots.map((slot) => slot.editorId)) : new Set(),
                )
              }
              disabled={disabled}
            />
            Select all
          </label>
          <span className="text-muted">{selected.size} selected</span>
          {selected.size > 0 && (
            <>
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 hover:bg-[var(--surface-hover)]"
                disabled={disabled}
                onClick={() =>
                  onCopy(
                    slots
                      .filter((slot) => selected.has(slot.editorId) && slot.beatmapId > 0)
                      .map((slot) => slot.beatmapId)
                      .join('\n'),
                  )
                }
              >
                Copy IDs
              </button>
              {onBulkTransfer && (
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 hover:bg-[var(--surface-hover)]"
                  disabled={
                    disabled ||
                    transferDisabled ||
                    !slots.some((slot) => selected.has(slot.editorId) && slot.beatmapId > 0)
                  }
                  title={
                    transferDisabled
                      ? 'Save draft changes before transferring maps'
                      : 'Copy or move saved maps to another stage'
                  }
                  onClick={() =>
                    onBulkTransfer(
                      slots
                        .filter((slot) => selected.has(slot.editorId) && slot.beatmapId > 0)
                        .map((slot) => slot.name),
                    )
                  }
                >
                  <Copy size={14} />
                  Copy / move to stage
                </button>
              )}
              <label className="ml-auto flex items-center gap-2">
                <span className="text-xs text-muted">Change mod</span>
                <select
                  aria-label="Change selected maps mod category"
                  disabled={disabled}
                  defaultValue=""
                  onChange={(event) => {
                    if (event.target.value) onBulkCategory([...selected], event.target.value);
                    event.currentTarget.value = '';
                  }}
                >
                  <option value="" disabled>
                    Choose category
                  </option>
                  {categories.map((category) => (
                    <option key={category.acronym} value={category.acronym}>
                      {category.acronym}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-red-200 hover:bg-red-400/10"
                disabled={disabled}
                onClick={() => {
                  if (
                    !window.confirm(
                      `Remove ${selected.size} selected map${selected.size === 1 ? '' : 's'}?`,
                    )
                  )
                    return;
                  onBulkRemove([...selected]);
                  setSelected(new Set());
                }}
              >
                Remove selected
              </button>
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-muted hover:text-foreground"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </button>
            </>
          )}
        </div>
      )}
      <div
        className="pool-editor-table relative max-h-[65vh] min-h-40 overflow-auto rounded-lg border"
        tabIndex={0}
        aria-label="Mappool slots"
      >
        <table className="w-full min-w-[940px] table-fixed text-left text-sm">
          <colgroup>
            <col className="w-10" />
            <col className="w-16" />
            <col className="w-20" />
            <col className="w-20" />
            <col />
            <col className="w-28" />
            <col className="w-16" />
            <col className="w-28" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-card text-xs text-muted">
            <tr>
              {['', 'Order', 'Slot', 'Mod', 'Beatmap', 'ID', 'Stars', 'Actions'].map((h) => (
                <th key={h} scope="col" className="h-9 px-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map((s) => {
              const map = metadata[s.beatmapId];
              const group = canonical.filter((v) => v.category === s.category);
              const position = group.findIndex((v) => v.editorId === s.editorId);
              const problems = poolSlotErrors([s], categories);
              const icon = (
                label: string,
                onClick: () => void,
                content: React.ReactNode,
                inactive = false,
              ) => (
                <button
                  type="button"
                  title={label}
                  aria-label={label}
                  disabled={inactive}
                  onClick={onClick}
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-[var(--surface-hover)] focus-visible:outline-2"
                >
                  {content}
                </button>
              );
              return (
                <Fragment key={s.editorId}>
                  <tr
                    data-slot-id={s.editorId}
                    className="h-[54px] border-t hover:bg-[var(--surface-hover)]"
                  >
                    <td className="px-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${s.name}`}
                        checked={selected.has(s.editorId)}
                        disabled={disabled}
                        onChange={(event) => {
                          const index = slots.findIndex((slot) => slot.editorId === s.editorId);
                          const anchor = slots.findIndex(
                            (slot) => slot.editorId === lastSelected.current,
                          );
                          setSelected((current) => {
                            const next = new Set(current);
                            const isShiftClick =
                              event.nativeEvent instanceof MouseEvent && event.nativeEvent.shiftKey;
                            if (isShiftClick && anchor >= 0) {
                              const start = Math.min(anchor, index);
                              const end = Math.max(anchor, index);
                              for (const slot of slots.slice(start, end + 1)) {
                                if (event.target.checked) next.add(slot.editorId);
                                else next.delete(slot.editorId);
                              }
                            } else if (event.target.checked) next.add(s.editorId);
                            else next.delete(s.editorId);
                            return next;
                          });
                          lastSelected.current = s.editorId;
                        }}
                      />
                    </td>
                    <td className="px-1">
                      <div className="flex">
                        {icon(
                          `Move ${s.name} up`,
                          () => onMove(s.editorId, -1),
                          <ArrowUp size={14} />,
                          disabled || position < 1,
                        )}
                        {icon(
                          `Move ${s.name} down`,
                          () => onMove(s.editorId, 1),
                          <ArrowDown size={14} />,
                          disabled || position === group.length - 1,
                        )}
                      </div>
                    </td>
                    <td className="px-1">
                      <input
                        aria-label="Slot"
                        value={s.name}
                        maxLength={20}
                        disabled={disabled}
                        aria-invalid={!!problems.length}
                        style={{
                          color: themeStyle(
                            categories.find((c) => c.acronym === s.category)?.color,
                          )['--brand'],
                        }}
                        className="font-semibold"
                        onChange={(e) =>
                          onUpdate(s.editorId, { name: e.target.value.toUpperCase() })
                        }
                      />
                    </td>
                    <td className="px-1">
                      <select
                        aria-label="Mod category"
                        disabled={disabled}
                        value={s.category}
                        onChange={(e) =>
                          onUpdate(s.editorId, {
                            category: e.target.value,
                            name: nextSlotName(slots, e.target.value),
                          })
                        }
                      >
                        {categories.map((c) => (
                          <option key={c.acronym} value={c.acronym}>
                            {c.acronym}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2">
                      <div className="flex min-w-0 items-center gap-2">
                        {map?.cover && (
                          <img
                            src={map.cover}
                            alt=""
                            loading="lazy"
                            className="h-8 w-10 shrink-0 rounded object-cover"
                          />
                        )}
                        <div
                          className="min-w-0"
                          title={
                            map
                              ? `${map.artist} - ${map.title} [${map.difficulty}] · ${map.mapper}`
                              : errors[s.beatmapId] || 'Metadata not loaded'
                          }
                        >
                          <div className="truncate font-medium">
                            {map
                              ? `${map.artist} - ${map.title}`
                              : errors[s.beatmapId] || 'Metadata not loaded'}
                          </div>
                          {map && (
                            <div className="truncate text-xs text-muted">[{map.difficulty}]</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-1">
                      <input
                        aria-label="Beatmap ID"
                        type="number"
                        min={1}
                        max={2147483647}
                        value={s.beatmapId || ''}
                        disabled={disabled}
                        onChange={(e) =>
                          onUpdate(s.editorId, { beatmapId: Number(e.target.value) })
                        }
                      />
                    </td>
                    <td className="px-2 font-mono text-amber-200">
                      {map?.stars.toFixed(2) ?? '--'}
                    </td>
                    <td className="px-1">
                      <div className="flex">
                        {icon(
                          `Copy beatmap ID ${s.beatmapId}`,
                          () => onCopy(String(s.beatmapId)),
                          <Copy size={14} />,
                          s.beatmapId < 1,
                        )}
                        <button
                          type="button"
                          title={`Details for ${s.name}`}
                          aria-label={`Details for ${s.name}`}
                          aria-expanded={expanded === s.editorId}
                          onClick={() => setExpanded(expanded === s.editorId ? null : s.editorId)}
                          className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-[var(--surface-hover)]"
                        >
                          {expanded === s.editorId ? (
                            <ChevronUp size={14} />
                          ) : (
                            <ChevronDown size={14} />
                          )}
                        </button>
                        {icon(
                          `Remove ${s.name}`,
                          () => onRemove(s.editorId),
                          <Trash2 size={14} />,
                          disabled,
                        )}
                      </div>
                    </td>
                  </tr>
                  {expanded === s.editorId && (
                    <tr className="border-t bg-[var(--surface-hover)]">
                      <td colSpan={8} className="p-4">
                        {map ? (
                          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                            <span className="break-words">
                              {map.artist} - {map.title} [{map.difficulty}]
                            </span>
                            <span>Mapper: {map.mapper}</span>
                            <span>{map.bpm} BPM</span>
                            <span>
                              {Math.floor(map.length / 60)}:
                              {String(map.length % 60).padStart(2, '0')}
                            </span>
                            <span>
                              AR {map.ar} · CS {map.cs} · OD {map.od} · HP {map.hp ?? '--'}
                            </span>
                            <a
                              href={`https://osu.ppy.sh/beatmaps/${s.beatmapId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Open beatmap ${s.beatmapId}`}
                              title="Open beatmap"
                              className="text-primary"
                            >
                              <ExternalLink size={16} />
                            </a>
                          </div>
                        ) : (
                          <span className="text-muted">
                            {errors[s.beatmapId] || 'Metadata not loaded'}
                          </span>
                        )}
                        {problems.map((p) => (
                          <p key={p} role="alert" className="text-red-300">
                            {p}
                          </p>
                        ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
