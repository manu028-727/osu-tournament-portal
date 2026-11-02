# Delivery Plan

## Status And Evidence

Consolidated on 24 October 2026 from the repository, migrations and existing
verification records. This is the ordered project history and remaining work,
not a second specification. Functional requirements live in [SPEC.md](SPEC.md).
Historical checks below were recorded at their checkpoints; this documentation
rewrite does not rerun or certify every earlier deployment/provider check.

Historical `Done` means delivered in source, not deployed to every installation.
Use **Verified completed** for a scoped result with source/check evidence,
**Partially implemented** for a contract with remaining gaps, **Planned** for work
not performed, **Blocked** for a named unmet prerequisite, and **Unverified** where
evidence is absent. Passing existing tests does not close an uncovered finding.
New development should update the owning phase and remaining work, rather than
append another guide. SPEC's capability labels do not override discrepancies here.

## Ordered Delivery History

| Order | Delivery                                                                                                                                                                      | State                                                        | Source Checkpoint                          |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------ |
| 1     | Extract generic multi-tournament app from private tournament implementations; retain OAuth, scoped roles, CMS revisions, media, teams, referee engine and historical importer | Done                                                         | `7d4a4d9`                                  |
| 2     | Public MIT distribution, legal notices, no private fixtures or artwork; Docker-first provisioning and optional private storage/IRC                                            | Done                                                         | `924abbd`                                  |
| 3     | Simplify to one default Compose stack and `portal` lifecycle helper, isolate advanced overrides and remove generated clutter                                                  | Done                                                         | `a9d82fb`                                  |
| 4     | Repair fresh tournament lifecycle: chooser boundary, `/t/<slug>/admin/...`, missing-context errors, empty page defaults, unpublished editing and authorization tests          | Done                                                         | `6fab893`                                  |
| 5     | Approve tournament profile design, persistent shared banner/identity/tabs, platform-only header, both themes, editable contrast-safe accents and application rollout          | Done                                                         | `fd6bc44`                                  |
| 6     | Portable versioned ZIPs, strict previews, fresh unpublished imports, media hashes, identity remapping, recovery journals and isolated legacy migration                        | Done                                                         | `3182a5c`                                  |
| 7     | Simplify organizer destinations, Website/Staff subsections, canonical Matches list, guarded changes and real previews                                                         | Done                                                         | `42d111c`                                  |
| 8     | Correct Bancho PASS/NICK/USER registration, current per-user identity and secret-free stage/code diagnostics                                                                  | Done                                                         | `0c1b51a`                                  |
| 9     | Recognize command acknowledgements, then replace ordinary-command verification with honest nonblocking Sent receipts; preserve uncertain room-creation safeguards             | Done; acknowledgement gating superseded                      | `d65c4e7`, `dc73647`                       |
| 10    | Canonical gameplay scoring, native SE/DE/groups, path eligibility, confirmed advancement, stage repair, qualifier runs/provenance and immutable reviewed standings            | Done with explicit provider/layout limits                    | `d7d738c`                                  |
| 11    | Stable tournament match numbers, bracket reservations and improved organizer workflows                                                                                        | Done                                                         | `39e5b68`                                  |
| 12    | Persistent pool planning/suggestions/reviews, bulk stages/schedules/staff/qualifiers, safe pool release, historical bracket linking and archive extensions                    | Done                                                         | `c6b9935`                                  |
| 13    | Consolidate project knowledge into AGENTS, INTENT, SPEC, PLAN, ARCHITECTURE and DESIGN; retain README entry point, remove superseded guides                                   | Done                                                         | `fc41596`                                  |
| 14    | Audit every major subsystem, rerun the safe baseline and align documentation; prepare the cleanup without changing application behavior                                       | Verified completed within audit scope                        | `d88724d`, audit of `fc41596`              |
| 15    | Enforce nested ownership, saved revision owners and same-match action relationships with additive migrations                                                                  | Verified completed                                           | `2ec77f8`                                  |
| 16    | Align guest lifecycle/projections, explicit editing context and fresh CMS state                                                                                               | Verified completed                                           | `b34cf3a`                                  |
| 17    | Reject stale settings, staff and category writes with reviewed patches                                                                                                        | Verified completed                                           | `0e07e51`                                  |
| 18    | Share match/qualifier resource scheduling and stage pool validation                                                                                                           | Verified completed                                           | `5790dd5`                                  |
| 19    | Journal ordinary media writes/deletes and protect historical references                                                                                                       | Verified completed within synthetic/filesystem scope         | `fe46534`                                  |
| 20    | Paginate long lists and stream complete roster exports                                                                                                                        | Verified completed; representative load tuning Blocked       | `4a9d953`                                  |
| 21    | Separate domain reads/restoration and enforce archive/schema coverage; remove verified obsolete code                                                                          | Verified completed                                           | `a6c93f6`                                  |
| 22    | Patch dependency advisories, reproduce adapter warning and gate releases on checks                                                                                            | Verified completed; upstream warning Blocked                 | `14acd73`                                  |
| 23    | Add complete English/Italian built-in interfaces and shared dirty-navigation/dialog ownership                                                                                 | Verified within recorded frontend scope                      | `4c74c4c`                                  |
| 24    | Separate editable homepage Heroes, polish all block types and widen shared responsive containers                                                                              | Verified within recorded Chromium scope                      | `09a9fc2`                                  |
| 25    | Improve numeric match navigation, direct organizer results, reviewed multiplayer imports and Matches scheduling/search                                                        | Verified within recorded Chromium and PostgreSQL scope       | `3b5beb4`                                  |
| 26    | Retain deleted generated fixtures, edit scores in rows, reconstruct roster-based MP results and integrate mappool suggestions                                                 | Verified within recorded Chromium and PostgreSQL scope       | `01971b2`; checks below                    |
| 27    | Interactive bracket editing, explicit fixture restoration and permanent whole-bracket deletion with reviewed numbering restart                                                | Verified within recorded Chromium and PostgreSQL scope       | `48f8b5d`; checks below                    |
| 28    | Two-path double-elimination presentation, shared finals conclusion, stage headings and numbered pending slots                                                                 | Verified within recorded Chromium and PostgreSQL scope       | `527bdd7`; checks below                    |
| 29    | Progression-based bracket stage suggestions, persisted number reservations and reviewed editable generation ranges                                                            | Verified within recorded Chromium and PostgreSQL scope       | `c333383`; checks below                    |
| 30    | Shared qualifier refereeing/IRC/synchronization, automatic registration approval, captain booking and reviewed bulk MP imports                                                | Verified within recorded synthetic PostgreSQL/Chromium scope | Working tree after `c333383`; checks below |

Rejected calm/earlier redesign pilots are not design authority. Their useful
usability lessons and verification procedures are incorporated in DESIGN and
ARCHITECTURE; their obsolete visual specifications and local preview URLs are not.

## Schema Delivery Order

