import Papa from 'papaparse';
import { z } from 'zod';
import {
  matchesBatchScheduleSchema,
  type MatchesBatchScheduleAction,
} from './matches-bulk-validation';

type MatchRow = {
  id: string;
  matchNumber: number;
  version: number;
  status: string;
  scheduledAt: string | null;
};
type Referee = { id: string; username: string; osuId: number };
export type SchedulePasteRow = MatchesBatchScheduleAction['matches'][number] & {
  line: number;
  matchNumber: number;
  previousTime: string | null;
};
const normalize = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[ _-]+/g, '');
const clear = (value: string) => ['-', 'clear'].includes(value.toLowerCase());

function parseDate(value: string) {
  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
  ) {
    if (!z.iso.datetime({ offset: true }).safeParse(value).success)
      throw new Error('Use a valid ISO date and time.');
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error('Use a valid ISO date and time.');
    // UTC conversion must not normalize invalid calendar dates such as February 30.
    const calendar = value.slice(0, 10),
      day = new Date(`${calendar}T00:00:00Z`);
    if (day.toISOString().slice(0, 10) !== calendar)
      throw new Error('The calendar date does not exist.');
    return date.toISOString();
  }
  const local = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!local) throw new Error('Use YYYY-MM-DD HH:mm or an ISO timestamp with a timezone.');
  const [, year, month, day, hour, minute, second = '0'] = local.map((part) => part || '0');
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day) ||
    date.getHours() !== Number(hour) ||
    date.getMinutes() !== Number(minute) ||
    date.getSeconds() !== Number(second)
  )
    throw new Error('The calendar date or local time does not exist.');
  return date.toISOString();
}

export function parseMatchSchedulePaste(text: string, matches: MatchRow[], referees: Referee[]) {
  const errors: string[] = [],
    rows: SchedulePasteRow[] = [];
  if (text.length > 100_000) return { rows, errors: ['Paste at most 100 KB of schedule data.'] };
  const parsed = Papa.parse<string[]>(text, {
    delimiter: text.includes('\t') ? '\t' : ',',
    skipEmptyLines: 'greedy',
  });
  errors.push(...parsed.errors.map((error) => `Row ${(error.row ?? 0) + 1}: ${error.message}`));
  const raw = parsed.data.map((row) => row.map((cell) => cell.trim()));
  const headings = (raw[0] || []).map(normalize);
  const hasHeader = ['match', 'matchnumber', 'matchid', 'id', 'number'].includes(headings[0]);
  const matchIndex = hasHeader
    ? headings.findIndex((heading) =>
        ['match', 'matchnumber', 'matchid', 'id', 'number'].includes(heading),
      )
    : 0;
  const dateIndex = hasHeader
    ? headings.findIndex((heading) =>
        ['scheduledat', 'datetime', 'date/time', 'scheduledtime', 'date'].includes(heading),
      )
    : 1;
  const timeIndex = hasHeader ? headings.indexOf('time') : -1;
  const refIndex = hasHeader
    ? headings.findIndex((heading) => ['referee', 'referees', 'ref'].includes(heading))
    : 2;
  const body = hasHeader ? raw.slice(1) : raw;
  if (dateIndex < 0 && refIndex < 0) errors.push('Include a scheduled_at or referee column.');
  if (!body.length) errors.push('No schedule rows found.');
  if (body.length > 100) errors.push('Update at most 100 matches at a time.');
  const seen = new Set<string>();
  for (const [index, values] of body.slice(0, 100).entries()) {
    const line = index + (hasHeader ? 2 : 1);
    try {
      if (values.length > (hasHeader ? headings.length : 3))
        throw new Error(
          'Unexpected extra columns. Include headers for a separate date and time column.',
        );
      const numberText = values[matchIndex] || '';
      if (!/^#?[1-9]\d*$/.test(numberText))
        throw new Error('Enter a numeric tournament match number.');
      const matchNumber = Number(numberText.replace('#', ''));
      const record = matches.find((match) => match.matchNumber === matchNumber);
      if (!record)
        throw new Error(
          `Match ${matchNumber} is not in the current list. Check the tournament and clear filters.`,
        );
      if (seen.has(record.id)) throw new Error(`Match ${matchNumber} occurs more than once.`);
      seen.add(record.id);
      if (record.status !== 'SCHEDULED')
        throw new Error(`Match ${matchNumber} is not scheduled and cannot be changed here.`);
      const dateText = dateIndex < 0 ? '' : values[dateIndex] || '';
      const timeText = timeIndex < 0 ? '' : values[timeIndex] || '';
      if (timeText && !dateText) throw new Error('A time needs its date in the same row.');
      if (timeText && clear(dateText))
        throw new Error('A cleared date cannot also specify a time.');
      const refText = refIndex < 0 ? '' : values[refIndex] || '';
      const row: SchedulePasteRow = {
        id: record.id,
        baseVersion: record.version,
        matchNumber,
        line,
        previousTime: record.scheduledAt,
      };
      if (dateText)
        row.scheduledAt = clear(dateText)
          ? null
          : parseDate(timeText ? `${dateText} ${timeText}` : dateText);
      if (refText) {
        row.refereeIds = clear(refText)
          ? []
          : refText.split(/[;|]/).map((value) => {
              const name = value.trim().toLowerCase().replace(/\s+/g, '_');
              const found = referees.filter(
                (ref) =>
                  ref.id === value.trim() ||
                  ref.username.toLowerCase().replace(/\s+/g, '_') === name ||
                  String(ref.osuId) === value.trim().replace(/^#/, ''),
              );
              if (found.length !== 1)
                throw new Error(
                  `Referee "${value.trim()}" is unknown or ambiguous. Use an eligible username or osu! ID.`,
                );
              return found[0].id;
            });
      }
      const valid = matchesBatchScheduleSchema.safeParse({
        type: 'matches.batch.schedule',
        matches: [row],
      });
      if (!valid.success)
        throw new Error(valid.error.issues.map((issue) => issue.message).join(' '));
      rows.push(row);
    } catch (error) {
      errors.push(`Row ${line}: ${(error as Error).message}`);
    }
  }
  return { rows, errors };
}
