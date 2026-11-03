import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatPlanSchema, formatSourceCount, type FormatPhase } from '../src/lib/format-plan';
import { COMPATIBILITY_PLANS } from './fixtures/format-plans';

const parse = (plan: unknown) => formatPlanSchema.parse(plan);
const issues = (plan: unknown) => {
  const result = formatPlanSchema.safeParse(plan);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};
const clone = <T>(value: T): T => structuredClone(value);
const entrantsIn = (phases: readonly FormatPhase[], phase: FormatPhase) =>
  'entries' in phase
    ? phase.entries.reduce(
        (total, item) => total + (formatSourceCount(phases, item.source) ?? 0),
        0,
      )
    : 0;

describe('format plan contract', () => {
  it.each(Object.entries(COMPATIBILITY_PLANS))('expresses %s', (_, plan) => {
    expect(issues(plan)).toEqual([]);
  });

  it('seats every entrant in the tiered and asymmetric formats', () => {
    const owc = parse(COMPATIBILITY_PLANS.owc).phases;
    expect(entrantsIn(owc, owc[1])).toBe(32);
    expect(entrantsIn(owc, owc[2])).toBe(32);
    const italian = parse(COMPATIBILITY_PLANS.italianCup).phases;
    expect(entrantsIn(italian, italian[1])).toBe(16);
    expect(entrantsIn(italian, italian[2])).toBe(16);
  });

  it('rejects a phase reading from a later phase', () => {
    const plan = clone(COMPATIBILITY_PLANS.italianCup);
    plan.phases.reverse();
    expect(issues(plan).join()).toContain('Qualifiers must come before');
  });

  it('rejects ranks promised to two phases', () => {
    const plan = clone(COMPATIBILITY_PLANS.italianCup);
    (plan.phases[1] as { entries: { source: { from: number } }[] }).entries[0].source.from = 4;
    expect(issues(plan).join()).toContain('Rank 4 already enters another phase.');
  });

  it('rejects ranks beyond the qualifier cutoff', () => {
    const plan = clone(COMPATIBILITY_PLANS.oidc);
    (plan.phases[0] as { advance: number }).advance = 12;
    expect(issues(plan).join()).toContain('Only 12 entrants advance');
  });

  it('rejects a tier that cannot be seated', () => {
    const plan = clone(COMPATIBILITY_PLANS.italianCup);
    (plan.phases[1] as { tiers: { groupSize: number }[] }).tiers[0].groupSize = 3;
    expect(issues(plan).join()).toContain('must exactly seat its seed range');
  });

  it('rejects a placement a group does not have', () => {
    const plan = clone(COMPATIBILITY_PLANS.italianCup);
    (
      plan.phases[2] as { entries: { source: { placement?: number } }[] }
    ).entries[3].source.placement = 5;
    expect(issues(plan).join()).toContain('Placement 5 does not exist');
  });

  it('rejects one placement advancing to two destinations', () => {
    const plan = clone(COMPATIBILITY_PLANS.italianCup);
    (
      plan.phases[2] as { entries: { source: { placement?: number } }[] }
    ).entries[3].source.placement = 2;
    expect(issues(plan).join()).toContain('already advances elsewhere');
  });

  it('rejects mismatched asymmetric lanes', () => {
    const plan = clone(COMPATIBILITY_PLANS.italianCup);
    (plan.phases[2] as { losers: { size: number } }).losers.size = 4;
    expect(issues(plan).join()).toContain('Losers entry must match the Winners size');
  });

  it('rejects routing into a Losers lane that does not exist', () => {
    const plan = clone(COMPATIBILITY_PLANS.italianCup);
    (plan.phases[2] as { losers: null | object }).losers = null;
    expect(issues(plan).join()).toContain('Enable Losers entry');
  });

  it('rejects explicit pairs that do not seat the lane', () => {
    const plan = clone(COMPATIBILITY_PLANS.owc);
    const pairs = (plan.phases[2] as { losers: { pairing: number[][] } }).losers.pairing;
    pairs[0] = [22, 19];
    expect(issues(plan).join()).toContain('A seed appears in two opening matches.');
    pairs.pop();
    expect(issues(plan).join()).toContain('exactly 8 opening matches');
  });

  it('rejects non-power-of-two brackets', () => {
    const plan = clone(COMPATIBILITY_PLANS.oidc);
    (plan.phases[1] as { winners: { size: number } }).winners.size = 12;
    expect(issues(plan).join()).toContain('powers of two');
  });

  it('requires individual qualifier players to form teams before competing', () => {
    const plan = clone(COMPATIBILITY_PLANS.draftCup);
    plan.phases.splice(1, 1);
    (
      plan.phases[1] as { entries: { source: { phase: string; kind: string; count?: number } }[] }
    ).entries[0].source = { kind: 'RANK_RANGE', phase: 'qualifiers', from: 1, to: 8 } as never;
    expect(issues(plan).join()).toContain('must form teams');
  });

  it('requires group placements before limiting rematches', () => {
    const plan = clone(COMPATIBILITY_PLANS.oidc);
    (plan.phases[1] as { rematch?: string }).rematch = 'AVOID_SAME_GROUP';
    expect(issues(plan).join()).toContain('Rematch limits need entrants placed');
  });

  it('requires auction settings for an auction', () => {
    const plan = clone(COMPATIBILITY_PLANS.draftCup);
    delete (plan.phases[1] as { auction?: object }).auction;
    expect(issues(plan).join()).toContain('needs a budget');
  });

  it('never lets application code depend on the compatibility fixtures', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : [path];
      });
    for (const file of walk('src').filter((path) => /\.tsx?$/.test(path)))
      expect(readFileSync(file, 'utf8'), file).not.toContain('format-plans');
  });
});