Apply migrations through the normal reviewed install workflow, not manually in
arbitrary order. Existing-schema adoption is a separate guarded procedure in
[ARCHITECTURE.md](ARCHITECTURE.md#existing-schema-adoption).

| Migration                                          | Purpose                                                                                                                                                   |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261020000000_baseline`                          | Generic platform, CMS, access, registrations, referee/qualifier and IRC foundation                                                                        |
| `20261020210000_tournament_transfers`              | Durable import journal                                                                                                                                    |
| `20261021110000_tournament_gameplay_scoring`       | Canonical scoring and safe legacy inference                                                                                                               |
| `20261021120000_native_competition_qualifier_runs` | Brackets, paths, run-aware qualifiers and standings                                                                                                       |
| `20261021130000_qualifier_score_provenance`        | Score representation/verification/source evidence                                                                                                         |
| `20261021140000_stable_tournament_match_numbers`   | Immutable local numbering, reservations, allocation trigger                                                                                               |
| `20261022010000_pooling_workflows`                 | Plans, candidates, skillsets/tags, reviews and artist warnings                                                                                            |
| `20261024010000_owned_revision_and_result_links`   | Scan ownership and enforce revision/action references                                                                                                     |
| `20261024011000_revision_owner_orm_compatibility`  | Preserve Prisma optional-pointer compatibility with owner triggers                                                                                        |
| `20261024012000_immutable_revision_owners`         | Prevent saved revision reparenting                                                                                                                        |
| `20261024013000_staff_edit_versions`               | Add staff/category optimistic edit counters                                                                                                               |
| `20261024014000_media_cleanup_outbox`              | Empty durable media cleanup journal                                                                                                                       |
| `20261028010000_generated_match_deletion`          | Retain generated match history with a nullable deletion witness                                                                                           |
| `20261028020000_deleted_bracket_state`             | Expand the bracket state constraint for retained deleted positions                                                                                        |
| `20261029010000_bracket_retirement`                | Active-fixture schedule uniqueness and an intermediate parent marker                                                                                      |
| `20261029020000_permanent_bracket_deletion`        | Remove the intermediate marker for the explicitly permanent deletion contract                                                                             |
| `20261030010000_qualifier_registration_workflows`  | Native registration policy/private answers, public rejection reasons/private notes, booking capacity, qualifier game provenance and IRC context ownership |

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

For the earlier `fc41596` documentation consolidation, formatting, ESLint and all
339 unit tests passed.
The authored Markdown inventory contains exactly AGENTS, README and the five
canonical docs; all relative links/heading anchors resolve. The generated Next.js
agent block and Docker safety instructions are retained. Superseded references,
including the setup tool's network-safety help link, have been replaced.
No database, container, browser, production build or live-provider checks were
needed or rerun for that change; previous application evidence remains dated above.
No live service or instance data was changed.

### Repository Audit Checks - 24 October 2026

Audited the clean `design/tournament-profile` checkout at `fc41596`, remote
manu028-727/osu-tournament-portal. Inventory: 338 tracked files, 57 Prisma models,
seven migrations and 32 direct production dependencies. All canonical documents
and README were read. Source review covered the subsystem matrix below, SQL
constraints/triggers, API entrypoints, import/runtime references, scripts, Docker
and both workflows. It was not a formal proof of every branch or dependency.

New checks, separate from the historical baseline:

| Check                     | Actual result and boundary                                                                                                                                                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node/lockfile             | Node 22.23.3 explicitly selected; manifest and lockfile root dependency maps match; npm ci passed in ignored .data/audit-20261024/lockfile-install without replacing checkout dependencies                                                                |
| Formatting/lint/types     | npm run format:check, npm run lint and npm run typecheck passed before documentation edits; documentation formatting/link/diff checks repeated at completion                                                                                              |
| Unit                      | 339 tests in 25 files passed                                                                                                                                                                                                                              |
| PostgreSQL integration    | 172 tests in 20 files passed on the guarded tournament_platform_test database; no migration/setup/reset command run                                                                                                                                       |
| Prisma                    | validate passed; read-only migrate status found all seven migrations applied; migrate diff from the isolated datasource to schema returned no difference                                                                                                  |
| Production build          | npm run build passed with dummy isolated database URLs, no installation credentials; standalone output generated                                                                                                                                          |
| Production Chromium       | All 36 tests passed in sequential batches: organizer/competition/bulk 12, referee/public/standings 17, platform/workspace/transfer 7; the IRC test ran with mock Bancho and a random test-only secret                                                     |
| Visual evidence           | Inspected six generated screenshots: stage editor light 320/dark 1366, public pool 320, mobile pool details 390, qualifier review dark 320 and public bracket light 1366; browser suites additionally exercised their configured width/theme/interactions |
| Relationship probe        | A deliberately rolled-back synthetic transaction accepted a scoped result referencing another tenant's match action and a page pointer referencing another page's revision; no probe records persisted; see F06                                           |
| Dependency advisories     | npm audit --audit-level=high exited 0, reporting three moderate package entries (brackets-manager/uuid and fast-uri), zero high/critical; this is not a clean advisory report or exploit assessment                                                       |
| Distribution source check | node scripts/source-audit.mjs --tracked passed with 338 files and no issues; this scanner is narrower than a full secret/history or container scan                                                                                                        |

Read-only Compose validation also passed for the default file and development,
assets, external-network and mock-IRC overlays using .env.example with
STACK_ENV_FILE pinned to that example. The first config attempt lacked that pin
and failed because no installation .env exists in this checkout. No Docker daemon
mutation was involved. collect-notices generated notices for 831 installed package
distributions in .data/audit-20261024/THIRD_PARTY_NOTICES.txt; native/OS SBOM and
container scan obligations remain separate.

The first 12-test browser attempt failed at Chromium launch (missing libnspr4 and
other host libraries), before browser assertions. Reusing already-extracted
libraries in .data/browser-runtime resolved it; the complete batch was rerun.
No host packages or Docker services were installed/changed. Initial sandbox
subprocess/network restrictions were resolved for safe checks outside the sandbox.
Integration/browser runs emitted the existing pg concurrent-query deprecation;
the integration loader also emitted its native-loader warning. One platform
negative-path browser case logged Tournament not found while the test passed.

Ignored evidence is under .data/audit-20261024/browser-organizer-rerun,
browser-referee-public and browser-platform; failed launch evidence is retained
separately. Some existing specs also write ignored test-results and .data/visual
screenshots. These are synthetic session/storage/provider tests. No live OAuth,
remote S3, real Bancho, container rebuild, production installation, gitleaks
history scan, image vulnerability scan, off-host restore or realistic load test
was performed. A fresh lockfile install was verified separately; application
checks used the existing matching checkout dependencies. No application source,
dependency manifest, schema, migration or infrastructure was changed.

## Repository Audit And Cleanup Phase

Overall assessment: a functioning, extensively tested monolith with substantial
maintenance concentration and several uncovered contract gaps. Existing pure
engines, revisions, snapshots, tenant predicates, permission refreshes and archive
recovery are valuable foundations. Evidence does not justify a rewrite, dropping
history tables, replacing the bracket engine or bulk dependency removal.
The technical boundary map and proposed architecture are in
[ARCHITECTURE](ARCHITECTURE.md#implementation-boundaries-and-cleanup).

### Whole-Product Implementation Map

| SPEC contract                                                              | Current verified implementation and evidence                                                                            | Status / remaining scope                                                                                                                             |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Platform and first installation](SPEC.md#platform-and-first-installation) | portal/configure/bootstrap, tournaments-service, setup/tournament integration and lifecycle browser suites              | Verified completed for source/isolated lifecycle; fresh-container evidence remains historical                                                        |
| [Identity and authorization](SPEC.md#identity-and-authorization)           | OAuth state/session code, refreshed permissions, classified scopedDb, ownership constraints and observer tests          | Verified completed for exercised trust boundaries; live OAuth Unverified                                                                             |
| [Public website](SPEC.md#public-tournament-website)                        | Shared profile, uniform lifecycle gates, public projections/context and bilingual rendering                             | Verified completed for exercised Chromium states; other engines and assistive technology Unverified                                                  |
| [Branding and media](SPEC.md#branding-and-media)                           | Saved themes, shared durable media journal/recovery, historical references and privacy/failure tests                    | Verified completed for synthetic/filesystem cases; remote provider settlement Unverified                                                             |
| [Stages, pools and pooling](SPEC.md#stages-mappools-and-pooling)           | Shared validation, reviewed stage tokens, plans/reviews/releases and owned dirty dialogs                                | Verified completed for exercised workflows; named presets, notes, uploads and mappacks remain extensions                                             |
| [Teams and staff](SPEC.md#teams-players-and-public-staff)                  | Versioned edits/bulk actions, paginated lists, global search and complete streamed CSV export                           | Verified completed for exercised flows; representative load tuning Blocked under F07                                                                 |
| [Scheduling and brackets](SPEC.md#scheduling-and-native-brackets)          | Shared final-plan resource checks, stable numbering, native brackets and audited corrections                            | Verified completed for exact-time conflict parity; intervals, availability and bulk duplication remain extensions                                    |
| [Referee operations](SPEC.md#referee-match-operations)                     | Preserved snapshots/history, separated reads/mutations, bilingual referee/import UI and Discord goldens                 | Verified completed within exercised rules/layouts; live provider evidence remains separate                                                           |
| [Qualifiers and scoring](SPEC.md#qualifiers-and-scoring)                   | run-aware source validation, pure mathematics, versioned standings, reopen/downstream guards and archive witness tests  | Verified completed for supported native/manual/legacy evidence; lazer Rooms capture and qualifier workbook adapter Planned with source prerequisites |
| [Interoperability](SPEC.md#interoperability-and-portability)               | Reviewed workbooks, wire/schema coverage, one versioned identity traversal, restoration witnesses and recovery journals | Verified completed for supported formats/bounds; representative archive RSS Blocked under F07                                                        |
| [Reliability and hosting](SPEC.md#reliability-hosting-and-acceptance)      | Request protection, private storage, signed IRC, pinned CI and production-browser release gate                          | Verified completed within local checks; upstream pg warning Blocked; live providers/target deployment Unverified                                     |

### Finding Priorities And Evidence

High means privacy/integrity protection or an important boundary needs prompt work;
Medium means observable inconsistency, reliability risk or significant maintenance
cost; Low means bounded cleanup. These are audit priorities, not CVSS scores.
The findings below preserve the audit baseline. Current remediation status and
checks are in [Cleanup Delivery](#cleanup-delivery). "Verified" refers to the stated
evidence; suspected performance/exposure consequences are identified separately.

### F01 Public Lifecycle Gates

Sources: [tournament lifecycle](../src/lib/tournaments-service.ts),
[public CMS/pools](../src/lib/queries.ts), [media access](../src/lib/media-access.ts),
[competition projection](../src/lib/competition-service.ts).

**High; verified source contradiction.** tournamentAction(lifecycle) and the chooser
Archive button retain published=true when archiving. tournamentList(publicOnly),
queries.publicDb, publicMatches, publicTeams, isPublicAsset and the public layout
only check published. publicCompetitionData and publishedQualifierStandings also
require archivedAt=null. Thus the same archived published tournament remains
listed and serves CMS/pools/teams/matches/media while brackets/standings disappear.
This contradicts [the platform contract](SPEC.md#platform-and-first-installation).
The directory even offers an Archived filter, confirming an implementation-level
policy divergence rather than a missing database field.

Use one explicit guest-visibility predicate across HTML, metadata, APIs, assets,
directory and featured selection. Retain the SPEC rule unless the maintainer
approves a product change. No schema migration is needed for reader consistency;
do not silently rewrite existing archived/public records. First add guest tests
for every published/archived combination, direct URLs, media and featured roots,
with privileged editing still allowed. Current suites do not cover this matrix.

### F02 Stale Editor Writes

Sources: [action schemas](../src/lib/validation.ts),
[mutation dispatcher](../src/lib/admin-service.ts),
[settings form](../src/components/admin/settings.tsx),
[staff bulk contract](../src/lib/staff-bulk-validation.ts).

**High for settings; Medium elsewhere; verified source.** settings.save accepts a
whole settings object without a base version and writes it under the global lock;
SettingsEditor submits hidden fields from its original info/branding/navigation
snapshot too. A second valid old form can overwrite a newer save. Staff/category
single edits and staff.bulk similarly have no reviewed version; update counts
detect disappearing rows, not changed values. stage.save checks its token only
when supplied. These are weaker than the existing match/team/revision protocols
and [stale editing requirements](SPEC.md#stages-mappools-and-pooling).

Introduce reviewed witnesses and narrow patches using existing patterns; reject
missing witnesses for updates. Settings may use a reviewed existing timestamp or
an additive version; staff/category version fields would require additive backfill.
Do not invent historical versions or reset records. Test two independent old forms,
separate Website subsections, stale staff bulk selections, omitted stage tokens,
permission revocation and full batch rollback. Keep lock serialization as well.

### F03 Divergent Scheduling And Pool Checks

Sources: [single-match operations](../src/lib/matches-service.ts),
[bulk scheduling](../src/lib/matches-bulk-service.ts),
[qualifier availability](../src/lib/qualifiers-bulk.ts),
[pool checks](../src/lib/stage-pool-validation.ts).

**Medium; verified source.** matches-service.validateAssignments checks referee
collisions; match.create/match.schedule additionally reject an identical opponent
pair, but do not reject a shared participant against a different opponent or a
qualifier lobby. matches-bulk-service checks those resources, while qualifiers-bulk
has its own availability algorithm. A conflicting schedule can depend on which
editor saved it. Match creation also repeats pool-size/TB/protect checks instead
of stagePoolProblems, already used by release/bulk stage reassignment. Duplication
is confirmed; every edge-case difference in pool acceptance is not yet reproduced.

Extract shared final-plan resource checks and pool predicates, preserving qualifier
capacity and duplicate-entry rules. No migration. Add differential single/create/
bulk/paste/qualifier tests with shared substitutes, same time, different opponents,
time swaps, cancelled/completed records, custom stages and TB-heavy pools. Keep
interval-overlap scheduling as the separately planned extension, not an audit fix.

### F04 Media Reference And Cleanup Ownership

Sources: [tenant upload](../src/app/api/media/route.ts),
[tenant delivery/deletion](../src/app/api/media/[id]/route.ts),
[platform deletion](../src/app/api/platform/media/[id]/route.ts),
[journaled import](../src/lib/tournament-import.ts).

**Medium; verified source reliability gap.** Tenant/platform upload and DELETE
routes independently coordinate DB and storage. DELETE commits catalog removal,
then logs a failed object delete without retaining its key for retry. Upload
compensation can also fail without a durable record; an uncertain put can fail
before compensation begins. Archive imports already solve this class of problem
with TournamentTransfer, but ordinary uploads/deletes do not. isPublicAsset,
assertOwnedMedia, DELETE reference scans and archive asset traversal each encode
different notions of a reference, including JSON substring checks.

Centralize reference traversal for current content and historical snapshots while
keeping public visibility separate from deletion protection. Design a bounded
durable cleanup/tombstone workflow, likely an additive migration; preserve existing
objects and reconcile against a restored copy before any orphan cleanup. Tests must
inject put/delete/DB-commit failures and process interruption, cover every saved
reference form, and prove recovery never deletes committed or published media.
No orphan inventory or storage deletion was attempted during this audit.

### F05 Service Concentration And Lock Scope

Sources: [competition service](../src/lib/competition-service.ts),
[match service](../src/lib/matches-service.ts),
[standings service](../src/lib/qualifier-standings-service.ts),
[dispatcher](../src/lib/admin-service.ts), [IRC RPC](../src/lib/irc-service.ts).

**Medium; verified structure, performance impact Unverified.** competition-service
(1,783 lines) mixes graph lifecycle, reads, corrections and archive witnesses;
matches-service (1,595) mixes read/options/roster/lobby/schedule/state/history code;
qualifier-standings-service (927) mixes source assembly, review and restoration.
admin-service (836) still owns CMS/staff/access/settings writes alongside dispatch.
Most write paths, login bootstrap and even IRC authorization share key 78214321,
so unrelated tournaments serialize. Five-connection pools can wait on this work;
no load measurement establishes a throughput defect yet.

Extract cohesive read, schedule, correction and archive responsibilities while
retaining current transaction/authorization ownership and public API behavior.
No schema migration for extraction. Add multi-connection cross-tournament lock-wait
measurements, concurrent last-owner changes, scoring writes versus corrections and
qualifier reopen versus downstream start. Existing stage/qualifier concurrent-call
tests are useful but do not justify narrowing the global lock. Change lock scope
only as a later reviewed step with explicit acquisition order and failure tests.

### F06 Scoped Client And Relational Boundaries

Sources: [scopedDb](../src/lib/scoped-db.ts), [schema](../prisma/schema.prisma),
[baseline SQL](../prisma/migrations/20261020000000_baseline/migration.sql),
[archive relationship validation](../src/lib/tournament-archive-format.ts).

**High hardening priority; verified isolated probe, no reachable API exploit shown.**
scoped-db.ts returns a full Prisma client type but manually covers selected delegate
and nested-write shapes. Parent-owned creates do not validate all related IDs;
unclassified models pass through and raw SQL is untouched. Page/Pool revision
pointers constrain tenant, not owning page/pool. MatchMapResult's independent
matchId/actionId foreign keys do not require the action to belong to that match.

A rolled-back test transaction successfully used scopedDb(tenant A) to create a
result with tenant A's match and tenant B's action, and pointed one page at another
page's revision. An initial probe with null score totals was rejected by the
existing score CHECK; the valid-score rerun demonstrated the relationship gap.
Domain lookups and archive validation currently supply checks absent from this
lower layer. Do not claim either that all relationships are DB-enforced or that
these probes establish a remotely exploitable route.

Add explicit supported-operation/relationship tests, reject unsupported wrapper
operations or validate them, and review all raw-client callsites before changing
the wrapper. Stronger composite parent FKs need additive unique keys/constraints,
an isolated mismatch scan, reviewed repairs and validation before enforcement.
Never relink historical records automatically. Regression gates include nested
create/connect/upsert/update/delete, included relations, same-tenant wrong-parent
pointers, cross-tenant action/result IDs and archive rejection/round trips.

### F07 Read Size And Index Budget

Sources: [public matches](../src/lib/public-matches.ts),
[admin data](../src/app/api/admin/data/route.ts),
[CSV export](../src/app/api/admin/teams/export/route.ts),
[schema indexes](../prisma/schema.prisma), [archive bounds](../src/lib/tournament-archive-format.ts).

**Medium; verified bounds inconsistency, suspected scale problems.** Public matches,
public/admin teams and team CSV export stop at 500; media catalog stops at 200
without continuation. A large CSV export silently omits teams. Match/pooling/
qualifier/competition reads can instead load entire collections and child histories.
AuditLog's time index and Match's status/time index do not lead with tournamentId.
Archive limits bound input bytes but parsing/remapping/ZIP copies can coexist.

Define complete export versus paginated list contracts, stable ordering/cursors and
explicit truncation errors. First test cap+1 records, tied ordering values, filters,
public projection and export completeness. Use realistic isolated fixtures to
measure query plans, lock waits, browser payloads and archive RSS before adding
tenant-leading indexes or streaming. Index changes require additive reviewed SQL
and an operator lock/build strategy; pagination alone needs no data migration.
Do not lower limits or remove archived history to make measurements pass.

### F08 Archive And JSON Contract Maintenance

Sources: [wire allowlist](../src/lib/tournament-archive-format.ts),
[export/localization](../src/lib/tournament-export.ts),
[restore/remapping](../src/lib/tournament-import.ts),
[competition codecs](../src/lib/competition-archive.ts).

**Medium; verified maintenance risk, no demonstrated round-trip loss.** The 796-line
tournament-archive-format.ts allowlist, import insertionOrder/deferred pointers,
scoped ownership maps and competition-specific remappers must all track schema
changes. localizeArchive/remapJson share field-name/path heuristics for IDs, while
competition-archive.ts explicitly maps structured witnesses. A new ID-bearing JSON
field can be missed despite valid Prisma types. Current tested archives round-trip.

Introduce focused schema/allowlist coverage and explicit JSON witness codecs around
these existing owners. Preserve intentional versioned wire allowlists, not automatic
database export. No migration for tests/extraction; any wire change needs version/
backward-compatibility review. Gate it on synthetic archives with all model groups,
old missing optional tables, nested ID arrays/maps, imported identities without
grants, source-hash equivalence, unknown formula versions and interrupted recovery.
Do not delete duplicate-looking snapshots/cache/provenance fields as a shortcut.

### F09 Frontend Boundaries And Editing Consistency

Sources: [pooling workspace](../src/components/admin/pooling-workspace.tsx),
[matches dashboard](../src/components/admin/matches-dashboard.tsx),
[shared hooks/controls](../src/components/admin/shared.tsx),
[semantic token aliases](../src/app/globals.css).

**Medium; verified source concentration and interaction differences.** PoolingWorkspace
has 2,049 lines, MatchesDashboard 1,567, RefereePanel 1,420, StagesEditor 1,140 and
PoolEditor 1,047. Forms, bulk selection, provider preview and dialogs share extensive
local state. Status labels are imported from MatchesDashboard into other workspaces;
artist normalization is duplicated in pooling UI/service; local datetime, clipboard
and selection helpers recur. useUnsaved guards anchor clicks and unload, not all
history/programmatic navigation. Native window.confirm and Radix confirmations
coexist. Public empty/control copy mixes Italian and English outside DEFAULT_COPY.

Extract pure shared contracts and cohesive editor sections, not a generic form
framework or parallel design system. Preserve canonical tokens: red/emerald/amber
Tailwind aliases are already remapped to semantic light/dark state tokens, so a
color-name search alone does not prove hardcoded-theme defects. No migration.
Gate changes on dirty form plus polling, Back/Forward/programmatic navigation,
dialog focus return, unsaved close, clipboard denial, bulk selection filtering and
both appearances at all DESIGN widths. UI-language/default-rule changes require
maintainer direction and must never translate saved content automatically.

### F10 Obsolescence And Compatibility Inventory

Sources at the audit revision: old `tests/smoke/calm-pilot.ts`,
[active profile](../src/components/home-content.tsx),
[active shell](../src/components/admin/shell.tsx),
[obsolete-action response](../src/lib/admin-service.ts).

**Low; verified candidates, no safe production deletion list established.**
tests/smoke/calm-pilot.ts still expects the rejected More/Homepage navigation and
is outside configured suites/CI. Treat it as a superseded QA candidate after
preserving useful assertions in current tests. Conversely home-pilot.module.css
and workspace-pilot.module.css are actively imported by the approved UI; IRC Client,
MemoryStorage, historical W/L links, legacy systemKey/templateKey, match numbers/
codes and old archive defaults have runtime or compatibility uses. media.delete
remains in the action schema/permission switch solely to return an endpoint error;
the UI uses DELETE /api/media/:id. That is a candidate obsolete action, not a second
working deletion implementation. No unused production module/dependency was proven
by the import/reference inventory.

Perform caller, route, script/container and compatibility checks per removal. Keep
migrations and notices intact. Most verified source cleanup needs no migration;
removing persistent legacy fields would need a separately reviewed compatibility
and additive transition plan. Test old URLs, historical imports and archives before
retiring adapters. Do not infer deadness from no direct import or a filename.

### F11 Dependencies And Automated Verification

Sources: [manifest/overrides](../package.json), [lockfile](../package-lock.json),
[Checks workflow](../.github/workflows/checks.yml),
[release workflow](../.github/workflows/release.yml).

**Medium; verified advisory/CI gaps, exploitability Unverified.** npm audit reports
brackets-manager through its nested uuid (<11.1.1), and fast-uri through
Prisma's development-tool chain (Prisma CLI, @prisma/dev, @prisma/streams-local, ajv);
the three moderate package entries represent two dependency chains, not three
independent demonstrated exploits. The high-only CI threshold still passes.
Do not apply npm audit's suggested major downgrade of brackets-manager blindly.
Clean npm ci also reports deprecated transitive inflight/glob/lodash.isequal/uuid.

checks.yml runs development E2E before build; it does not run E2E_PRODUCTION=1 or
enable the IRC browser case. It separately builds/scans containers and checks a
fresh container lifecycle. release.yml depends on manual dispatch/main/environment,
without a job dependency proving Checks succeeded for the published SHA. Remote
branch/environment protection is Unverified. Both workflows use mutable action tags.

Trace advisory reachability and review compatible updates/overrides with bracket,
workbook, licensing and build regression checks; no DB migration. Add production
and mock-IRC browser gates, review release SHA/digest/check binding and pin reviewed
actions. Reproduce the pg warning with a stack before changing transaction query
parallelism; native-loader warnings need separate configuration work. A passing
source scanner does not replace gitleaks, image scans or provider/restore testing.

### F12 Fresh CMS State

Sources: [tournament creation](../src/lib/tournaments-service.ts),
[setup checklist reads](../src/app/api/admin/data/route.ts),
[existing lifecycle tests](../tests/tournaments.integration.test.ts).

**Medium; verified contract gap.** tournaments-service.tournamentAction(create)
creates home/rules PageRevision rows and points both drafts at them. overview's
setup.homeSaved/rulesSaved checks pointer presence, so a never-edited tournament
already counts both pages as saved. Tests confirm two page records but do not
require zero revisions. [SPEC](SPEC.md#platform-and-first-installation) requires
creation without fabricated CMS revisions and valid absent-page editor defaults.

Leave page containers if useful, initialize no saved revision, and rely on the
existing empty editor contract until an actual save. No schema migration is needed;
preserve all existing drafts, including blank ones that may have been user-saved.
Add exact fresh revision/pointer/checklist assertions and first-save/publish/restore
tests, including an entirely absent page and stale first-save races.

### F13 Explicit Tournament Context And Redirects

Sources: [API actor guard](../src/lib/auth.ts),
[fallback resolution](../src/lib/tournament-context.ts),
[registration redirect](../src/app/register/route.ts),
[specialized media route](../src/app/api/media/route.ts).

**Medium; verified source inconsistency.** Main admin data/action routes use
requireTournamentActor, but it rejects only a missing/none tenant, not an implicit
selection. Older media, metadata, team export and workbook paths use getActor and
often `actor.tournamentId || 'main'`. With a featured/default/legacy tournament,
requestScope can resolve a tenant even on an unscoped API call, including the main
routes. The chooser policy is therefore incomplete at API boundaries. This is
not evidence of a permission bypass: reviewed paths still check capabilities.
register/route.ts also redirects an empty registration link to global /rules,
losing the selected tournament; it has no publication gate of its own.

Make tournament-edit context explicit independently of public featured-root
resolution, and scope internal redirect destinations with existing path helpers.
No migration; retain reviewed legacy public URLs deliberately. Add no-selection
tests for privileged and local-only actors with directory/featured/legacy roots,
direct specialized API calls and two tenants with different registration settings.
Assert distinct missing-context, forbidden and not-found outcomes.

### F14 Public Projections

Sources: [published page query](../src/lib/queries.ts),
[render-only block filtering](../src/components/home-content.tsx),
[asset inference](../src/lib/media-access.ts),
[public bracket projection](../src/lib/competition-service.ts).

**Medium; verified serialization differences, confidentiality intent partly unresolved.**
publicPage includes every block of a published revision; HomepageContent alone
filters visible=false. isPublicAsset scans the entire serialized revision, so a
hidden block's image can qualify as public. publicCompetitionData returns all
bracket entries' names/slugs/seeds while publicMatches hides fixtures with
unpublished/unapproved linked teams. No public contacts/reviews were found in
these reviewed projections; hidden published content and team publication semantics
need explicit acceptance tests rather than assumptions about React rendering.

Review guest field allowlists against
[public content](SPEC.md#public-tournament-website) and
[registration publication](SPEC.md#teams-players-and-public-staff). Preserve saved
data and specify whether hidden published blocks are merely omitted visually or
must be withheld from JSON/media; do not silently change the product contract.
No schema migration for projection fixes. Test guest JSON and direct media bytes,
hidden-only references, draft revisions, unpublished entrants in public brackets
and unchanged authorized previews. Browser screenshots alone cannot verify this.

### Cleanup Execution Order And Gates

1. **Characterize privacy/integrity gaps first:** F01/F02/F03/F06/F12/F13/F14
   reproductions and regression matrices; retain the newly verified baseline.
   Resolve any product-policy ambiguity explicitly without weakening SPEC.
2. **Repair boundary behavior:** consistent public/context rules, stale witnesses,
   scheduling predicates and fresh CMS state. Preserve public routes/history and
   record actual checks before broad structural edits.
3. **Harden persistence and recovery:** F04/F06 additive constraints/cleanup jobs
   only after restored-data scans, reviewed migration/rollback strategy and fault
   tests. No automatic repair/deletion of historical records or unknown objects.
4. **Extract services and contracts:** F05/F08, retaining locks and transaction
   behavior; then F09 editor sections/shared types. Do not combine schema redesign,
   lock narrowing and component rewrites into one unreviewable change.
5. **Remove proven obsolete paths:** F10 alongside the feature/extraction that
   supersedes them; keep compatibility until its replacement passes old-data tests.
6. **Address measured scale and delivery debt:** F07/F11 query/payload/RSS evidence,
   reviewed dependency updates, production/mock-provider CI and release checks.
   Only then consider a narrower locking protocol based on concurrency evidence.
7. **Resume release/provider and product roadmap:** the remaining work below stays
   intact. Cleanup is not deployment approval and does not implement extensions.

Each stage requires affected unit/integration/browser checks plus format/lint/types
and a production build when behavior changes. Schema work adds migration drift,
constraint and archive tests; UI work adds inspected screenshots/interactions.
No finding is closed solely by shrinking files or keeping existing tests green.

## Remaining Work

### Cleanup Delivery

The numbered findings above preserve the audit baseline. The delivery record below
owns the resulting implementation and verification state.

- Ownership foundation: added failing regressions for wrong-owner page/pool
  revisions, cross-match result/action IDs and nested writes, then guarded additive
  SQL and scoped-client validation. A follow-up migration preserves the applied
  ledger after testing exposed Prisma's optional-composite-pointer nested-create
  incompatibility. Disposable populated schemas verify preservation and mismatch
  refusal. Global write locking and historical witnesses are retained.
- Ownership phase checks: 339 unit tests, 180 integration tests in 22 files,
  lint, types, Prisma formatting and production build pass. Saved revision owner
  immutability closes the pointer/reparenting race. The pg concurrent-query warning
  remains under F11; these synthetic checks are not live-provider verification.
- All migrations in this phase target only the isolated synthetic test database.
  No installation migration, deployment, publication or service restart is authorized
  by these source changes. The remaining delivery phases are recorded below.
- Public/context phase: one guest lifecycle predicate, hidden-block/media and
  private-bracket-entrant projections, explicit editing API context and scoped
  registration redirects address F01/F12/F13/F14. Fresh pages have no revisions.
  Four-state synthetic reader matrix and fresh-CMS integration checks pass; full
  suite: 184 integration tests, 339 unit tests, lint, format, types and production
  build pass. Four production Chromium tests cover explicit-context errors,
  archived HTTP/public API/registration paths and authorized archived editing.
  Persistent profiles pass 1920/1366/768/390/320 in light/dark; desktop and narrow
  screenshots were inspected. Evidence: .data/cleanup-20261024/browser-context-final
  and the ignored profile screenshots. No saved publication flags were rewritten.
- Stale-write phase (F02): settings writes moved into settings-service.ts and now
  apply narrow patches with Tournament.version checks; staff/category additive
  versions protect edits/deletes/bulk batches, and stage updates require review
  tokens. Archive inspection now shares field validation independently of actions.
  188 integration tests, 339 unit tests, lint, format, types and production build
  pass, including populated-version migration and concurrent old-form regressions.
  The new production browser regression passes exact patch payload, visible stale
  rejection, retained dirty values and preserved current data in two open forms.
  It exposed and fixed JSON object-key ordering in patch comparison. Evidence:
  .data/cleanup-20261024/browser-stale-forms-pass. Other four platform browser cases
  passed in the earlier batch. No installation migrations were applied.
- Scheduling phase (F03): removed the three independent timed resource algorithms
  in favor of one final-plan validator and reused stage pool checks at match
  creation. Added differential single/create/bulk cases for teams, substitutes,
  qualifier entrants, referees and a tiebreaker-heavy pool. 193 integration tests,
  339 unit tests, lint/types/build pass. Three production organizer browser cases
  pass bulk/paste/mobile scheduling and stage workflows. No migration; global lock
  and qualifier uniqueness/capacity semantics are retained. Evidence:
  .data/cleanup-20261024/browser-scheduling.
- Media phase (F04): ordinary tenant/platform writes now share a durable outbox,
  bounded explicit recovery and exact reference traversal. Synthetic failure tests
  cover uncertain puts/commits, failed compensation/deletion, transaction rollback,
  process interruption, late upload commits, both catalogs and hidden/historical
  references. 203 integration tests, 340 unit tests, lint/types and build pass.
  The empty additive outbox migration was applied only to the isolated test DB;
  populated-schema checks preserve existing content. The production filesystem
  upload/historical-deletion/qualifier browser case passes; evidence:
  .data/cleanup-20261024/browser-media. Remote S3 timeout/settlement remains Unverified, and
  existing orphan reconciliation requires an operator-reviewed restored copy.
- List/export phase (F07): removed silent caps, added stable explicit pagination
  and global team search, and streamed complete snapshot CSVs including empty teams.
  207 integration tests in 25 files and 340 unit tests pass; lint/types/build pass.
  The new production browser case passes continuation/search/export and 72
  route/theme/width captures; narrow light media and dark team screenshots inspected.
  It exposed an extra header blank line, now fixed with a regression assertion.
  Evidence: .data/cleanup-20261024/browser-pagination-rerun and pagination.
  No migration. Representative installation query/index/archive-memory tuning
  remains blocked on an approved restored dataset; synthetic correctness fixtures
  do not establish production performance or justify speculative indexes.
- Domain/archive phase (F05/F08/F10): separated authorized match/competition reads,
  record helpers, group seed witnesses and archive restoration from mutation
  services. Qualifier source assembly, shared contracts and restoration now have
  independent owners; the standings mutation service is 289 lines. Client types
  no longer point into match mutation code. Schema tests explicitly account for
  all generated models/scalars, wire exclusions, insertion order and deferred
  references. One version 1 JSON identity traversal preserves historical behavior;
  competitive witnesses still prove equivalence before rebinding hashes. Removed
  the obsolete rejected media action and calm pilot harness after checking current
  browser coverage. Active CSS and historical compatibility remain.
  343 unit tests, 208 integration tests, lint/types and production build pass.
  A two-connection isolated lock probe measured 151.7ms wait for a controlled 150ms
  hold (.data/cleanup-20261024/lock-contention.json); this confirms serialization,
  not a production throughput limit. The shared lock remains unchanged.
  Production Chromium passes 18 competition/qualifier/referee cases; the optional
  mock-IRC case was skipped in this phase and remains a final gate. Evidence:
  .data/cleanup-20261024/browser-domain-extraction. No migration for extraction.
- Dependency/delivery phase (F11): clean npm ci installs patched scoped uuid
  11.1.1 and fast-uri 3.1.9; npm audit reports zero advisories. npm initially kept
  a stale nested uuid 9 lock entry despite the override; removing that obsolete
  entry and rerunning npm ci verified both consumers resolve the patched root.
  No bracket-engine downgrade or unrelated dependency removal. Checks now gates
  production/mock-IRC browsers and moderate advisories, pins action commits and
  is a same-revision prerequisite for approved releases. Remote execution and
  protection settings remain Unverified; no publication/deployment was performed.
  Fresh-install checks pass: format/lint/types, 343 unit, 208 integration and build;
  830 package notices regenerated and tracked source audit has no issues.
  Native-loader warning resolved. pg warning reproduced with a single read-only
  Prisma relation query; explicit shared-transaction query batches were sequenced.
  Remaining engine/adapter warning is Blocked on a compatible upstream fix, with
  traces in .data/cleanup-20261024/pg-minimal-repro.log and pg-warning-trace.log.
  All 38 standalone production Chromium cases pass, including mock Bancho, after
  the dependency changes (.data/cleanup-20261024/browser-dependencies-full).
  The expected missing-tournament negative path logged a 404 while its test passed.
- Frontend/localization phase (F09): maintainer explicitly requested complete
  English and Italian built-in interfaces with a visible switch. Request cookies,
  server/client rendering, metadata, dates/numbers, validation, shared labels and
  generated feedback follow that preference. The Italian catalog has 3,065 entries;
  source-copy/alias coverage, duplicate keys and interpolation are tested. Names,
  CMS/navigation text, rules policies, notes and histories remain authored data.
  AppError retains English domain messages with non-enumerable templates/parameters;
  HTTP errors localize without changing status/body shape or global Zod settings.
  Match labels, artist normalization and local datetime conversion have shared owners.
  PoolingWorkspace is now 770 lines instead of 2,049: suggestion/bulk, review/selection
  and configuration forms own their state and guarded discard. One shared navigation
  guard covers links/unload, cancelable Back/Forward and stage router calls; Modal
  restores connected opener focus. Unsupported/forced browser traversal limitations
  remain explicit in ARCHITECTURE. No migration for this phase.
  Final standalone production checks pass all 42 Chromium cases, including the four
  bilingual cases and mock Bancho. They cover real localized 400/409 responses,
  unchanged persisted data, dirty settings/CMS/dialogs, canceled close/Back/Forward,
  focus return, bulk/filtering, clipboard denial, match histories and stage exit.
  216 new captures cover six populated/empty views, both languages/appearances and
  nine viewport sizes; narrow public/settings/pooling/referee/chooser and desktop
  screenshots were inspected. Inspection exposed and fixed a 320px header overflow,
  missed referee labels and decimal formatting. English referee wording/casing is
  preserved; Italian mappool assertions now expect comma decimals. Evidence:
  .data/cleanup-20261024/browser-complete and complete-browser.log. Unit tests pass
  355 in 29 files; integration passes 208 in 26 files, including disposable populated
  migration schemas. Production build, types/lint and Prisma validation pass. npm
  audit reports zero vulnerabilities; notices still cover 830 distributions.
  All four bilingual browser cases also pass in development mode (1.1 minutes),
  with evidence in .data/cleanup-20261024/browser-development. Final format checks,
  153 relative links and the tracked-source audit (385 files, zero issues) pass.
  Registry recheck still lists adapter-pg/client 7.10.1;
  the CLI's newer major prerelease does not supply a verified compatible adapter fix.

### Finding Disposition

| Findings        | Result                                                                                                            | Remaining prerequisite or limit                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| F01/F12/F13/F14 | Resolved: uniform guest gates, fresh unsaved CMS, explicit editing context and public allowlists                  | Live target verification remains operator work                                                                    |
| F02             | Resolved: reviewed settings patches and staff/category/stage witnesses                                            | Applied migrations required before installing this source                                                         |
| F03             | Resolved: shared final-plan scheduling and stage pool checks                                                      | Interval conflicts/availability are separate extensions                                                           |
| F04             | Resolved within source and synthetic/filesystem tests: durable outbox, bounded recovery and historical references | Remote timeout/settlement Unverified; existing orphan reconciliation needs a reviewed restored copy               |
| F05             | Resolved: cohesive read/mutation/restoration owners, shared lock retained after measured serialization            | No narrower-lock change without representative contention evidence                                                |
| F06             | Resolved: database ownership/action constraints and fail-closed scoped writes                                     | Existing mismatches cause migration refusal and require reviewed repair                                           |
| F07             | Pagination/export completeness resolved; representative performance tuning **Blocked**                            | Approved representative restored dataset for EXPLAIN/archive RSS; no speculative indexes                          |
| F08             | Resolved: schema/wire coverage, authoritative insertion/deferred references and identity traversal                | Version 1 historical compatibility remains intentional                                                            |
| F09             | Resolved within exercised English/Italian Chromium workflows                                                      | Other engines/assistive technology and non-cancelable browser exits remain bounded verification scope             |
| F10             | Resolved: obsolete pilot/action/reexports and duplicated helpers removed after replacement checks                 | Active CSS, import adapters and complete-cohort readers remain required                                           |
| F11             | Dependency/CI cleanup resolved; Prisma/adapter pg warning **Blocked** upstream                                    | Compatible upstream fix; remote workflow execution, Docker delivery and live providers Unverified in this cleanup |

Work in this order unless the maintainer explicitly reprioritizes. Items marked
conditional are extensions, not already approved commitments or release blockers.

1. **Audit-driven cleanup and regression work (Completed within stated scope).**
   The [finding disposition](#finding-disposition) records resolved work and the
   two named blockers. Resume representative performance work only with an approved
   restored dataset, and adapter warning work against a compatible upstream fix.
2. **Release and deployment verification.** Review the target branch/release,
   back up and restore-test an isolated copy, build consistent web/tools/gateway
   images, run security/license scans and the current regression commands. Obtain
   separate approval for registry publication or live cutover. Apply the missing
   additive migrations and restart only the approved installation.
3. **Live provider smoke checks (Unverified; credential-dependent).** With operator-supplied credentials, verify osu!
   sign-in/state/logout/current profile, uncached metadata and multiplayer evidence,
   remote private S3 read/write/delete/authorization, and optional per-user Bancho
   registration/room creation/dispatch in an authorized disposable lobby. Retain
   sanitized evidence, never passwords/tokens or raw authentication traffic.
4. **Verification debt.** Exercise genuine concurrent-user/database races beyond
   stale-version/transaction tests, additional browser engines, accessibility with
   assistive technology and realistic storage/archive/load sizes. Address existing
   pg concurrent-query warning against the recorded upstream reproduction. The Vite
   native-loader warning was resolved during cleanup.
   Historical one-off visual harnesses may describe obsolete screens; current E2E
   and rollout harnesses are the regression starting point.
5. **Qualifier source adapters (Planned; workbook adapter Blocked on inspected performance evidence).** Inspect a redistributable/synthetic verified
   qualifier workbook layout containing actual individual performances before
   implementing its adapter. Preserve unsupported-sheet reporting. Add native
   lazer Rooms API capture only against documented supported evidence; do not
   repurpose legacy Bancho capture. Qualifier IRC execution remains a separate
   possible integration; copied setup commands work today.
6. **Organizer ergonomics.** Consider a named reusable preset library, interval
   schedule conflicts/staff availability. Current navigation guards include tested
   cancelable Back/Forward; additional engine coverage remains verification work.
   Scheduling conflicts compare identical starts. Do not silently widen bulk status/participant
   edits around historical and referee protections.
7. **Conditional scale/extensions.** Evaluate streamed/offline large archives,
   multi-gateway sharding, bulk match duplication, per-slot notes, custom-map upload
   or mappack generation only with concrete workflows and security review. Arbitrary
   blank bracket graph editing and automatic historical reseeding are not current
   promises. Preserve the supported source-stage/default reuse and existing graph.

## Homepage And Layout Repair - 25 October 2026

Source scope: working tree based on `4c74c4c`, following the maintainer's request
to separate editable Heroes from the persistent profile and widen page layouts.

- Profile name, banner, logo and tabs now belong only to tournament settings.
  Removed homepage reads from the shared public layout and organizer settings
  wrapper, obsolete override warnings, the ContentBlocks forwarding component
  and the mixed home-pilot stylesheet after checking source/test/script callers.
- Homepage renders every visible Hero independently, title-only/image-only
  blocks, explicit buttons even when navigation shares the destination, all
  configured timeline dates and saved page-level rich text. Empty TipTap bodies
  do not create blank panels. Saved content and schema are unchanged.
- Added distinct theme-aware Hero/editorial/image/announcement/button/timeline
  layouts, responsive preview container queries and shared 2560px maximum page
  width. Prose remains bounded; organizer form widths are separate from tables.
  Existing compact mappool dimensions and breakpoints are retained.
- Editor block identity survives reordering; rich bodies remain editable after
  changing type, and rich edits clear obsolete plain-text fallbacks. Existing
  introductions have an editor. Draft save/preview/publish/history remain separate.
- **Verified completed within Chromium scope.** Node 22.23.3 `npm ci`, format,
  lint, types, 355 unit tests, 208 integration tests, source audit and standalone
  production build passed. Final browser evidence: 48 production tests completed
  with Playwright's `status: passed` report and no failed cases; four development
  homepage cases completed with exit 0. A long shell wrapper received SIGTERM,
  but its detached browser runner continued and completed the final report; the
  wrapper interruption is not counted as a completed check. Port 3001 was free
  after the task-owned server shut down.
- Browser coverage includes add/edit/type change/reorder with retained editor DOM,
  draft preview/public isolation, publication, hiding/deletion without changing
  the publication, title-only/image-only/empty rich bodies, all six block types,
  all timeline dates and shared-navigation destinations. Shared profile nodes and
  banner requests remain stable across tabs. Mappool tests retain 64/72px cards,
  one/two/three columns, grouping, hover/details/copy and keyboard/touch behavior,
  including new 2560/3440px cases.
- Rendered evidence covers light/dark, system changes, saved accents, English and
  Italian with authored copy preserved, missing/present artwork, long identity,
  empty/populated pages and mobile preview scrolling. Homepage screenshots cover
  320, 375, 390, 683, 768, 844 landscape, 1024, 1366, 1920, 2560 and 3440px;
  sampled screenshots were inspected. Evidence is in ignored
  `.data/homepage-20261025/development/`, `production-final/` and `checks/`.

No database migration or authored-content conversion is required. No deployment,
service restart or installation-data changes were performed. Provider behavior
and additional browser engines remain outside this UI verification scope; the
previously recorded upstream pg warning is unchanged.

## Matches Management - 28 October 2026

Source scope: working tree after `09a9fc2`. The maintainer requested readable
bracket match IDs, direct organizer results, official osu! imports and a faster
Matches workspace, while preserving Referee Mode.

- Bracket reservations/immutable tournament numbers remain authoritative. New
  source codes are numeric; old codes remain internal compatibility witnesses.
  List/bracket/public/referee labels, room names, dependency/correction warnings,
  scoring warnings and deletion confirmation use readable numbers. Numeric
  referee URL aliases resolve the original record.
- Added one organizer result editor shared by Matches and bracket positions:
  overall scores/winner, FF, external credit, submit/confirm and reviewed reason.
  Explicit external credit appears publicly before assignments without changing
  assignment permissions, and survives multiplayer re-import.
  Existing actions, player/map scores and revisions stay intact. Corrections use
  existing downstream protection, approval, reviewed hash and transaction locks.
  Referee composition and gameplay state transitions were not redesigned.
- Added official multiplayer preview with metadata, player/game evidence,
  red/blue mapping, warmup exclusion, reasoned winner corrections, signed
  continuation and bounded expiring review tokens. Apply retains game provenance
  and a separate overall decision, without fabricated picks/bans or conversion.
  Re-import uses existing unique game identities and no-ops unchanged reviews.
  Public projections omit internal review/audit data and unpublished pool links.
- Organizer matches use 50-row pagination, full filtered search/counts, numeric
  default order and alternate sorts. URL state survives refresh/view changes;
  changing pages/filters clears selection. Inline time/referee edits reuse the
  existing scheduling service. Editors pause polling, guard dirty transitions and
  manage keyboard focus; provider errors remain recoverable. Opening a result
  scrolls to its heading, including on narrow screens with long names.
- Removed replaced scheduling trigger markup and generated-code display suffixes.
  Checked bracket position, import-report and reconciliation links for numeric
  destinations. Retained internal/source IDs and the active referee summary action
  for historical records, workbook compatibility and existing callers.
- **Verified completed within the recorded scope.** Node 22.23.3 `npm ci`, format,
  lint, types, 360 unit tests, 215 PostgreSQL integration tests, source audit and
  standalone production build passed. All 54 production browser cases completed
  with exit 0 and Playwright `status: passed`. After final numeric-link/focus
  corrections, six affected integration cases and 17 affected production browser
  cases completed successfully; these reruns are not additional unique tests.
  Eight development Matches cases and a final narrow-screen focus case also
  completed with exit 0. Earlier failed attempts are superseded by completed
  reruns rather than counted as successful checks.
- New coverage includes reserved match numbers; audited manual/FF results;
  preserved referee records; advancement and protected/stale/foreign corrections;
  manager-only source previews; pinned API score representation and signed
  continuation; unavailable or mismatched providers; corrected/duplicate-safe
  re-import; public credit/history privacy; pagination, cross-page search,
  selection clearing, inline and bulk saves, dirty guards and keyboard focus.
  Existing referee, qualifier and bracket browser workflows passed unchanged in
  operational scope, with numeric labels/links updated.
- Matches screenshots cover light/dark, English/Italian with retained edits,
  long names, 320/375/390/768/1024/1366/1920px, 844px landscape and 683px reflow.
  The full suite also covers system appearance, saved accents, empty/populated
  collections and existing shared/public layouts. Actual screenshots were
  inspected, including the viewport view of the opened editor at 320px.
  Evidence remains ignored under `.data/matches-20261028/`, with final runs in
  `production-complete/`, `production-links/`, `development-complete/`,
  `development-focus/` and logs in `checks/`.

No migration or installation-data conversion is required. No deployment or live
service restart was performed. Live osu! availability/credentials were
not exercised: provider payloads were mocked, browser sessions were synthetic and
IRC coverage used the existing mock Bancho harness. Additional browser engines
and a live osu! import smoke test remain unverified. The existing upstream pg
concurrent-query warning is unchanged; synthetic empty-avatar warnings were also
observed without browser-test failures.

## Organizer Workspace Corrections - 28 October 2026

Source scope: working tree after `3b5beb4`. The maintainer requested generated
deletion, fast inline results, reliable MP reconstruction and contextual suggestions.

- The existing Delete action now retains generated Match records, child history,
  revisions, the bracket relation and immutable number. A deleted node produces no
  output or replacement fixture. Reviewed unstarted downstream changes can retract;
  protected gameplay, frozen seeds, stale versions, legacy references and uncertain
  room requests remain guarded. Deleted history is filterable and can be reopened
  through the established manager workflow. Public projections exclude it.
- Scores themselves open a compact row/card editor for scores, winner and FF.
  Notes/credit are optional; partial scores stay in progress and a winning score
  confirms through the existing audited result service. One editor retains values
  across responsive hosts and language changes, with dirty/busy guards. Removed
  the old expanded manual result form and redundant Result action.
- MP teams resolve through roster osu! IDs and substitutes, independently of
  usernames/colors. Historical available player scores produce actual team totals
  and map wins, including maps outside a published pool. Unknown/shared identities,
  ties and unsupported evidence expose review. Warmups explicitly default to zero;
  ordinary unambiguous imports apply directly. Signed complete evidence supports
  local recalculation, corrections and duplicate-safe re-import; game provenance
  remains separate from referee picks and private review payloads. Changing warmup
  counts preserves reviewed winners/reasons. Link-only saving remains available
  through the same pane and established lobby action.
- Suggestions now open inside the pool editor, with search/category/status/skillset
  and stage filtering, metadata/feedback previews, acceptance and slot assignment.
  Existing selection permissions, artist/replacement rules and revision checks
  remain authoritative. Assignment first saves pending pool edits; a later rejected
  selection does not discard that saved draft or publish it.
- Removed the blanket bracket-deletion rejection and obsolete copy after checking
  callers. Added the explicit deletion date to archive coverage/restoration, while
  keeping old archives compatible. A first-click List/Bracket race found by the
  qualifier browser flow was fixed by persisting filter URLs only on actual edits.
- **Verified completed within recorded scope.** Node 22.23.3 lockfile installation,
  formatting, lint, types, 363 unit tests, 219 PostgreSQL integration tests, source
  audit and standalone production build passed. Four affected route/database cases
  reran successfully after the final warmup-correction fix; reruns are not extra
  unique tests. Import issue literals are also covered by the locale catalog check.
- All 56 final production Chromium cases passed with exit 0 and Playwright
  `status: passed`, including existing Referee Mode, qualifier, bracket, public
  pool and fresh-workspace flows. This supersedes the earlier 55-pass/one-failure
  run that exposed the missing link-only action. Development evidence includes
  17 passing cases from the initial run and five successful targeted cases after
  correcting a feedback assertion and the first-click navigation race. Failed
  attempts remain in ignored logs and are not counted as completed verification.
- Regression scope includes stale/foreign/unauthorized deletion, protected
  downstream history and uncertain IRC requests, no regeneration or renumbering,
  archive round trips, partial/manual/FF results, frozen-roster preservation,
  ID/substitute/color-independent reconstruction, zero/explicit warmups, retained
  winner corrections, ambiguous player mapping, default immediate imports,
  duplicate-safe history and link-only saving. Contextual suggestions exercise
  filters, metadata/review previews, actual assignment, pending notes preservation
  and unchanged publication through existing services.
- Rendered coverage includes light/dark, English/Italian, long names, empty and
  populated/filter-empty states, 320/375/390/768/1024/1366/1920px, 844px landscape
  and 683px reflow. Dirty score/note values survive responsive host and language
  changes. Actual screenshots were inspected for inline rows, narrow controls,
  suggestions and ambiguous mapping. Final evidence lives under
  `.data/workspace-fixes-20261028/production-final/`, `development-final/`,
  `development-rerun/` and `checks/`.

Deployment requires the two additive migrations listed above before this source
runs. No installation data, live services or deployment was changed. Provider
responses and sessions are synthetic; a live osu! MP import and additional browser
engines remain unverified. Evidence stays ignored in
`.data/workspace-fixes-20261028/`; the existing pg warning and synthetic empty-avatar
warnings are retained rather than suppressed.

## Bracket Management - 29 October 2026

Source scope: working tree after `01971b2`. The maintainer explicitly clarified
that whole-bracket deletion must erase its match histories and allow recreation
from match 1. This supersedes the initially proposed retained parent lifecycle.
Individual generated-fixture deletion/restoration still retains its own history.

- Bracket cards now show readable seeds, sides, scores/FF, winners, state and
  schedule/progression, with accent selection and connected round headings.
  Search, round navigation, keyboard/drag scrolling and zoom/reset/fit work in the
  existing public and organizer views; mobile uses a bounded round list.
- The selected position opens an adjacent/below-canvas editor for scores/winner/FF,
  MP import, schedule, referees, slots and progression. Existing domain operations
  remain authoritative. Container-based result layout avoids narrow side-panel
  columns; responsive/language changes retain edits and selection changes respect
  dirty/busy state. Referee Mode keeps its existing composition.
- Explicit Regenerate Match restores the same retained fixture/number/status and
  frozen configuration, with events/revisions and current progression checks.
  Recorded rosters and protected downstream matches cannot be replaced. Missing
  generation only creates ready absent records; intentional deletions stay deleted.
- Whole-bracket deletion requires both management and deletion permissions,
  reviewed versions/impact, exact-name confirmation and an acknowledgement for
  played histories. Active gameplay, uncertain room creation and external
  match/route/seed dependencies block it. One transaction removes graph rows,
  matches and child histories; associated audit payloads are removed and shared
  schedule receipts retain unaffected entries. Only a minimal deletion receipt
  remains, without scores or referee history.
- Numbering restarts at 1 only when no other matches or reserved node numbers
  remain in the tournament. Otherwise unrelated IDs and the high-water allocation
  remain unchanged. Preview explains the applicable behavior. Rebuild keeps the
  reviewed configuration in the generation form, permanently deletes the old
  bracket, refreshes registration-based seed order, then previews/creates a fresh
  unpublished graph. Qualified-source validation remains explicit. Failed/canceled
  generation cannot recover the purged history.
- Removed the unused compatibility component alias, obsolete position modal
  wrapper and the intermediate whole-bracket history view. No Markdown file was
  added. The first new migration was already applied to the isolated test database
  before the clarified deletion contract; it is preserved unchanged and followed
  by a compensating migration. Final Bracket schema has no deletion marker.

Verification completed against the isolated test database and synthetic sessions:

- Node 22.23.3 lockfile installation, Prisma generation/migrations, formatting,
  lint, types, production build and the source audit passed. The audit includes
  all 406 working-tree files, including the untracked additions, with zero issues.
  All 363 unit tests in 30 files passed. Initial sandbox-blocked socket tests were
  rerun successfully with their local mock listeners permitted.
- All 226 PostgreSQL integration tests passed in completed serial batches:
  27 bracket cases and 199 cases in the other 26 files. The earlier combined
  process ended with signal 143 after printing results and is not counted as
  successful verification. Completed batches replace that interrupted witness.
- All 57 production Chromium cases passed in completed serial batches of
  18, 23 and 16, each with exit 0. This includes mock IRC, guided BO9, collaboration,
  forfeits, qualifier workflows, public pages, transfers and the existing Matches
  and MP workflows. The initial combined browser run lacked the synthetic MP
  signing key, skipped optional IRC and also ended with signal 143; it is retained
  as failed evidence rather than counted. The final batches provide the test-only
  signing key and a random mock-gateway secret, without live provider access.
- The final development bracket flow also passed. Its actual interactions verify
  inline scheduling/referees, locked positions, FF, canceled dirty selection,
  retained values across language/responsive changes, explicit fixture restoration,
  permanent history removal, refreshed registration seeds, recreation from match 1
  and the final empty state. Additional database cases cover stale/foreign/permission
  denial, missing repair, protected downstream history, uncertain room creation,
  unaffected numbering, FK child cleanup, shared audit cleanup and archive exclusion.
- Rendered checks cover light/dark, English/Italian, 320/375/390/683/768/844/1024/
  1366/1920px, plus existing ultrawide/shared appearance cases. Actual screenshots
  were inspected for desktop/public brackets, the compact side editor, the Italian
  320px result form, the permanent-deletion confirmation and the empty bracket.
  Evidence lives in `production-a/`, `production-b/`, `production-c/`,
  `development-complete/` and `checks/` under
  `.data/bracket-management-20261029/`. Earlier retained-parent screenshots do not
  certify the clarified permanent deletion contract.

Apply the two new migrations through the normal install workflow before this
version runs. No installation data, live services or deployment was changed.
Live OAuth/osu! MP/Bancho and additional browser engines remain unverified; the
upstream pg concurrent-query warning remains visible.

## Double-Elimination Presentation - 29 October 2026

Source scope: working tree after `48f8b5d`. This is a presentation change: native
generation, stored lane keys/routes, seeds, match numbers, reset eligibility,
confirmation, correction, deletion and audit services remain unchanged.

- Extracted display grouping/coordinates/labels to the client-safe
  `bracket-presentation.ts`. DE renders exactly Winners Bracket and Losers Bracket
  path headings, with their finals aligned in the last path column. Grand Finals
  and reset sit together to the right between those path finals; there is no
  third Finals section. Only same-path connectors remain.
- Pending slots use readable Winner/Loser of Match # references; actual resolved
  participants replace those labels. Reset slots use conditional Grand Finals
  loser/winner references, preserving their original sides and color/history meaning.
  Byes, unavailable numbers, deleted fixtures and unused resets retain honest states.
- Competition read queries project the configured stage name, without adding
  stage rules or pool drafts to public results. Stage names are primary in headers,
  navigation, round tools, creation previews and the inspector; Finals/reset roles
  remain secondary. Authored names stay unchanged across English/Italian switches.
- Preserved selected-node editing, search, width-fit/zoom, contained panning and
  mobile round navigation. Removed the old independent Finals-band layout,
  unconditional all-route SVG rendering, generic lane-number captions and their
  unused count translations. Stored round names and archive fields remain intact.
- Added semantic presentation regressions for DE2/4/8/16/32/128, configured reset
  variants, exact two-path grouping, connector boundaries, shared-ending alignment,
  stage names, pending/resolved/reset labels and unchanged input witnesses.
  Browser cases complete real persisted DE8 brackets both with and without a
  played reset, and compare database graph/history witnesses before/after viewing.

Verification on Node 22.23.3:

- `npm ci`, Prisma generation, format, lint, route generation/TypeScript and the
  production build passed. The source audit includes both new TypeScript files
  and reports 408 source files with no issues; `git diff --check` passed.
- All 375 unit tests in 31 files passed, including 12 new presentation cases.
  The competition/tournament integration suites passed 35 tests in two files;
  the public visibility suite passed four more, using isolated PostgreSQL only.
- Production Chromium passed 29 distinct cases: 12 competition, 10 Matches/bulk
  editing and seven Referee Mode cases, including mock IRC. After the final reset
  captions and exact-number search correction, the affected three bracket cases
  passed again in both development and production. These reruns are not counted
  as additional distinct cases. The initial development run's search failure
  exposed matches referenced by pending slots taking priority over their exact
  number; Enter now selects the exact numeric match first.
- Both DE8 cases complete every required persisted match, with 14 played matches
  for a skipped reset and 15 for a played reset. They verify two sections, 11
  same-path connectors, aligned path finals, configured stage headings, conditional
  numbered references, resolved public participants and unchanged graph/history
  witnesses after viewing. Editor scheduling, referee assignment, positions,
  results, deletion/restoration and rebuilding remain covered.
- Captured and inspected light/dark screenshots, English/Italian interface states,
  empty/populated and completed/unused-reset states. Responsive checks cover
  1920, 1366, 1024, 844 landscape, 768, 683, 390, 375 and 320px widths, contained
  canvas scrolling, repeated Fit stability and the mobile round list.

Evidence and command logs remain ignored under `.data/bracket-layout-20261029/`.
Interrupted checks were not counted as passes. Browser coverage is Chromium;
OAuth, osu! and Bancho use synthetic/local mocks rather than live provider
verification. Existing pg concurrent-query and synthetic avatar warnings remain
visible. No migration or installation-data conversion is required; no deployment
or live service change is part of this work.

## Bracket Generation And Stage Numbering - 30 October 2026

Source scope: working tree after `527bdd7`. New generation follows stage progression
instead of numbering all Winners rounds before all Losers rounds. Existing graphs,
match IDs/numbers, histories and immutable SQL triggers remain unchanged.

- Added a client-safe stage ordering/suggestion owner. Explicit Next stage links
  take precedence over position, with deterministic ordering for unrelated stages.
  Suggestions cover all elimination segments, shared finals/reset, third place,
  limited-stage configurations and groups, without parsing authored names.
- Preview and creation share stage validation, forward dependency checks and
  numbering order. Stage ranks precede Winners/Losers lane and native round/node
  positions. RO16 reserves Winners 1-8 then Losers 9-12 before the next stage;
  actual ranges continue from the current tournament counter, exclude byes and
  include conditional reset reservations. Manual linking allocates no numbers.
- Creation preview shows editable Automatic/override selectors and numeric range
  cards in generation order, refreshing after edits. A reviewed hash rejects
  stale stage/rules/source/counter state before writes under the established
  advisory-lock/counter-row-lock order. Generation-key retries remain idempotent.
- Removed the old unconditional stage inheritance and round-first numbering
  comparator. Rebuild preserves the former rounds' actual stage assignments;
  existing archives/configuration and historical numbers are not recalculated.
  Rebuild forms refresh suggestions when entrants change and discard unavailable
  stage selections so retired configuration cannot block the new preview.

Verification on Node 22.23.3:

- Locked `npm ci`, Prisma generation, format, lint, route generation/TypeScript,
  production build and `git diff --check` passed. The source audit covers 409
  source files, including the new stage owner, with no issues.
- All 384 unit tests in 31 files passed. New cases cover literal DE16 ranges,
  multiple Losers rounds, explicit links overriding display order, stage caps,
  overrides, third place/groups, byes and reset/no-reset variants through DE128.
- All 46 PostgreSQL tests in competition, lock, tournament-transfer and public
  visibility suites passed. Coverage includes matching preview/persisted ranges,
  stale counter/stage witnesses, suggested-stage eligibility, forward dependencies,
  idempotent generation retries, immutable existing numbers, manual linking and
  archive/history compatibility.
- Production Chromium passed all 14 competition cases, followed by three focused
  final cases after the rebuild fix. Those three also passed in development.
  This covers 15 distinct production cases; repeated cases are not counted twice.
  Two concurrent reviewed requests produce one graph and one stale rejection;
  refreshing the latter then reserves the next nonoverlapping sequential range.
- Browser interactions exercise Automatic/override updates, preserved selector
  focus while rows reorder, stale-review recovery without lost form values,
  exact generation ranges, a complete DE8 reset, public numeric placeholders,
  old-match histories, permanent rebuilds and regeneration. The new rebuild case
  removes former entrants and retires a former stage, then creates the smaller
  bracket with fresh valid suggestions and numbers 1-3.
- Captured and inspected preview/range screenshots in light/dark, English/Italian,
  desktop and narrow mobile layouts. Checks cover 1920, 1366, 1024, 844 landscape,
  768, 683, 390, 375 and 320px, including contained modal scrolling and wrapped
  action controls. Required field hints use the shared accessible Field contract;
  participant fieldsets explicitly allow shrinking at narrow widths.

Evidence and command logs remain ignored under `.data/bracket-generation-20261030/`.
Early runs exposed a stale private test DB address, sandbox socket restrictions,
field-label/mobile containment regressions and a wrong Italian test selector;
the final runs above passed after correction. Failed/interrupted runs are not
success evidence. Tests use the guarded isolated database at the existing QA
container's current address; no service was restarted and no private configuration
file was rewritten. Browser coverage is Chromium with synthetic sessions/providers;
live OAuth/osu!/Bancho remain unverified. The upstream pg concurrent-query warning
remains visible. No migration or installation-data conversion is required; no
deployment or installation-data mutation is part of this work.

## Shared Qualifier And Registration Workflows - 30 October 2026

Source scope: working tree after `c333383`. Implementation is complete; provider
behavior is verified with isolated synthetic fixtures, within the scope below.
No deployment or installation-data mutation is part of this work.

- Found the empty-session crash: qualifier command generation received zero
  players even though the shared command builder requires 1-16. Replaced the
  team-at-a-time next-score model with shared map/run progress.
- Extended the existing IRC panel, tickets, gateway authorization and durable
  uncertain-room request infrastructure to qualifier contexts; no dummy matches
  or separate Bancho client. Normal match refereeing keeps its existing contract.
- Added an additive workflow migration for registration policy/private answers,
  separate public rejection/private notes, session booking capacity and durable
  qualifier game evidence. Applied migrations and existing histories are retained.
- Native registration and captain booking use the existing OAuth identities,
  roster writer, qualifier assignment/capacity/schedule helpers and root lock.
  New website/import registrations auto-approve without new role grants.
  Registration configuration exposes deadlines, roster limits/locks, rank/country
  eligibility and private required/custom fields. Existing external links remain
  an explicit configuration mode.
- Live capture and external/bulk imports share canonical score conversion,
  provenance and auditing. All four seeding methods/run policies retain their
  statistical owner and formula version. Shared-map completeness is independent
  of team ordering; genuine zero and missing evidence remain distinct.
- Qualifier sessions expose contextual assignment/removal and booking controls.
  Captains reserve/move/cancel existing sessions with root-lock serialization,
  policy/team/session witnesses, capacity and conflict checks. Played entrants and
  completed sessions retain history; explicit active-session overrides are audited.
  Registration edits retain their original witness across booking refreshes.
- Stage-selected bulk MP previews retain full paginated histories, player/roster
  attribution, explicit warmup counts, retries, exclusions, individual/team values
  and corrections. Multiple links can continue one session/run sequence. Partial
  histories never apply; provider failures retain other sources' checkpoints.
  Re-import preserves manual corrections unless replacement is explicit. Pending
  game evidence blocks confirmation/finalization; finalized seeds feed native brackets.
- Removed the old redirect-only registration route and duplicate qualifier capture
  writer. Added explicit scoped ownership/archive coverage for new provenance,
  reviewed IRC context FKs/checks and backward defaults for older version-1 archives.
  No historical migration or statistical witness was rewritten.

Checks actually run:

- Node 22.23.3 with npm ci; Prisma generation, format, lint, types and production
  build passed. The source-tree audit includes new untracked source and reports no
  private/generated source issues. No new Markdown document was created.
- 387 unit tests in 31 files passed, including existing IRC socket/security tests,
  all seeding methods/run policies, shared map progress and catalog/archive coverage.
- 239 PostgreSQL integration tests in 28 files passed sequentially. Coverage includes
  concurrent capacity-one booking, captain ownership, eligibility/deadline/roster
  locks, auto approval/private answers/public rejection, shared scoring for genuine
  two-player teams despite mixed lobby colors, multiple MP sources/runs, pagination,
  provider-error continuation, missing/zero scores, re-import/manual corrections,
  source history/archive round trips and finalized seedings feeding a native bracket.
- 20 distinct production Chromium cases passed: five connected qualifier workflows
  plus 15 existing referee, standings, localization and stage cases. The five new
  cases also passed in development. Website registration/import/synchronization
  use real application HTTP routes and PostgreSQL; only the upstream osu! fetch
  boundary and Bancho are synthetic. IRC linking triggers automatic API scoring
  without an approval step. Normal BO9, pick/ban, collaboration, permissions,
  confirmation and forfeit workflows retain their regression coverage.
- Captured and inspected light/dark, English/Italian, empty/populated and modal
  evidence. New qualifier layouts cover 1920, 1366, 1024, 844 landscape, 768, 683,
  390, 375 and 320px; narrow map selection reaches horizontally contained actions.
  Fixed a whole-column sticky gap, selected-map/status disagreement and clipped
  text actions found during rendered verification.

Evidence is ignored under `.data/qualifier-workflow-20261030/`. Earlier runs exposed
stale generated Next route types, sandbox socket restrictions and outdated team/test
selectors; failed or interrupted checks are not success evidence. The additive
workflow migration was applied only to the guarded isolated test database. Operators
must apply it through the existing installation/update workflow before using this
source. No live service was restarted, no image was published and nothing was pushed.

Live OAuth, osu! and Bancho remain unverified; native lazer Rooms API capture remains
outside current support, with the existing standardized manual path retained. Browser
coverage is Chromium, not every browser/provider combination. The existing upstream
pg concurrent-query deprecation warning remains visible. Next operational work is
the operator-controlled update and live-provider verification described in ARCHITECTURE.

## Qualifier Reliability And Compact Workflow Audit - 30 October 2026

Scope: follow-up to `7d0eaeb`, covering qualifier management, capture/import,
completion, booking and results. The normal head-to-head referee composition and
state machine remain under their existing owners.

- Added manager-only single/bulk session deletion with reviewed versions and
  confirmation. Deletion removes operational/booking visibility, retains histories,
  blocks active/uncertain/finalized sources and never closes Bancho. Deleted sessions
  have an explicit read-only list filter. Existing sessions have inline identity,
  notes, schedule/staff editing and the established bulk assignment/scheduling tools.
- Individual imported rule violations retain raw/mod/provenance rows and exclusion
  reasons; valid simultaneous players continue. Team FreeMod checks, progress and
  standings share eligibility semantics. Bulk overrides/exclusions keep before/after
  history, refreshed authorization, session witnesses and existing lock order.
- Repaired accepted partial games: late player scores merge through the canonical
  writer; source revisions preserve old evidence, corrections and intentional
  removals. Stable re-imports avoid version churn. Reviewed run/map replacement
  removes old linked rows atomically; completed preview refreshes retrieve late
  provider data without discarding partial/failing-source checkpoints.
- Imported/live sessions complete when each expected entrant has an eligible full
  run under the selection policy. Optional second runs can continue, partial data
  stays Playing, and removing required evidence resumes Playing. Completion does
  not close IRC or finalize seeds. New calculation version 2 supports these rules;
  finalized version-1 hashes/formulas remain intact until controlled reopening.
- Reworked qualifier UI around compact rows, inline scores, contextual bulk actions,
  exception review and disclosures. Removed the superseded single-score dialog.
  Captain booking has stage/availability filters and a collapsed existing roster.
  Imports have a direct action, explicit warmups and advanced diagnostics; stage
  policy explains run eligibility. Results share scoped navigation, dense standings
  and the existing controlled finalization workflow. Untouched identity/schedule
  forms follow polling while dirty forms retain their reviewed version.
- Reviewed scoped ownership, SQL/FK behavior, archive allowlists/defaults, public
  projections and restoration witnesses for the additive
  `20261030020000_qualifier_eligibility_lifecycle` migration. Applied it only to the
  guarded isolated test database. Normal `./portal install` applies it on update.

Resumed audit on 1 November 2026 verified the interrupted work against the full
request. It also closed the optional-run deletion gap: completed sessions with
pending games or incomplete provider history cannot be deleted into a read-only
state. The UI and backend share that protection; regression coverage uses actual
automatic synchronization to finish the second run and then permits deletion while
preserving all four scores and both game receipts. Inline row/filter discard guards,
untouched schedule witnesses, keyboard scrolling, semantic warning contrast and
standings announcements were checked together. Bulk selection labels now describe
the actual selectable session scope.

Verification on 1 November 2026, against the uncommitted follow-up to `7d0eaeb`:

- Node 22.23.3 with the existing lockfile installation; Prisma generation, format,
  lint, generated route types, TypeScript and production build passed.
- 393 unit tests in 31 files and 242 PostgreSQL integration tests in 28 files
  passed. Integration suites ran sequentially against the guarded isolated test
  database. Coverage includes transactional deletion rollback, pending optional
  runs, eligibility overrides, late scores, intentional removals, historical
  calculation witnesses, booking conflicts and tournament isolation.
- 25 distinct production Chromium cases passed: eight connected qualifier cases,
  two bulk-management/seeding cases and 15 existing referee, standings,
  localization and stage regressions. The eight qualifier cases also passed in
  development. Actual application HTTP routes and PostgreSQL cover empty-session
  access, inline/bulk edits, registration/rejection, booking, shared-player score
  capture, Freemod exceptions, automatic completion, optional runs, audited
  corrections, duplicate-safe imports, publication and finalized seedings feeding
  a native bracket. Existing head-to-head referee coverage remained successful.
- Captured and inspected English/Italian, light/dark and empty/populated layouts.
  Session, booking, configuration, import, exception and standings evidence covers
  desktop and narrow mobile, including 1920, 1366, 768, 390 and 320px; session
  layouts also cover 1024, 844, 683 and 375px. Verified keyboard access to the full
  public score column within its horizontal container.
- Source audit inspected 432 files with no issues; no new Markdown files were
  created. Evidence is ignored under `.data/qualifier-audit-20261030/` and
  `.data/qualifier-*.log`. Earlier failed/interrupted runs are not passes.

The additive migration was applied only to the isolated test database. Operators
must run the normal `./portal install` update before using this source. No live
installation data was changed, no service was restarted and nothing was pushed.
Browser upstream osu! responses and Bancho are synthetic: live OAuth, osu! API
and Bancho behavior remain unverified. Native lazer Rooms API capture retains its
existing manual fallback. Chromium coverage does not establish other browser or
provider behavior. The existing upstream pg concurrent-query deprecation warning
remains visible; operator-controlled live-provider verification is the next
operational step.

## Historical Qualifier Capture Repair - 1 November 2026

Follow-up to `71ca4af`: a reported historical multiplayer session showed pre-start
warnings for every game in Referee Mode. The bulk importer used historical parsing,
but subsequent capture/synchronization used the later website START boundary.
The older writer also rejected an entire game for one missing NoFail score and
stopped the source loop, explaining why older partial imports ended at Freemod.

- Shared parsing now recognizes the exact multiplayer/game pair in server-recorded
  import provenance. Normal live games retain their timestamp checks, including
  other games in the same room and identically numbered games from another room.
- Synchronization resumes retained historical receipts and audits recovery of an
  automatic pre-start exclusion. Explicit import/game exclusions, corrected scores,
  intentional removals, source ownership and existing locks/version checks remain.
- Public-page inspection confirmed two 13-map runs and 104 individual scores in the
  reported history. A read-only local projection of its legacy score fields found
  two missing-NoFail performances, rather than missing provider games. Raw evidence
  remains ignored under `.data/qualifier-mp-diagnostic-20261101/`; it is not shipped
  as production content or a test fixture. Authenticated live API behavior was not
  verified.

Verification on Node 22.23.3: all 394 unit tests in 31 files, 20 qualifier workflow/
capture PostgreSQL tests in two files and eight production Chromium qualifier
cases passed. The historical import/capture case also passed in development. New
checks cover both runs, isolated NoFail exclusion, idempotence, recovery of wrongly
classified receipts, explicit exclusion preservation and the live timestamp guard.
Format, lint, route generation/TypeScript, production build, `git diff --check` and
the 432-file source audit passed. Earlier failed attempts are not success evidence.
Browser/API tests use synthetic provider responses and the isolated test database;
only the reported public page was retrieved live. No schema or new migration is
required, and no installation data has been changed. Changes remain local pending
an authorized commit/push and operator-controlled installation update.

## Scoring Accuracy And Platform Editing Overhaul - 2 November 2026

Verified working tree based on `276f142` (source fingerprint
`e19b5b3540acffa4779fb7245f24da6493437f5b215036d28996252e669dcb70`). The maintainer explicitly changed the
completion contract: played, valid and counted are independent; excluded observed
scores do not erase a played map. Historical finalized witnesses remain immutable.

Completed implementation and verification:

| Area                            | Required delivery                                                                                                                                                            | State    |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Scoring                         | Canonical configurable normalization/rounding, failed-score and Freemod validation, played-run completion, versioned historical compatibility                                | Verified |
| Reference reconciliation        | Read-only comparison of all 22 teams, both Freemod maps and explicit ignored performances; private evidence only in ignored `.data`                                          | Verified |
| Corrections                     | Inline/bulk include, exclude, restore, revalidate, remap and reprocess with cohort impact preview and audited versions                                                       | Verified |
| Registration / booking          | Independent public pages, API/service ownership, statuses and deadlines; shared transactional capacity/identity safeguards                                                   | Verified |
| Tournament / settings / access  | Creation, branding, roles and configuration with contextual editing and useful batches                                                                                       | Verified |
| CMS / navigation / media        | Direct editing, discoverable save/publication, block batches and retained drafts                                                                                             | Verified |
| Teams / rosters / staff         | Inline management, selected-row batches and protected historical rosters                                                                                                     | Verified |
| Stages / pools / suggestions    | Compact contextual rules, maps, playtesting and mod configuration; preserve public pool geometry                                                                             | Verified |
| Matches / brackets / scheduling | Preserve gameplay and existing inline tools; consolidate organizer actions and validate bulk/version behavior                                                                | Verified |
| Verification / cleanup          | Full affected unit, isolated DB and development/production browser gates, inspected responsive/theme screenshots, build/static checks, obsolete-code removal and owning docs | Verified |

The evidence below covers the current source snapshot. No deployment, installation
data mutation, source publication or new Markdown document was performed.

Implementation evidence:

- One qualifier score owner handles mode-specific native normalization, tournament
  multipliers, exact per-player rounding, failed/unverified performances and rule
  decisions. V3 separates played runs from counted maps; finalized V1/V2 witnesses
  keep their original owner/hash, including after nullable schema additions.
- All 22 reference teams and seeds reconcile across 13 maps. The private harness
  projects 960 sheet-filtered rows plus two excluded Tornado performances through
  the canonical score/standings pipeline. Maximum Z-Sum difference is
  `7.105427357601002e-15`. This verifies mathematics against the sheet's eligibility
  selection; the sheet strips NF and cannot independently verify that provider fact.
  FM1 is 502,812 raw / 467,954 normalized. Ignored game `641899348` contributes no
  counted FM2 score; the valid replay is 182,411 raw / 159,264 normalized. Raw
  excluded observations remain evidence and complete played maps.
- Score management is shared by session and stage pages, with direct raw/mod/pass
  editing, useful selection batches, whole-cohort previews and durable remapping.
  Revalidation retains explicit and matching historical audited decisions; restore
  deliberately clears them. Stage reprocessing includes retained historical sources
  without modifying raw receipts or lifecycle. Finalized stages remain locked.
- Registration and Booking have separate pages, API/service owners, DTOs, settings
  and witnesses. Legacy booking actions delegate for compatibility. Registration
  deadlines/custom fields do not invalidate booking; reservation cancellation leaves
  the registration/roster/version unchanged.
- Collection editing uses contextual panes across tournament creation, access,
  teams/staff, stages, pool maps/configuration/releases/reviews, suggestions,
  scheduling, bracket rounds and qualifier session forms. Existing inline/bulk
  workflows remain. New team identity/status batches, user-role batches and CMS
  section batches remove repetitive work. Roles use compact rows and permission
  copying with stale configuration checks. CMS history/unpublish are direct actions.
  Team identity drafts survive background collection refreshes; filtering/paging
  requires explicit discard, and saves retain the original version witness so a
  concurrent batch update rejects stale edits without erasing the draft.
  Tournament settings/branding/navigation/media retain their existing direct forms,
  protected assets, private previews and independent publication behavior.
- Cleanup removes obsolete CMS Page options and the superseded organizer exception
  editor. Assigned referees retain compact read-only diagnostics; historical wire
  actions and immutable calculation versions remain deliberate compatibility paths.
- Two additive migrations add score decision/pass evidence and independent booking
  configuration. Both were applied only to the isolated test database. Normal
  `./portal install` applies them; neither backfills/recalculates official results.

Verification completed on the isolated test database, sequentially for database and
browser suites:

| Check                        | Evidence and scope                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Locked dependencies / schema | Node 22.23.3, `npm ci`, Prisma generate; both additive migrations applied to `tournament_platform_test`, 20-migration ledger current                                                                                                                                                                                                                                               |
| Static / production          | Format check, ESLint, route type generation / TypeScript, `git diff --check` and the default Turbopack production build passed                                                                                                                                                                                                                                                     |
| Unit                         | 407 tests in 32 files; all four scoring methods, run policies, exact normalization, played versus valid/countable runs, V1/V2 hash compatibility and locale catalogs                                                                                                                                                                                                               |
| PostgreSQL                   | 247 tests in 28 files; tenant and permission boundaries, stale/atomic corrections, remap plus re-import, restoration/revalidation, finalization locks, captain races, registration independence, archive round trips and existing bracket/referee histories                                                                                                                        |
| Production Chromium          | All 71 unique scenarios covered: the complete run passed 70; the remaining editor test had an obsolete assertion expecting platform permissions in a tournament-role form. The corrected test verifies their omission and passed its targeted rerun                                                                                                                                |
| Development Chromium         | All 18 qualifier/referee/workspace scenarios covered: 17 passed the suite run, and the same corrected editor case passed its targeted rerun                                                                                                                                                                                                                                        |
| Reference sheet              | All 22 teams / 13 maps / seed order match; maximum Z-Sum discrepancy `7.105427357601002e-15`, with excluded raw Tornado observations retained                                                                                                                                                                                                                                      |
| Visual / interaction         | New editor screenshots at 1920/1366/768/390/320 in both appearances; 15 workspace views, empty/populated records, dirty cancel, team/CMS/user batches, role copying and stale-save rejection. Existing public-pool gates also cover 2560/3440. Inspected panes, compact roles, qualifier exceptions, mobile and theme outputs; desktop pane bounds now have a regression assertion |

Final logs and source manifest are in ignored `.data/zsum-comparison-20261102`:
`unit-complete.log`, `integration-complete.log`, `build-handoff.log`,
`browser-production-final.log`, `browser-production-workspace-final.log`,
`browser-development-final.log`, `browser-development-workspace-final.log`,
`browser-inline-handoff-1.log`, `browser-inline-handoff-0.log` and
`source-witness.json`. Real sheet/MP data, comparison scripts and rendered screenshots
remain private QA artifacts. No live installation or tournament data was modified.
The final inline-editor regression passed in both production and development,
including canceled filter discard, background refresh and stale-save draft retention.

Provider limits: browser sessions use explicit synthetic database fixtures, osu!
fetches use the guarded fixture boundary and IRC uses mock Bancho TCP. These verify
real application routes, persistence and protocol integration, not live OAuth, osu!
API availability or live Bancho behavior. The sheet comparison proves the canonical
mathematics against its recorded eligibility; it cannot reconstruct stripped NF
provenance. Native lazer Rooms capture remains the previously documented limitation.

Operator handoff: normal `./portal install` applies the two migrations. Existing
saved normalization/rule decisions are preserved until reviewed reprocessing.
For the reference sheet, choose native bonus removal, no additional tournament
multiplier and per-player floor rounding; review excluded FM2 and other exceptions
against the configured rules. Finalized seedings require controlled reopening before
source corrections. Head-to-head Referee Mode, public pool geometry, historical
snapshots, permissions and bracket numbering/progression remain covered by the gates.

## Completion Rules

For each change: establish source behavior, implement within existing ownership
boundaries, add risk-scaled tests, update the owning canonical docs, and record
actual checks and limitations here. A future feature is complete only when its
contract in SPEC works end-to-end with persistence, authorization and failure cases.
UI work also needs rendered evidence under [DESIGN.md](DESIGN.md#verification).
Deployment commands and recovery procedures remain in ARCHITECTURE, not duplicated
into release-specific guides. The baseline counts above are not a permanent target
and must not be relabeled as newly executed tests.
