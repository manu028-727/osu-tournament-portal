# Organizer Workflow Update

All development and verification for this update use `osu-tournament-platform`,
the checkout of `manu028-727/osu-tournament-portal`. Neither legacy tournament
installation nor its database is changed.

## Workflow References

The OIDC referee and mappool workbooks are workflow references, not application
defaults. `Round Setup` centralizes reusable action sequences; `Schedule` and
`Chrono Schedule` keep participants, stages, staff, times, results and multiplayer
links together. The pooling workbook separates expected distributions/difficulty
targets from suggestions, review assignments, feedback, selection and publication.

The previous UI required repeated full-form edits for these related operations.
It also kept empty slot plans only in browser state and had no persistent
suggestion/review pipeline. This update adds scoped, versioned patch operations
behind compact tables rather than reproducing spreadsheet cells or formulas.

## Stages

- Overview rows expose name, type, Best-of and the action editor directly.
  Qualifier rows show qualifier policy instead of head-to-head rules.
- Select individual stages, a shift range or all filtered stages. Filters clear
  selection. Mixed values are explicit; omitted fields remain unchanged.
- Changing Best-of for three stages takes three selections, one value change and
  one Apply action, without opening three advanced forms. Single-row edits use
  the inline control and row Save. Actual pointer clicks depend on the browser's
  native select control.
- Bulk rules can inherit tournament defaults, copy a source stage or patch just
  selected fields. Customized stages are not overwritten by default changes.
- New-stage templates supply editable names/types. Rules come from real
  tournament defaults or a selected source stage, not tournament-specific presets.
- Duplicate stage separates rules, appearance, empty pool, slot structure and
  actual beatmaps. It never copies publication, dates, progression links, match
  histories or playtesting assignments.
- Action pairs retain the referee engine's AB/ABAB/ABBA semantics, starting-team
  rules, rolls, protects and tiebreakers. The preview runs the actual engine.
- Configuration tokens reject stale concurrent changes. Saved rules do not
  rewrite existing match snapshots. Stage display order does not drive progression.
- Pool readiness checks cover map capacity, bans/protects and tiebreakers. Empty
  stages remain editable; publication rejects incomplete or impossible pools.

See [stage workflows](STAGE-WORKFLOWS.md) for operator steps and validation details.

## Mappools And Playtesting

- Slot distributions and advisory star ranges persist before any beatmaps are
  assigned. Draft Save stores the plan and filled slots atomically. Missing maps
  remain visible after reload; public data contains only published revisions.
- Bulk import fills planned slots. Existing compact rows retain ID/URL editing,
  canonical numeric sorting, category changes, selection, copying and removal.
- Copy pool structure and copy contents are distinct. Selected saved rows can be
  copied or moved into another stage draft with explicit replacement confirmation.
  Source publication and all previous revisions remain intact.
- Average stars, BPM and drain length supplement star-range targets. Targets are
  advisory, not arbitrary difficulty restrictions.
- Suggestions support actual cached/API metadata, deduplication, notes, stage,
  category and configurable primary/secondary skillsets. Filters include those
  fields, submitter, mapper, review state, stars, BPM and duration.
- Multi-select suggestions to patch status, stage, category, notes, tags and
  playtest assignments. Only explicitly enabled fields change.
- Assigned playtesters save their own fit/difficulty ratings, flags and feedback.
  Consolidated ratings and full feedback remain attached to the same suggestion.
- Accept a suggestion, choose a destination slot and select it into a new draft.
  Duplicate beatmaps and occupied slots require resolution; selection never publishes.
- Optional tournament artist warnings retain reason/source. Explicit bans require
  an editor's recorded resolution, checked again during publication.
- Draft, review, approved and public are separate states. Pool releases supports
  multi-pool publish/unpublish with saved-revision checks and atomic validation.
  Every writer enforces the same 100-slot editor limit.
- Archives now include plans, suggestions, skillsets, warnings, assignments and
  completed reviews, with IDs rebound into the destination tournament.

The public mappool cards, category tints, previews and mobile interactions are unchanged.

## Matches And Brackets

- Schedule time and referee can be edited inline. Selected unstarted scheduled
  matches support absolute/relative time changes, referees, stage, streamer,
  commentators, notes and public visibility in one patch.
- Paste CSV/TSV schedules with numeric match numbers, timestamps and referee
  usernames/IDs. Preview validates each row; blanks preserve values and `-`
  explicitly clears a field. Local timestamps use the browser timezone; use ISO
  timestamps with offsets when sharing schedules across timezones.
- Resource checks correlate each proposed time with its own referees and players,
  including qualifier sessions. Version checks and transactions prevent partial
  writes. Started/results-bearing records cannot be silently reassigned to stages.
