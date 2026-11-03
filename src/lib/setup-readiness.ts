// Derived from real records, never stored, so it cannot drift from what actually exists.
export const SETUP_SECTIONS = [
  'identity',
  'registration',
  'rosters',
  'scoring',
  'stages',
  'format',
  'schedule',
  'staff',
  'publication',
] as const;
export type SetupSection = (typeof SETUP_SECTIONS)[number];
export type SetupSummary = {
  description: string;
  hasBanner: boolean;
  published: boolean;
  registrationMode: 'WEBSITE' | 'EXTERNAL';
  registrationOpen: boolean;
  registrationWindowSet: boolean;
  gameplayScoringSet: boolean;
  teamSize: number;
  maxPlayers: number;
  stages: { name: string; kind: string; poolSlots: number; poolPublished: boolean }[];
  plan: { exists: boolean; valid: boolean; locked: boolean };
  approvedEntrants: number;
  staff: number;
  homePublished: boolean;
  rulesPublished: boolean;
  dismissed: readonly string[];
};
export type ReadinessItem = {
  id: string;
  section: SetupSection;
  label: string;
  values?: (string | number)[];
  required: boolean;
  done: boolean;
};

export function setupReadiness(summary: SetupSummary): ReadinessItem[] {
  const activeStages = summary.stages;
  const unpublishedPools = activeStages.filter((stage) => !stage.poolPublished);
  const items: ReadinessItem[] = [
    {
      id: 'scoring',
      section: 'scoring',
      label: 'Choose the gameplay scoring system',
      required: true,
      done: summary.gameplayScoringSet,
    },
    {
      id: 'stages',
      section: 'stages',
      label: 'Create the tournament stages',
      required: true,
      done: activeStages.length > 0,
    },
    {
      id: 'format',
      section: 'format',
      label: 'Plan how entrants progress through the phases',
      required: true,
      done: summary.plan.exists && summary.plan.valid,
    },
    {
      id: 'pools',
      section: 'stages',
      label: unpublishedPools.length
        ? 'Publish the mappool for {0} more stages'
        : 'Publish a mappool for every stage',
      values: unpublishedPools.length ? [unpublishedPools.length] : [],
      required: true,
      done: activeStages.length > 0 && unpublishedPools.length === 0,
    },
    {
      id: 'roster',
      section: 'rosters',
      label: 'Allow rosters big enough for the players per side',
      required: true,
      done: summary.maxPlayers >= summary.teamSize,
    },
    {
      id: 'publish',
      section: 'publication',
      label: 'Publish the tournament',
      required: true,
      done: summary.published,
    },
    {
      id: 'registration-window',
      section: 'registration',
      label: 'Set when registration opens and closes',
      required: false,
      done: summary.registrationWindowSet || summary.registrationMode === 'EXTERNAL',
    },
    {
      id: 'registration-open',
      section: 'registration',
      label: 'Open registration',
      required: false,
      done: summary.registrationOpen || summary.registrationMode === 'EXTERNAL',
    },
    {
      id: 'description',
      section: 'identity',
      label: 'Add a tournament description',
      required: false,
      done: !!summary.description,
    },
    {
      id: 'banner',
      section: 'identity',
      label: 'Add website artwork',
      required: false,
      done: summary.hasBanner,
    },
    {
      id: 'homepage',
      section: 'publication',
      label: 'Publish a homepage',
      required: false,
      done: summary.homePublished,
    },
    {
      id: 'rules',
      section: 'publication',
      label: 'Publish the rules',
      required: false,
      done: summary.rulesPublished,
    },
    {
      id: 'staff',
      section: 'staff',
      label: 'List the public staff',
      required: false,
      done: summary.staff > 0,
    },
    {
      id: 'entrants',
      section: 'rosters',
      label: 'Have entrants registered',
      required: false,
      done: summary.approvedEntrants > 0,
    },
  ];
  // Only optional items can be dismissed: "not needed" must never hide a real requirement.
  return items.map((item) =>
    !item.required && summary.dismissed.includes(item.id) ? { ...item, done: true } : item,
  );
}

export function sectionStatus(items: readonly ReadinessItem[], section: SetupSection) {
  const own = items.filter((item) => item.section === section);
  if (own.some((item) => item.required && !item.done)) return 'REQUIRED' as const;
  if (own.some((item) => !item.done)) return 'OPTIONAL' as const;
  return 'DONE' as const;
}
