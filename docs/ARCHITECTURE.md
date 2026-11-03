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
  [implementation boundaries](#implementation-boundaries-and-cleanup),
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
Editing guards require an explicit proxy-derived slug independently of public
featured/default resolution, including specialized upload/export/provider routes.

`src/app/(public)/layout.tsx` owns published profile/identity/tabs outside changing
page content. Same-tournament links reuse nodes; cross-tournament links deliberately
replace the document to reset tenant state. Every guest reader uses the shared
published-and-not-archived predicate. Archiving preserves saved publication flags
and content while withholding the tournament from guests.

## API And Mutation Contracts

Team/match public readers and team/media admin reads support explicit pagination
(`paged=1&page=N` for JSON). Public pages use 50 records, organizer teams 100 and
media 100. Stable ID tie breakers prevent omissions among equal sort values;
counts and match filter options describe the full authorized collection. Legacy
JSON readers without `paged` retain complete arrays for compatibility.
`teams-export.ts` streams a read-only RepeatableRead snapshot in 100-team keyset
batches with backpressure, a 60-second transaction bound and formula-safe CSV.
Cancellation/read errors abort the stream; exports have no list cap.

Principal handlers under `src/app/api`:

| Route                                             | Contract                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| `/api/auth/{login,callback,logout}`               | OAuth initiation/consumption and POST revocation                           |
| `/api/tournaments`                                | Platform listing and tournament lifecycle/configuration                    |
| `/api/admin/data?section=...&tournament=<slug>`   | Permission-filtered scoped reads                                           |
| `/api/admin/action?tournament=<slug>`             | Validated action union and transaction dispatcher                          |
| `/api/admin/{beatmaps,players}`                   | Authorized official-provider metadata                                      |
| `/api/admin/teams/export`                         | Authorized roster export                                                   |
| `/api/admin/{multiplayer,qualifier-multiplayer}`  | Reviewed official match evidence                                           |
| `/api/admin/qualifier-import`                     | Stage-selected paginated qualifier MP import previews/application          |
| `/api/registration`                               | Native captain registration and qualifier booking, without workspace roles |
| `/api/admin/referee-import`                       | Workbook preview, destinations, reviewed application                       |
| `/api/media`, `/api/media/<id>`                   | Scoped uploads/catalog and authorized bytes                                |
| `/api/platform/media`, `/api/platform/media/<id>` | Independently owned platform assets                                        |
| `/api/public/<resource>`                          | Explicit public projections, not private serialization                     |
| `/api/tournament-transfer/{export,import}`        | Archives, validation/application and recovery                              |
| `/api/irc/ticket`, `/api/internal/irc`            | Session-bound ticket and signed reauthorized RPC                           |
| `/api/health`                                     | Runtime health used by image checks                                        |

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
5. Return saved results and refresh resources. Mutable editors compare reviewed
   versions/revisions/configuration witnesses; settings apply narrow versioned
   patches and stage updates require configuration tokens.
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

| Models                                                                                                                | Identity, Relationships And Purpose                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User, Session, OAuthState, RateLimit                                                                                  | Global unique osuId; hashed credentials/state, expiry and durable rate windows                                                                           |
| Permission, Role, UserRole, RolePermission                                                                            | Global permission catalog; local role names unique per tenant, composite membership ownership; legacy system keys retained                               |
| PlatformSettings, PlatformAsset                                                                                       | Singleton main, one-time bootstrap/root/featured settings; globally owned assets                                                                         |
| Tournament, TournamentSettings                                                                                        | Unique slug, lifecycle/timezone/version/number counter; one-to-one branding/navigation/scoring/rules                                                     |
| Page, PageRevision, ContentBlock                                                                                      | Unique tenant/slug, independent draft/public pointers, saved immutable revisions, ordered typed JSON blocks                                              |
| TournamentStage, ModCategory                                                                                          | Tenant slug/type/rules/policy/banner/progression; configurable acronym/color/priority                                                                    |
| Mappool, MappoolRevision, MappoolSlot, Beatmap                                                                        | Pool per stage, revision pointers, unique slot/name and position per revision; global metadata cache plus frozen slot values                             |
| PoolPlan, PoolCandidate, PoolSkillset, PoolCandidateTag, PoolReview, PoolArtistWarning                                | Plan/stage; unique candidate beatmap/tenant, scoped skillsets/tags, candidate/reviewer uniqueness and normalized artist warnings                         |
| Participant, Team, TeamMember                                                                                         | Global numeric player identity; tenant registration/approval/seeding/source; one roster ownership per tenant/player, ordered members                     |
| StaffMember, StaffCategory, StaffAssignment                                                                           | Tenant public profile/visibility and many-to-many positions; no access grant                                                                             |
| MediaAsset, AuditLog                                                                                                  | Opaque unique storage keys/metadata; scoped/platform actor/action/entity/details/time                                                                    |
| Match, MatchAssignment                                                                                                | Stable local number/source code; stage/pool/team references, frozen participants/rules, state/version/score/roll/timer/lobby, assigned users             |
| MatchMapAction, MatchMapResult, MatchPlayerScore                                                                      | Unique match/sequence, result/action, result/player; void/correction and score provenance                                                                |
| MatchEvent, MatchResultRevision, MultiplayerGame                                                                      | Unique match/version history and unique match/MP/game evidence                                                                                           |
| QualifierLobby, QualifierEntry, QualifierAssignment, QualifierScore, QualifierGame, QualifierEvent, QualifierStanding | Sessions/snapshots/booking capacity, ordered entrants/staff, unique lobby/player/slot/run and source games, versioned events and stage/version standings |
| Bracket, BracketRound, BracketNode, BracketSlot, BracketEntry                                                         | Native paths, ordered stage-mapped rounds, unique node keys/match bindings/numbers, source routes and path-specific seed/eligibility                     |
| RefereeImport, IrcLobbyRequest, TournamentTransfer                                                                    | Expiring parsed previews, durable uncertain room creation, archive upload/cleanup journal                                                                |

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
from the document. The shared `TournamentProfileHeader` reads only tournament
settings; public layout does not fetch homepage revisions. `HomepageContent`
renders each visible block independently, including all Hero fields, explicit
navigation-destination buttons, all important dates and existing page-level HTML.
Draft preview uses the same renderer under the tournament palette. The editor API
synthesizes empty defaults for absent pages; tournament creation does not write
blank saved revisions or mark unsaved pages as completed work.

Homepage editor IDs exist only in mounted client state and stay stable across
reordering. Save sends the canonical block envelope without those IDs. When a
block carries HTML, changing its type retains the rich editor; editing HTML clears
the obsolete plain-text fallback so it cannot mask or resurrect older body text.
Existing page HTML has a separate introduction editor. These presentation changes
require no schema or content migration. Profile/tab styling and homepage styling
have separate owners, with shared page-width tokens in globals.css.

RichEditor emits `editor.getHTML()`, not a persisted TipTap document tree.
`PageRevision.html` and block `content.html` are sanitized on save/import and public
read. Block envelopes remain JSON. `publicPage` selects visible blocks from the
published revision behind the tournament lifecycle gate; the renderer also checks
visibility for authorized previews. Public media-reference inference excludes
hidden-block content. Independent saved drafts remain private. Historical findings
are recorded in [F14](PLAN.md#f14-public-projections).

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
`pool-suggestions-panel.tsx` reads the same authorized pooling data inside
`pool-editor.tsx`, reuses its metadata/review display helpers, and uses the existing
acceptance and `pooling.select` actions. It does not implement a second selection
policy. Pending local pool edits first save through `pool.save`, then assignment
compares the returned draft revision and candidate version. If assignment fails,
the completed draft save remains visible; no edits are silently discarded and no
publication changes. Replacement and artist resolutions follow the same service
checks as the full suggestions workspace.

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
explicit matches.delete workflow with dependency guards; generated matches use the
retained deletion lifecycle described below rather than cascading their history.

`match-numbering.ts`/SQL trigger serialize allocation on tournament counter.
Positive matchNumber is tenant-unique and immutable while its record is retained. Requested
numeric source codes must exceed the allocated high-water mark; nonnumeric codes
retain spelling with a new number. Migration preserves unambiguous numeric codes
and allocates remaining records safely. Numeric public URLs resolve numbers only.
New bracket source codes use their reserved number. Existing generated codes remain
as compatibility witnesses, with numeric labels and referee URL aliases hiding
those identifiers from the interface. The underlying referee record ID is unchanged.

`match-queries.ts` paginates organizer matches at 50 rows, with full filtered totals
and deterministic number/schedule/stage/update ordering. Search includes frozen
participant names, live names, referee assignments, external credit, stage and notes.
`matches-dashboard.tsx` retains query state in the URL, debounces search, clears
page/filter selections and suspends polling during inline/result editing. Inline
schedule cells reuse the existing `match.schedule` authorization/version/conflict
path. No separate mutable scheduling implementation exists.
`match-inline-result.tsx` owns the compact score/winner/FF form. One editor instance
portals into the visible row/card host, preserving unsaved state across responsive
layout changes. Optional reason/credit fields are secondary; default reasons still
produce attributed events. Partial scores remain IN_PROGRESS; a configured winning
score confirms through the existing result service. Referee gameplay is unchanged.

`match-results-contract.ts` owns client-safe organizer result actions. The existing
mutation dispatcher explicitly routes both actions to `matches.manage` and
`match-results-service.ts` under the established global advisory lock. An overall
decision uses SUMMARY mode, retains all referee actions/results, appends an event
and result revision, and advances only after confirmation. Existing winner-based
correction previews/locks protect downstream gameplay and frozen standings; the
reviewed hash is compared again inside the transaction. Result entry does not
renumber records or convert historical scoring.
An explicitly saved `source.organizerResult.externalReferee` controls public
result credit before assignments, without granting access or changing assignments.
Multiplayer re-import preserves that credit; legacy sheet credit keeps its existing
fallback behavior.

Generated deletion uses the existing `match.delete` permission/action with a
reviewed impact hash and version under the same lock. `Match.deletedAt` is a
retained lifecycle witness: the match becomes CANCELLED and unpublished while
all actions, scores, events, revisions and its node/number remain intact. The
DELETED node has no progression output and cannot lazily recreate a match.
Unstarted downstream assignments can be cleared with approval; protected matches,
frozen source standings, legacy dependencies and pending/unknown room requests
block deletion. Deleted records remain readable through a list filter and reject
mutations until the established organizer reopen action clears the marker.
Workbook and reconciliation entrypoints enforce the same guard. Public projections
exclude deleted records independently of publication flags. Standalone permanent
deletion retains its established confirmation/dependency behavior.

Apply `20261028010000_generated_match_deletion` and
`20261028020000_deleted_bracket_state` through the normal migration workflow before
running this source. They add the nullable date and expand the existing node state
constraint; foreign keys and immutable number triggers remain unchanged. The archive
allowlist explicitly includes the date, old archives default to null, and competition
restoration retains deleted nodes and historical roster witnesses without activating
them. scopedDb ownership still follows the retained Match parent for child history.

Native brackets use the established engine for SE/DE/groups construction and native
rows for lifecycle/routes/eligibility/lazy matches. Newly generated playable nodes
reserve numbers by stage progression, lane (Winners, Losers, shared finals), native
round position and top-to-bottom node position/key; BYE/SKIPPED consume none. Lazy creation
retains reservations even after unrelated matches are created. Confirmed results
advance; losses/withdrawals/overrides are path-specific. Manual slots/routes/locks
are audited, cycle-checked and cannot replace started history.

`competition-stages.ts` owns pure stage ordering and suggestions. It topologically
orders active head-to-head stages using `nextStageId`, then configured position/ID
for unrelated stages. Suggestions follow explicit links from the selected start,
fall back to that order and clamp to the last available stage. Winners round N
uses offset N-1; Losers round N uses floor(N/2); shared finals use the stage after
Winners Finals, with the reset on the same stage. Third place uses its Winners
final stage and group rounds stay at the selected start. No names are interpreted.
`generateCompetition` applies explicit round overrides after suggestions without
changing upstream seed placement, routes, keys or stored round positions.

`checkedPlan` validates selected and suggested stages, roster eligibility, seeding
sources, override keys and forward stage dependencies for preview and creation.
The preview uses recalculated synthetic nodes to exclude byes and the same
`match-numbering.ts` ordering as persisted reservations. Stage ranks are transient
`NumberableRound.stagePosition` metadata; no schema field or migration is added.
The existing global advisory lock precedes a tournament counter row lock during
creation. Before inserting, the optional reviewed hash compares the request, graph,
stage/rules/source witnesses and current counter, retaining that row lock through
reservation. Manual-link previews reserve nothing and omit the counter witness.
The browser always sends the preview hash; existing direct create callers without
one compute and validate the current plan under the same locks. A stale reviewed
writer rejects before creating any rows. Generation-key retries return their
existing graph before re-evaluating the now-advanced counter.

The hash is transient and excluded from saved creation configuration. Existing
configuration JSON retains the requested overrides; persisted BracketRound.stageId
is the authoritative assignment snapshot and is already exported/remapped with its
round. Rebuild pre-fills eligible actual assignments, drops unavailable stages and
refreshes suggestions when the entrant count changes. Archives, applied SQL numbering
triggers, immutable existing reservations and referee histories remain unchanged;
neither imports nor stage edits recompute old numbers using the new ordering.

`bracket-presentation.ts` owns display-only lane grouping, coordinates, labels and
connector filtering. It reads the native graph without mutating it. DE has two
display paths; the engine's existing FINALS lane is rendered as their common ending,
not as a third section. Winners/Losers Finals share the last path column; Grand
Finals and reset follow in columns to the right. Only same-path connectors render.
Slot labels read reserved numbers and resolved team IDs. Under the existing
B-wins reset condition, RESET_A/RESET_B label the Grand Finals loser/winner while
retaining their original sides; no reset eligibility or color rule is changed.
The existing bracket renderer, round tools, preview and inspector share these labels.

Competition read queries now include only the related stage's name and project
optional `stageName` on round DTOs in both authorized and public views. The public
projection contains no stage rules, pool drafts or added configuration. Presentation
code never writes stored round names/lane keys, generation configuration, archives
or mutation/domain state. Display grouping requires no migration.

Bracket lifecycle operations live in `competition-service.ts` and the existing
mutation dispatcher. Delete and its preview require both `matches.manage` and
`matches.delete`; restoration/missing generation require `matches.manage`.
The shared advisory lock protects a preview hash covering bracket/configuration,
nodes, slots, match versions/assignments, dependencies, lobby requests and current
stage/settings witnesses. The write compares this hash and bracket version again.
Single-fixture regeneration reads the retained deletion event, restores that same
record and prior status, appends an event/revision and reuses normal progression
persistence. Recorded rosters and started downstream matches cannot be replaced;
unstarted downstream changes require approval. Missing generation creates only
ready empty positions, respects manual-link mode and leaves deleted records alone.

Whole-bracket deletion is an explicit permanent purge. Active gameplay,
pending/UNKNOWN room requests and external progression/seed/legacy match
dependencies block it. Under the global lock and tournament counter row lock,
the operation deletes owned slots, nodes, entries and rounds before their bracket,
then deletes linked multiplayer evidence and matches. Existing FK cascades remove
assignments, lobby requests, referee actions, scores, events and revisions.
Associated bracket/match audits are removed; bulk schedule receipts are scrubbed
only of purged entries. The replacement audit contains deletion counts and whether
numbering restarted, without old match payloads. The tournament counter is reset
to zero only if no other match or reserved node number remains. Recreated brackets
then start at 1; unrelated records keep their existing IDs and counter allocation.

Rebuild deliberately uses the existing generation preview/create path with a fresh
generation key, reviewed participants and stage configuration. Removal and new
generation are separate reviewed operations: a failed new generation does not undo
the permanent deletion. Reusing numbers is limited to this reviewed empty-counter
reset. Apply `20261029010000_bracket_retirement` and
`20261029020000_permanent_bracket_deletion` in order through normal migrations.
The first also replaces unconditional pair/time uniqueness with a SQL partial unique
index on nondeleted matches (plus the ordinary Prisma index). The compensating
migration removes the intermediate parent marker; no applied migration is rewritten.
Scheduling availability excludes individually retained deleted fixtures. Purged
graphs and histories are absent from subsequent archives; the existing individual
fixture deletion date remains compatible. No ownership delegate or cascading FK
has changed.

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

### Formats And Setup Workspace

`format-plan.ts` is the client-safe contract for who plays where; rules stay on stages and
entrants on teams. `TournamentPhase` rows persist it with a token witness, through
`format-plan-service.ts` under `matches.manage`. `format-graph.ts` builds a phase's bracket
before entrants exist, using `entryRef` placeholders with `resolved:false` so nothing reads
as a bye. A Losers lane fed from outside is the library's standard graph of twice the size
with Winners round 1 removed. `format-advancement.ts` owns draws, group labels, tiebreak
chains, placement routing and the rematch solver. These are pure.

`format-lifecycle-service.ts` persists them. `format.lock` creates a `Bracket` per phase with
`config.phaseKey` and reserves numbers through the normal allocator, holding the established
stage then tournament row lock order. Its config stores no entrants until advancement, so
`competitionStoredConfigSchema` allows empty `teamIds`; `competitionCreationSchema` compares
creation requests across archives. `format.advance` re-derives everything from
`format-guards.ts`, compares a review hash, then writes entries, slots and an append-only
`PhaseAdvancement` holding the source witness and resulting slot map. Regenerating an AUTO
slot reads that map rather than a library plan. `persistRecalculation` still owns slot,
state and lazy match writes, so protected-match and roster checks apply unchanged.

A phase may read several sources, so its bracket lists `sourceStandingIds` and
`sourceBracketIds` instead of the single-source fields. `assertPhaseSourcesCurrent` runs at
match start beside the older source checks. `consumersOfBracket` blocks a correction only
when the later phase has been played, and qualifier reopening walks the same lists. Hashes
name database identities, so import calls `rebindImportedAdvancements` after standings and
competition rebinding. `phaseRanking` and `phaseAdvancing` in the saved config let standings
and eligibility read a group's own tiebreakers without loading the plan. `BracketEntry.
lossesAllowed` carries the one-life rule. Whole-bracket deletion refuses format brackets;
`format.unlock` removes them all, and resets numbering only under the existing empty-counter
exception. Rounds gain no columns, because their projection is spread publicly: group labels
live in the round name, and public slots expose only `entryLabel`.

`setup.apply` runs several pure configuration operations in one transaction, resolving
`ref:<name>` so later operations can read a stage created earlier. It has no authority of
its own: `applyAdminOperation` re-checks each operation's permission and media ownership
and writes its audit, exactly as a single action does. `SETUP_OPERATIONS` lists what may
join, excluding pools, staff and pages because they need network calls before their
transaction opens. `setup-queries.ts` is the read model; its stage token hashes only a
stage's own columns, matching the save path. `setupState` holds dismissed checklist items.

## Qualifiers, Scoring And Standings

`gameplay-scoring.ts` defines SCORE_V1, SCORE_V2, LAZER. Canonical selection is
TournamentSettings.gameplayScoring; stages inherit, historical records retain
snapshots. Legacy inference requires unanimous modes; conflicting evidence needs
review. Competition locks scoring except reviewed resolution of an unknown mode
matching every historical witness. Lazer accepts acknowledged standardized manual
scores, not classic display or legacy Bancho/API capture. No numerical conversion
between gameplay systems is fabricated.

`score-pipeline.ts` is the one owner of how a performance becomes a map result, for
live capture, manual entry, reviewed multiplayer imports and qualifier mod checks.
`scoreMode` only describes the lobby: the `!mp set` argument and the API gate.
`winCondition` decides what a map is won on (score, team average accuracy, combo or
misses) and inheritance never rewrites it, so a ScoreV2 lobby can be decided on
accuracy from the same evidence. Accuracy is averaged, keeps its decimals and is never
multiplied; `mapWinner` treats floating-point noise as a draw to replay. Raw score stays
stored as evidence beside the deciding metric. A metric saved through the old Bancho
mode reads with its original behaviour through `effectiveWinCondition`. Match totals may
therefore be decimal in `MatchMapResult`, while `Match.scoreA/B` remain maps won.

`requiredMods` applies to every map, and a required mod is stripped before multiplier
lookup so it cannot change the result. `categoryOptionalMods` and `categoryAllowedMods`
refine single categories. `freeModQuotas` lists requirements in priority order, and each
player fills the first one they satisfy; without it a snapshot keeps its original
HDHR-as-HR and EZ-as-HD counting. Reviewed multiplayer imports deliberately skip lineup
and mod enforcement so usable historical evidence is kept, but use the same team value
and winner functions. Qualifiers also compare category mods, which matches do not, and
keep their saved eligibility wording. Workbook imports stay provenance only.

Parsing a saved snapshot must never start failing: `matchRulesSchema` only validates new
fields, and every default in it stays as it was because old snapshots rely on it. New
tournaments instead start from `neutralMatchRules`, which chooses neutral multipliers
and policy text and only asks for FreeMod quotas a team of that size can meet.

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
%MAX            = sum_m (T[i,m] / max_i(T[i,m]) * 100)
Avg placement   = sum_m (1 + count(T[j,m] > T[i,m])) / M, lowest first
```

`qualifier-seeding/4` covers `PERCENT_MAX`, `AVERAGE_PLACEMENT` and any `metric` other
than score. A qualifier seeded on accuracy or combo stores that value as `adjusted`, and
raw score stays as evidence. Missing metric evidence excludes the score with a reason
instead of counting zero. Older versions never read the new columns or references.

**Witness rule.** `loadQualifierCalculation` names every hashed score and game field
explicitly, because a spread would let any new column change every saved source hash.
Qualifier policy fields must be optional with no default for the same reason, since the
parsed policy is hashed. `tests/format-witnesses.test.ts` and its integration counterpart
pin these from before the format engine. Never update one to make a test pass.

Match Cost is OSUPLUS_QUALIFIER_COHORT_V1, not every formula called match cost.
References are complete eligible entrants across rooms without winner/TB bonuses.
Example `[100,80]` versus `[50,40]`: means 75/60 and first cost
`2/4 * (100/75 + 80/60) = 4/3`. Independently derived from the positive-reference
formula in [osu!plus revision b143241](https://github.com/limjeck/osuplus/blob/b143241ec202f624e58ba7326b5d0e8f5ad339ed/osuplus.user.js#L1108-L1197),
without copying incompatible code; general methods follow the
[osu! seeding definitions](https://osu.ppy.sh/wiki/en/Tournaments/Common_seeding_methods).

Incomplete entrants get no seed and do not affect official references. New
`qualifier-seeding/3` calculations require a complete played run per entrant,
respecting FIRST_RUN/SECOND_RUN; observed excluded scores count toward played maps,
and optional incomplete runs do not block an otherwise eligible entrant. BEST_PER_MAP
can combine valid maps from played runs containing exclusions; BEST_COMPLETE_RUN
still needs one wholly eligible run. Excluded scores remain in the hashed source and
never become zero. Version 2 retains its complete-eligible-run requirement; version 1
retains its requirement that every configured run be eligible and complete.
Existing finalized version-1/version-2 calculations keep their exact owner/hash until
reviewed reopening; archive restoration reproduces all three known versions. Duplicate
plays/ownership, unverified/inconsistent provenance and unconfirmed sessions block.
Zero deviation contributes zero/warning; fewer than two complete entrants blocks
sample Z-Sum; zero Match Cost reference blocks instead of inventing a denominator.
Provisional partial values are not final seeds. Raw V1 range bias is warned. Full
precision determines ties; ID order is display-only; ties need explicit order/reason.

`qualifier-score.ts` owns native score interpretation, configured tournament
multipliers, per-player rounding and individual eligibility. Native osu!standard
legacy multipliers follow the scoring-mode branch in
[ppy/osu's legacy score simulator](https://github.com/ppy/osu/blob/master/osu.Game.Rulesets.Osu/Difficulty/OsuLegacyScoreSimulator.cs#L161-L208):
HR/DT/NF differ between V1 and V2. Explicit normalization is unsupported for lazer
and other rulesets; reported scores remain available. FLOOR/ROUND use exact rational
arithmetic before aggregation, avoiding floating-point underflow at integer boundaries.
Absent optional policy keys preserve the former conversion behavior and hashes.
Pass status remains nullable provider evidence; eligibilityOverride records an explicit
INCLUDE/EXCLUDE separately from automatic rule decisions. Older explicit decisions
are recovered only from matching audited events, never guessed from free-text reasons.

`POST /api/admin/qualifier-score-review` is manager-only, same-origin and rate-limited.
`qualifier-corrections-service.ts` projects the complete cohort under root/stage locks,
checks each reviewed lobby version and hashes the source plus correction choices.
Preview and apply use the same projection; application rechecks the review hash,
records before/after scores and policies, and reconciles played completion without
closing IRC or touching finalized seedings/brackets. Map/run/player corrections
persist as reviewedMapping alongside original game evidence. Reprocess covers every
non-cancelled stage source, including retained deleted histories; this explicit
derived-data correction preserves raw receipts and lifecycle. Other deleted-session
mutations remain forbidden. Revalidation preserves explicit decisions; restore clears
them and re-runs automatic checks. Remapping rejects destination conflicts.

`20261102010000_qualifier_score_decisions` adds nullable passed/eligibilityOverride
with a SQL decision allowlist. `20261102020000_qualifier_booking_policy` adds nullable
booking configuration. Both are additive, are applied by `./portal install`, and
perform no historical recalculation or data backfill. Archive allowlists include
these fields with backward-compatible absent/null handling and decision validation.

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

`multiplayer.ts`/`qualifier-multiplayer.ts` paginate and parse official game evidence.
`qualifier-capture-service.ts` owns live ingestion and the shared API/import writer:
root advisory lock, refreshed authorization, stage row lock, session version,
frozen-roster conversion and per-score/event/audit provenance. QualifierGame retains
original provider evidence plus the accepted proposal or explicit exclusion. Its
session/MP/game key makes re-import duplicate-safe; stage/player/game checks prevent
reusing a performance in another session/run. Accepted games preserve later manual
corrections. Missing scores never become zero and pending receipts block finalization.
The exact multiplayer/game pair in a server-recorded `qualifier.source.imported`
event identifies reviewed historical evidence. Capture previews, player exclusions
and automatic synchronization reuse that provenance instead of comparing historical
games with the later website START time. Other games retain the live start boundary.
Synchronization can repair an automatic pre-start exclusion only for witnessed
imports without an explicit game/import exclusion; it audits the classification
change and preserves score corrections and intentional-removal tombstones.
Accepted partial receipts can gain new player rows through the same writer. Source
revisions retain before/after evidence; existing scores and intentional removal
events protect corrections from automatic replacement/resurrection. Explicit
replacement can relocate a game between reviewed runs/maps by removing its old
linked rows through the canonical audited owner, preventing double counting.
Individual rule violations persist as QualifierScore.eligible=false with an
eligibilityReason; their raw/mod/adjusted/provenance fields remain evidence.
Unsupported mods retain their original list. Parsing malformed, unknown or duplicate
player rows preserves their game evidence and does not discard other players.
FreeMod quotas are evaluated for the affected team/map/run, consistently in progress,
exception review and standings. Canonical bulk eligibility overrides require manager
permission, reviewed session version, a reason and before/after history.

`reconcileQualifierCompletion` owns automatic completion/resumption under the root
lock followed by the existing stage lock. It checks complete eligible runs per
entrant, selection policy and complete API history. API/import completion records
autoCompleted and a versioned event; later optional scores remain writable through
the same canonical owner. Manual-only confirmation stays explicit. No completion
path sends IRC commands or finalizes standings. Finalized sources stop score polling.

Qualifier ref pages poll score synchronization every 20 seconds while visible and
running or automatically completed; the persistent checkpoint resumes bounded six-page API requests until
history is complete. No partial history is scored. Referee-selected warmup events,
unrelated maps and pre-start games are excluded; other ambiguities remain reviewable.
`qualifier-import-service.ts` uses the same parser/writer for stage-selected bulk
links. Existing RefereeImport caches bounded, actor-owned 24-hour previews with a
QUALIFIER_MP_V1 discriminator, source checkpoints and stage/roster/session witness.
Bulk preview bounds the total page budget, persists successful sources even if
another source fails, and resumes remaining sources without re-fetching completed
histories. No partially loaded batch can apply scores.
Once every source is complete, refreshing unchanged decisions reloads provider
history to find late scores. A partially loaded/failed batch instead resumes its
checkpoints without re-fetching already successful sources. Reviewed player
exclusions also update linked existing source scores through the eligibility owner;
raw rows, manual corrections and durable source exclusions remain preserved.
Workbook readers explicitly reject that discriminator. Apply rechecks the witness
under the root/stage locks before creating external sessions/evidence; individual
game transactions use reviewed versions and report partial failures for resumable
review. External starts carry explicit provenance, without inventing website staff
or IRC execution. Configured runs follow complete pool cycles; retries require
explicit review. Exclusions and corrections retain original evidence and audit.
Valid games can apply despite game-level ambiguities elsewhere in the loaded source.
An import's proposed team totals exclude ineligible scores. The direct-import action
shares the exact preview/fingerprint/decision writer with advanced review.

Session deletion is a guarded soft deletion: deletedAt removes operational visibility
and booking; unused SCHEDULED reservations become CANCELLED, while completed sources
keep their status, scores, entries, games and events. All protected single/bulk,
booking, capture and IRC paths enforce the retained record's read-only state.
Pending/unknown room creation and active sessions block deletion. IRC room closure
is independent. Completed sessions with pending games or incomplete provider history
also block deletion, preventing stranded read-only evidence during optional runs.
Canonical archive allowlists include deletedAt, autoCompleted,
eligible and eligibilityReason, with backward defaults for older archives.
`20261030020000_qualifier_eligibility_lifecycle` is additive and applied by the normal
`./portal install` migration step; it does not recalculate historical results.

Evidence is not automatically an official result or duplicate run.
Organizer imports use `POST /api/admin/match-results` for impact/source preview and
`match.result.import` for application. They use the official
[Get Match API](https://osu.ppy.sh/docs/#get-match), with legacy score representation
pinned through the API version header, server credentials and existing timeouts.
`organizer-multiplayer.ts` reconstructs tournament sides by immutable osu! IDs in
the match roster, including substitutes. Lobby colors and mutable names do not own
team identity. Unknown/shared identities require explicit mappings. Team totals sum
available score evidence with the frozen multiplier policy; historical team-size,
NoFail or missing pool membership do not invent or discard scores. Custom slot
multipliers still need a uniquely identified slot, and unsupported scoring, ties,
duplicate players or absent team evidence require review. Referee synchronization
retains its strict pool, start-time, roster/color and state-machine checks.

`match-result-review.ts` signs bounded, actor/tenant/match/version-bound evidence
for 15 minutes using domain-separated HMAC and the existing private osu! client
secret. Tokens contain no credentials, stay in the authorized editor,
are not persisted in audit, and are invalidated by credential rotation. The server
verifies the signature and reviewed version before accepting decisions. This
stateless preview works across processes sharing the installation credentials.
History loads in six-page batches with signed continuation checkpoints; previews
are bounded to 120 games and the existing request-size limit. Incomplete history
cannot be applied, and source failures leave the saved match unchanged.
The organizer form supplies an explicit warmup count (default zero), then counts
accepted games chronologically to the win target. Unambiguous complete history
applies directly; partial outcomes remain IN_PROGRESS. Ambiguous identities or
unsupported evidence expose review rather than a default approval checkbox.
Complete signed evidence can be recalculated without another provider request;
fresh imports still fetch the source. Saved warmup/mapping decisions stay in
`source.organizerResult`; source evidence and reviewed game decisions remain
separate provenance. Warmup changes recalculate inclusion while retaining reviewed
map winners and their reasons. Unchanged re-imports preserve explicit previous
decisions. Saving a link without importing still uses the existing `match.lobby`
action. A possible no-op still
reaches server fingerprint verification even when downstream state is protected.

Accepted and excluded games persist in MultiplayerGame under the existing unique
match/lobby/game key. Its evidence is source provenance; proposal.organizerReview
is a separately attributed decision, never a fabricated pick/ban or score
conversion. Corrections retain prior game rows in the event witness; games missing
from the replacement review remain retained but are excluded from current public
history. Identical re-import is a no-op. Completed public projections select only
approved current-lobby games and omit review reasons, tokens, actors and raw
payloads; unpublished pool beatmap links remain withheld. These JSON additions
use existing archive fields, without adding tables or exporting server authority.
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
deletion is refused, including hidden and historical references. Archive imports
retain retryable cleanup through TournamentTransfer; ordinary uploads/deletes use
the MediaCleanup outbox described in [implementation boundaries](#implementation-boundaries-and-cleanup).
Back up every saved revision reference, not only current visible artwork.

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
a lobby never creates a website match. Tickets/RPC/gateway identity optionally name
a qualifier context; omitted context remains a normal match for compatibility.
IrcLobbyRequest has exactly one match or qualifier owner, with composite tenant FKs.
Qualifiers reuse this panel and transport, including uncertain-creation guards,
without dummy matches or an additional Bancho client. Lazer is not legacy Bancho support.
Commands follow the [official tournament management reference](https://osu.ppy.sh/wiki/en/osu!_tournament_client/osu!tourney/Tournament_management_commands),
including permanent user IDs as command targets. Delivery status still distinguishes
sending from actual provider execution.

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

Checks is reusable through workflow_call. Approved Container Release depends on
those checks at the same revision before the release-approval environment and
publication job can run. External actions are pinned to reviewed commit hashes.
Checks includes development and standalone production Chromium; production enables
isolated mock Bancho with a temporary secret. npm audit fails at moderate severity.
Remote workflow execution and branch/environment protection require separate review.

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

## Implementation Boundaries And Cleanup

Cleanup delivery starts with the ownership boundary. The additive
20261024010000 migration scans existing links and refuses mismatches before adding
same-match action foreign keys. 20261024011000 retains the original Prisma pointer
relations and adds database constraint triggers for page/pool revision ownership;
putting an owner's primary key inside an optional Prisma pointer relation broke
nested pool creation during verification. Neither migration rewrites data.
scopedDb now rejects unclassified models and unsupported nested write shapes, uses
generated scalar enums to distinguish JSON from relations, validates parent IDs
and requires callback transactions. SQL/raw-client access remains an explicit
service responsibility. Dated checks and the remaining cleanup are in PLAN.

public-visibility.ts owns the published-and-not-archived guest predicate across
content, media, metadata, lists, brackets, standings and featured selection. Archive
flags and saved revisions are preserved. Public CMS queries select visible blocks;
media inference uses the same visible blocks, and bracket projections omit private
entrants. Editing APIs use requireTournamentActor with an explicit proxy-derived
slug. Public featured-root fallback does not select an editing context. Native
`/register`, `/qualifier-booking` and qualifier results use scopedHref from
tournament-paths.ts. `registration-service.ts` owns tournament entry, private answers
and roster editing. `qualifier-booking-service.ts` owns reservations through
`/api/qualifier-booking`; registration responses contain no session collection and
booking responses contain no roster-editing or custom-answer payload. The old
registration.booking action delegates to the booking owner for saved-client
compatibility. `qualifierBookingPolicy` has independent enable/open/close controls;
null configuration reads the former registration-policy booking keys without a
backfill. Booking witnesses include eligibility/gameplay configuration but exclude
registration deadlines and custom fields. Existing OAuth/session identities are
revalidated under the root lock;
policy hashes and team/session versions reject stale forms. Profiles and mode ranks
are fetched outside transactions through the existing osu! API wrapper, then
identity/eligibility are checked before the shared team writer. Rank/country evidence
does not claim to verify unavailable restricted-account flags. No role is created.
New entries auto-approve; updates retain existing status. Public Team projections
include rejection reasons and exclude custom answers, contact fields and admin notes.
Captain assignment uses a server-only ownership capability in the existing qualifier
move/removal helpers, not an impersonated organizer permission. Stage uniqueness,
capacity, approved status, exact-time resource conflicts and history checks apply
equally to organizer and captain entrypoints. Migration
`20261030010000_qualifier_registration_workflows` is additive; normal installation
applies it through migrate deploy. Archives retain new configuration/provenance and
default absent game tables/booking fields for older version-1 archives. Operational
IRC requests and import jobs remain excluded. New tournament
page containers have no saved revision until the first successful save.

settings-service.ts owns settings patch application within the dispatcher's locked,
authorized transaction. settings.save requires Tournament.version and writes only
submitted fields, incrementing that same version; lifecycle changes also invalidate
old settings forms. Scoring impact checks and frozen gameplay snapshots are retained.
Team identity patches avoid roster/profile fetches. Team batches reuse the same
status/deletion owner and compare every selected version before writing; a stale or
history-protected row rolls back the entire batch. `user-roles-service.ts` owns both
single and selected-user role changes, with current authorization, reviewed role IDs
and permission lists, self/Owner guards and before/after audit. Browser role editors
carry `role-configuration.ts` witnesses for name, description and sorted permissions;
role save/delete compare these under the root lock. Older action payloads remain
accepted for compatibility; new editing controls always submit the witness.
StaffMember/StaffCategory/ModCategory version fields are introduced additively with
default one. Edits/deletes and staff bulk operations validate reviewed witnesses;
bulk assignment changes advance member versions and stale batches roll back. Stage
updates require the existing configuration token. Archive inspection validates
settings fields separately from editor action metadata, preserving old archives.

schedule-availability.ts checks the final replacement plan for shared referees,
team IDs and all snapshotted players (including substitutes) at exact instants.
Single match creation/assignment, bulk/pasted matches and qualifier plans share it.
Excluded record IDs preserve atomic time swaps; completed/cancelled records release
timed resources. Qualifier stage-entry uniqueness remains a distinct rule, including
completed sessions. stage-pool-validation.ts is authoritative for match creation
and stage release/reassignment. Referee eligibility now belongs to match-access.ts.
Interval overlaps and personal availability remain separate planned features.

media-cleanup.ts owns ordinary tenant/platform upload journaling and cleanup. An
empty additive MediaCleanup outbox records each key before put; catalog insertion
and journal completion commit together under the existing lock. Failed/uncertain
puts retain a one-hour grace, and failed deletes retain a five-minute retry lease.
Catalog deletion and cleanup scheduling are atomic. Recovery claims bounded jobs,
checks both catalogs under the lock, then deletes outside the transaction; a late
upload cannot commit after its job has been claimed. Committed media is preserved
after an uncertain acknowledgement. No existing objects are classified as orphans.

Run `node --env-file=.env --import tsx scripts/recover-media.ts` to preview up to
50 eligible journal entries, then add `--apply` after operator review; `--limit=N`
accepts 1..200. Use a restored isolated copy before installation recovery. No
automatic worker/cron is installed. Storage/network settlement after provider
timeouts remains provider-specific; interruption tests use synthetic storage.
media-references.ts parses exact URLs and snapshot image IDs, protects hidden and
historical references in bounded batches, and is shared by ownership/public checks.
Public inference still applies publication/visibility filters before traversal.

### Current Domain Ownership

| Boundary            | Owner and dependency direction                                                                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Match reads         | match-queries.ts owns authorized options, list/detail and history projections; match-record.ts owns database projections, roster snapshots and draft/lobby helpers; matches-types.ts is client-safe                                                                                  |
| Match mutations     | matches-service.ts owns state transitions, score/action history and audited corrections using the caller's transaction; match-access.ts owns permission scope/referee eligibility                                                                                                    |
| Competition         | competition-queries.ts owns projections/options; competition-groups.ts owns reviewed group results/seeds; competition-restoration.ts verifies/rebinds archive witnesses; competition-service.ts owns graph lifecycle/advancement/corrections                                         |
| Qualifier standings | qualifier-standings-contract.ts owns shared types/snapshot checks; qualifier-standings-sources.ts assembles source cohorts/projections and row locks; qualifier-standings-restoration.ts verifies import equivalence; qualifier-standings-service.ts owns review/finalization/reopen |
| Settings            | settings-service.ts applies versioned patches; admin-service.ts owns lock, refreshed authorization and audit dispatch                                                                                                                                                                |
| Scheduling/media    | schedule-availability.ts validates final resource plans; media-cleanup.ts owns ordinary storage journaling; media-references.ts traverses exact current/historical references                                                                                                        |
| Archives            | tournament-archive-format.ts owns wire allowlists, insertion order and deferred references; archive-identities.ts owns version 1 namespace traversal; domain restoration modules verify competitive witnesses                                                                        |

### Interface Language And Editor Ownership

`i18n.ts` owns the English/Italian catalogs and bounded message interpolation.
English source copy is its own fallback; the English catalog maps the original
Italian built-in messages. `server-locale.ts` reads the nonsensitive, one-year,
SameSite=Lax `portal_language` cookie through async request cookies. An explicit
`en`/`it` preference wins; installation locale supplies Italian for `it`/`it-*`
and English otherwise. URLs and tenant selection are independent of language.
`LocaleProvider` initializes from that server value. Its control updates the
cookie, document language and mounted client copy, then refreshes server content
without remounting editors. Date/number display uses the selected locale and
the existing tournament timezone; stored values and command/export formats keep
their domain representation. Native date widgets and browser-owned unload prompts
follow browser/OS language settings.

Only built-in copy calls the translator. CMS/navigation labels, names, notes,
rich text, rules policies and imported histories are authored data and render
verbatim. Interpolation parameters are preserved. Generated feedback alone uses
the catalog's template matcher, allowing existing notices to follow a language
change. There is no DOM-wide translation or external translation service.

`AppError` retains its English `message` and HTTP status, with non-enumerable
translation templates/parameters. `errorResponse` is async and localizes the
existing `{ error }` response at the HTTP boundary; callers inspecting the response
must await it. Field paths and protocol identifiers remain stable. Zod uses
request-local formatting, never mutable global language configuration. Locale
lookup failure falls back to English so error reporting still works. Diagnostics,
audit payloads, saved competition data and archive contracts are unchanged.

Shared match labels live in `match-display.ts`; artist normalization in
`pool-artist.ts`; browser datetime conversion in `utils.ts`. PoolingWorkspace owns
filters/selection and read refresh, while suggestion/bulk dialogs, review/selection
dialogs and configuration forms own their local edits in separate components.
Successful saves close through the existing mutation callback; failed saves keep
the dirty form. Shared Modal returns focus to its connected opener.

`unsaved-navigation.ts` registers one listener set while editors are dirty, with
one confirmation across multiple dirty rows. It protects ordinary links, unload,
cancelable same-document Navigation API traversal and explicit guarded stage
router calls. A confirmed discard/save acknowledges only its own editor before
navigation. Pooling dialogs additionally guard Escape, outside/Close/Cancel and
detail-to-review/selection transitions. Refreshing language is not a navigation
away. Browsers can impose non-cancelable traversals; browsers without Navigation
API retain link/unload and explicit router protection. These are limits of the
[HTML navigation contract](https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-navigate-event),
not a guarantee that every forced exit can be canceled.

Read modules do not import mutation services. Archive entrypoints import restoration
owners directly. Removed service reexports prevent new callers rebuilding that
coupling. Referee/provider/import adapters share record/access helpers rather than
importing the whole match mutation service. The superseded calm pilot harness and
rejected media.delete action were removed; current DELETE routes retain audit events.
Active profile CSS and historical adapters remain required.

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
The two-connection isolated lock probe records controlled wait evidence in ignored
.data. It establishes serialization across callers, not a throughput limit. Keep
the global lock until a reviewed narrower protocol passes concurrency protection.
Single/bulk/qualifier scheduling share final-plan validation; state machines and
qualifier uniqueness remain domain-specific.

### Database And Wire Boundaries

Prisma is not the entire persistence contract. SQL adds scoring/run/graph CHECKs,
partial IRC uniqueness, immutable match numbers/revision owners, owner-specific
page/pool pointer triggers and same-match action foreign keys. Additive migrations
scan and refuse mismatches rather than relink historical records.

scopedDb explicitly classifies models and validates parent references. Unsupported
nested operations and unclassified models fail closed. Raw SQL remains a service
responsibility; the full Prisma type does not imply all nested APIs are supported.
Archive contract tests compare every generated model/scalar with its reviewed wire
allowlist or explicit exclusion. New staff/category edit counters, object keys and
server/global credentials remain excluded. Those new counters default to one on
import; existing version 1 version fields retain their wire contract, and the new
tournament starts at version one. Version 1 opaque
history retains its established identity-field convention; competitive configurations
and standings additionally require domain witness equivalence before hash rebinding.

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
Public team/match and organizer team/media lists expose continuation; exports remain
complete. User lookup is a bounded search response. Some authorized competition,
pooling and qualifier workflows intentionally load complete cohorts. Archive bounds
do not measure peak RSS across parsing/remapping/ZIP buffers. Representative
restored-data plans, memory measurements and tenant-leading index choices remain
operator-dependent work; synthetic correctness tests do not justify index changes.

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
do not replace persistence coverage or live-provider checks. Locale tests check
catalog coverage, duplicate keys, interpolation, request concurrency and unchanged
authored parameters. Localization E2E exercises real localized failures, dirty
forms/dialogs/history and both languages/appearances at required viewport sizes.
With E2E_OSU_FIXTURE_DIR enabled, Playwright pins the same synthetic osu! credential
in the server and test workers so signed result-review receipts exercise the real
verification path. This branch requires the isolated test database; it supplies no
production authentication shortcut or live-provider verification.

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

Qualifier workflow E2E also accepts an explicit E2E_OSU_FIXTURE_DIR containing
synthetic user/match JSON. Playwright preloads tests/helpers/mock-osu.mjs only into
that test server; the preload refuses any database except tournament_platform_test.
It substitutes the upstream fetch boundary while exercising the real registration,
booking, capture and import HTTP routes, session checks and PostgreSQL writers.
Application runtime has no mock-provider or fake-login endpoint. Missing fixtures
fail rather than accessing live osu! data. Use IRC_ENABLED=true with a fresh
test-only IRC_GATEWAY_SECRET to exercise the shared mock-Bancho gateway as well.
These checks establish synthetic workflow behavior, not live OAuth/API/Bancho verification.

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

Scoped brackets-manager/ExcelJS uuid 11.1.1 and fast-uri 3.1.9 overrides address
the reviewed advisory chains. Brackets-manager uses uuid.v4 without buffer arguments;
the override retains its CommonJS API. Recheck installed nested versions with
`npm ls uuid fast-uri` after lockfile maintenance.

The pg concurrent-query warning also reproduces in one read-only Prisma relation
query (Prisma/adapter-pg 7.10.1), without application Promise.all. Application
queries sharing one transaction are sequenced where explicit. The upstream engine
still dispatches relation queries concurrently; do not suppress the warning, patch
installed packages or change database locks as a workaround. Track a compatible
upstream fix before pg 9. Vite's native-config warning is resolved with an explicit
.ts config import and TypeScript's noEmit-compatible import option.

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
