import { describe, expect, it } from 'vitest';
import { formatFlow, phaseEntrantCount } from '../src/lib/format-flow';
import { previewFormatPlan } from '../src/lib/format-preview';
import {
  buildTemplate,
  DEFAULT_TEMPLATE_CHOICES,
  eliminationStages,
  poolPlanSlots,
  TEMPLATE_KEYS,
  templateChoicesSchema,
  templateDefaults,
  type TemplateChoices,
} from '../src/lib/format-templates';
import { COMPATIBILITY_PLANS } from './fixtures/format-plans';
import { formatPlanSchema } from '../src/lib/format-plan';
import { sectionStatus, setupReadiness, type SetupSummary } from '../src/lib/setup-readiness';

const choices = (fields: Partial<TemplateChoices>): TemplateChoices => ({
  ...DEFAULT_TEMPLATE_CHOICES,
  ...fields,
});

describe('format templates', () => {
  it.each(TEMPLATE_KEYS)('%s builds a valid plan from its defaults', (template) => {
    const built = buildTemplate(templateDefaults(template));
    expect(built.plan.phases.length).toBeGreaterThan(0);
    expect(built.stages.length).toBeGreaterThan(0);
    for (const phase of built.plan.phases)
      if ('stageId' in phase) {
        const stage = built.stages.find((item) => `ref:${item.ref}` === phase.stageId);
        expect(stage, phase.key).toBeTruthy();
      }
  });

  it('never mentions a real event', () => {
    const text = JSON.stringify(
      TEMPLATE_KEYS.map((template) => buildTemplate(templateDefaults(template))),
    );
    expect(text).not.toMatch(/OWC|OIDC|MIR|Italian|Legend|Challenger|Contender/i);
  });

  it('expands to single elimination without any Losers lane', () => {
    const { plan, stages } = buildTemplate(
      choices({ template: 'QUALIFIER_BRACKET', doubleElimination: false, bracketSize: 8 }),
    );
    expect(plan.phases.at(-1)?.kind).toBe('SINGLE_ELIMINATION');
    expect(stages.map((stage) => stage.name)).toEqual([
      'Qualifiers',
      'Quarterfinals',
      'Semifinals',
      'Finals',
    ]);
  });

  it('adds Grand Finals only to double elimination and lengthens later rounds', () => {
    const stages = eliminationStages(16, true);
    expect(stages.map((stage) => [stage.name, stage.bestOf])).toEqual([
      ['Round of 16', 9],
      ['Quarterfinals', 11],
      ['Semifinals', 11],
      ['Finals', 13],
      ['Grand Finals', 13],
    ]);
  });

  it('seats direct entrants and each group placement in the right lanes', () => {
    const { plan } = buildTemplate(choices({ template: 'DIRECT_ENTRY_GROUPS' }));
    const main = plan.phases.at(-1)!;
    expect(phaseEntrantCount(plan.phases, main)).toBe(16);
    expect(main).toMatchObject({
      winners: { size: 8 },
      losers: { size: 8 },
      rematch: 'AVOID_SAME_GROUP',
    });
  });

  it('builds tiered groups with the same shape as a world-cup style format', () => {
    const { plan } = buildTemplate(
      choices({ template: 'TIERED_GROUPS', directSeeds: 8, groupCount: 4, groupSize: 4 }),
    );
    expect(plan.phases[0]).toMatchObject({ advance: 40 });
    expect(plan.phases[1]).toMatchObject({ labels: 'LETTERS', labelOrder: 'SOURCE_AGGREGATE' });
    expect(plan.phases.at(-1)).toMatchObject({ winners: { size: 16 }, losers: { size: 16 } });
  });

  it('rejects choices no bracket can seat instead of building something wrong', () => {
    expect(() =>
      buildTemplate(choices({ template: 'DIRECT_ENTRY_GROUPS', directSeeds: 3 })),
    ).toThrow();
    expect(templateChoicesSchema.safeParse(choices({ bracketSize: 12 })).success).toBe(false);
  });

  it('turns pool counts into canonical slots', () => {
    expect(poolPlanSlots({ NM: 2, HD: 1, HR: 0, DT: 0, FM: 0, TB: 1 })).toEqual([
      { name: 'NM1', category: 'NM' },
      { name: 'NM2', category: 'NM' },
      { name: 'HD1', category: 'HD' },
      { name: 'TB', category: 'TB' },
    ]);
  });
});

