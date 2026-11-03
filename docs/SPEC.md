# Product Specification

## Reading This Contract

This is the intended product behavior, not a claim that every requested extension
has shipped. **Current** means implemented in the consolidated source baseline;
**Partial** means an explicit boundary remains; **Planned** means not implemented.
[PLAN.md](PLAN.md) records delivery order, evidence and outstanding work.
[ARCHITECTURE.md](ARCHITECTURE.md) defines implementation and operator procedures.

## Platform And First Installation

**Current.** A Docker installation provisions private persistence, real osu! OAuth,
one-time ownership and a tournament directory without demo tournaments or fake
accounts. A designated numeric osu! identity consumes platform ownership once.
Restarting/seeding cannot rearm that bootstrap. Platform administrators manage
platform identity and independent tournaments; a tournament Owner is scoped.

An empty tournament is valid before and after publication. Creation initializes
required settings and local access templates, not fabricated announcements,
matches or CMS revisions. Editors provide safe empty defaults until actual saves.
Tournament publication is independent from page, pool, roster, bracket and
standings publication. Archived/private tournaments must not become guest-visible.

`/admin/tournaments` selects a tournament. Editing uses `/t/<slug>/admin/...` and
works while unpublished. Unscoped editors lead to the chooser, not an arbitrary
tournament. Missing context, authentication, permission, resource and stale-write
errors remain distinguishable; authorized empty collections are not 404s.

## Identity And Authorization

**Current.** Use osu! Authorization Code flow with state/cookie binding, server-side
exchange, stable numeric identities, expiring hashed server sessions and logout
revocation. Store profiles/last login, not user OAuth access/refresh credentials.
No passwords or test-login endpoints replace OAuth in production.

Users may hold multiple local roles with configurable granular permissions. Default
templates are Guest, Player, Sheeter, Pooler, Referee, Staff Manager, Content Editor,
Admin and Owner. Signing in alone grants no organizer rights. A fresh platform has
no implicit tournament membership; role assignment is a scoped administrative act.
Do not allow self-promotion, grants beyond the actor's authority or removal of the
last protected owner. Public staff positions never grant internal permissions.

Every protected API/mutation enforces server authorization and tenant ownership.
Referees see **All Matches** by default, including other assignments and unassigned
records. Visibility is separate from operation: normal referees operate assigned
matches; `matches.manage`/`matches.manage_all` permit appropriate overrides. Admins
and Owners have full local access. Observers cannot overwrite another editor.

## Public Tournament Website

Built-in public, organizer and referee interfaces support complete English and
Italian copy, including controls, empty states, validation feedback and accessible
labels. A visible language switch persists the visitor's choice and updates server
and client rendering without discarding unsaved editing values. CMS text, names,
descriptions, notes, imported histories and other authored content remain in their
original language; selecting an interface language never rewrites saved content.

**Current.** Provide homepage, mappools/stage pools, matches/details, brackets,
qualifier standings, teams, staff and rules with useful empty/loading/error states,
public metadata and responsive, accessible navigation.

The shared tournament banner, identity and single tab navigation persist across
same-tournament pages and use tournament settings, independently of homepage
revisions. An editable Hero is homepage content: its title, artwork, body and
buttons render in saved order without overriding or disappearing into the shared
profile. Multiple Heroes and title-only/image-only blocks are supported. Explicit
CMS links remain visible even when their destinations also appear in navigation.
Timeline blocks show all configured important dates. Platform controls remain
separate. Missing artwork is handled without invented branding. Support
light/dark/system appearance and saved
tournament colors; the complete visual contract is [DESIGN.md](DESIGN.md).

Homepage blocks support authored text, hero content, images, announcements, links,
button groups and dates, with visibility/order controls. Rules support rich text,
headings, lists, tables, links, images, dividers and heading navigation. Both retain
draft saves, explicit preview/publish/unpublish and revision history. Editing a
published page creates a draft; only explicit publication changes guest content.
Block type changes and reordering retain authored content and editor identity;
existing page-level rich text remains editable and visible. Responsive containers
use desktop and ultrawide space while prose keeps a readable line length and
public mappools retain their compact card geometry.
Selected homepage sections support show/hide, duplication and removal within the
draft. History and unpublish remain directly discoverable; batches do not publish
or overwrite authored text automatically.

