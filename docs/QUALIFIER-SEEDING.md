# Native Qualifier Standings

## Integration Contracts

- `src/lib/qualifier-policy.ts`: `qualifierPolicySchema`, `QualifierPolicy`, `DEFAULT_QUALIFIER_POLICY`, `QUALIFIER_METHOD_LABELS`. No gameplay scoring selector or database dependency.
- `src/lib/qualifier-standings-validation.ts`: client-safe `qualifierStandingsActionSchema`, `qualifierStandingsRevision`, and `QualifierStandingsAction`. The database service re-exports the action schema/type for server callers. Shared validation must import the pure validation module.
- `calculateQualifierStandings(input)` is the pure mathematical entry point. `sourceHash` hashes the canonical complete source/configuration snapshot and calculation version, including unused score records. Input arrays are normalized before hashing; input objects are not mutated.
- `qualifierStandingsData(actor, stageId)` returns `{stage, preview, latest, versions, locked, canManage}`. It requires full-cohort read permission, not merely assigned-lobby permission.
- `applyQualifierStandingsAction(tx, actor, action)` requires `matches.manage` and a caller-owned transaction. The parent dispatcher takes its existing global advisory lock first; this service then locks the tournament-qualified stage row.
- `assertQualifierMutable(tx, stageId, tournamentId)` takes that same stage lock and rejects source changes when the latest snapshot is finalized. An approved later `REOPENED` version permits referee corrections. Always pass the actual tournament ID.
- `finalizedQualifierSeeds(tx, tournamentId, standingId)` returns qualified `{teamId, seed}` records only for the latest finalized version after checking resolution and current source hash. A later reopen invalidates the old witness immediately, even before any score changes. It does not rewrite team seeds or automatically reseed a bracket.
- `publishedQualifierStandings(tournamentId, stageId)` returns only an explicitly published, finalized, current snapshot from a published, unarchived tournament. A stale snapshot is not recomputed into public results.
- Admin component: `QualifierStandings({stageId, actor?})`. Public component: `QualifierStandings({standings})`; the shared `QualifierStandingsTable` also accepts calculation rows directly.

Every action includes `stageId`, `baseVersion` (latest version, or zero), and the current preview's `sourceHash`:

- `qualifier.policy.save`: also `policy`. Allowed only before sessions start or record scores; updates still-scheduled policy snapshots and versions. Parent stage editing may use an even stricter session-existence lock.
- `qualifier.standings.calculate`: saves a new private provisional version.
- `qualifier.standings.resolve`: also `tieOrder` and nonempty `reason`; saves a new provisional version with an explicit approved order of all tied entrants.
- `qualifier.standings.finalize`: also optional `tieOrder`, `reason`, and `cutoff`. Requires a saved current provisional review, complete confirmed sources and resolved ties. Creates a new immutable finalized version.
- `qualifier.standings.publish`: also `published`. Publishes only a current finalized version; a stale published version can still be hidden.
- `qualifier.standings.reopen`: also `reason`, `affectedBracketIds`, `impactHash`, and literal `acknowledgeImpact: true`. Appends a `REOPENED` version only after an exact, current downstream review. It takes the shared competition advisory lock before the stage lock.

Snapshot shape: `{state, calculation, calculatedBy, calculatedAt, finalizedAt, cutoff, tieResolution, seeds}`. Finalized `seeds` contain `{teamId, seed, qualified}`. Reopened snapshots additionally retain `correctionReview` with the superseded standing, actor, reason and impact witness. Versions and audit records are retained. Publication changes only publication flags and audit records.

## Controlled Corrections

`qualifierCorrectionImpact(tx, tournamentId, stageId)` supplies the organizer's `correctionImpact` preview: affected bracket versions, their native matches, blocking matches, `impactHash`, and `canReopen`. It follows every bracket referencing this stage's standings and recursively follows connected `sourceBracketId`/`groupSource.bracketId` paths. The reopen action validates the reviewed standings version, current source hash, exact affected-bracket ID set and current impact hash while holding both transaction locks.

