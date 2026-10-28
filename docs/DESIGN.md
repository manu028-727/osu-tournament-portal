# Design Language

## Approved Direction

The current design is the approved osu!-inspired tournament profile and rounded
application rollout, refined for dense organizer work. Earlier graphite/sidebar
and rejected calm pilots are not alternative specifications. Preserve existing
functionality, saved branding and content; this document is not permission for
another redesign. Product motives are in [INTENT.md](INTENT.md), behavior in
[SPEC.md](SPEC.md), implementation in [ARCHITECTURE.md](ARCHITECTURE.md).

Public pages prioritize actual tournament identity/artwork and readable content.
Organizer pages prioritize compact tables, useful bulk edits and explicit save
states. Referee pages prioritize score, current action, maps, commands and history.
They share typography, semantic tokens and controls, not identical compositions.
Do not use oversized marketing headings, empty dashboards, decorative statistics,
invented announcements, heavy section framing or generic promotional copy.

## Foundation And Tokens

Long public team/match and organizer team/media lists use compact Previous/Next
controls with page and total counts. Controls wrap at narrow widths, preserve
filters and disable unavailable navigation. Team search spans every page.

`src/app/globals.css` owns base tokens, focus, spacing and operational layouts;
`src/lib/theme.ts` derives readable branding. Feature CSS modules own scoped geometry.
Use semantic tokens instead of hardcoding a new local palette. Current defaults:

| Token                              | Light             | Dark               |
| ---------------------------------- | ----------------- | ------------------ |
| --page                             | #f8f5f6           | #231f23            |
| --surface                          | #ffffff           | #302b30            |
| --surface-hover / --surface-raised | #f1e9ed           | #3d353c            |
| --text                             | #30242b           | #f3edf0            |
| --muted                            | #70616b           | #bfb0bb            |
| --control-border                   | #cabec6           | #695963            |
| --separator                        | #e4dce1           | #4a3f47            |
| --team-red / --state-danger        | Distinct dark red | Readable pale red  |
| --team-blue                        | Readable blue     | Readable pale blue |
| --state-live                       | Dark green        | Mint               |
| --state-warning                    | Dark gold         | Pale gold          |

Saved primaryColor/accentColor are authoritative and editable; platform values
initialize new tournaments and selected-tournament values take precedence. Theme
derivatives target 4.5:1 text contrast on relevant surfaces, including readable
button foregrounds, without rewriting stored values. Mod colors remain independent.
Use --brand/--accent/--brand-ink/--accent-subtle/--accent-border/--focus-ring for their
intended roles, not a one-hue replacement palette. Global element styles belong in
Tailwind's base layer so they do not override utility colors unexpectedly.

Appearance has one nonsensitive SameSite cookie, portal_appearance: Light, Dark,
System. Async server cookies initialize HTML; native color-scheme/light-dark handles
OS preference before paint and on changes. No inline startup script/CSP weakening,
duplicate localStorage preference, database color edits or theme flash workarounds.
Dialogs/menus inherit workspace theme; portaled public previews capture scoped
branding. Both themes apply to CMS, referee, qualifiers, errors and loading states.

The header places a compact EN/IT language control beside appearance. Its menu
names the languages English and Italiano and marks the selection. Language changes
refresh built-in copy while retaining mounted editors and dirty values. The selected
language sets the document language and date/number formatting; authored content
keeps its original language and wording. This is separate from saved CMS copy.

## Typography, Geometry And Controls

Self-host IBM Plex Sans 400/600 for interface/prose and Plex Mono 400 for identifiers,
dates, numerical evidence and commands. Keep OFL notices; no remote font requests.
Use tabular numerals for scores and comparison columns, not monospace for all prose.

- Body 16px, prose 17px, operational text 14px, secondary labels 13px. Compact
  headers are modest, never hero-scale. Profile title is 28px desktop/23px mobile.
- Letter spacing is zero. Interface fonts do not scale with viewport width;
  editable Hero titles range from 26px to 34px with their content container. Long identity
  text wraps; long dense row titles truncate with full text available in details.
