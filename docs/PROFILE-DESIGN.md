# Tournament Profile Design

Status: approved design, rolled out on `design/tournament-profile`.
Working directory: `/home/mdistefano/osu-tournament-platform`.
The remote is `manu028-727/osu-tournament-portal`.

## Profile Header

The public tournament layout no longer has a separate hero panel. Its structure is:

1. Platform directory link, appearance preference and existing account controls.
2. Rounded, unobstructed banner with no heading, overlay, gradient or controls.
3. Tournament identity: optional logo, moderate title, meaningful status and dates.
4. One set of tournament navigation tabs.
5. Authored CMS content, without empty generated sections.

The banner uses the existing visible homepage image override, falling back to
the tournament banner. This preserves the existing CMS editing and draft-preview
precedence. Stage banners are independent and unchanged. `object-fit: contain`
preserves text-heavy artwork rather than requiring destructive crops or a new
focal-point database field. The desktop frame is 4:1 and mobile is 3:1, with
letterboxing where needed. Missing artwork uses a shorter accent-tinted surface;
missing logos are omitted, never fabricated.

Identity and navigation are physically below the image, verified by browser
bounding-box assertions. The title wraps without viewport-scaled type. Tabs can
scroll horizontally on small screens, and retain keyboard access and active state.
Only the banner has 24px desktop / 20px mobile corners; the identity and tabs flow
into the page without a separate card surface. Controls use 12px corners.

`src/app/(public)/layout.tsx` owns the banner, identity and tournament tabs, outside
the changing page content. Same-tournament Next.js links preserve this layout and
its image nodes. The top header contains platform controls only, on every public
tournament page. There is no second desktop/mobile tournament menu. The shared
header reads only the published homepage revision; unpublished edits cannot change
its image or title. The CMS preview composes the same header with its selected
draft explicitly. The homepage retains an accessible H1, while subpages keep their
own page headings. Cross-tournament links still replace the document deliberately
to preserve tenant isolation.

Legacy hero paragraphs remain ordinary authored content below the header. Links
already present in navigation are not repeated as CTA buttons, but remain saved
and editable. The first two configured dates move into identity metadata; additional
dates and authored timeline notes remain in the content flow. No stored content
is rewritten, no fake fixtures/announcements are introduced, and block visibility
continues to control authored content.

## Appearance and Branding

There is one appearance preference: `portal_appearance`, with Light, Dark and
System values. It is a nonsensitive, same-site browser cookie, read by the async
Next.js `cookies()` API on the server. The root HTML includes the selected value;
native CSS `color-scheme` / `light-dark()` handles system preference before paint
and when the OS changes. No inline startup script or CSP weakening is required.
It persists through routes and reloads and is independent of the database colors.

The existing platform and tournament `primaryColor` and `accentColor` fields remain
the only branding source. Platform colors initialize new tournaments; a selected
tournament's saved colors take precedence in its existing scoped layout. Neither
field is overwritten by appearance switching. Display variants are contrast-adjusted
for the darkest light and lightest dark surfaces, with separate readable button
foregrounds. The original configured value remains unchanged.

Semantic tokens cover page, surface, elevated surface, text, muted text, borders,
interactive accent, subtle selection, hover and focus. Success, warning, destructive
and red/blue team colors have independent light/dark variants. Mod colors remain
unchanged. Menus/dialogs continue to inherit appropriate tournament branding.

The shared appearance foundation applies throughout public pages, CMS editors,
match and qualifier tools, IRC controls, dialogs, loading and empty states.
The approved rollout preserves the existing operational workflows and permissions.

## Organizer Workspace

The existing permission-aware direct editing destinations remain. Selected links,
menus, inputs, buttons and repeated editor blocks now share the rounded, warm
surface system. Publication is a small secondary status next to Overview, not a
large centerpiece. The overview provides useful editing destinations rather than
counts, activity widgets or a quick-action tile grid. Homepage still opens its real
editor directly; Save, Publish and Preview remain visible. Other editors/referee
page compositions and the match engine are unchanged.

## Main Files

- `src/components/home-content.tsx`, `home-pilot.module.css`: profile and real CMS content.
- `src/app/(public)/layout.tsx`, `src/components/tournament-tabs.tsx`, `public-nav.tsx`:
  persistent profile, single scoped tournament navigation and platform controls.
- `src/lib/theme.ts`, `src/components/appearance.tsx`, `src/app/layout.tsx`,
  `src/app/globals.css`: existing-branding derivatives and one appearance preference.
- `src/components/admin/shell.tsx`, `overview.tsx`, `workspace-pilot.module.css`:
  management navigation and focused overview.
- `src/components/ui/button.tsx`, `src/components/admin/shared.tsx`: shared controls/dialogs.
- `src/components/public-mappool.tsx`, `public-mappool.module.css`: only theme-aware
  slot/text/detail surfaces, retaining the original mod-colored borders/backgrounds;
  no new grid, card sizing, sorting or hover/mobile interaction logic.
- `tests/theme.test.ts`, `tests/smoke/profile-review.ts`: contrast and browser evidence.

Earlier design passes remain below as historical verification records. The current
rollout is described in the final section.

