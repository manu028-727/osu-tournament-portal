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

**Current.** Provide homepage, mappools/stage pools, matches/details, brackets,
qualifier standings, teams, staff and rules with useful empty/loading/error states,
public metadata and responsive, accessible navigation.

The shared tournament banner, identity and single tab navigation persist across
same-tournament pages. Platform controls remain separate. Missing artwork is
handled without invented branding. Support light/dark/system appearance and saved
tournament colors; the complete visual contract is [DESIGN.md](DESIGN.md).

Homepage blocks support authored text, hero content, images, announcements, links,
button groups and dates, with visibility/order controls. Rules support rich text,
headings, lists, tables, links, images, dividers and heading navigation. Both retain
draft saves, explicit preview/publish/unpublish and revision history. Editing a
published page creates a draft; only explicit publication changes guest content.

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

**Current.** Support team and solo registrations, roster/captain/substitute identity,
approval/rejection/publication, seed/rank/contact data and reviewed CSV import/export.
Use osu! IDs as identity, reuse registered rosters for matches/invites and protect
private contact data. Qualifier seeds are distinct from registration/rank-sum order.
Delete only unused registrations without damaging match snapshots/history.

Staff listings use custom ordered categories and multiple positions per member,
osu! profiles, optional biography/image and visibility. Bulk changes support
visibility/category/position patches without creating users or privileged roles.
Website access and role management are explicitly separate workspace subsections.

## Scheduling And Native Brackets

**Current.** One canonical Matches list offers All/My/Unassigned and status, stage,
date, participant, referee and identifier filters. Inline and bulk changes support
time, staff, stage, notes and publication on eligible unstarted records. Schedule
paste previews numeric match numbers and timestamps, preserves blank fields and
uses explicit clearing. Stale/foreign selections and resource conflicts reject
unsafe batches. Bracket round stage assignment preserves started history.

Each match has an immutable positive tournament-local number distinct from database
ID and source code. Numbers are unique, never recycled, and reserved in bracket
round order before lazy match creation. Public numeric links resolve those numbers.

Native single elimination, double elimination/reset and groups support deterministic
seeding, byes, previews, configurable round/stage assignments, manual/locked slots,
reviewed routes, qualification and public views. Only confirmed results advance.
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
Support one/two runs and BEST_PER_MAP, BEST_COMPLETE_RUN, FIRST_RUN or SECOND_RUN;
team aggregation SUM/AVERAGE/TOP_N. Review stable API evidence before capture.

Calculate Raw Score, sample-deviation Z-Sum, Team Average or the explicitly named
osu!plus qualifier-cohort Match Cost adaptation. Preserve raw/provenance data,
missing versus zero, complete cohorts, full precision and explicit tie decisions.
Provisional, finalized and published standings are separate immutable versions.
Finalization requires complete confirmed sources and resolved ties; cutoff seeds
can generate brackets. Reviewed reopening preserves old witnesses and freezes
downstream assignments, hides superseded publication and blocks after downstream
gameplay starts. No silent reseeding.

**Partial.** Native lazer Rooms API capture and qualifier IRC execution panel are
not implemented. Lazer cannot use legacy Bancho setup/capture. Qualifier workbook
layouts are detected/reported but not imported as invented performances.

## Interoperability And Portability

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