- Shared controls are 12px radius, repeated items/dialogs 16px, compact inner
  inputs/badges can use 8px. Profile banner is 24px desktop/20px mobile. These are
  established design-system exceptions, not a new nested-card aesthetic.
- Standard controls/touch targets are about 44px. Dense desktop pool inputs remain
  34px; mobile/coarse-pointer actions retain sufficient hit area and spacing.
- General wrap uses shared `--page-width`: max 2560px, with each side inset
  `clamp(12px, 2.5vw, 64px)`. Profile, navigation, homepage, subpages, footer and
  organizer workspace share those edges. Prose stays within about 74 characters;
  organizer forms can stop at 1280px while tables use the available workspace.
  Use minmax(0, ...), min-width:0, explicit aspect ratios and bounded dialogs so
  content/focus/hover cannot resize neighboring controls.
- Use Button, Badge, StateBadge, MatchStatusBadge, Field, Modal, ConfirmButton,
  SectionTitle and LoadingState instead of a parallel component vocabulary.
- Use Lucide icons and accessible labels/tooltips for tool actions, color inputs
  for swatches, tabs for views, checkboxes/toggles for binary settings and ordinary
  commands for save/publish. Do not replace familiar icons with text pills.
- Sections are unframed layouts/bands with constrained content. Cards are repeated
  objects or genuine tools, not every section and not cards nested inside cards.
- Motion is short, functional and subtle; respect prefers-reduced-motion. No
  decorative orbs, glow/blob backgrounds, glass effects or animated page entrances.

## Shared Public Tournament Layout

The platform header contains platform directory/appearance/account controls only.
Below it: actual banner, identity/logo/status/dates, **one** tournament tab list,
then page content. The profile is independent of editable homepage Heroes. Keep
one tournament navigation; identity/tabs flow naturally into the page.

The banner is unobstructed: no title/control/gradient laid over text-heavy artwork.
Use object-fit:contain in a 4:1 desktop, 3:1 mobile frame with letterboxing and a
360px maximum height. Missing
banner has a shorter accent surface; missing logo is omitted, never fabricated.
Identity sits physically below artwork. Tabs remain reachable with contained
horizontal scrolling/keyboard access on mobile; the page itself must not overflow.

`src/app/(public)/layout.tsx` keeps profile/banner/identity/tabs mounted across Home,
Mappools, Matches, Teams, Staff and Rules; only content underneath changes. Preserve
DOM/image identity and geometry on same-tournament links. Cross-tenant navigation
resets deliberately. Name/banner/logo come exclusively from tournament settings;
neither published nor draft Heroes override the profile. Home retains accessible
H1; subpages have their own headings.

Authored content is not rewritten to match layout. Every visible Hero renders its
own title, body, artwork and links. Title-only/image-only blocks remain meaningful;
truly empty bodies do not create blank panels. Hidden blocks stay hidden. The
profile summarizes the first two dates; timelines show the complete calendar.
Every authored button renders, including links also present in navigation.
Stage banners are independent.
Do not ship reference artwork/private tournament fixtures as default branding.

Homepage block treatments use the saved palette and rounded osu! geometry:
Hero has an accent surface with optional side-by-side contained artwork; text is
an open editorial band with a heading column; images pair unobstructed artwork
with authored captions; announcements use a compact notice icon/accent rail;
button groups have primary/secondary destinations; timelines use connected dated
milestones. Stack artwork and copy below an 800px content width; switch timelines
to a vertical rail below 600px. Container queries also apply inside draft previews.
Keep image-only sections full-width, long content wrapping, 44px actions and visible
keyboard focus. Saved page introductions render before the ordered blocks.

## Public Mappool Contract

Keep compact horizontal cards, not tall covers. Current geometry: 72px mobile,
64px from 640px; one column below 640px, two until 1100px, then three. Categories
remain separate canonical groups, with centered incomplete rows of equal-width
cards. No large NM/HD/HR/DT/FM/TB section headings. Slot badges remain visible.