Settings saves apply only reviewed changed fields. An older form, including another
Website subsection, must fail visibly after a newer settings or lifecycle save.
Staff/category edits and bulk selections also reject stale review witnesses without
partial application.

## Branding And Media

**Current.** Organizers edit tournament name/acronym/description, mode, status,
registration/social links, dates/timezone, logo/favicon/banner, primary/accent
colors, navigation, footer and public text without source edits. Platform branding
has separate global ownership. Stage banners remain independently configurable.

Media supports reusable previews, upload/replace/delete, content/size validation
and optimization through filesystem or private S3-compatible storage. Draft/private
references stay protected even through direct URLs. Deletion must not break saved
references. Upload/library interactions provide clear failure and completion states.

## Stages, Mappools And Pooling

**Current.** Custom stage names/slugs/types, display order, banners, gameplay rules,
qualifier policy and lifecycle remain editable. Stage identity is distinct from
bracket round/lane labels. Bulk rule patches preserve omitted/mixed values, reuse
defaults or source-stage overrides and reject stale configuration tokens.
Duplication independently selects rules, appearance, empty pool, structure or
contents; it never duplicates publication, gameplay history or staff assignments.

Pools support individual/bulk IDs and slot mappings, actual osu! API metadata,
inline ID/category/slot edits, copying/removal, numeric canonical sorting on every
save and **Sort by Slot**. Duplicate/invalid slots are rejected, not overwritten.
Standard relative order is NM, HD, HR, DT, FM, then TB; customs use explicit priority
and deterministic fallback. Manual moves adjust slot names so save preserves order.
Saved metadata includes cover, artist/title/difficulty/mapper, stars, BPM, duration,
AR/CS/OD/HP, ID and original link. Mode mismatches/missing IDs are reported.

Plans persist empty distributions and advisory difficulty targets before maps
exist. Suggestions have real metadata, tags/skillsets, notes, filters, status,
review assignments, ratings and feedback. Accepted maps enter a selected draft
slot without publication. Artist warnings/bans require traceable resolution.
The Mappool editor includes a contextual suggestions panel: browse/search by
category, status, skillset and stage scope, inspect metadata and feedback, accept
eligible suggestions and assign a destination slot without leaving the editor.
Assignment saves any pending pool edits first. Replacement and artist-ban
resolution remain explicit; stale candidate/draft versions fail visibly. If
assignment fails after a draft save, those saved edits remain available.
Copying structure is distinct from copying/moving saved contents between drafts.
Statistics summarize stars/BPM/length. Draft/review/approved/public states differ.
Single and multi-pool release validate completeness, rules, warnings and expected
revisions atomically. Old publications remain unchanged by new drafts.

Public pools use compact, centered, category-grouped grids with subtle tinted,
bordered padding behind opaque cards, no large category titles, stable desktop
hover previews and independent mobile details. Unpublished pools/drafts must never
leak through URLs, APIs, previews, media or caches.

**Partial.** Reusable configurations are defaults/source stages, not a named preset
library. No per-slot notes schema, standalone custom-map upload or automatic
mappack generator exists. These are extensions, not prerequisites for basic pooling.

## Teams, Players And Public Staff

Public team/match lists and organizer team/media lists expose explicit page controls,
stable ordering and total counts. Filters apply to the whole selected collection.
CSV roster exports include every authorized team, including empty rosters; a failed
export must fail rather than silently return a truncated successful file.