- Bracket rounds can share one stage change, including safe updates of unstarted
  match snapshots. Started matches require reconciliation rather than bulk replacement.
- Existing slot assignment, swapping, locking, manual progression and automatic
  restoration remain available. Round display names and gameplay stage names remain distinct.
- Create a bracket with **Link existing matches** to reconstruct a tournament
  already in progress. Link historical matches round by round; reversed red/blue
  sides adjust bracket placement without rewriting original match records/results.
- Numeric match IDs are stable, tournament-scoped and separate from database IDs
  and historical codes. Generated positions reserve numbers in round/display order;
  future rounds retain their reserved IDs. Multiple brackets use one locked counter.
- Archive export/import now explicitly preserves assigned and reserved numbers.
  Older archives recover unique numeric codes and allocate remaining numbers safely.
  Numeric public URLs resolve only numeric IDs; nonnumeric legacy codes remain valid.

See [match numbering](MATCH-NUMBERING.md) for numbering and existing-match bracket steps.

## Qualifiers And Staff

- Create several qualifier sessions from one preview, inheriting stage policy and
  a stable pool snapshot. Sequential times, entrant distribution and staff can be
  adjusted before committing the batch.
- Select filtered sessions to set/shift/clear times, assign referees or patch notes.
- Assign unassigned entrants or transfer them between compatible, unstarted
  sessions. Capacity, duplicate registration, participant/referee conflicts,
  stale versions and finalized standings block unsafe changes.
- Existing raw/Z-Sum/team-average/match-cost calculations and all four two-run
  policies remain in use; scores and captured history are not reset.
- Public staff listings support filtered multi-selection, visibility changes,
  adding/removing categories, changing position labels and reassignment. Those
  operations do not create users or grant roles/permissions.
- Privileged website roles still use the existing access-management workflow.
  Matches is the canonical schedule; Referee Mode remains the live match interface.

## Data Integrity And Deployment

These operations reuse the existing authenticated action endpoint, tenant-scoped
Prisma access, referee state machine, metadata cache, revision/publication system
and audit logging. Every root mutation reloads permissions in the locked
transaction. Versioned selections reject stale/foreign records rather than
claiming partial success. Detailed audit payloads stay in the database; summary
endpoints do not expose private draft IDs or review notes through `audit.view`.

`20261022010000_pooling_workflows` is an additive migration for the six pooling
tables. No data reset, history rewrite or seed import is required. Back up, pull
the desired branch and run `./portal install` to rebuild and apply migrations.
`./portal start` alone does not rebuild or migrate. See [upgrading](UPGRADING.md).

## Verification

Verified checks: 339 unit tests, 172 PostgreSQL integration tests, TypeScript,
ESLint, Prettier and the standalone production build. Prisma's datasource/schema
diff reports no drift in the migrated test database. Run integration and browser
suites separately: the first-owner integration fixture requires no other
temporary platform administrators to be active.

All 36 production browser tests passed in three sequential batches: organizer
(12), referee/public (17, including a mock IRC server) and platform lifecycle (7).
The long combined run was terminated externally; the shorter batches were then
rerun to completion. Output is retained locally in `.data/qa-final-organizer`,
`.data/qa-final-referee-public` and `.data/qa-final-platform`.

Automated checks use only the isolated `tournament_platform_test` database.
The regression suites cover tenant/permission boundaries, stale writes, preserved
histories, draft isolation, copy modes, schedule conflicts, pool releases,
suggestions/reviews and archive round trips. Browser specs exercise actual APIs,
reload persistence, desktop/mobile layouts and both themes. Relevant specs:

- `tests/e2e/stage-workflows.spec.ts`
- `tests/e2e/competition.spec.ts`
- `tests/e2e/matches-bulk.spec.ts`
- `tests/e2e/workspace.spec.ts`

Screenshots are generated under the selected Playwright output directory, with
stage, pooling, staff, qualifier, match-list and bracket captures at 1366, 390 and
320 pixels. Test fixtures are explicitly synthetic and never become live data.
Reviewed captures are also collected locally in `.data/visual/organizer-update`.

## Boundaries

- Reusable presets use tournament defaults and source stages, not a separate
  named-preset library. There is no cross-tournament copy of sensitive references.
- Scheduling conflicts currently detect identical start times, not overlapping
  estimated durations or a referee availability calendar.
- Bulk status changes do not bypass the referee state machine. Played matches,
  arbitrary bracket-participant replacement and match-result corrections retain
  their dedicated audited workflows. Bulk match duplication is not added.
- Notes belong to pools or persistent suggestions/reviews; there is no new
  standalone custom-map upload system or automatic mappack generation.
- Live osu!/Bancho credentials were not exercised during this editing update.
  Command, scoring and authentication regression tests passed; IRC browser
  authentication and command delivery used an isolated mock Bancho server.