Group surface is **behind** cards: 10px padding, subtle configured category tint
(currently 4%), 1px more opaque matching border (24%), rounded corners and 12px
inter-group gap. Card backgrounds are opaque; group tint must not wash over artwork
or text. Keep image/dark readability shade confined to each card. Do not turn the
group into a new colored card layout or lose custom categories.

Cards show artist/title, difficulty, badge, actual artwork and visible 44px info
button. Titles truncate gracefully. Desktop fine-pointer hover opens a portaled,
collision-aware detail overlay; it never increases row height or shifts neighbors.
Detail width/max-height and scroll containers prevent edge clipping/viewport overflow.
Touch tap follows the beatmap link; info opens a separate dismissible sheet/dialog
without navigation. No hover-only mobile behavior. Details show full title/difficulty,
mapper, stars, BPM, duration, ID and copy feedback; honor safe areas, focus, Escape,
outside/Close dismissal and ordinary page scrolling.

## Organizer And Referee Workspaces

Primary organizer navigation: Overview, Website, Stages & mappools, Teams & players,
Matches, Staff, Settings. Each opens actual work, not a link-directory dashboard.
Subsections are scoped normal links and permission-aware. The chooser remains
platform-level and hides tournament editing menus until selection.

Website groups Homepage, Rules, Tournament info, Appearance, Navigation & text,
Media library. Appearance/tab previews use actual public components, not a fake
illustration. Staff separates Public listing from Website access and Roles &
permissions. Settings holds technical/export/audit/sheet tools. Overview uses real
setup tasks/draft reminders; optional tasks cannot block publication, and checklist
collapses for published tournaments. No invented metrics or activity widgets.

Keep Save/Preview/Publish visible, destructive/history/advanced controls secondary,
and publication a restrained explicit state. Show backend-confirmed success/error,
unsaved status and guarded discard/navigation. Disclosure reduces clutter without
hiding necessary settings. Keep existing stored field values when switching tabs.

Pool editing uses compact rows/thumbnail/slot/ID/category and one-click copy. Less
common settings expand. Reorder controls must describe persistent slot changes,
not misleading motion reversed on Save. Bulk stage/pool/staff/schedule controls
show selection scope, mixed values, enabled patch fields, preview and stale errors.
Filtering clears hidden selections where implemented; never silently apply beyond
the reviewed rows. Planning, review, approval and publication remain distinguishable.

Matches is the single canonical list, All Matches default with optional My/Live/
Upcoming/Completed/Unassigned filters. Keep search visible on mobile and collapse
secondary filters. Rows retain readable time, stable number, teams, assignment,
state and actions without horizontal page scroll. Referee/View labels reflect
actual capabilities, not just assignment text.

Use match numbers throughout visible and accessible labels; keep internal/source
IDs out of rows, brackets and scoreboards. List defaults to numeric order, has
50-row pagination and keeps filters/sort/page in its URL. Search remains visible
on mobile. Page changes clear selection; polling pauses while an editor is open.
Time and referee assignments expand in their row rather than opening the full
match dialog. The full form remains available for participant changes and less
common settings.

An organizer Result action opens one embedded editor above the list/bracket,
with the selected number, opponents, score, winner/FF and source/reason in context.
Keep the Referee link explicit and preserve the referee screen's composition and
state machine. Bracket position clicks open the same organizer editor; position
editing remains a separate action. View changes must respect unsaved edits.
Focus enters the embedded editor and returns to its opener on close. Long entrant
and referee names wrap within narrow layouts; assignment controls remain usable.

Multiplayer review shows source metadata and an ordered, bounded game list. Make
warmup exclusion, red/blue mapping, proposed totals/winners, player-score details
and reasoned manual corrections explicit. Load earlier pages before reviewing an
incomplete source. Confirming is separate from retaining unconfirmed history;
show downstream impact and the necessary approval before changing earlier results.
Completed public history contains only accepted game data and a clear source label.