Any started/progressed match, start/submission/completion timestamp, map result, captured multiplayer game, summary score, or winner blocks reopening. Such cases require separate historical reconciliation; there is no unsafe override.

For safe unstarted paths, reopening preserves finalized snapshot JSON and all bracket assignments, appends a reviewed lifecycle version, and hides old published finals. The existing referee workflow can then reopen the lobby and correct actual source scores. It must reconfirm the lobby, save a fresh provisional calculation and explicitly finalize a new version. Old standing IDs stay unusable even after re-finalization with unchanged numerical seed order. Existing brackets are never rebound or reseeded automatically: an organizer must explicitly rebuild or reconcile them against the new finalized witness.

The organizer dialog freezes its reviewed source/version/impact, lists all affected brackets, and requires a reason and explicit acknowledgment. Any poll update that changes the witness disables submission. Parent start/publication paths must call `finalizedQualifierSeeds` for qualifier-derived paths, including connected downstream source paths; new bracket generation alone is not an adequate guard.

## Exact Mathematics

All methods consume recorded adjusted scores, preserving original raw values, mods, scoring system, representation, verification and provenance. The service verifies adjusted values against the existing `convertedScore` implementation and the lobby's rule snapshot. This layer does not invent a V1/V2/lazer conversion or a new mod-normalization formula. Standardized lazer and legacy score representations remain distinct.

For each team, map and run:

- `SUM`: exactly `requiredPlayers` distinct roster members, summed.
- `AVERAGE`: exactly `requiredPlayers` distinct roster members, averaged.
- `TOP_N`: at least `requiredPlayers` distinct roster members; sum the highest `requiredPlayers` scores. Other actual player scores remain in the source snapshot.

Substitutions between maps are allowed within the snapshotted roster. Duplicate plays or duplicate roster ownership block finalization; the pipeline never silently chooses one duplicate record.

After shared run selection produces map values `T[i,m]`:

- Raw total: `sum_m T[i,m]`.
- Raw average: `sum_m T[i,m] / M`.
- Team average: `sum_m T[i,m] / M`, after the explicitly configured team-map aggregation above.
- Z-Sum: `sum_m (T[i,m] - mean[m]) / sampleSD[m]`, with `sampleSD = sqrt(sum((T - mean)^2)/(n-1))`. No percentile transformation and no intermediate rounding.
- Match cost: `2/(p+2) * sum_playedMaps(T[i,m]/mean[m])`.

