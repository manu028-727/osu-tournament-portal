export type OrderedSlot = {
  name: string;
  category: string;
  beatmapId: number;
  categoryPriority?: number | null;
};
export type SortCategory = { acronym: string; position: number };
const standard = ['NM', 'HD', 'HR', 'DT', 'FM'];
const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function normalizedSlot<T extends OrderedSlot>(slot: T): T {
  const category = slot.category.trim().toUpperCase();
  let name = slot.name.trim().toUpperCase();
  const suffix = name.slice(category.length);
  if (name.startsWith(category) && /^\d+$/.test(suffix) && Number.isSafeInteger(Number(suffix)))
    name = category + Number(suffix);
  return { ...slot, name, category };
}

export function poolSlotErrors(slots: OrderedSlot[], categories: SortCategory[]): string[] {
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const raw of slots) {
    const slot = normalizedSlot(raw);
    const suffix = slot.name.slice(slot.category.length);
    if (!Number.isSafeInteger(slot.beatmapId) || slot.beatmapId < 1 || slot.beatmapId > 2147483647)
      errors.push(`Enter a valid beatmap ID for ${slot.name || 'this slot'}.`);
    if (!categories.some((c) => c.acronym === slot.category))
      errors.push(`Unknown mod category: ${slot.category}.`);
    if (
      !slot.name.startsWith(slot.category) ||
      (suffix !== '' &&
        (!/^\d+$/.test(suffix) || !Number.isSafeInteger(Number(suffix)) || Number(suffix) < 1))
    )
      errors.push(
        `Invalid slot "${raw.name}": use ${slot.category} or ${slot.category} followed by a positive number.`,
      );
    if (seen.has(slot.name))
      errors.push(`Duplicate slot: ${slot.name}. Rename or remove one entry.`);
    seen.add(slot.name);
  }
  return errors;
}

export function sortPoolSlots<T extends OrderedSlot>(
  slots: T[],
  categories: SortCategory[] = [],
): T[] {
  const priority = (slot: T) => {
    const category = slot.category;
    if (category === 'TB') return Number.MAX_SAFE_INTEGER;
    const index = standard.indexOf(category);
    return index >= 0
      ? index + 1
      : (categories.find((c) => c.acronym === category)?.position ?? slot.categoryPriority ?? 1000);
  };
  return slots.map(normalizedSlot).sort((a, b) => {
    const rank = priority(a) - priority(b);
    if (rank) return rank;
    if (a.category !== b.category) {
      const known = Number(standard.includes(b.category)) - Number(standard.includes(a.category));
      return known || natural.compare(a.category, b.category);
    }
    return natural.compare(a.name, b.name) || a.beatmapId - b.beatmapId;
  });
}

export function nextSlotName(slots: OrderedSlot[], category: string) {
  const names = new Set(slots.map((s) => normalizedSlot(s).name));
  let number = 1;
  while (names.has(`${category}${number}`)) number++;
  return `${category}${number}`;
}

export function movePoolSlot<T extends OrderedSlot & { editorId: string }>(
  slots: T[],
  editorId: string,
  direction: -1 | 1,
  categories: SortCategory[],
): T[] {
  const ordered = sortPoolSlots(slots, categories);
  const current = ordered.find((s) => s.editorId === editorId);
  if (!current) return ordered;
  const group = ordered.filter((s) => s.category === current.category);
  const neighbor = group[group.findIndex((s) => s.editorId === editorId) + direction];
  if (!neighbor) return ordered;
  return sortPoolSlots(
    ordered.map((s) =>
      s.editorId === editorId
        ? { ...s, name: neighbor.name }
        : s.editorId === neighbor.editorId
          ? { ...s, name: current.name }
          : s,
    ),
    categories,
  );
}
