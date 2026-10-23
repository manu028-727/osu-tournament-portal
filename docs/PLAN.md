# Delivery Plan

## Status And Evidence

Consolidated on 24 October 2026 from the repository, migrations and existing
verification records. This is the ordered project history and remaining work,
not a second specification. Functional requirements live in [SPEC.md](SPEC.md).
Historical checks below were recorded at their checkpoints; this documentation
rewrite does not rerun or certify every earlier deployment/provider check.

`Done` means delivered in source, not deployed to every installation. `Partial`
identifies a known limitation, not a hidden success. New development should update
the relevant completed phase and remaining work, rather than append another guide.

## Ordered Delivery History

| Order | Delivery                                                                                                                                                                      | State                                     | Source Checkpoint    |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------- |
| 1     | Extract generic multi-tournament app from private tournament implementations; retain OAuth, scoped roles, CMS revisions, media, teams, referee engine and historical importer | Done                                      | `7d4a4d9`            |
| 2     | Public MIT distribution, legal notices, no private fixtures or artwork; Docker-first provisioning and optional private storage/IRC                                            | Done                                      | `924abbd`            |
| 3     | Simplify to one default Compose stack and `portal` lifecycle helper, isolate advanced overrides and remove generated clutter                                                  | Done                                      | `a9d82fb`            |
| 4     | Repair fresh tournament lifecycle: chooser boundary, `/t/<slug>/admin/...`, missing-context errors, empty page defaults, unpublished editing and authorization tests          | Done                                      | `6fab893`            |
| 5     | Approve tournament profile design, persistent shared banner/identity/tabs, platform-only header, both themes, editable contrast-safe accents and application rollout          | Done                                      | `fd6bc44`            |
| 6     | Portable versioned ZIPs, strict previews, fresh unpublished imports, media hashes, identity remapping, recovery journals and isolated legacy migration                        | Done                                      | `3182a5c`            |
| 7     | Simplify organizer destinations, Website/Staff subsections, canonical Matches list, guarded changes and real previews                                                         | Done                                      | `42d111c`            |
| 8     | Correct Bancho PASS/NICK/USER registration, current per-user identity and secret-free stage/code diagnostics                                                                  | Done                                      | `0c1b51a`            |
| 9     | Recognize command acknowledgements, then replace ordinary-command verification with honest nonblocking Sent receipts; preserve uncertain room-creation safeguards             | Done; acknowledgement gating superseded   | `d65c4e7`, `dc73647` |
| 10    | Canonical gameplay scoring, native SE/DE/groups, path eligibility, confirmed advancement, stage repair, qualifier runs/provenance and immutable reviewed standings            | Done with explicit provider/layout limits | `d7d738c`            |
| 11    | Stable tournament match numbers, bracket reservations and improved organizer workflows                                                                                        | Done                                      | `39e5b68`            |
| 12    | Persistent pool planning/suggestions/reviews, bulk stages/schedules/staff/qualifiers, safe pool release, historical bracket linking and archive extensions                    | Done                                      | `c6b9935`            |
| 13    | Consolidate project knowledge into AGENTS, INTENT, SPEC, PLAN, ARCHITECTURE and DESIGN; retain README entry point, remove superseded guides                                   | Done                                      | This change          |

Rejected calm/earlier redesign pilots are not design authority. Their useful
usability lessons and verification procedures are incorporated in DESIGN and
ARCHITECTURE; their obsolete visual specifications and local preview URLs are not.

## Schema Delivery Order

