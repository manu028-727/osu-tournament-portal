export function matchTime(value: string | Date | null, timezone = 'UTC') {
  return value
    ? new Intl.DateTimeFormat('it-IT', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: timezone,
      }).format(new Date(value))
    : 'Data da definire';
}
export const PUBLIC_MATCH_STATUS = {
  SCHEDULED: 'Da disputare',
  IN_PROGRESS: 'In corso',
  AWAITING_CONFIRMATION: 'Risultato da confermare',
  COMPLETED: 'Concluso',
  DISPUTED: 'In revisione',
  CANCELLED: 'Annullato',
};
export function bracketEntrant(name: string) {
  const ref = /^([WL])(\d+)$/.exec(name);
  return ref ? `${ref[1] === 'W' ? 'Vincitore' : 'Perdente'} incontro ${ref[2]}` : name;
}
export function matchCredits(value: unknown) {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' ? value.slice(0, 120) : '');
  return {
    referee: text(source.referee),
    streamer: text(source.streamer),
    commentators: Array.isArray(source.commentators)
      ? source.commentators.map(text).filter(Boolean).slice(0, 4)
      : [],
  };
}