**Current.** Support team and solo registrations, roster/captain/substitute identity,
approval/rejection/publication, seed/rank/contact data and reviewed CSV import/export.
Use osu! IDs as identity, reuse registered rosters for matches/invites and protect
private contact data. Qualifier seeds are distinct from registration/rank-sum order.
Delete only unused registrations without damaging match snapshots/history.
Names and seeds can be edited directly in the entrant list without fetching or
rewriting rosters. Selected entrants support atomic approval, rejection, publication,
hiding and unused-record deletion, with individual permissions and version checks.

Website registration uses osu! OAuth and captain ownership for team or solo entries;
it never grants website roles. New website entries and new organizer imports are
automatically approved and published. Organizers may reject them with a required
public reason visible in Teams; private notes and custom answers are separate.
Configure native/external registration, eligibility by mode rank/country, required
custom fields, deadlines, roster/substitute limits and roster locking. Existing
rejected or pending entries retain that status when their captain edits them.

Registration and qualifier reservation have distinct public pages, API owners,
configuration and statuses. Registering never books a session, and canceling a
reservation never unregisters an entrant. Booking has independent opening/closing
times; registration deadlines and custom fields do not invalidate a booking form.
Eligibility changes still require the captain to review booking again.
Captains reserve, move or cancel their entry in existing qualifier sessions. Show
times in the chosen display timezone, capacity, deadlines and current reservations.
Validate ownership, eligibility, stage uniqueness, schedule conflicts, capacity and
reviewed versions transactionally. Started/completed sessions protect histories;
organizers may explicitly add/remove unscored entrants in active sessions with an
audited reason. Recorded entrants remain in their historical session.

Staff listings use custom ordered categories and multiple positions per member,
osu! profiles, optional biography/image and visibility. Bulk changes support
visibility/category/position patches without creating users or privileged roles.
Website access and role management are explicitly separate workspace subsections.
Selected users support adding/removing a role while retaining their other roles.
Batch actions preserve self-editing, protected-permission and last-Owner guards and
reject changed role assignments atomically.

## Scheduling And Native Brackets

**Current.** One canonical Matches list offers All/My/Unassigned and status, stage,
date, participant, referee and identifier filters. Inline and bulk changes support
time, staff, stage, notes and publication on eligible unstarted records. Schedule
paste previews numeric match numbers and timestamps, preserves blank fields and
uses explicit clearing. Stale/foreign selections and resource conflicts reject
unsafe batches. Bracket round stage assignment preserves started history.

Each match has an immutable positive tournament-local number distinct from database
ID and source code. Numbers are unique, stable while retained, and reserved before
lazy match creation. New brackets order reservations by configured stage progression,
then Winners/Losers/shared finals, then round and top-to-bottom position. For RO16
double elimination, Winners positions receive 1-8 and the first Losers round 9-12
before the next stage. An existing tournament continues at its next available number.
Byes consume no numbers; a conditional reset reserves one. Public numeric links resolve those numbers.
Generated database/source identifiers are not displayed. Organizer and public
match labels, bracket controls, lobby commands and deletion confirmation use match
numbers. Numeric referee URLs resolve the same record; existing internal URLs and
source-code references remain compatible. Existing assigned numbers are preserved.

The organizer list defaults to numeric order with 50-row pages, complete filtered
counts and search across all pages, frozen/current participant names, referees,
source credits, stages and notes. Filters, sort and page remain in the URL. Inline
time/referee changes and existing bulk/pasted scheduling retain version/conflict
checks; hidden page selections are cleared.

Organizers with `matches.manage` click a score cell to edit scores, winners and
forfeits inline in its match row, with optional notes and external referee credit
under a disclosure.
The editor retains its values across responsive layout and language changes.
Partial scores remain in progress; reaching the configured win target confirms
the result and advances the bracket. Choosing a winner or FF fills the winning
score. Every save records the actor, before/after values and a default audit reason
when no note is supplied. Bracket positions use the same compact result controls.
Corrections
preview affected match numbers, require approval for unstarted downstream changes
and reject stale impact or protected gameplay/frozen standings. Existing referee
actions, player/map scores, events and revisions remain preserved independently of
the organizer's overall result. An explicit external referee credit takes precedence
in public results without changing assignments or permissions. Referee Mode keeps
its operational workflow.