describe('format preview and flow', () => {
  it('previews what locking would create, including labelled opening matches', async () => {
    const plan = formatPlanSchema.parse(COMPATIBILITY_PLANS.italianCup);
    const preview = await previewFormatPlan(plan);
    const [qualifiers, groups, main] = preview.phases;
    expect(qualifiers.matchCount).toBe(0);
    expect(groups.matchCount).toBe(24);
    expect(main.matchCount).toBe(23);
    expect(preview.totalMatches).toBe(47);
    expect(main.openings[0].pairs[0]).toEqual(['Qualifiers #1', 'Group stage: place 1 (4)']);
    expect(main.openings.map((opening) => opening.lane)).toEqual(['WINNERS', 'LOSERS']);
  });

  it('describes who goes where', () => {
    const plan = formatPlanSchema.parse(COMPATIBILITY_PLANS.italianCup);
    const edges = formatFlow(plan);
    expect(edges).toContainEqual({
      from: 'qualifiers',
      to: 'main',
      lane: 'WINNERS',
      label: '#1-4',
    });
    expect(edges).toContainEqual({ from: 'groups', to: 'main', lane: 'LOSERS', label: '#3' });
  });
});

describe('setup readiness', () => {
  const ready: SetupSummary = {
    description: 'A tournament',
    hasBanner: true,
    published: true,
    registrationMode: 'WEBSITE',
    registrationOpen: true,
    registrationWindowSet: true,
    gameplayScoringSet: true,
    teamSize: 2,
    maxPlayers: 3,
    stages: [{ name: 'Finals', kind: 'ELIMINATION', poolSlots: 10, poolPublished: true }],
    plan: { exists: true, valid: true, locked: false },
    approvedEntrants: 4,
    staff: 1,
    homePublished: true,
    rulesPublished: true,
    dismissed: [],
  };
  const missing = (summary: SetupSummary) =>
    setupReadiness(summary)
      .filter((item) => !item.done)
      .map((item) => item.id);

  it('has nothing left for a finished tournament', () => {
    expect(missing(ready)).toEqual([]);
  });

  it('reports what an empty tournament needs, with optional items marked', () => {
    const items = setupReadiness({
      ...ready,
      description: '',
      hasBanner: false,
      published: false,
      registrationOpen: false,
      registrationWindowSet: false,
      gameplayScoringSet: false,
      stages: [],
      plan: { exists: false, valid: false, locked: false },
      approvedEntrants: 0,
      staff: 0,
      homePublished: false,
      rulesPublished: false,
    });
    expect(items.filter((item) => item.required && !item.done).map((item) => item.id)).toEqual([
      'scoring',
      'stages',
      'format',
      'pools',
      'publish',
    ]);
    expect(items.find((item) => item.id === 'staff')).toMatchObject({ required: false });
    expect(sectionStatus(items, 'stages')).toBe('REQUIRED');
    expect(sectionStatus(items, 'staff')).toBe('OPTIONAL');
  });

  it('never treats a saved but invalid plan as ready', () => {
    expect(missing({ ...ready, plan: { exists: true, valid: false, locked: false } })).toEqual([
      'format',
    ]);
  });

  it('counts unpublished pools and refuses rosters smaller than a side', () => {
    const items = setupReadiness({
      ...ready,
      maxPlayers: 1,
      stages: [
        { name: 'A', kind: 'ELIMINATION', poolSlots: 0, poolPublished: false },
        { name: 'B', kind: 'ELIMINATION', poolSlots: 3, poolPublished: false },
      ],
    });
    expect(items.find((item) => item.id === 'pools')).toMatchObject({ done: false, values: [2] });
    expect(items.find((item) => item.id === 'roster')?.done).toBe(false);
  });

  it('lets organizers dismiss optional items but never required ones', () => {
    const summary = { ...ready, staff: 0, published: false, dismissed: ['staff', 'publish'] };
    expect(missing(summary)).toEqual(['publish']);
  });

  it('does not ask an externally registered tournament to open website registration', () => {
    expect(
      missing({
        ...ready,
        registrationMode: 'EXTERNAL',
        registrationOpen: false,
        registrationWindowSet: false,
      }),
    ).toEqual([]);
  });
});