Referee desktop uses match/score/current action, compact central pool/pick-ban board,
and commands/history/rules. Sticky scoreboard and bounded scroll panes are functional,
not decorative. Responsive layout keeps current action/maps reachable. Show clearly
whether editing assigned match or observing read-only; polls must not overwrite
unsaved work. Copy controls and command dispatch are not execution confirmations.

## Accessibility And States

Use semantic headings/forms, visible labels/focus, aria-current for navigation,
named dialogs, focus trap/return and keyboard-operable menus/reordering. Pair status
color with text/symbol, never color alone. Confirm irreversible actions; don't hide
security warnings in tooltips. Keep buttons/text within parents at 320px and zoom.
Use compact skeleton/empty rows, real next steps and recoverable visible errors,
not blank sections or large generic empty-state cards. Notifications must not move
table geometry or conceal the current match action.

## Implementation Alignment

The approved direction remains unchanged. globals.css remaps several Tailwind
color names to semantic state/team tokens; those usages are not independent fixed
light/dark palettes. tournament-profile.module.css owns the persistent identity,
tabs and page frame; homepage.module.css owns CMS block layouts. The obsolete mixed
home-pilot stylesheet has been removed. workspace-pilot.module.css remains the
active organizer stylesheet despite its historical name.

Current editing uses shared Radix Modal/ConfirmButton alongside native confirm
prompts. Dirty editors share one navigation confirmation, including cancelable
browser history and guarded stage redirects. Pooling dialogs preserve edits when
discard is canceled, protect transitions into other dialogs, and return focus to
their connected opener. Unsupported/forced browser exits retain the limitations in
[ARCHITECTURE.md](ARCHITECTURE.md#interface-language-and-editor-ownership).
Built-in copy follows the English/Italian control; editable copy remains authored
content. The approved layout and confirmation controls are retained. Regression
scope and historical evidence belong in
[F09](PLAN.md#f09-frontend-boundaries-and-editing-consistency); obsolete QA authority
is covered by [F10](PLAN.md#f10-obsolescence-and-compatibility-inventory).

Dense stage tables use contained horizontal scrolling; verification must include
access to their final columns by keyboard/touch, not merely absence of page overflow.
Screenshot sampling does not certify every editor, content state or assistive
technology. Dated results and evidence paths remain in
[PLAN](PLAN.md#repository-audit-checks---24-october-2026).

## Verification

The public directory lists published, unarchived tournaments; archived tournaments
remain in the organizer chooser. The directory status control reflects that rule.
Fresh page editors start unsaved. Cleanup preserves the approved profile layout,
tab persistence and both appearances; hidden blocks stay available to authorized
editing and are withheld from public data and media inference.

Use isolated synthetic fixtures and current E2E/rollout harnesses, following
[ARCHITECTURE.md](ARCHITECTURE.md#development-and-tests). Inspect actual screenshots;
DOM width assertions alone are not a visual audit. Evidence stays in ignored .data.

Required viewport checks: 1920 desktop, 1366 laptop, 768 tablet, 390 mobile and 320
narrow mobile; add 375/1024, landscape and zoom-equivalent reflow for shared changes,
plus 2560/3440 for changes to shared container widths.
Test light/dark/system and several saved accents, missing/real artwork, short/long
names, empty/populated collections, dialogs/errors and responsive navigation.
Verify touch/keyboard/focus, no page overflow, stable card dimensions/order, first/
last/edge hover overlays, mobile details/copy/dismiss and reduced motion.

Shared-profile changes must verify persistent nodes/one banner request/no duplicate
navigation and no draft override on public pages. CMS changes need actual save,
preview, publication isolation and unsaved handling. Referee/qualifier changes need
permission-aware views, live polling and preserved histories. Test development and
standalone production; Docker verification is required when changing its delivery.
Historic results live in [PLAN.md](PLAN.md#verification-baseline); mocks/visual checks
do not establish live OAuth, remote S3, real Bancho or every browser's compatibility.