The existing Delete action removes generated fixtures from active scheduling
without destroying their record, actions, scores, revisions or reserved number.
The bracket keeps a deleted position which cannot advance or regenerate itself.
Reviewed changes may clear unstarted downstream positions; played downstream
matches, frozen seed snapshots, stale forms and pending/uncertain room creation
remain protected. The Deleted matches filter exposes retained history. Authorized
reopening restores the same record and number. Standalone permanent deletion
retains its explicit confirmation and dependency checks.

Bracket positions expose **Regenerate Match** for intentionally deleted fixtures.
Restoration reuses the retained record, number, stage, frozen rules and referee
history, restores its prior lifecycle state and recalculates current progression.
Played rosters and started downstream matches stay protected; affected unstarted
fixtures require a reviewed approval. Generating missing matches repairs ready
positions without records and never restores intentional deletions automatically.

The bracket is an organizer workspace: a selected match opens an adjacent editor
for inline scores/winner/FF, time, referees, participant slots and advancement
routes, with an explicit Referee/history link. Search by match number or entrant,
round navigation, contained panning/zoom/fit and a mobile round list keep large
brackets usable. Dirty edits survive responsive changes and guard selection changes.

Organizers with match-management and deletion permissions can permanently delete a
complete bracket and all its linked fixtures with exact-name confirmation.
This explicitly erases scores, map/player results, multiplayer evidence, referee
actions, events, revisions, assignments and the bracket graph. Completed matches
require an additional acknowledgement of permanent history loss. Active gameplay,
uncertain lobby creation and external match/progression/seed dependencies block
deletion. Only a minimal deletion receipt remains; associated match audit records
are removed and shared scheduling receipts retain only unaffected entries.

When no matches or bracket number reservations remain in the tournament, this
explicit deletion resets numbering so recreation starts at **match 1**. Unrelated
matches and reservations keep their numbers and prevent that reset; the preview
states which behavior applies. This is the sole intentional reuse exception.
Rebuild performs the permanent deletion review, then opens the existing generation
preview with the old configuration and editable participant/seeding selection.
Registration-based seed order is refreshed before that preview; qualified-source
brackets keep their reviewed source selection and validation.
Creation makes a fresh unpublished graph with fresh database identities. If
generation is canceled or fails after deletion, the deleted history stays erased;
the generation form remains available for retry.

Native single elimination, double elimination/reset and groups support deterministic
seeding, byes, previews, configurable round/stage assignments, manual/locked slots,
reviewed routes, qualification and public views. Only confirmed results advance.
Creation suggests every round's stage from the selected starting stage, following
explicit Next stage links before configured display order. The first Winners and
Losers rounds share a stage; the next Winners round and the next two Losers rounds
advance together. Later rounds repeat that pattern. Winners/Losers Finals share
the final path stage; Grand Finals uses the next stage when available, and its reset
shares that stage. When stages run out, remaining rounds use the last available
stage. Single-elimination third place shares its final stage; group rounds stay
in their selected stage. Authored names are never parsed to infer progression.
Organizers may override suggestions; a round cannot precede a feeder's stage.
The preview shows every proposed stage and actual numeric range in generation
order, updating after edits. Generation checks the reviewed stage/configuration
and counter witness before writing; stale previews must be refreshed. Existing
match numbers, database identities, histories and routes are never renumbered by
new generation, stage edits, lazy materialization, imports or synchronization.
Double-elimination presentation has only Winners Bracket and Losers Bracket paths.
Winners Finals and Losers Finals end their respective paths in aligned columns.
Grand Finals and the optional reset form their shared conclusion to the right;
there is no third Finals section. Connectors stay within each path. Pending slots
show Winner/Loser of Match # with the reserved match number, and show actual
participants only when the stored slots resolve. Reset slots show the conditional
Grand Finals loser/winner references, retaining their original sides, and remain
explicitly conditional until required.
Round headings, navigation and organizer controls use configured stage names,
with Finals/reset roles as secondary labels. These are presentation rules only:
stored lanes, routes, seeding, numbering, confirmation and reset eligibility remain
unchanged.
Eligibility/losses/withdrawals are competition-path-specific; overrides need reasons.
Link existing matches round-by-round without duplicating records or rewriting
original colors, scores, actions or multiplayer evidence.

