# Calm Design Pilot

Status: rejected. Retained as a historical implementation/verification record.
The replacement is [Tournament Profile Design](PROFILE-DESIGN.md).

## Scope

This pilot replaces the public tournament homepage composition and Organizer
Workspace navigation/overview. The homepage editor demonstrates the navigation
with real fields, saving, previewing and publishing. Other public pages and
editor/referee bodies have not been redesigned as part of this pilot.

Existing uncommitted work from the previous design pass was preserved. The branch
therefore includes earlier changes outside this pilot; they are not new work in
this milestone. No database migrations, live content edits or deployment are
needed to review the pilot locally.

## Baseline Problems

- The tournament name appeared in the navigation, hero, footer and copyright.
- The homepage separated its title, artwork and buttons into competing layers.
- The workspace repeated its context in a sidebar, breadcrumb, title and footer.
- Counts, shortcuts, stage/date lists and eight activity items competed on the
  overview, regardless of their relevance to the organizer.
- Mobile required opening a drawer for every workspace section change.

## New Composition

The homepage integrates artwork and identity in one full-width region. The title
has a fixed, restrained type size. Authored dates and content follow in an aligned
reading layout, without numbered decorations or card grids. Configurable text,
links, block order, visibility and branding remain intact. An empty homepage uses
only actual tournament identity; it does not create announcements or events.
An explicitly hidden hero stays hidden.

The workspace uses a two-line header instead of a fixed sidebar. Overview,
Homepage, Mappools, Matches and Referee remain direct links, when authorized.
Secondary tools are grouped in More; settings, public website, switching
tournaments and sign-out remain available. Mobile keeps the primary links visible.
Dropdowns support keyboard navigation, Escape and focus restoration through Radix.

The overview has one focus: actual website publication state. Edit homepage is
the primary action. Publication uses the existing permission-checked, versioned
tournament API and confirmation dialog. Key dates appear only when configured.
Stages, matches and teams are plain authorized destinations. No usage counts,
activity feed or fabricated attention items are displayed.

The homepage editor has a constrained working width and unframed content blocks.
Save, Publish and Preview stay visible; revision history and Unpublish are under
Page options. The Rules editor's toolbar and all underlying editing behavior stay
unchanged.

Pilot styles live in CSS modules. A pathname-aware boundary switches homepage
header/footer styling during client navigation, preventing it leaking into other
public pages. The bundled IBM Plex Sans/Mono pairing is retained, with mono used
only for dates and identifiers. No new fonts, packages or visual assets are needed.

## Reproducible Review

`tests/smoke/calm-pilot.ts` targets only the existing isolated
`platform_visual_test` database and a loopback application URL. It refuses to run
without `ALLOW_ISOLATED_CONTAINER_TESTS=yes`. The synthetic color-chart artwork is
QA media, not proposed tournament branding or a production default.

Fresh baseline screenshots are in `.data/visual/pilot-before/`, not the previous
redesign's baseline directory. After screenshots are in
`.data/visual/pilot-after/`. Desktop comparisons use 1366 × 900 and mobile uses
390 × 844, with identical fixture content. The after matrix additionally covers
320, 375, 768 and 1920px. Generated evidence is ignored by Git.

The browser harness checks HTTP success, overflow, console/runtime errors, direct
navigation, menu bounds/focus, actual draft persistence, unchanged published
revision, draft preview, revision history, guest API rejection, client navigation
out of/into the homepage, and tournament unpublish/edit/publish behavior.

The existing multi-tournament browser test also checks empty published homepages
and the new permission-aware navigation. Backend authorization, scope and
publication integration tests remain in place.

No live OAuth provider, S3 service or IRC connection is needed for this visual
review; those integrations are unchanged and are not claimed as freshly tested.

## Verification Results

- TypeScript, ESLint, Prettier and `git diff --check`: passed.
- Production `prisma generate && next build`: passed, including standalone output.
- Unit tests: 135 passed. PostgreSQL integration tests: 51 passed.
- Chromium regression suite: 16 passed, including the empty-homepage and updated
  workspace navigation checks.
- Pilot browser matrix: all 18 page/width combinations passed in development and
  again against the standalone production build, with no horizontal overflow,
  runtime errors or unexpected admin API errors.
- Draft saving, preview, history, guest rejection, homepage/subpage navigation and
  tournament unpublish/edit/publish were exercised against the isolated QA data.

The production preview runs on `http://localhost:3348/t/visual-review`. The local
comparison gallery is `.data/visual/pilot-review.html`. No Docker image was rebuilt,
no Docker network was created, and no live service or installation data was changed.
Nothing has been committed, pushed or deployed. Visual approval is the next step.
