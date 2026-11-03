export const DEFAULT_COPY = {
  mappoolsEyebrow: '',
  mappoolsTitle: 'Mappools',
  mappoolsDescription: '',
  staffEyebrow: '',
  staffTitle: 'Staff',
  staffDescription: '',
  rulesEyebrow: '',
  rulesDescription: '',
  communityLabel: '',
  competitionLabel: '',
  formatLabel: '',
  finalsLabel: '',
  timelineNote: '',
  footerTagline: '',
};
export type SiteCopy = typeof DEFAULT_COPY;
export function siteCopy(value: unknown): SiteCopy {
  const copy = { ...DEFAULT_COPY };
  if (value && typeof value === 'object')
    for (const key of Object.keys(copy) as (keyof SiteCopy)[]) {
      const text = (value as Record<string, unknown>)[key];
      if (typeof text === 'string') copy[key] = text;
    }
  return copy;
}