**Partial.** Conflict detection covers identical start times, not estimated-duration
overlaps or a staff availability calendar. No arbitrary blank graph builder or bulk
match duplication. Corrections must not automatically replace started downstream
participants. Match status/participants cannot be patched around state-machine rules.

## Referee Match Operations

**Current.** A referee can open all authorized match histories, scores, assignments,
pool snapshots, lobby links and results; live observers receive reliable polling
without taking editing ownership. Show assignment/read-only/edit state explicitly.

Operate from immutable roster/rule/pool snapshots. Support roll winner and separate
protect/ban/pick starters; stage-specific action pairs, AB/ABAB/ABBA sequences,
double-category policies and optional tiebreaker bans. Indicate the next valid
action, keep compact maps visible, copy IDs/map/mod commands and prevent invalid
reuse. Include lobby setup, invites, referee/timer/start helpers, Discord match
pings and configured rule references. Commands use actual tournament game mode,
NoFail policy, team/scoring settings and registered player IDs.

Persist chronological actions, map/player scores, converted values, current score,
events and result revisions. Best-of completion, submission, confirmation, forfeits,
disputes, reopening, undo/corrections and permanent deletion use permission-checked,
audited workflows with conflict checks. Refresh/restart must retain history.

Bancho's scoring mode and the tournament's win condition are separate. Maps can be
decided on score, team average accuracy, combo or misses, read from the same lobby
evidence: a ScoreV2 lobby can decide on accuracy, which keeps its decimals and is never
multiplied. Mods can be required on every map, including Relax, optional or restricted
per category, and FreeMod requirements define which mods count toward each.

FreeMod conversion uses explicit universal/custom/slot or legacy multiplier policy,
not a hidden score-system conversion. Dedicated Discord formatting reproduces
supported Stat Lord `Template!AB3` spacing/Markdown/forfeits and custom flags; golden
tests verify output. Never announce a confirmed winner before confirmation.

**Partial.** Spreadsheet parity applies to inspected supported layouts and formulas,
not inaccessible Apps Script automation or every workbook variant. Native qualifier
workflows are separate from elimination refereeing.

## Qualifiers And Scoring

**Current.** Tournament gameplay scoring is canonical: ScoreV1, ScoreV2 or explicit
standardized manual lazer scores. Once recorded competition exists, preserve its
scoring provenance; unknown legacy modes require reviewed compatible resolution.
Never fabricate V1/V2/lazer conversion. Stages inherit the canonical choice.

Qualifier sessions play a full stage pool with stable snapshots, rosters, scheduled
staff, invites/pings, multiplayer links and individual map/run results. Batch create,
schedule and compatible unstarted entrant transfers respect capacity and history.
Edit session identity, notes, schedule, staff and booking settings in place. Single
and bulk deletion remove reservations from operational lists, preserve scores and
referee histories, and never close an IRC room. Confirm deletion; block active
sessions, uncertain room creation and finalized sources. Retained completed sessions
remain standings sources and keep their entrant ownership. Deleted histories are
read-only and reachable through the session list's Deleted filter. An explicit
stage-wide calculation reprocess may update derived scores and rule decisions in
retained sources with a before/after audit; original evidence and lifecycle remain
unchanged, and finalized standings require controlled reopening first.
Complete multiplayer history and resolve pending games before deleting a completed
session, including an automatically completed session with an optional run underway.
Support one/two runs and BEST_PER_MAP, BEST_COMPLETE_RUN, FIRST_RUN or SECOND_RUN;
team aggregation SUM/AVERAGE/TOP_N. Empty sessions open before entrants are assigned;
starting requires entrants, schedule and assigned staff. Multiple teams share one
simultaneous lobby and play each map together, without Best-of, pick/ban or team
wins. Referees select the full pool map by map and record individual scores inline.
The existing IRC panel supports qualifier creation, linking, maps/mods, invites,
player removal, commands and connection status; normal match refereeing is retained.

