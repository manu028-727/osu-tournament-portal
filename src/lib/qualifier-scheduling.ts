import type { QualifierAction } from './qualifiers-validation';

export type NewQualifierSession = Extract<
  QualifierAction,
  { type: 'qualifier.batch.create' }
>['sessions'][number];

export function qualifierSessionPlan(input: {
  stageId: string;
  prefix: string;
  firstNumber: number;
  count: number;
  entrantsPerLobby: number;
  teamIds: string[];
  refereeIds: string[];
  startAt: string | null;
  intervalMinutes: number;
}): NewQualifierSession[] {
  if (!input.stageId) throw new Error('Choose a qualifier stage.');
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 50)
    throw new Error('Create between 1 and 50 sessions at a time.');
  if (
    !Number.isInteger(input.firstNumber) ||
    input.firstNumber < 1 ||
    input.firstNumber > 1_000_000
  )
    throw new Error('Enter a valid first lobby number.');
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,70}$/.test(input.prefix))
    throw new Error('Use a short alphanumeric lobby prefix.');
  if (
    !Number.isInteger(input.entrantsPerLobby) ||
    input.entrantsPerLobby < 1 ||
    input.entrantsPerLobby > 16
  )
    throw new Error('Use between 1 and 16 entrants per session.');
  if (
    !Number.isInteger(input.intervalMinutes) ||
    input.intervalMinutes < 0 ||
    input.intervalMinutes > 10080
  )
    throw new Error('Use an interval from 0 to 10080 minutes.');
  if (new Set(input.teamIds).size !== input.teamIds.length)
    throw new Error('Select each entrant only once.');
  if (input.teamIds.length > input.count * input.entrantsPerLobby)
    throw new Error('Add more sessions or increase the entrants per session to fit the selection.');
  const start = input.startAt ? new Date(input.startAt) : null;
  if (start && !Number.isFinite(start.getTime())) throw new Error('Enter a valid start time.');
  return Array.from({ length: input.count }, (_, index) => ({
    code: `${input.prefix}${input.firstNumber + index}`,
    stageId: input.stageId,
    teamIds: input.teamIds.slice(
      index * input.entrantsPerLobby,
      (index + 1) * input.entrantsPerLobby,
    ),
    refereeIds: [...input.refereeIds],
    scheduledAt: start
      ? new Date(start.getTime() + index * input.intervalMinutes * 60_000).toISOString()
      : null,
    notes: '',
  }));
}
