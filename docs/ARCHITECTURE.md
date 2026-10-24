# Technical Architecture

## Scope And Source Map

This is the implementation, security, development and operations reference.
Requirements are in [SPEC.md](SPEC.md), ordered status/evidence in [PLAN.md](PLAN.md),
visual contracts in [DESIGN.md](DESIGN.md), and working rules in
[AGENTS.md](../AGENTS.md). Code/schema/lockfile remain executable truth; update this
document when those contracts change. Examples are not proof of live verification.

### Navigation

- Core: [topology](#process-and-network-topology),
  [routing/context](#request-routing-and-tournament-context),
  [API contracts](#api-and-mutation-contracts),
  [database ownership](#database-and-tenant-isolation),
  [authentication](#authentication-and-access).
- Domain: [CMS](#cms-and-publication), [pooling](#pool-planning-ordering-and-release),
  [matches/brackets](#match-state-numbers-and-brackets),
  [qualifiers/scoring](#qualifiers-scoring-and-standings),
  [workbooks](#workbook-and-multiplayer-interoperability).
- Integrations: [osu! metadata](#official-osu-metadata), [media](#media-and-storage),
  [archives](#tournament-archive-protocol), [IRC](#optional-irc-gateway).
- Operations: [configuration](#deployment-and-configuration),
  [network safety](#network-safety), [updates](#updating-and-release-cutover),
  [adoption](#existing-schema-adoption), [backups](#backups-and-recovery),
  [troubleshooting](#troubleshooting).
- Engineering: [development/tests](#development-and-tests),
  [boundaries and proposed cleanup](#implementation-boundaries-and-proposed-cleanup),
  [security/contribution/license rules](#security-and-distribution).

| Layer          | Implementation                                                                      |
| -------------- | ----------------------------------------------------------------------------------- |
| Web            | Next.js App Router, React, TypeScript; `src/app`, `src/proxy.ts`                    |
| UI             | Tailwind CSS, Radix primitives, Lucide, reusable local controls; `src/components`   |
| Domain         | Pure validation/calculation modules and transactional services; `src/lib`           |
| Database       | PostgreSQL, Prisma, `@prisma/adapter-pg`; `prisma/schema.prisma`, migrations        |
| CMS            | TipTap HTML, sanitized rendering, JSON homepage blocks and revision services        |
| Media          | Sharp, AWS S3 SDK or filesystem; `image-upload.ts`, `storage.ts`, `media-access.ts` |
| Competition    | `brackets-manager`/`brackets-model` plus native persisted graph and safeguards      |
| Interchange    | ExcelJS, PapaParse, bounded validated ZIP archives                                  |
| Optional IRC   | `irc-framework`, `ws`, signed RPC; `services/irc`, `src/lib/irc-*`                  |
| Infrastructure | `portal`, `compose.yaml`, `Dockerfile`, `deploy/`, `scripts/`                       |
| Verification   | Vitest, PostgreSQL integration tests, Playwright, guarded smoke harnesses           |

Node must be >=22.12; `.nvmrc` selects 22. Use `npm ci` and `package-lock.json` for
exact versions (manifest currently requests Next 16, React 19, Prisma 7, Tailwind 4,
TipTap 3 and Zod 4). Read bundled Next guides before framework edits. There is no
separate public backend application or fake production identity layer.

## Process And Network Topology

```text
Browser --HTTPS/WSS--> operator reverse proxy
  --> web listener :3000 (host default 127.0.0.1:3335)
      --> standalone Next on 127.0.0.1:3002
      --> /api/irc/socket upgrade --> irc-gateway:8080 (optional)
Next --> PostgreSQL / private object storage / official osu! API
IRC gateway --> signed web internal RPC / irc.ppy.sh:6667
```

`scripts/serve-container.mjs` (bundled as `front.cjs`) starts Next as a child,
preserves Host on ordinary proxy requests, bounds timeouts and coordinates SIGTERM/
socket shutdown. Only the exact enabled IRC socket path upgrades in production,
with configured Origin. Cookies/Authorization are stripped from that upgrade;
the first WebSocket frame carries a single-use ticket, never a URL credential.
Development additionally permits Next HMR upgrades.

Compose's `backend` network is internal; `outbound` supplies external API/IRC egress
to web/gateway. Database, storage and gateway publish no host ports. Only web is
exposed, on loopback by default. The reverse proxy must support WebSocket upgrades
and archive sizes/timeouts. `next start` alone does not supply this IRC upgrade path.

## Request Routing And Tournament Context

Public URLs are `/t/<slug>` with mappools, matches, teams, staff, rules, brackets and
qualifiers descendants. Organizer URLs are `/t/<slug>/admin/...`. Filesystem routes
remain shared public/admin handlers; `src/proxy.ts` rewrites validated scoped paths
internally. `tournament-paths.ts` owns parsing/building. Legacy `/admin/t/<slug>/...`
redirects permanently and schedule aliases lead to Matches. No generated tenant
source trees or special reverse-proxy admin rules are required.

The proxy deletes incoming `x-tournament-slug`, derives it from route or API
`?tournament=<slug>`, sets `x-original-path` and a CSP nonce. Internal rewrites retain
raw origin so loopback normalization cannot turn them into external self-proxies.
These headers are not client authority. `requestScope()` validates slugs and resolves
DB IDs/timezone/base paths with React request caching. It also supports configured
directory/featured roots and legacy fallback records; a fresh platform needs no
`main` tournament anchor.

`workspace.ts`, `workspace-server.ts` and client scope helpers keep tournament
editors behind selection. `/admin/tournaments` is the platform chooser. Unscoped
editors return there; unresolved API context returns 400, not a false resource 404.
Empty page queries provide safe editor defaults without saving CMS content on read.
The API guard currently detects an unresolved/none tenant, not necessarily an
explicit selection: featured/default fallback can satisfy it. Specialized older
routes also use getActor directly. The explicit-context contract is therefore
incomplete; see [F13](PLAN.md#f13-explicit-tournament-context-and-redirects).

`src/app/(public)/layout.tsx` owns published profile/identity/tabs outside changing
page content. Same-tournament links reuse nodes; cross-tournament links deliberately
replace the document to reset tenant state. Public queries gate publication/archive
state inconsistently: publication is checked broadly, but only competition and
qualifier-standings readers also exclude archived tournaments. Directory, CMS,
pools, teams, matches, media and the shared public layout currently accept a
published archived tournament. Archiving preserves the published flag. This is a
known contract discrepancy, not the target visibility policy; see
[F01](PLAN.md#f01-public-lifecycle-gates).

## API And Mutation Contracts

Principal handlers under `src/app/api`:

| Route                                             | Contract                                                |
| ------------------------------------------------- | ------------------------------------------------------- |
| `/api/auth/{login,callback,logout}`               | OAuth initiation/consumption and POST revocation        |
| `/api/tournaments`                                | Platform listing and tournament lifecycle/configuration |
| `/api/admin/data?section=...&tournament=<slug>`   | Permission-filtered scoped reads                        |
| `/api/admin/action?tournament=<slug>`             | Validated action union and transaction dispatcher       |
| `/api/admin/{beatmaps,players}`                   | Authorized official-provider metadata                   |
| `/api/admin/teams/export`                         | Authorized roster export                                |
| `/api/admin/{multiplayer,qualifier-multiplayer}`  | Reviewed official match evidence                        |
| `/api/admin/referee-import`                       | Workbook preview, destinations, reviewed application    |
| `/api/media`, `/api/media/<id>`                   | Scoped uploads/catalog and authorized bytes             |
| `/api/platform/media`, `/api/platform/media/<id>` | Independently owned platform assets                     |
| `/api/public/<resource>`                          | Explicit public projections, not private serialization  |
| `/api/tournament-transfer/{export,import}`        | Archives, validation/application and recovery           |
| `/api/irc/ticket`, `/api/internal/irc`            | Session-bound ticket and signed reauthorized RPC        |
| `/api/health`                                     | Runtime health used by image checks                     |

Admin data includes overview, homepage/rules, settings, stages/mappools/pooling,
staff/media/users/roles/teams, matches/referee/detail/history/events, referees,
multiplayer history, qualifiers/stages/standings, competition/correction, stage
reconciliation, audit and sheet data. Exact projections live in route/types. Empty
authorized collections are valid; unknown sections are 404. Audit/overview return
summary columns, not sensitive raw audit payloads.

The primary mutation pipeline:

1. Require exact configured Origin, reject cross-site, resolve hashed session and
   selected tournament, apply per-user write limit.
2. Bound/read JSON (500,000 bytes) and parse the action-specific Zod union.
3. `executeAction` opens a scoped transaction, takes PG advisory lock `78214321`
   and reloads the actor's current memberships/permissions.
4. Domain services check tenant, capability, lifecycle and expected version/revision/
   configuration witness, then atomically write related rows and audit/events.
5. Return saved results and refresh resources. Matches, teams, revisions and several
   bulk workflows compare reviewed witnesses. Settings, individual staff/category
   edits and staff bulk edits do not have equivalent stale-form checks; stage.save
   accepts an omitted configuration token. See [F02](PLAN.md#f02-stale-editor-writes).
   Root transaction timeout is 15 seconds; avoid network
   work under locks where the existing architecture allows preparation outside.

Specialized media/platform/import/IRC paths own equivalent guards and bounds.
`AppError` carries safe status/message; Zod returns bounded field errors, Prisma
P2002 is 409 and P2025 is 404. Unexpected exceptions return generic 500. Do not
turn database failures into fabricated empty collections.

## Database And Tenant Isolation

`db.ts` constructs Prisma with pg max 5 connections, 10-second connection timeout,
20-second idle timeout, reusing `globalThis` in development. `instance.ts` validates
the URL database against APP_DATABASE_NAME (explicit test DB also allowed).
`prisma.config.ts` uses DIRECT_URL or DATABASE_URL and rejects mismatched test URLs.
Generated client code is under `src/generated/prisma`, not committed.

`scopedDb(client, tournamentId)` wraps root/transaction delegates, injecting direct
tenant or parent-relation constraints into reads and unique writes/deletes, stamping
create ownership and rejecting foreign tenant data/transaction rebinding. It does
not sanitize arbitrary raw SQL or replace relationship checks. Classify each new
model as global, directly owned or parent-owned. Composite DB foreign keys provide
a second boundary, not an optional UI check.

### Relational Ownership Map

| Models                                                                                                 | Identity, Relationships And Purpose                                                                                                          |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| User, Session, OAuthState, RateLimit                                                                   | Global unique osuId; hashed credentials/state, expiry and durable rate windows                                                               |
| Permission, Role, UserRole, RolePermission                                                             | Global permission catalog; local role names unique per tenant, composite membership ownership; legacy system keys retained                   |
| PlatformSettings, PlatformAsset                                                                        | Singleton main, one-time bootstrap/root/featured settings; globally owned assets                                                             |
| Tournament, TournamentSettings                                                                         | Unique slug, lifecycle/timezone/version/number counter; one-to-one branding/navigation/scoring/rules                                         |
| Page, PageRevision, ContentBlock                                                                       | Unique tenant/slug, independent draft/public pointers, saved immutable revisions, ordered typed JSON blocks                                  |
| TournamentStage, ModCategory                                                                           | Tenant slug/type/rules/policy/banner/progression; configurable acronym/color/priority                                                        |
| Mappool, MappoolRevision, MappoolSlot, Beatmap                                                         | Pool per stage, revision pointers, unique slot/name and position per revision; global metadata cache plus frozen slot values                 |
| PoolPlan, PoolCandidate, PoolSkillset, PoolCandidateTag, PoolReview, PoolArtistWarning                 | Plan/stage; unique candidate beatmap/tenant, scoped skillsets/tags, candidate/reviewer uniqueness and normalized artist warnings             |
| Participant, Team, TeamMember                                                                          | Global numeric player identity; tenant registration/approval/seeding/source; one roster ownership per tenant/player, ordered members         |
| StaffMember, StaffCategory, StaffAssignment                                                            | Tenant public profile/visibility and many-to-many positions; no access grant                                                                 |
| MediaAsset, AuditLog                                                                                   | Opaque unique storage keys/metadata; scoped/platform actor/action/entity/details/time                                                        |
| Match, MatchAssignment                                                                                 | Stable local number/source code; stage/pool/team references, frozen participants/rules, state/version/score/roll/timer/lobby, assigned users |
| MatchMapAction, MatchMapResult, MatchPlayerScore                                                       | Unique match/sequence, result/action, result/player; void/correction and score provenance                                                    |
| MatchEvent, MatchResultRevision, MultiplayerGame                                                       | Unique match/version history and unique match/MP/game evidence                                                                               |
| QualifierLobby, QualifierEntry, QualifierAssignment, QualifierScore, QualifierEvent, QualifierStanding | Sessions/snapshots, ordered entrants/staff, unique lobby/player/slot/run, versioned events and stage/version standings                       |
| Bracket, BracketRound, BracketNode, BracketSlot, BracketEntry                                          | Native paths, ordered stage-mapped rounds, unique node keys/match bindings/numbers, source routes and path-specific seed/eligibility         |
| RefereeImport, IrcLobbyRequest, TournamentTransfer                                                     | Expiring parsed previews, durable uncertain room creation, archive upload/cleanup journal                                                    |

IDs are normally CUIDs; numeric osu!/beatmap identities stay stable. JSON represents
validated configuration/provider values and frozen historical witnesses, not a
substitute for relational ownership. Exact nullability/indexes/delete behavior are
in schema/SQL: history references generally restrict while owned children cascade.
Applied SQL also owns CHECKs, number allocation/immutability triggers and partial
uniqueness for unresolved IRC creation not fully expressed in Prisma models.

## Authentication And Access

Login generates 32 random bytes of state, stores SHA-256 plus validated local return
path, and binds to a ten-minute HTTP-only cookie. Callback timing-safely compares
cookie/state, atomically consumes unexpired DB state, exchanges code server-side
with identify/public scopes, fetches `/api/v2/me`, upserts numeric identity and
rotates the prior session. Access/refresh tokens are deliberately discarded. New
sessions use independent random credentials, stored hashed with seven-day expiry.

HTTPS uses `__Host-tournament_session`/`__Host-tournament_oauth`, Secure, HTTP-only,
SameSite Lax, path `/`; loopback HTTP uses non-prefixed names. Logout is same-origin
POST, deletes hashed session and clears cookie, returning JSON or 303 as requested.

Bootstrap creates platform/permissions and pins OWNER_OSU_ID for first genuine
sign-in. The locked login transaction consumes it only when no platform admin exists
and bootstrap was not consumed; restarts cannot rearm it. `actorForTournament`
combines local memberships; `platformAdmin` supplies global authority. New sign-in
does not manufacture tournament access. Default roles live in `permissions.ts`;
custom local roles cannot grant platform-only permissions. Self-role changes,
over-grants and last-Owner removal are blocked. Staff titles grant no authority.

`match-access.ts` separates manager, assigned, override, draft, score, submit and
schedule. Default Referee gets view_all and assigned operation/history capabilities,
not manage_all. Read-all queries must not filter to assignedReferee. Other/unassigned
matches remain read-only without additional authority, including direct API calls.

`security.ts` supplies exact-origin CSRF checks, atomic DB-backed limits and safe
errors. Primary actions allow 100/minute/user, official API reads share 55/minute,
login has its own limit. Successful login maintains expired state/session/rate rows.
Proxy supplies nonce CSP, no-store/private admin/auth and HTTPS HSTS; Next config
adds nosniff/frame denial/referrer/device policies. Never weaken these to hide bugs.

## CMS And Publication

Page catalogs use tenant/slug (`home`, `rules`), separate draft/published pointers,
immutable saved revisions and ordered blocks. Save appends sanitized content guarded
by expected draft ID; publish checks the reviewed draft before moving the public
pointer. Unpublish hides without erasing history. Pool revisions follow the same
principle. Public readers use only publications behind the tournament gate; previews
authorize and explicitly select a revision.

`rich-text.ts` sanitizes TipTap rendering and imports. Heading navigation derives
from the document. Shared public profile uses visible published homepage branding
override, then tournament settings, never the newest draft; preview uses its draft
explicitly. The editor API can synthesize defaults for absent pages; however,
`tournamentAction(create)` currently creates home/rules pages and one blank saved
draft revision for each. The setup checklist treats these as saved work. This
differs from the empty-tournament contract; see [F12](PLAN.md#f12-fresh-cms-state).

RichEditor emits `editor.getHTML()`, not a persisted TipTap document tree.
`PageRevision.html` and block `content.html` are sanitized on save/import and public
read. Block envelopes remain JSON. `publicPage` returns all published-revision
blocks, while HomepageContent filters `visible` during rendering; API serialization
and media reference inference do not apply that filter. Public projection review
is tracked in [F14](PLAN.md#f14-public-projections).

## Pool Planning, Ordering And Release

`mappool-order.ts` uppercases/normalizes categories and numeric suffixes, validates
IDs/categories/duplicates and sorts numerically (NM2 before NM10). NM through FM
have priorities 1-5; customs use configured positions/deterministic natural fallback;
TB is always last. Manual within-category moves exchange slot names so save does
not reverse the move. Stable editor identity must not be React array indices.

`stage-workflows.ts` implements patch/copy/default inheritance/reorder/duplication
with raw config SHA-256/default tokens. Head-to-head rules and qualifier policy
differ; action preview uses the live engine. Empty stages save normally;
`stage-pool-validation.ts` checks regular capacity, protect/ban/TB-ban counts and
tiebreakers before publication. Existing match snapshots do not change with stages.

`pooling-service.ts` owns plans/candidates/skillsets/reviews/warnings. Empty slots
and targets persist in plans; actual revision slots contain filled beatmaps only,
with shared 100-slot bounds. Candidate statuses are SUGGESTED, REVIEW, PLAYTESTING,
ACCEPTED, REJECTED, SELECTED; plan DRAFT/REVIEW/APPROVED is separate from release.
Assigned reviewers write their own feedback; managers assign others. Selection
creates a draft with expected base revision, never automatically publishes.

Artist resolutions bind exact warning identity/reason and are rechecked at publish.
Shared `publishPoolDraft` validates single/bulk releases; batches compare every
expected state/draft/public pointer and fail atomically. Cross-stage COPY/MOVE
acts on saved selected slots with explicit replacement review, retaining old public
revisions. Structure-only copy never invents beatmaps or copies review assignments.

## Match State, Numbers And Brackets

`match-engine.ts` is pure workflow/calculation; `matches-service.ts` owns persistence,
with shared validation/rule/type modules. Matches freeze participants/rules/pool
revision so registration/stage edits cannot silently change play. States: SCHEDULED,
IN_PROGRESS, AWAITING_CONFIRMATION, COMPLETED, DISPUTED, CANCELLED. Score-derived
winner or referee submission is not organizer confirmation. Timer anchors/remaining
values persist, not just browser intervals.

Actions retain sequence/side/slot/actor/provenance, results reference actions and
player scores. Corrections/undo void or version records rather than discard history;
events/result revisions retain audit and snapshots. Stale baseVersion writes fail.
`polling.ts` schedules after completion and pauses/resumes with visibility/connection,
preventing overlaps; observing grants no edit ownership. Permanent deletion is an
explicit matches.delete workflow with dependency guards, not cancellation.

`match-numbering.ts`/SQL trigger serialize allocation on tournament counter.
Positive matchNumber is tenant-unique, immutable and never recycled. Requested
numeric source codes must exceed the allocated high-water mark; nonnumeric codes
retain spelling with a new number. Migration preserves unambiguous numeric codes
and allocates remaining records safely. Numeric public URLs resolve numbers only.

Native brackets use the established engine for SE/DE/groups construction and native
rows for lifecycle/routes/eligibility/lazy matches. Playable nodes reserve numbers
by round position, lane, node position/key; BYE/SKIPPED consume none. Lazy creation
retains reservations even after unrelated matches are created. Confirmed results
advance; losses/withdrawals/overrides are path-specific. Manual slots/routes/locks
are audited, cycle-checked and cannot replace started history.

### Linking Historical Matches

1. Open Matches, Bracket, Create bracket and enable **Link existing matches**.
2. Preview the actual format/seeds/byes and map rounds to gameplay stages. This
   mode creates positions, not replacement matches or new number reservations.
3. Start with earliest ready positions and choose existing same-tenant/stage/pair
   matches. Reversed colors are identified; linking swaps incoming bracket sides,
   never original match sides/actions/scores.
4. Link; completed results resolve subsequent positions. Continue through scheduled
   finals and referee those same records normally.

One match occupies at most one node. Version/downstream guards apply. Round stage
changes update only safe unstarted snapshots. Started downstream corrections require
reconciliation, not automatic reseeding. Schedule bulk services similarly patch
explicit eligible fields, compare all versions and reject unsafe batches. CSV/TSV
paste uses match numbers; blanks preserve and `-` clears. Use ISO offsets for
portable timestamps; naive values use browser timezone. Conflicts currently compare
identical starts, not estimated-duration overlap.

## Qualifiers, Scoring And Standings

`gameplay-scoring.ts` defines SCORE_V1, SCORE_V2, LAZER. Canonical selection is
TournamentSettings.gameplayScoring; stages inherit, historical records retain
snapshots. Legacy inference requires unanimous modes; conflicting evidence needs
review. Competition locks scoring except reviewed resolution of an unknown mode
matching every historical witness. Lazer accepts acknowledged standardized manual
scores, not classic display or legacy Bancho/API capture. No numerical conversion
between gameplay systems is fabricated.

`qualifiers-service.ts` owns sessions/entries/staff/events/scores;
`qualifiers-bulk.ts` and `qualifier-scheduling.ts` implement batches/transfers.
Freeze full pool/roster/rules/policy/scoring snapshots. Unstarted transfers require
compatible snapshots, <=16 players/8 teams, no mixed formats or duplicate entrants,
resource/version checks and no frozen history/finalized sources. Scores retain run,
raw/mods/adjusted, actual scoring, representation, source/game ID and verification.
One captured game cannot count as both runs.

`qualifier-policy.ts` is client-safe. Per team/map/run, SUM/AVERAGE require exactly
requiredPlayers distinct registered members; TOP_N requires at least N and sums
highest N. Substitutions stay inside frozen rosters. Missing evidence is not zero.
One run counts Run 1. Two-run BEST_PER_MAP chooses complete team-map values, ties
Run 1; FIRST_RUN/SECOND_RUN never fill from the other. BEST_COMPLETE_RUN selects a
whole team run, not individual maps/players. Comparison references first average
each entrant's complete candidate runs, equal cohort weighting; official references
then recalculate from selected complete entrants. Store both reference sets.

For selected team-map values T[i,m], M maps and p played maps:

```text
Raw total       = sum_m T[i,m]
Raw average     = sum_m T[i,m] / M
Team average    = sum_m T[i,m] / M after configured roster aggregation
Z-Sum           = sum_m (T[i,m] - mean[m]) / sampleSD[m]
sampleSD[m]     = sqrt(sum_i (T[i,m] - mean[m])^2 / (n - 1))
Match Cost      = 2 / (p + 2) * sum_playedMaps(T[i,m] / mean[m])
```

Match Cost is OSUPLUS_QUALIFIER_COHORT_V1, not every formula called match cost.
References are complete eligible entrants across rooms without winner/TB bonuses.
Example `[100,80]` versus `[50,40]`: means 75/60 and first cost
`2/4 * (100/75 + 80/60) = 4/3`. Independently derived from the positive-reference
formula in [osu!plus revision b143241](https://github.com/limjeck/osuplus/blob/b143241ec202f624e58ba7326b5d0e8f5ad339ed/osuplus.user.js#L1108-L1197),
without copying incompatible code; general methods follow the
[osu! seeding definitions](https://osu.ppy.sh/wiki/en/Tournaments/Common_seeding_methods).

Incomplete entrants get no seed and do not affect official references. Every
configured run must be complete to finalize, including unused second runs. Duplicate
plays/ownership, unverified/inconsistent provenance and unconfirmed sessions block.
Zero deviation contributes zero/warning; fewer than two complete entrants blocks
sample Z-Sum; zero Match Cost reference blocks instead of inventing a denominator.
Provisional partial values are not final seeds. Raw V1 range bias is warned. Full
precision determines ties; ID order is display-only; ties need explicit order/reason.

`qualifier-seeding.ts` is pure and hashes complete canonical source/config/version,
including unused records. Service requires full-cohort access. Actions carry stageId,
baseVersion, sourceHash and take the qualified stage lock after root lock. Provisional
review, FINALIZED, publication and REOPENED are distinct versions/operations; snapshots
contain calculation, actors/times, cutoff, tie decisions and qualified seeds. Public
reads never recalculate a stale version into published results.

`finalizedQualifierSeeds` validates latest finalization/current witnesses on all
derived path starts/publication, not only generation. Reopen compares exact reviewed
affected bracket IDs/versions/impact hash under competition and stage locks. It
recursively blocks downstream started/progressed/scored history. Safe reopen appends
history, hides old publication and preserves frozen bracket participants. Correct/
reconfirm/recalculate/finalize explicitly; old IDs remain invalid, no silent rebinding.

Archive-only rebinding verifies known formula/version, remapped source completeness,
selected runs, statistics/values/seed order, then updates equivalent hashes with
import provenance, never rankings/ties/cutoffs. Unknown/different witnesses stay
stale, including conservative floating-point operation-order differences. Import
`qualifier-standings-validation.ts` in browser code, not DB-backed services.

## Workbook And Multiplayer Interoperability

`referee-workbook.ts` reads XLSX up to 4 MB/120 tabs, detecting all supported numbered
matches, not just Template. Inputs: S2 ID, S5 MP, AB7 stage, E/F/H/J action rows,
cached AB3 Discord. Settings/Round Setup and map/mod evidence inform reconstruction;
extended referee area is bounded to 500 rows. Google export #NAME? does not justify
dropping history: reconstruct from supported sequence/row order/cached Discord,
report unresolved disagreements and require review, never guess scores/actions.

`referee-import.ts` stores a 24-hour parsed preview/fingerprint, lists authorized
destinations and compares scoring/stage/team/pool/timeline/result compatibility.
`referee-workbook-state.ts` validates frozen rules/pools. Apply requires reason,
expected version and explicit create/replace/confirm choices. Persist individual
actions/results/provenance plus events/revisions/audit. Reimport is duplicate-safe;
replacement is explicit, chronological source rows retained. Stage reconciliation
maps to reviewed existing stages while keeping original bracket/round labels.
Qualifiers Ref/Schedule layouts are detected but unsupported for performance import;
native sessions and archives are separate supported routes.

`multiplayer.ts`/`qualifier-multiplayer.ts` preview official game evidence and capture
provenance; evidence is not automatically an official result or duplicate run.
`discord-result.ts` is independently tested: spreadsheet function retains CHAR(13),
Markdown/emojis/flags and asymmetric forfeit markers. The website wrapper additionally
requires COMPLETED confirmation, uses matchNumber and can omit MP for explicitly
completed historical records. In-progress previews never announce a confirmed winner;
goldens cover these intentional conditional differences.

## Official osu! Metadata

`osu.ts` uses official OAuth/API v2, server credentials, 15-second timeouts and a
process-local app-token cache refreshed before expiry. Beatmap metadata cache lasts
24 hours, batching missing IDs by 50. Validate provider payloads; report per-ID
absence/mode mismatch. Frozen revision metadata prevents cache refresh rewriting
history. Profiles verify numeric IDs; renamed usernames refresh at OAuth login.
Provider outages surface safe retryable errors without changing saved content.

## Media And Storage

`image-upload.ts` accepts static PNG/JPEG/WebP/AVIF <=4 MB with bounded multipart
overhead. Sharp inspects bytes, rejects animation/>40-million-pixel inputs,
rotates/resizes within 2560x2560 without enlargement, encodes WebP quality 85 and
rechecks size. SVG/script uploads are not supported images.

Opaque restricted UUID-style WebP keys never use user paths. ObjectStorage exposes
put/get/head/delete. Filesystem uses private exclusive temporary writes/rename and
absolute persistent STORAGE_LOCAL_DIR. Development `local` alias is forbidden in
production. S3 uses scoped server credentials, bounded reads, two SDK attempts and
15-second aborts. Objects carry SHA-256; verify bytes, not ETags. Bucket stays private.

Same-origin media routes check publication/reference/ownership separately for global
and tenant assets. Failed saves do not create false catalog success. Referenced
deletion is refused. Archive imports retain retryable cleanup through
TournamentTransfer. Ordinary tenant/platform
media deletion commits the catalog deletion first, then attempts object deletion;
failure is logged and the object key is not retained in a cleanup job. Upload
compensation also has no durable journal. Those failures can leave private orphan
objects; ordinary cleanup is not currently retryable through the application.
See [F04](PLAN.md#f04-media-reference-and-cleanup-ownership). Back up all saved
revision references, not only current visible artwork.

## Tournament Archive Protocol

Export in tournament Settings needs settings.manage, users.manage and roles.manage.
Platform admin imports in chooser: select ZIP, preview counts/warnings/access
suggestions, choose unused slug, confirm **Import as unpublished**. Export is saved
DB data only. Reimport creates another new tournament, never overwrites existing.

Format identifier osu-tournament-portal, version 1:

```text
manifest.json        source/version, JSON/media SHA-256, warnings
tournament.json      explicitly allowlisted relational collections
media/<local>.webp   checked uploads/referenced local raster artwork
```

Include all saved CMS/pool revisions, planning/reviews, rosters/seeds/public staff,
matches/actions including voided history/player results/events/corrections/evidence,
brackets/numbers/qualifiers/standings and tournament audit. Exclude sessions/OAuth,
platform authority/settings, server env, IRC credentials/transient requests, pending
workbook uploads and unrelated tenants. Sensitive JSON keys are stripped/rejected.

Local IDs/foreign keys/snapshot references remap with fresh storage keys; numeric
osu!/beatmap IDs stay stable. Reuse global identities/metadata without overwriting
other tournaments. Only importer gets local Owner access. Source role grants and
referee assignments become completion-report suggestions, not automatic privileges.
Missing historical actor profiles get no sessions/roles/platform rights. Page/pool
publications survive behind private tournament gate, never auto-featured.

WebP bytes remain intact. Safe local raster public artwork normalizes/bundles;
replace local SVG with raster CMS uploads first. Missing/unsafe files fail export.
Remote URLs remain remote, not arbitrary server-side fetches. Runtime public-file
lookups are excluded from build tracing. Unknown format/fields/tables/enums, bad
references/checksums/images/duplicates, traversal/symlink/encrypted/unexpected ZIP
entries fail. No filesystem extraction. Rich text is sanitized.

Bounds: 64 MB ZIP, 128 MB expanded, 16 MB JSON, 60,000 records, 1,000 images,
4 MB/image. Proxy needs >=65 MB multipart and adequate timeout; provider limits
still apply. This is bounded memory, not an unlimited streamed migration path.
Archives contain private drafts/contacts/notes: never commit or publish them.

Before uploading, TournamentTransfer journals planned fresh object keys; uploads
read-back verify. Relational restore/count/report/role init and journal completion
commit together. Failure cleans only fresh attempt keys; failure becomes
CLEANUP_REQUIRED. Recent imports exposes full reports/recovery. Stop the old worker
and wait for 30-minute stale heartbeat; recovery claim blocks its late commit.
Completed transfers can never be cleaned, including lost commit acknowledgements.
Reconnect DB before outage recovery; never delete published media or overwrite a
tournament to retry. Number reservations/counter survive; old archives recover
unambiguous codes and allocate safely. Standings rebind only after witness checks.
Legacy-compatible read-only exporter lives with the legacy app; this does not
authorize modifications of that checkout or its database.

## Optional IRC Gateway

Set IRC_ENABLED=true and add irc to COMPOSE_PROFILES; install/rebuild. Web/gateway
share a private random IRC_GATEWAY_SECRET >=64 characters. WSS proxies through web;
gateway is not published. One gateway instance; sharding is not implemented.

Short-lived one-use tickets bind user/session/tenant/match. Signed internal RPC
checks timestamp/signature/replay nonce and reauthorizes identity/assignment on
every operation. Observing is not sending; no borrowing another user's connection.
Passwords remain temporarily in memory, input/library references clear after use,
never DB/S3/browser storage/logs. JavaScript cannot promise forensic zeroization.
No saved-password reconnect; disconnect grace never sends room-close.

Use separate osu! **IRC password**, never ordinary account password. Upstream
irc.ppy.sh:6667 is plaintext: HTTPS/WSS protects browser hop only; host operator/
network observers can see upstream traffic. Transport timeout is not rejection.

`services/irc/bancho-client.ts` uses current authenticated website username, spaces
to underscores, sends PASS then NICK then `USER <nickname> 0 * :<nickname>` with
CRLF, no CAP/SASL/NickServ. Password passes verbatim through JSON/WebSocket/framing,
no trim/hash/URL decoding/Base64. Accept 1-200 printable ASCII without spaces/control;
invalid input is explicit, never truncated. Re-login after an osu! username change.

Structured irc.connection logs/UI show sanitized nickname, stage, source, code only;
never raw authentication commands/reasons, passwords, tickets/cookies/session hashes.

| Source / Stage / Code                                           | Meaning                                        |
| --------------------------------------------------------------- | ---------------------------------------------- |
| gateway / validation / INVALID_CONNECT_REQUEST                  | Local rejection; no upstream attempt           |
| gateway / identity / USERNAME_CHANGED or NICKNAME_MISMATCH      | Refresh identity, no alternate nickname        |
| transport / connecting or registration / TIMEOUT or socket code | Connectivity, not confirmed password failure   |
| bancho / registration / 464                                     | Upstream authentication rejection              |
| bancho / registration / 432, 433                                | Nickname rejection/collision                   |
| bancho / registration / 421, 461                                | Command/registration compatibility             |
| bancho / ERROR                                                  | Upstream ended connection; raw reason withheld |
| bancho / connected / 001                                        | Registered, then joins #osu                    |

BanchoBot, lobby chat, player PMs remain separate. Ordinary validated commands show
**Sent** on dispatch, never wait for inferred acknowledgements, block next commands,
automatically retry or confirm map winners. Read bot responses: Sent invite can
still receive User not found. Disruptive operations require confirmation; creator-only
addref needs persisted creation proof; rate/queue/message/submission-ID bounds remain.

Creation differs: persist unresolved IrcLobbyRequest before !mp make to BanchoBot,
parse real official room URL, join and require explicit match linking. Unknown
outcomes survive restarts and block blind retries until reviewed. Creating/linking
a lobby never creates a website match. Qualifiers copy setup commands, not this
execution panel; lazer is not legacy Bancho support.

Safe logs: `./portal compose logs --tail=100 irc-gateway`. Gateway/web fixes need
rebuild/recreation (`./portal install`); start alone reuses images. Strict mock TCP
tests and real ticket/RPC/WebSocket tests are not live credentials/room verification.

## Deployment And Configuration

### First Installation

Linux Docker Engine/Compose, public HTTPS proxy/origin and dedicated osu! OAuth app
are required; host Node is not required. `./portal setup` creates private mode-0600
.env with unique secrets/STACK_NAME, requests URL/port/owner/OAuth, builds, starts
persistence, migrates, bootstraps, initializes storage and starts runtime. It refuses
configuration overwrite. Register APP_URL/api/auth/callback in osu! account settings;
use separate OAuth apps/environments. Real owner login then creates the first
tournament in /admin/tournaments; selected editors work unpublished. This is not
existing-schema adoption.

### Lifecycle Commands

| Command              | Effect                                                                    |
| -------------------- | ------------------------------------------------------------------------- |
| ./portal setup       | Guided first configuration/install                                        |
| ./portal install     | Build, start persistence, migrate, bootstrap, init storage, start runtime |
| ./portal start       | Existing images only; no rebuild or migrations                            |
| ./portal stop        | Stop services, keep volumes/data                                          |
| ./portal status      | Service status                                                            |
| ./portal logs        | Follow last 100 web lines; Ctrl+C only stops viewing                      |
| ./portal compose ... | Advanced Compose, same project/env                                        |

One root compose.yaml handles normal hosting. Profiles database/storage/irc select
PostgreSQL 17/RustFS/optional gateway. Maintenance migrate/bootstrap use tools image;
storage-init creates private bucket/scoped access. **Never change STACK_NAME on an
existing install** expecting the same volumes. Editing .env passwords does not
rotate initialized DB/storage credentials. PORTAL_ENV_FILE selects private alternate
config; absent .env, .env.docker works. STACK_ENV_FILE passes that path to storage init.

Advanced overlays honor COMPOSE_FILE, e.g.
`compose.yaml:deploy/compose.external-network.yaml`:

| File                                 | Purpose                                         |
| ------------------------------------ | ----------------------------------------------- |
| compose.dev.yaml                     | Source-mounted development only                 |
| deploy/compose.external-network.yaml | Existing private EXTERNAL_SERVICE_NETWORK       |
| deploy/compose.assets.yaml           | Read-only private INSTANCE_PUBLIC_DIRECTORY     |
| deploy/compose.qa.yaml               | Isolated mock-IRC automation, never real Bancho |

.env.example inventories configuration; placeholders are not usable credentials.

| Variables                                                                  | Boundary                                                                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| APP_URL, OSU_CLIENT_ID/SECRET, OSU_REDIRECT_URI                            | Public HTTPS/callback and server-only OAuth                                                 |
| OWNER_OSU_ID, INITIAL_SITE_NAME                                            | Initial bootstrap, not recurring privilege changes                                          |
| STACK_NAME, COMPOSE_PROFILES, WEB_BIND/PORT                                | Persistent identity, service selection, restricted listener                                 |
| DATABASE_URL, APP_DATABASE_NAME                                            | Restricted web connection and database-name guard                                           |
| DIRECT_URL, POSTGRES__, APP_DATABASE__                                     | Migration/init administrative and restricted app credentials; DIRECT_URL never given to web |
| STORAGE_DRIVER, STORAGE_LOCAL_DIR                                          | s3 or absolute persistent filesystem, media volume in Docker                                |
| S3_ENDPOINT/REGION/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY/FORCE_PATH_STYLE | Private scoped adapter                                                                      |
| RUSTFS_ACCESS_KEY/SECRET_KEY                                               | Bundled storage administrator, initialization only                                          |
| IRC_ENABLED, IRC_GATEWAY_SECRET, IRC_SERVER_HOST/PORT                      | Explicit opt-in, signing/upstream                                                           |

Remove database profile for managed PG and configure direct/application URLs. Remove
storage for external S3/filesystem. AWS usually uses empty endpoint/path-style false;
R2/B2/custom providers need explicit endpoint/region/style verification. Manual
advanced provisioning: `node scripts/configure.mjs`, edit private env, then install.

### Runtime Images

Dockerfile uses digest-pinned build/Distroless bases and lockfile. Prisma/standalone
build together; placeholder build DB URL never contacts an installation or embeds
secrets. Web contains standalone/static/public/front listener/notices. Gateway is a
separate bundle; tools has Prisma/tsx. Runtime processes use UID/GID 1000 without
shell/npm; web/IRC drop capabilities, deny new privileges, bound logs and health/
shutdown behavior. Diagnose using Node/logs, not docker exec sh. Development has
its own tooling target. Base-image pins require deliberate security updates.

### HTTPS And Proxy

Caddy on the same host:

```caddyfile
cup.example.com {
    reverse_proxy 127.0.0.1:3335
}
```

Separate proxy: bind WEB_BIND to intended private interface and firewall it to the
proxy only. Match APP_URL and OAuth callback to public HTTPS. Never publish database,
storage or gateway. Allow archive multipart >=65 MB and sufficient timeout.

### Network Safety

Docker pools can contain 192.168 ranges and overlap SSH/LAN/VPN. Helper checks effective
pools/bridges against IPv4 SSH client when SSH_CONNECTION exists; it never edits host
routes/firewall/daemon. Review IPv6 and other routed ranges manually before extra
stacks. Reserve Docker-only ranges in /etc/docker/daemon.json, merge settings,
validate with `dockerd --validate --config-file=/etc/docker/daemon.json`, coordinate
restart. New pools do not renumber existing bridges. Recreate only approved affected
networks, retain volumes/unrelated services. Never global prune or down --volumes;
a temporary client route is not a permanent pool repair.

### Updating And Release Cutover

Back up DB/media/private configuration, restore-test and review release/migrations.
Keep STACK_NAME, actual URLs/credentials. On reviewed branch, in approved window:

```bash
./portal stop
git pull --ff-only
./portal install
```

Stop on migration failure, never reset/regenerate secrets. start alone does not
update. Keep old images/config/backups. New competition/numbering/pooling code needs
its migrations before starting; [PLAN.md](PLAN.md#schema-delivery-order) lists order.

For cutover restore staging, compare key table hashes, media/users/roles/CMS/results
and exercise workflows first. Obtain live approval, pause writers, take final backup,
reconcile media, stop only approved web/gateway, migrate/init/start matched images,
verify health then switch routing. Smoke-test login, private drafts, branding/history
and nondisruptive edit; retain old checkout/backups until cleanup approved. Rollback
images/routing deliberately, never reverse schema or restore stale data over writes.

Security refresh: `./portal compose build --pull --no-cache web migrate irc-gateway`
(gateway when used), record digests and scan. Distro updates layered onto pinned
bases are deliberate security refreshes, not byte-identical OS promises. Registry
publication needs separate approval; release workflow requires reviewed main,
explicit version/publish flag and release-approval environment.

### Existing Schema Adoption

Never replay baseline DDL on an existing schema. For an eligible existing
multi-tournament/IRC shape, deploy/adopt-existing.sql adds platform/setup/assets and
defaults without rewriting content. Guarded helper retains legacy ledger and marks
baseline applied via Prisma resolve; later migrations deploy normally. Older private
schemas first need their own reviewed upgrade to expected shape.

On isolated restored copy with explicit intended APP_DATABASE_NAME/URLs:

```bash
node --env-file=.env.upgrade scripts/adopt-existing.mjs
# After target, SQL and backup review only:
CONFIRM_DATABASE_ADOPTION=YOUR_DATABASE node --env-file=.env.upgrade scripts/adopt-existing.mjs --apply
node --env-file=.env.upgrade node_modules/prisma/build/index.js migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

Failed ledger resolve requires review/retry, never baseline CREATE TABLE replay.
Preserve actual credentials/callback/storage keys. Cookie changes can require login,
not data deletion. Mount private static art read-only, never distribute it in code.

### Backups And Recovery

Volumes are not backups. Keep encrypted versioned off-host copies, monitor age/disk,
restore-test. In controlled write pause stop web/IRC, take pg_dump -Fc, stop object
storage cleanly and archive entire volume including hidden IAM metadata. Archive
filesystem media if used, matching private credentials separately. Restart storage
then web/IRC. Restore to separate empty DB/volumes with pg_restore --exit-on-error
--no-owner --no-acl, preserving storage UID 10001/filesystem UID 1000. Verify schema,
table hashes, media bytes/references, draft privacy/history before routing. External
providers need versioned backup tooling; app S3 user is not backup administrator.
Tournament archives omit server secrets/authority and are not full instance backups.

### Moving Filesystem Media To S3

Explicit separate operation: scripts/migrate-media.ts previews DB/file references,
retains originals, copies without DB rewrites and read-back verifies SHA-256. Reports
are exclusive mode-0600; reruns verify existing objects, not overwrite collisions.
Review symlinks/missing files manually.

```bash
node --env-file=.env.migration --import tsx scripts/migrate-media.ts --source /private/uploads --report /private/preview.json
node --env-file=.env.migration --import tsx scripts/migrate-media.ts --source /private/uploads --backup /private/originals --report /private/copy.json --copy
```

Pause uploads/deletes after verification, reconcile again, switch adapter and check
private/public images. Rollback must reconcile new S3 uploads back first. Originals
are never automatically deleted; cleanup requires explicit operator approval.

### Troubleshooting

- Docker access denied: administrator grants it; docker-group membership is
  root-equivalent. Never paste sudo passwords into tools/chat.
- Config exists: use start/install, not secret regeneration.
- Proxy 502: check status/health, WEB_BIND/port, target/firewall/routes from proxy;
  working public TLS does not prove upstream reachability.
- Admin 404: inspect actual JSON/HTML/status/context before proxy changes. Missing
  selection is 400, missing item 404. Check image/route manifest/assets/logs.
- OAuth: compare exact APP_URL/callback/credentials/cookie HTTPS origin; branding
  cannot retarget OAuth.
- Stale browser: verify all images/assets match one build, rebuild/install and
  inspect Network. Never cache private admin data to hide inconsistency.
- IRC timeout: check outbound TCP6667/DNS/firewall, not password assumptions.
- Schema/Prisma mismatch: stop, inspect migrate status/diff on intended DB, no reset.

Safe commands: `./portal status`, `./portal compose config --quiet`,
`./portal compose logs --since=15m --tail=100 web`, and gateway logs. Do not publish
resolved env/Compose configuration, credential URLs, cookies or tickets.

## Implementation Boundaries And Proposed Cleanup

### Current Verified Ownership

Source inspection at `fc41596` found one application with domain services, not
separate competing backend implementations. The schema has 57 models across seven
migrations. The counts below describe that revision, not permanent size limits.
Audit actions, priorities and acceptance gates live only in
[PLAN](PLAN.md#repository-audit-and-cleanup-phase).

| Boundary                     | Current owners and dependency direction                                                                                                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP/context                 | proxy.ts, tournament-paths.ts, tournament-context.ts and auth.ts resolve identity/context; route handlers validate request transport and call services                                                                                                           |
| Administrative orchestration | validation.ts combines domain action unions; admin-service.ts (836 lines) maps permissions and dispatches one transaction; api/admin/data/route.ts separately dispatches reads                                                                                   |
| Match operations             | match-engine.ts is pure; matches-service.ts (1,595 lines) combines options/queries, roster and lobby helpers, scheduling, state changes and result revisions; qualifiers, IRC and bulk scheduling reuse its helpers                                              |
| Competition                  | competition-engine.ts adapts brackets-manager through in-memory storage; competition-service.ts (1,783 lines) owns persisted graph operations, eligibility, correction previews, public reads and archive witness rebinding                                      |
| Qualifiers                   | qualifier-policy.ts and qualifier-seeding.ts own pure policy/math; qualifiers-service.ts and qualifiers-bulk.ts persist sessions; qualifier-standings-service.ts (927 lines) owns cohort reads, finalization, reopen and archive rebinding                       |
| Pooling/stages               | mappool-order.ts and stage-pool-validation.ts are pure; stage-workflows.ts and pooling-service.ts persist plans/reviews/release; basic stage/category/pool saves still live in admin-service.ts                                                                  |
| Teams/CMS/access             | teams-service.ts prepares provider data then writes versioned registrations; page/staff/role/settings writes remain in admin-service.ts; permissions.ts is the access vocabulary                                                                                 |
| Transfer                     | tournament-archive-format.ts explicitly defines the wire allowlist; tournament-export.ts collects a read-only consistent snapshot; tournament-import.ts remaps/restores with durable storage recovery; competition and standings services verify their witnesses |
| Browser state                | admin/shared.tsx owns request/resource/polling/task/dialog/unsaved helpers; individual editors own forms and selection state; no shared form-store layer exists                                                                                                  |
| Providers                    | osu.ts owns official API access; multiplayer adapters validate evidence; storage.ts owns object operations; services/irc is an optional process; discord-result.ts formats strings, with no Discord bot/webhook transport                                        |

The large services are not pure domain libraries: importing one as a runtime
dependency brings database/context dependencies. MatchParticipants currently lives
in matches-service.ts and is imported with `import type` by view/adapter modules.
The resulting static type backedges are not evidence of a runtime circular import.
Actual runtime component coupling exists where referee-panel.tsx and
qualifiers-workspace.tsx import status labels from matches-dashboard.tsx.

### Transactions And Policy Duplication

`executeAction` prepares provider metadata outside the transaction, reloads the
actor inside it and takes advisory lock `78214321`. Tournament lifecycle, OAuth
bootstrap, media, workbook application, IRC and domain services also use that
same database-wide key. Reacquisition inside the same transaction is intentional;
it does not provide parallelism between tournaments. Standings also takes a
stage-specific lock after the root lock. Import uses a separate Serializable
transaction/journal; export uses read-only RepeatableRead. These are distinct
consistency protocols, not interchangeable transaction wrappers.

`applyMatchAction`, `applyPoolingAction` and similar functions rely on their
caller's transaction and permission refresh for part of the mutation contract.
Some recheck capabilities or take the shared lock themselves; others rely on the
dispatcher. An extraction must preserve the complete caller/callee contract.
There is no measured throughput or lock-wait baseline yet.

Policy duplication has observable differences. Match creation and single-match
scheduling use validateAssignments plus same-opponent-pair checks; bulk scheduling
also compares shared players/teams against other matches and qualifier sessions.
Qualifier scheduling uses assertQualifierAvailability. Match creation repeats
pool-capacity rules rather than calling stagePoolProblems, which release and bulk
stage reassignment use. Keep head-to-head and qualifier semantics explicit while
consolidating genuinely shared predicates; do not collapse their state machines.

### Database And Wire Boundaries

Prisma is not the entire persistence contract. SQL adds scoring/run/graph CHECKs,
partial IRC uniqueness and match-number triggers. Page and pool pointer foreign
keys verify the tournament, but do not verify that the chosen revision belongs to
that particular page/pool. MatchMapResult independently references Match and
MatchMapAction, without a constraint equating the action's matchId to the result's.
Application lookups and archive validation supply those stronger checks today.
This is a defense-in-depth gap, not a demonstrated reachable cross-tenant exploit.

scopedDb maintains manual direct/parent/nested-relation maps. Unclassified delegates
pass through as global. Raw SQL is not rewritten. ownedData handles create/update
and createMany on listed nested relations, but not all Prisma nested operations
(connect, connectOrCreate, nested upsert/updateMany/deleteMany and others). Parent-
owned creates do not automatically validate every related ID. The wrapper retains
the Prisma client type, so TypeScript does not restrict callers to the supported
subset. Explicit domain predicates and composite foreign keys remain necessary.

These repeated values have different ownership and must not be deduplicated blindly:

| Values              | Authority and intentional copies                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gameplay scoring    | TournamentSettings.gameplayScoring controls new records; Match.rules, QualifierLobby.rules/gameplayScoring and score provenance preserve historical interpretation                  |
| Players and teams   | User/Participant share global numeric identity; Team/TeamMember own current registration; Match/QualifierLobby participants JSON freezes the played roster                          |
| Beatmaps and pools  | Beatmap is refreshable metadata cache; MappoolSlot and PoolCandidate metadata are saved workflow witnesses; pool revisions preserve publications/history                            |
| Competition         | Native rows own current nodes/routes; Bracket.config and seedOrder retain generation/source witnesses; legacy W/L labels retain supported historical dependencies                   |
| Qualifier standings | Source rows and hashes witness the cohort; versioned snapshot owns reviewed statistics/ties/seeds; import rebinding proves equivalence rather than recalculating history            |
| Portability         | ARCHIVE_TABLES is a security allowlist, not generated Prisma serialization; identity remapping, insertion order and deferred pointers implement its versioned relationship contract |

Tenant/time filters lack matching leading indexes on several hot collections
(for example AuditLog has createdAt alone and Match has status/scheduledAt).
This is a query-plan investigation candidate, not a measured performance failure.
Public matches/teams and team exports cap at 500, admin media at 200 and user lookup
at 100 without continuation contracts. Conversely, matches, pooling candidates,
qualifier sessions and competition reads can load whole collections and children.
Archive byte/record bounds do not measure peak RSS across parsing, remapping and
ZIP buffers. See [F07](PLAN.md#f07-read-size-and-index-budget).

### Target Boundaries - Not Yet Implemented

Keep the existing monolith and its domain vocabulary. Extract cohesive reads,
scheduling predicates, correction workflows and archive witness functions from
the largest services, retaining one orchestration point for each transaction.
Client-shared types, labels and normalization belong beside pure domain modules.
Split large editor dialogs/selection/form sections around their actual workflows,
using the existing controls, resource hooks and semantic tokens.

Make ownership checks, reviewed witnesses and public projections explicit at every
entrypoint. Extend supported-operation tests before tightening scopedDb; add
relational constraints only after isolated scans and reviewed repairs. Preserve
the archive allowlist independently and verify its schema coverage automatically.
Keep current locks until concurrent-writer tests justify a narrower protocol.
No module moves, schema migrations, service changes or UI redesign have been made
as part of this audit. The execution sequence and migration gates are in PLAN.

## Development And Tests

Use Node22.12+, npm ci, isolated reachable DB/matching APP_DATABASE_NAME and local
APP_URL/storage. Generate Prisma, then `npm run dev -- --port 3000`. Docker dev uses
separate config/STACK_NAME, install, then
`./portal compose -f compose.yaml -f compose.dev.yaml up --build web`.
Read-only source mounts use separate dependency/generated/Next volumes; host env/
.data are not mounted. Refresh only task-owned development volumes, never persistence.

Integration/E2E DB must be tournament_platform_test, TEST_DATABASE_URL in private
.env.test. Setup guards name and creates synthetic fixtures. Standard checks:

```bash
npm ci
npm run db:generate
npm run test:db:setup
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:integration
npx playwright install --with-deps chromium
npm run test:e2e
# With isolated DATABASE_URL and APP_DATABASE_NAME configured:
npm run build
E2E_PRODUCTION=1 npm run test:e2e
```

Run integration/browser sequentially; owner fixtures require no competing temporary
platform admins. Build before production E2E. Harness copies public/static beside
standalone like Docker; does not migrate/create networks. Smaller serial spec batches
handle external session limits. Never count terminated runs as passed or delete
unknown fixtures. Session fixtures are test-only, no production fake-login endpoint.

Relevant suites: pure ordering/stage/pooling, rules/engine/Discord goldens, strict
IRC mock TCP, competition/scoring/numbering/qualifier mathematics; PostgreSQL
tenant/permission/stale-write/history/archive tests; E2E workspace/tournaments/
transfer/competition/stages/bulk matches/referee/public pools/standings. Browser mocks
do not replace persistence coverage or live-provider checks.

Smoke harnesses need explicit isolated environments. workspace.ts requires empty
migrated/bootstrapped platform_workspace_dev_test or platform_workspace_prod_test,
loopback APP_URL, test owner 990200001 and ALLOW_ISOLATED_CONTAINER_TESTS=yes. It
checks first lifecycle without seeded main; CI runs it against production Docker.
It retains records; use a new isolated target for another fresh run. Storage/media
smokes need matching staging config, never installation DB.

Visual harnesses guard platform_visual_test; current profile/rollout/E2E supersede
rejected pilot compositions. Real artwork is private QA input, never committed.
IRC E2E uses IRC_ENABLED, random test-only secret >=64 chars and mock Bancho, never
real passwords. [DESIGN.md](DESIGN.md#verification) defines rendered acceptance.

CI checks secrets/history, format/lint/types/Prisma, unit/DB/browser/build, dependency
audit, source audit, fresh Docker/storage, overlays, notices and container scans.
Release review uses `node scripts/source-audit.mjs --tracked`, `npm run licenses`.
No automatic release is implied by passed CI.

## Security And Distribution

Report vulnerabilities privately through the repository's
[Security tab](https://github.com/manu028-727/osu-tournament-portal/security), not
public issues containing private records/contacts/secrets. Include affected version,
synthetic reproduction, impact/remediation. Do not test destructive live operations
or rotate credentials without operator involvement. HTTPS, trusted host, private
DB/storage, scoped access, secure cookies and exact callbacks are boundaries.
No secrets in NEXT_PUBLIC, image build arguments, logs, URLs, issues or archives.
Review advisories and least-privilege access.

Application is [MIT](../LICENSE); private npm flag prevents accidental npm publishing,
not public licensing. Contributors need redistribution rights and preserve notices.
Never distribute private workbooks/art/registrations/history/screenshots. Use synthetic
fixtures/licensed assets; tiny WebP fixture is generated. IBM Plex WOFF2/OFL is in
public/fonts/LICENSE.txt; Lucide retains upstream terms. Native interoperability
does not redistribute workbooks/Apps Script or incompatible upstream code.

Review native/transitive obligations including Sharp/libvips LGPL. npm run licenses
writes ignored .data/licenses/THIRD_PARTY_NOTICES.txt; images include notices at
/app/THIRD_PARTY_NOTICES.txt and MIT at /LICENSE. Preserve both. ExcelJS unzipper/uuid
overrides avoid the obsolete unlicensed buffers chain; do not remove without license/
import regression review. middleware-handler has MIT LICENSE despite metadata gap.
RustFS Apache-2.0, PostgreSQL, Node/OS and Distroless keep their own terms. npm license
metadata is not a native/OS SBOM; review/scan images before publication. Platform MIT
grants no rights to private instance assets. Contributions are under project MIT.
