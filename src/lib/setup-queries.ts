import { db as rootDb } from './db';
import { formatStatus } from './format-lifecycle-service';
import { loadFormatPlan } from './format-plan-service';
import { rulesHash } from './match-record';
import { matchRulesSchema } from './match-rules';
import { eligibilityReview } from './eligibility-service';
import { AppError, can, type Actor } from './permissions';
import { qualifierBookingPolicy } from './qualifier-booking-policy';
import { registrationPolicySchema } from './registration-policy';
import { scopedDb } from './scoped-db';
import { resourceBoard } from './resource-service';
import { setupReadiness, type SetupSummary } from './setup-readiness';
import { formationBoards } from './team-formation-service';
import { stageConfigurationToken } from './stage-workflows';

// The token covers a stage's own columns, as the save path reads them without relations.
const ownFields = <T extends { poolPlan: unknown; mappool: unknown }>(stage: T) => {
  const { poolPlan, mappool, ...fields } = stage;
  void poolPlan;
  void mappool;
  return fields;
};

export async function setupWorkspaceData(actor: Actor) {
  if (!actor.permissions.length) throw new AppError('No administration permissions assigned.', 403);
  const tournamentId = actor.tournamentId || 'main';
  const db = scopedDb(rootDb, tournamentId);
  const tournament = await db.tournament.findUniqueOrThrow({
    where: { id: tournamentId },
    include: { settings: true },
  });
  const settings = tournament.settings!;
  const [stages, plan, pages, approvedEntrants, staff] = await Promise.all([
    db.tournamentStage.findMany({
      where: { archivedAt: null },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      include: {
        poolPlan: true,
        mappool: {
          include: { draftRevision: { include: { _count: { select: { slots: true } } } } },
        },
      },
    }),
    loadFormatPlan(rootDb, tournamentId),
    db.page.findMany({
      where: { slug: { in: ['home', 'rules'] } },
      select: { slug: true, draftRevisionId: true, publishedRevisionId: true },
    }),
    db.team.count({ where: { status: 'APPROVED', supersededAt: null } }),
    db.staffMember.count(),
  ]);
  const registration = registrationPolicySchema.parse(settings.registrationPolicy || {});
  const rules = matchRulesSchema.parse(settings.matchRules);
  const setupState =
    settings.setupState && typeof settings.setupState === 'object'
      ? (settings.setupState as { dismissed?: string[] })
      : {};
  const page = (slug: string) => pages.find((item) => item.slug === slug);
  // Exception reasons can record interviews, so they follow the roster permission.
  const eligibility = can(actor, 'teams.view')
    ? await eligibilityReview(rootDb, tournamentId)
    : null;
  const summary: SetupSummary = {
    description: tournament.description,
    hasBanner: !!settings.banner && settings.banner !== '/artwork.svg',
    published: tournament.published,
    registrationMode: registration.mode,
    registrationOpen: tournament.status === 'REGISTRATIONS_OPEN' && tournament.published,
    registrationWindowSet: !!registration.opensAt || !!registration.closesAt,
    gameplayScoringSet: !!settings.gameplayScoring,
    teamSize: rules.teamSize,
    maxPlayers: registration.maxPlayers,
    stages: stages.map((stage) => ({
      name: stage.name,
      kind: stage.kind,
      poolSlots: stage.mappool?.draftRevision?._count.slots ?? 0,
      poolPublished: stage.mappool?.state === 'PUBLISHED',
    })),
    plan: { exists: plan.rows.length > 0, valid: !!plan.plan, locked: plan.locked },
    approvedEntrants,
    staff,
    homePublished: !!page('home')?.publishedRevisionId,
    rulesPublished: !!page('rules')?.publishedRevisionId,
    eligibilityPending: eligibility?.rows.filter((row) => row.issues.length).length ?? 0,
    dismissed: setupState.dismissed || [],
  };
  return {
    tournament: {
      id: tournament.id,
      slug: tournament.slug,
      name: tournament.name,
      acronym: tournament.acronym,
      status: tournament.status,
      gameMode: tournament.gameMode,
      published: tournament.published,
      archivedAt: tournament.archivedAt?.toISOString() ?? null,
      version: tournament.version,
      timezone: tournament.timezone,
    },
    gameplayScoring: settings.gameplayScoring,
    navigation: settings.navigation as { label: string; href: string }[],
    importantDates: settings.importantDates as { label: string; date: string }[],
    registration,
    booking: qualifierBookingPolicy(settings),
    rules,
    defaultsHash: rulesHash(settings.matchRules),
    stages: stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      slug: stage.slug,
      kind: stage.kind,
      position: stage.position,
      startsAt: stage.startsAt?.toISOString() ?? null,
      description: stage.description,
      bannerImageId: stage.bannerImageId,
      nextStageId: stage.nextStageId,
      matchRules: stage.matchRules ? matchRulesSchema.parse(stage.matchRules) : null,
      qualifierPolicy: stage.qualifierPolicy,
      configurationToken: stageConfigurationToken(ownFields(stage)),
      rulesHash: rulesHash(stage.matchRules),
      poolId: stage.mappool?.id ?? null,
      poolState: stage.mappool?.state ?? 'DRAFT',
      poolSlots: stage.mappool?.draftRevision?._count.slots ?? 0,
      poolPlan: stage.poolPlan
        ? {
            slots: stage.poolPlan.slots as { name: string; category: string }[],
            minStars: stage.poolPlan.minStars,
            maxStars: stage.poolPlan.maxStars,
            version: stage.poolPlan.version,
          }
        : null,
    })),
    plan: plan.plan,
    planToken: plan.token,
    planLocked: plan.locked,
    planInvalid: plan.invalid,
    format: await formatStatus(rootDb, tournamentId),
    eligibility,
    formation: can(actor, 'teams.view') ? await formationBoards(rootDb, tournamentId) : [],
    resources: can(actor, 'teams.view') ? await resourceBoard(rootDb, tournamentId) : null,
    readiness: setupReadiness(summary),
    setupState,
  };
}
export type SetupWorkspaceData = Awaited<ReturnType<typeof setupWorkspaceData>>;