## Browser Evidence

The guarded review harness uses only `platform_visual_test`, a loopback APP_URL and
`ALLOW_ISOLATED_CONTAINER_TESTS=yes`. `--prepare` takes `PROFILE_BANNER_FILE` and
uploads it through the real CMS media endpoint, then configures only isolated QA
content. Reference artwork is not added to the application or repository. A second
empty QA tournament exercises missing branding, long names and accent isolation.

Screenshots are ignored at `.data/visual/profile-before` and `profile-after`. The
baseline contains the supplied artwork in the old layout, at the same desktop and
mobile viewport sizes as the new version. The new matrix covers four real pages
(home, overview, editor and mappool) at 320, 375, 390, 768, 1024, 1366 and 1920px in
both themes. Additional images cover missing branding and six non-identical accents.

The harness verifies image loading, unobstructed geometry, no page overflow,
unchanged mappool order/width/height/horizontal positions at comparison widths,
preference switching/reload/system behavior, configured color persistence, tenant
isolation, actual draft saves, unchanged published revisions, preview and guest
API rejection. The full regression suite covers mappool overlays/touch, tournament
creation/publication/scoping, historical/referee workflows and permissions.

The gallery is `.data/visual/profile-review.html`. No migration, reset, live
deployment or Docker network change is part of this pilot. Live external osu!
OAuth, S3 and IRC connections are unchanged and are not claimed as newly tested.

## Initial Pilot Verification

- 142 unit tests and 51 PostgreSQL integration tests passed.
- All 16 Chromium regression tests passed. All 7 mappool tests were additionally
  rerun after the final light-mode detail-label contrast correction and passed.
- TypeScript, ESLint, Prettier, whitespace checks and the production build passed.
- The 56-case theme/viewport matrix passed in development and standalone production,
  with no page overflow or console/runtime errors. Mappool geometry matched baseline.
- Six colors were saved through the protected CMS API and checked in both themes.
  Light/dark/system switching, reload persistence and cross-tournament isolation passed.
- Touch theme switching, the scrollable tournament tabs, and saving/restoring a
  color through the actual branding form passed at 390px.
- The supplied banner was uploaded through the CMS, displayed without cropping or
  obstruction, and kept out of the repository. Missing-banner/logo and long-name
  cases passed at 320px and desktop widths.

The local review URL is `http://localhost:3348/t/visual-review`. This initial
checkpoint preceded the user's approval of the profile direction and full rollout.

## Shared Layout Verification

The focused layout refinement keeps the profile mounted across Home, Mappools,
Matches, Teams, Staff and Rules. Production browser checks at 1920, 1366, 768,
390 and 320px in both themes verified all four DOM nodes (profile, banner,
identity and tabs) survive navigation, their bounding boxes remain unchanged,
only one document and one banner image are requested, and navigation is not
duplicated. All 60 tab transitions passed without console/runtime errors or
horizontal page overflow. Other page images are counted separately from the banner.

The 56-case production theme/viewport matrix also passed. Mappool slot order,
widths, heights and horizontal positions still match the original baseline.
Published homepage branding remains independent of draft previews. The new
automated regression includes a private hero draft and verifies that its title
and image never appear on any public tournament page.

Final checks: 142 unit tests, 51 PostgreSQL integration tests and all 17 Chromium
regression tests passed, along with TypeScript, ESLint, Prettier, whitespace checks
and the standalone production build. An initial CMS-menu timeout occurred during
an overlapping build; the complete sequential browser rerun passed.

Updated screenshots and comparison gallery are at `.data/visual/layout-after`
and `.data/visual/layout-review.html`. Only isolated QA records were used; a QA
staff image reference was corrected to make its existing upload publicly visible
through the normal publication checks. No production records, migrations, secrets,
Docker networks or live services were changed. No commit, push or live deployment
had been performed at that checkpoint.

## Approved Rollout Verification

The final rollout retains saved primary/accent colors, one appearance preference,
the persistent profile layout and the existing match/referee engine. Public map
cards retain their exact baseline slot order, widths, heights, horizontal positions
and grouping; only corners and theme-aware detail surfaces change. Cards use 12px
corners and groups/previews 16px; compact editor input heights remain unchanged.

`tests/smoke/rollout-review.ts` checks 31 production routes in dark/light modes at
1366px and 390px: 124 successful checks, no horizontal page overflow and no browser
runtime/console errors. Coverage includes every public destination, setup,
tournament chooser, every organizer section, match details, referee and qualifier
tools, match creation and archive-import dialogs. System appearance changes were
verified without reloading. Representative screenshots were inspected directly.
This harness requires an isolated QA database and never initializes live data.

The browser regression suite also checks narrow/mobile mappool interactions and
shared-header node persistence. Earlier seven-width/six-accent evidence remains
applicable to the unchanged layout and color-derivation logic. Live provider login,
remote S3 and Bancho sessions are not implied by these browser checks.

No live database, Docker network, deployment or installation content is changed by
the visual rollout. Transfer functionality has its own additive migration and
separate verification/documentation in [Tournament Export and Import](TOURNAMENT-TRANSFERS.md).