Running website sessions automatically synchronize official multiplayer evidence
while the referee workspace is open. Live sync and stage-selected bulk multiplayer
imports share the canonical conversion, score writer and audit history. Attribute
players by permanent osu! IDs in frozen rosters, never team colors or display names.
Reviewed historical imports remain historical when reopened in Referee Mode or
synchronized later; their games do not need to postdate the website session start.
Unimported live games retain the start-time guard. Preserve explicit exclusions.
Load complete paginated histories before applying scores. Exclude unrelated maps;
warmups default to zero and require explicit count/selection. Review ambiguous
players, retries, additional runs and missing evidence; never replace missing scores
with zero. Preserve original provider evidence and each attributable score even
when its mods violate rules. Record eligibility and the exclusion reason per score;
valid simultaneous players continue through the same pipeline. Unknown/duplicate
player evidence remains inspectable without inventing tournament identities.
Team FreeMod quotas apply only to the affected team/map/run. Organizers can bulk
exclude or explicitly override scores with an audited reason. Previews show eligible
individual/team values and allow audited corrections.
Re-import preserves accepted games and manual corrections unless replacement is
explicitly reviewed. Accepted partial games can receive newly available player
scores on synchronization or re-import; intentional removals remain audited and
require explicit replacement to restore. Incomplete histories and unresolved game evidence block
official finalization. Imports can apply valid games while ambiguous games await
review. A direct import uses an explicit warmup count (initially zero), while
advanced preview permits different choices per link.

Automatically complete imported/live sessions once each expected entrant has a
complete played run under the configured selection policy. Played, valid and counted
are independent: an observed excluded score completes a played map, while it remains
excluded from calculations. Missing scores never become zero. FIRST_RUN requires
Run 1, SECOND_RUN requires Run 2; best policies allow an optional second run.
Partial results stay Playing and resumable. Completion neither closes Bancho nor
finalizes official seedings. Automatically completed sessions continue accepting
optional runs and audited corrections until official finalization locks sources;
removing required evidence resumes Playing. Show missing/excluded/run blockers.
Manual-only sessions retain explicit referee submission and confirmation.

Qualifier policies explicitly choose reported scores or removal of native legacy
osu!standard mod bonuses, tournament multipliers, per-player rounding and whether
failed performances count. Apply normalization before team aggregation. An absent
pass witness is not a fabricated pass. Preserve existing saved-policy behavior until
an organizer reviews reprocessing; gameplay systems are never converted into one another.

One canonical score interpretation serves live capture, imports, inline corrections,
revalidation and standings. Managers can select scores to include/exclude, restore
automatic eligibility, revalidate or remap map/run/player attribution. Reprocessing
reviews every stage session and can adopt current stage rules. Preview changes to
the complete cohort's totals and seeds before applying, compare reviewed versions
and sources inside the transaction, and retain raw receipts and before/after audits.
Remapping persists across re-imports; conflicting destinations are rejected.

Calculate Raw Score, sample-deviation Z-Sum, Team Average, %MAX, average map placement
or the explicitly named osu!plus qualifier-cohort Match Cost adaptation, seeded on score,
accuracy or combo. Preserve raw/provenance data,
missing versus zero, complete cohorts, full precision and explicit tie decisions.
Provisional, finalized and published standings are separate immutable versions.
Calculation version 3 separates played-run completion from counted-score selection;
BEST_PER_MAP can combine valid maps across fully played runs containing exclusions.
BEST_COMPLETE_RUN still needs one wholly valid run. Published version-1/version-2
calculations retain their original formulas and hashes until reviewed reopening.
Finalization requires complete confirmed sources and resolved ties; cutoff seeds
can generate brackets. Reviewed reopening preserves old witnesses and freezes
downstream assignments, hides superseded publication and blocks after downstream
gameplay starts. No silent reseeding. Version 4 covers %MAX, average placement and
metric seeding; adding it recalculates no existing standing.

