# Interface Design

The approved design and current rollout are documented in
[Tournament Profile Design](PROFILE-DESIGN.md). That document supersedes the
historical palette, geometry and overview treatments recorded below. Shared
warm surfaces, rounded controls, editable branding and both themes now apply
throughout the application, including referee and qualifier tools.

## Direction

Graphite surfaces, restrained tournament branding and readable competition data.
Public pages favor artwork and identity; organizer screens favor rows and forms;
referee screens favor score, current action, maps and history. They share the same
type, controls, spacing and semantic colors, not the same page composition.

The visual audit used a separate `platform_visual_test` database, clearly labelled
synthetic teams/maps and an original test color chart. No installation content,
private player records, OIDC artwork or published CMS text was changed.

## Audit and Changes

| Area           | Observed Problem                                                 | Treatment                                                                                               |
| -------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Typography     | Arial plus global overrides enlarged tiny labels inconsistently  | Self-hosted IBM Plex Sans 400/600 and Plex Mono 400; explicit text scales                               |
| Navigation     | Duplicate acronym, wrong scoped active links, 288px sidebar      | Full tournament identity, scoped active state, 240px sidebar, keyboard-aware mobile menus               |
| Directory      | Large tiles and raw enum labels                                  | Short artwork tiles, readable statuses, count and compact filter bar                                    |
| Homepage       | Hidden tournament heading, tall timeline cards                   | Visible identity, bounded artwork and date rows; original CMS content retained                          |
| Public content | Large section headings, oversized staff/team placeholders        | Document-style rules, compact people/rosters, restrained team identity and stage lists                  |
| Mappools       | Good dense cards but inconsistent surrounding hierarchy          | Preserve 64/72px cards, centered category groups, hover portals and touch detail sheets                 |
| Overview       | Banner, gradient and four oversized statistic cards              | Inline real counts, editor links and plain stage/date/activity lists                                    |
| CMS            | Repeated panel framing and fully expanded homepage blocks        | Tabbed, unframed settings sections, collapsible content blocks, consistent action bars                  |
| Referee        | Width consumed by navigation and dispersed hierarchy             | Three operational panes, sticky desktop scoreboard, current-action emphasis and scrollable maps/history |
| Mobile matches | Filters hid the match list and actions needed sideways scrolling | Collapsible filters, visible search and match rows with the same permission-gated actions               |
| States         | Large empty/loading panels and inconsistent modal geometry       | Short empty rows, skeleton rows, bounded dialogs, shared errors and textual status indicators           |
| Responsive     | Existing chooser/user-table overflow                             | Minimum widths, wrapping toolbars and positioned scroll containers that contain offscreen labels        |

Security notices, deletion confirmations, input constraints and publication
explanations remain. Generic promotional subtitles and decorative icons were
removed. Backend endpoints, match calculations, authentication, permissions and
publication contracts are unchanged. There is no database migration.

## Tokens and Components

`src/app/globals.css` owns the palette, type scales, surfaces, radii, focus,
responsive constraints and operational layouts. Base element styles live in
Tailwind's base layer so they cannot override utility border colors accidentally.

- Background `#141416`, raised surface `#202023`, foreground `#f2f0f1`, muted `#b3b1b8`.
- Default brand pink, live mint, warning gold, distinguishable red/blue teams.
- Body 16px; public prose 17px; operational text 14px; secondary labels 13px.
- Controls 4px radius, repeated items 6px, dialogs 8px. No negative tracking.
- Standard controls 44px; compact desktop controls 40px; coarse-pointer buttons
  and mobile referee copy controls at least 44px tall.
- Motion is short and functional. Reduced-motion preferences disable transitions
  and animation. No glass effects, glowing backgrounds or animated page entrances.

Use `Button`, `Badge`, `StateBadge`, `MatchStatusBadge`, `Field`, `Modal`,
`ConfirmButton`, `SectionTitle` and `LoadingState` rather than another local style.
Use cards for repeated objects or genuinely framed tools, not every page section.
Numeric scores/IDs use the data font and tabular numerals. Keep meaningful text
alongside semantic colors. Maintain `aria-current`, visible focus and dialog names.

Tournament logos, banners, mod colors and all CMS content remain configurable.
`src/lib/theme.ts` raises insufficiently contrasting primary/accent display colors
to a 4.5:1 contrast ratio against the raised surface and chooses readable button
text. The stored original color is not changed. Workspace dialogs are portaled
inside the workspace so they inherit its tournament theme. Public map previews
retain their own scoped theme capture.

IBM's unmodified WOFF2 assets are bundled with their OFL 1.1 license in
`public/fonts/`. `next/font/local` serves them locally with adjusted fallbacks;
there is no Google Fonts or other runtime font dependency. See [licensing](LICENSING.md).
No new UI library or image service was added. Existing artwork supplies the visuals.

## Visual Verification

`tests/smoke/visual-review.ts` is deliberately guarded to the separate database
`platform_visual_test`, a loopback `APP_URL`, and
`ALLOW_ISOLATED_CONTAINER_TESTS=yes`. Migrate and bootstrap that empty database
with test owner ID `990200011`, then run with `--seed` to create its explicitly
synthetic fixtures. Run with `--before`, `--matrix` or `--interactions-only`.
Do not run it against an installation database. Seeding does not reset databases.

Screenshots and JSON reports go to ignored `.data/visual/before` and
`.data/visual/after`. The matrix covers 28 public/organizer/referee routes at
320, 375, 390, 768, 1024, 1366 and 1920px. It rejects non-200 responses, page
overflow and console/page errors. Additional checks exercise navigation focus,
mobile dialogs, CMS preview, mappool hover/details, IRC security UI, landscape and
200%-equivalent reflow (half-width layout at twice the pixel density).
Screenshot fixtures are QA evidence, not shipped demo content.

Keep the existing browser suite for publication isolation, canonical map grouping,
hover geometry, mobile copy/dismissal, referee permissions and live workflow
regressions. Theme contrast has dedicated unit tests. Review actual screenshots
when changing shared layout; passing a width check alone is not a visual audit.

Production Docker/browser verification is required as well as development mode.
Live osu! OAuth, uncached provider data and real Bancho sessions need authorized
deployment credentials; no such live checks are implied by visual tests.

## Verification Record

Verified on 20 October 2026, using Chromium and isolated databases:

- Formatting, ESLint and TypeScript passed.
- 135 unit tests, 51 PostgreSQL integration tests and 16 browser workflow tests passed.
- Production Docker build and container health passed; the admin data route is
  present in the standalone route manifest.
- 196 distinct route/width combinations passed (28 routes at seven widths),
  with no unexpected HTTP errors, page overflow or console errors. Navigation,
  settings-tab retention/save, modal bounds/focus, copy/detail interactions,
  simulated network failure/recovery, landscape and 200%-equivalent reflow were
  also exercised. Mobile match actions do not require sideways scrolling.
- Mobile layout shift measured 0.0096 for the fixture homepage and 0 for its
  mappool. No external font requests were made. These are fixture measurements,
  not a performance guarantee for arbitrary uploaded content.

Before screenshots cover 25 routes at desktop/mobile sizes. The final matrix
also covers the populated stage index, referee dashboard and sheet-data view.
For the same isolated fixture, the overview shortened from 1854 to 1195px at
1366px width, the mobile homepage editor from 3992 to 1946px, and the default
mobile settings view from 8557 to 1479px. Settings remain available in their tabs;
the measurements do not imply removed fields or deleted content.

Screenshots/reports remain local QA artifacts under `.data/visual`, not repository
assets. Provider credentials and other browsers were not verified. No production
deployment, database migration or installation-content rewrite was performed.