The official [osu! common seeding methods](https://osu.ppy.sh/wiki/en/Tournaments/Common_seeding_methods) documents average-score and sample-deviation Z-Sum. Team roster aggregation is an explicit tournament policy around those mathematical map scores.

The match-cost arithmetic was independently implemented from the positive-reference formula verified in [osu!plus, pinned revision b143241](https://github.com/limjeck/osuplus/blob/b143241ec202f624e58ba7326b5d0e8f5ad339ed/osuplus.user.js#L1108-L1197). No upstream implementation code is copied. `OSUPLUS_QUALIFIER_COHORT_V1` is explicitly a qualifier adaptation: references are selected, complete, eligible stage entrants across all qualifier rooms, not unrelated lobby-local populations. There are no multiplayer winner/tiebreak bonuses. Unlike upstream's zero-total fallback, a zero reference average blocks finalization rather than fabricating a denominator.

Example: map scores `[100, 50]` and `[80, 40]` have means `75` and `60`. The first entrant's two-map match cost is `2/4 * (100/75 + 80/60) = 4/3`.

## Run Selection and Cohorts

One run counts Run 1. Two runs support:

- `BEST_PER_MAP`: choose the higher complete team-map aggregation, independently per map. Equal scores select Run 1 deterministically.
- `FIRST_RUN`: only Run 1.
- `SECOND_RUN`: only Run 2; never fill missing values from Run 1.
- `BEST_COMPLETE_RUN`: choose one entire team run. There is no player-level or map-level mixing.

For best-complete-run comparison, freeze one map reference per eligible entrant by averaging that entrant's map values over their complete candidate runs. Each entrant therefore has equal cohort weight even when only one candidate is complete. Compute frozen per-map means/sample deviations from these values. Evaluate complete runs using the selected method against those frozen references. Equal complete-run comparison values choose Run 1. Only after selection are official standings references recalculated from selected complete entrants. Both frozen and official references are stored.

Incomplete entrants are excluded from official reference statistics and receive no seed. A partial match-cost value may be shown provisionally using available maps and the complete cohort's references, with its actual participation factor; it cannot be finalized. Every configured run must be complete for finalization, including unused second runs.

Real zero scores are retained. Zero sample deviation gives every entrant zero contribution on that map and a warning. Fewer than two complete entrants blocks sample Z-Sum. Zero match-cost reference averages block finalization. Invalid/unverified provenance, missing maps/players, inconsistent pool/policy/scoring snapshots and nonconfirmed sessions also block finalization. Non-approved native entrants are excluded from the cohort without deleting history. Raw V1/Team Average adds a map-range bias warning.

Ties compare full, unrounded numeric results. Stable identity ordering is only a display ordering, never a hidden tiebreak. Tied entrants have `seed: null` until an organizer records an explicit ordered decision and reason. The original equal values and tied status remain visible after resolution.

## Archive Rebinding

`rebindImportedQualifierStandings(tx, tournamentId)` is an import-only helper, called after all source records, pool pointers and standing records are restored. It returns `{rebound, skipped, warnings}`.

The importer must remap all snapshot identities, including `tieResolution.order`, `calculatedBy`, `participantIds`, `scoreIds`, and source-context record IDs. The helper verifies the known formula/version, complete remapped source scores, selected runs/players, statistical references, numeric values and historical seed order against a recomputation witness. It does not replace historical ranks, values, tie decisions, cutoff, seeds, or publication. A successful rebind updates source hashes and the equivalent normalized source/context, appending `importProvenance` with the original hash. Already bound records are unchanged.

Unknown formulas, mismatched sources/results, unresolved remapped identities or invalid restored finalization remain stale and produce warnings. Comparisons are deliberately exact; even floating-point operation-order differences can conservatively leave an imported statistical snapshot stale rather than silently accept different historical values. Older provisional versions that predate score corrections normally remain stale.

## Verification and Limits

Focused unit/transaction-delegate tests: `tests/qualifier-seeding.test.ts` and `tests/qualifier-seeding-service.test.ts`. Standalone command using the installed Node 22 runtime:

```sh
/home/mdistefano/.nvm/versions/node/v22.23.3/bin/node node_modules/vitest/vitest.mjs run tests/qualifier-seeding.test.ts tests/qualifier-seeding-service.test.ts
```

Real PostgreSQL coverage is in `tests/qualifier-standings.integration.test.ts` and `tests/qualifier-standings-archive.integration.test.ts`, using the central integration configuration and isolated `tournament_platform_test` database. These cover actual finalized/published snapshots, real export/localization/import with populated standings and linked brackets, approved ties, reviewed native corrections, old-witness start rejection, and started/scored blockers. Fixtures are tournament-local and cleanup deletes only those fixtures; tests never migrate or reset a database.

`tests/e2e/qualifier-standings.spec.ts` exercises the actual organizer page with a dedicated authenticated fixture and intercepted standings/action responses: light/dark acknowledgment gating, submitted correction payload, and the blocked mobile dialog. It does not substitute for PostgreSQL persistence coverage. Parent must run these browser cases against the current build; this worker did not start a competing Next server during stabilization.

Corrections after downstream gameplay starts still require separate manual historical reconciliation. No automatic bracket rebuilding or binding to a replacement standings version is performed. Only the named osu!plus qualifier adaptation is implemented, not Bathbot or arbitrary match-cost variants. No genuine concurrent database race simulation has been performed by this worker. Parent owns routes, schema/migrations, existing score capture, tournament settings and final browser verification.