**Partial.** Native lazer Rooms API capture is not implemented.
Lazer cannot use legacy Bancho setup/capture. Qualifier workbook
layouts are detected/reported but not imported as invented performances.

## Interoperability And Portability

**Current.** Matches imports an osu! multiplayer link through the official API,
including available lobby metadata, games and player-score evidence. Tournament
sides come from osu! IDs in the match rosters, including substitutes, rather than
usernames or lobby colors. Team totals use the available player scores and frozen
score multipliers. Historical lobby settings and maps outside a frozen pool do
not silently exclude otherwise usable evidence; unsupported scoring/custom slot
multipliers or missing/ambiguous identities require review instead of invented
conversion or players.

Import has an explicit warmup count, initially zero. Only the chosen initial maps
are warmups; accepted games count chronologically until the configured win target.
An ordinary complete, unambiguous import saves directly without an approval step.
Partial scores save in progress. Incomplete history must finish loading first.
Ambiguous IDs expose team mapping, and individual games can be excluded or have
their winner corrected with a reason. Existing completed-result correction guards
still apply when changing downstream progression. Imports remain editable later.

Import creates an audited overall result and separately retained game evidence.
Changing the warmup count retains previous map-winner corrections and reasons.
It does not invent rolls or pick/ban ownership. Re-import uses unique lobby/game
identities, preserves previous evidence in correction history and leaves unchanged
reviews unchanged. Public completed matches show only accepted game projections,
without private reasons, review tokens or audit payloads. Expired/unavailable osu!
history is reported honestly; manual result entry remains available.

**Current.** Numbered referee workbook tabs import into a selected authorized
tournament through preview/mapping/conflict review. Reconstruct action types from
round setup/row order/cached output where supported formula exports fail. Persist
individual protects/bans/picks/map results, source provenance, scores, MP links and
Discord output, not just files. Reimport is duplicate-safe; replacement is explicit.
Stage repair reuses reviewed existing stages and retains original bracket labels.

Tournament ZIP export/import includes saved CMS/pools, planning/reviews, teams,
competition/qualifiers, actions/corrections/provenance, audit and checked media.
Import always creates a new unpublished tournament with remapped local IDs.
Existing identities are reused without profile/session/permission overwrites;
source role grants and referee assignments require manual review. Never transfer
server secrets or platform authority. Preview validates hashes, bounds and relations;
durable journals support failed/interrupted storage cleanup without deleting
committed media. Preserve numbering and qualified historical standings witnesses.

**Partial.** Archives are bounded in memory, not a streamed migration system.
Unknown statistical versions/mismatched witnesses stay explicitly stale.

## Reliability, Hosting And Acceptance

**Current.** PostgreSQL persistence, validated server operations, tenant constraints,
CSRF/origin protection, sanitized rich text, secure cookies, bounded/rate-limited
requests, private media and audit logging are required. Docker provides a simple
default stack, optional external services and explicitly enabled IRC. Updates use
build/migrate/install, never database reset. Backups include storage and private
configuration and must be restore-tested independently of persistent volumes.

Optional per-user Bancho IRC uses authenticated current usernames and separate IRC
passwords held in memory. Safe diagnostics identify transport versus upstream
rejection without secrets. Ordinary commands report **Sent**, never inferred
execution; uncertain lobby creation retains its persistent duplicate guard.

Acceptance requires fresh unpublished editing, publish/re-edit, multi-tournament
authorization/isolation, preserved existing data, draft privacy, complete referee
and qualifier workflows, archive round trips, accessible responsive layouts and
verified production builds. See [PLAN.md](PLAN.md#verification-baseline) for actual
evidence and [remaining work](PLAN.md#remaining-work) for unverified integrations
and prioritized extensions. No provider compatibility or production readiness is
established solely by synthetic tests.