Apply migrations through the normal reviewed install workflow, not manually in
arbitrary order. Existing-schema adoption is a separate guarded procedure in
[ARCHITECTURE.md](ARCHITECTURE.md#existing-schema-adoption).

| Migration                                          | Purpose                                                                            |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `20261020000000_baseline`                          | Generic platform, CMS, access, registrations, referee/qualifier and IRC foundation |
| `20261020210000_tournament_transfers`              | Durable import journal                                                             |
| `20261021110000_tournament_gameplay_scoring`       | Canonical scoring and safe legacy inference                                        |
| `20261021120000_native_competition_qualifier_runs` | Brackets, paths, run-aware qualifiers and standings                                |
| `20261021130000_qualifier_score_provenance`        | Score representation/verification/source evidence                                  |
| `20261021140000_stable_tournament_match_numbers`   | Immutable local numbering, reservations, allocation trigger                        |
| `20261022010000_pooling_workflows`                 | Plans, candidates, skillsets/tags, reviews and artist warnings                     |

No phase authorizes a database reset, rewrite of historical results or automatic
live cutover. Private installation settings and published content stay authoritative.

## Verification Baseline

At `c6b9935`, recorded checks passed against isolated `tournament_platform_test`:

- 339 unit tests in 25 files and 172 PostgreSQL integration tests in 20 files.
- 36 standalone-production browser tests in serial batches: organizer 12,
  referee/public 17 and platform lifecycle/transfer 7.
- Type checking, ESLint, Prettier and production build; datasource/schema diff
  reported no difference after reviewed test migrations.
- Tenant/permission boundaries, stale writes, immutable publications/histories,
  pool planning/review/release, schedule/resource conflicts, stage duplication,
  historic bracket linking, numbering and archive round trips were covered.
- Browser checks used real application APIs and synthetic identities/data,
  inspected screenshots at desktop/mobile widths and both appearances. IRC used
  an isolated mock Bancho server and temporary test-only gateway secret.

A long combined browser run was terminated externally; the three smaller batches
were rerun to completion. Never run integration and browser suites concurrently
against their shared database. Local ignored evidence is under
`.data/qa-final-organizer`, `.data/qa-final-referee-public`,
`.data/qa-final-platform` and `.data/visual/organizer-update`; it is not shipped.

Earlier focused evidence retained for context:

- Generic first-install/container checks verified the admin data route in the
  production manifest, empty CMS editing and fresh owner/tournament lifecycle.
- Approved profile tests verified 60 same-tournament tab transitions at
  1920/1366/768/390/320px in both themes: persistent DOM/image nodes, one document
  and one banner request, no duplicate navigation or private draft branding leak.
- The approved rollout exercised 124 production route/theme/width combinations;
  organizer UX later exercised 228. These are dated fixture runs, not guarantees
  for arbitrary uploaded content or every browser engine.
- An isolated legacy backup import preserved 31 matches, 290 actions, 194 map
  results, 71 events, 65 result revisions, 27 teams/54 roster entries, 6 stages,
  17 pool revisions/272 slots, 19 CMS revisions and two verified media files.
  Matches 1/25/27 retained 10/14/11 actions, 6-0/7-3/7-0 scores, MP URLs and
  Discord/history visibility after reload. Source access grants were review-only.
  This verifies a dated backup, not newly captured live production records.

Live OAuth, remote S3 providers, native lazer capture and real Bancho credentials
are not implied by these results. No installation database, legacy service or
Docker network was changed by the latest organizer verification.

### Documentation Consolidation Checks

For this documentation change, formatting, ESLint and all 339 unit tests passed.
The authored Markdown inventory contains exactly AGENTS, README and the five
canonical docs; all relative links/heading anchors resolve. The generated Next.js
agent block and Docker safety instructions are retained. Superseded references,
including the setup tool's network-safety help link, have been replaced.
No database, container, browser, production build or live-provider checks were
needed or rerun for this change; previous application evidence remains dated above.
No live service or instance data was changed.

## Remaining Work

Work in this order unless the maintainer explicitly reprioritizes. Items marked
conditional are extensions, not already approved commitments or release blockers.

1. **Release and deployment verification.** Review the target branch/release,
   back up and restore-test an isolated copy, build consistent web/tools/gateway
   images, run security/license scans and the current regression commands. Obtain
   separate approval for registry publication or live cutover. Apply the missing
   additive migrations and restart only the approved installation.
2. **Live provider smoke checks.** With operator-supplied credentials, verify osu!
   sign-in/state/logout/current profile, uncached metadata and multiplayer evidence,
   remote private S3 read/write/delete/authorization, and optional per-user Bancho
   registration/room creation/dispatch in an authorized disposable lobby. Retain
   sanitized evidence, never passwords/tokens or raw authentication traffic.
3. **Verification debt.** Exercise genuine concurrent-user/database races beyond
   stale-version/transaction tests, additional browser engines, accessibility with
   assistive technology and realistic storage/archive/load sizes. Address existing
   pg concurrent-query and Vite loader deprecations deliberately after reproduction.
   Historical one-off visual harnesses may describe obsolete screens; current E2E
   and rollout harnesses are the regression starting point.
4. **Qualifier source adapters.** Inspect a redistributable/synthetic verified
   qualifier workbook layout containing actual individual performances before
   implementing its adapter. Preserve unsupported-sheet reporting. Add native
   lazer Rooms API capture only against documented supported evidence; do not
   repurpose legacy Bancho capture. Qualifier IRC execution remains a separate
   possible integration; copied setup commands work today.
5. **Organizer ergonomics.** Consider a named reusable preset library, interval
   schedule conflicts/staff availability and fuller browser Back/Forward unsaved
   guards. Current guards cover ordinary workspace links and reload/close; current
   conflicts compare identical starts. Do not silently widen bulk status/participant
   edits around historical and referee protections.
6. **Conditional scale/extensions.** Evaluate streamed/offline large archives,
   multi-gateway sharding, bulk match duplication, per-slot notes, custom-map upload
   or mappack generation only with concrete workflows and security review. Arbitrary
   blank bracket graph editing and automatic historical reseeding are not current
   promises. Preserve the supported source-stage/default reuse and existing graph.

## Completion Rules

For each change: establish source behavior, implement within existing ownership
boundaries, add risk-scaled tests, update the owning canonical docs, and record
actual checks and limitations here. A future feature is complete only when its
contract in SPEC works end-to-end with persistence, authorization and failure cases.
UI work also needs rendered evidence under [DESIGN.md](DESIGN.md#verification).
Deployment commands and recovery procedures remain in ARCHITECTURE, not duplicated
into release-specific guides. The baseline counts above are not a permanent target
and must not be relabeled as newly executed tests.
