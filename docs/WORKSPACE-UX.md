# Organizer Workspace UX

## Audit and Plan

The audit follows the actual section router, permission map, server queries,
editors and rendered desktop/mobile review pages. This is a workflow change,
not a public website redesign. No schema or referee-engine migration is needed.

| Task                                | Previous path/problem                                  | Intended destination                                          |
| ----------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| Create tournament                   | Platform chooser, then selected workspace              | Keep chooser and tenant boundary                              |
| Name/description/dates/registration | Settings, identity and registration tabs               | Website, Tournament info                                      |
| Artwork/colors                      | Settings, Branding                                     | Website, Appearance; real profile preview                     |
| Homepage/announcements              | Homepage; separate from other website fields           | Website, Homepage; existing revision editor                   |
| Navigation and public text          | Settings, Navigation and Page labels                   | Website, Navigation & text; contextual label preview          |
| Rules                               | More, Website, Rules                                   | Website, Rules; existing rich-text editor                     |
| Stages                              | More, Competition, Stages; duplicate basic stage forms | Stages & mappools, Stage settings; shared stage form          |
| Pools                               | Separate primary destination                           | Same Stages & mappools destination; compact editor unchanged  |
| Teams/rosters                       | More, Competition                                      | Primary Teams & players destination                           |
| Public staff                        | More, Website; permissions elsewhere                   | Staff, Public listing and Website access tabs                 |
| Staff access/custom roles           | More, Administration, Users/Roles                      | Staff, Website access and Roles & permissions                 |
| Schedule/assign matches             | Matches; same records also in Referee                  | One Matches list, optional My Matches filter                  |
| Live match/results/history/IRC      | Referee list, then match                               | Referee action on that match; return to Matches               |
| Qualifiers                          | Referee list, secondary link                           | Matches, Qualifier lobbies; original engine preserved         |
| Publish website                     | Overview/chooser; no empty-state next steps            | Overview, real-data setup tasks and existing publication gate |
| Transfer tournament                 | Settings export / platform import                      | Settings, Export; chooser, Import, unchanged permissions      |

Major risks: button-only tabs can bypass unsaved link guards; settings saves contain
the full validated settings object; two concurrent draft revisions must not become
one publication; managers and assigned referees have different mutation rights.
Reuse current APIs and independent revision checks. Subsection links prompt before
discarding edits; ordinary external previews must not prompt unnecessarily.

Implementation sequence: navigation and aliases; functional Website/Staff/Pool
composition; canonical match list; setup guidance and simpler common forms;
save/preview/discard states; isolated browser and authorization regressions.

## Verification

### Delivered Navigation

The primary navigation is **Overview, Website, Stages & mappools, Teams & players,
Matches, Staff, Settings**. Each destination opens an actual editor or working list,
not an intermediate directory of links. Subsections are ordinary scoped links,
filtered by the existing permission system. The tournament chooser remains separate.

- Website contains Homepage, Rules, Tournament info, Appearance, Navigation & text,
  and Media library. Homepage announcements remain existing editable content blocks.
  Navigation uses the real public tab component for its label preview; Appearance
  uses the real tournament profile header. Published homepage overrides are identified
  instead of silently being reset. Branding/settings saves take effect immediately;
  page drafts retain independent save, preview, publish and history operations.
- Stages & mappools contains the unchanged compact pool editor and shared Stage
  settings form. Creating or editing a stage from a pool returns to that pool.
  Advanced stage rules, progression and archive settings remain available.
- Matches is the only match-list screen and uses `section=matches`. The old
  `/admin/referee` list redirects there; individual referee and qualifier workspaces
  remain operational. All Matches is the default, with optional assignment/status
  filters. Each match opens Referee or View according to its actual edit permissions.
- Staff separates Public listing from Website access and Roles & permissions.
  Public positions still grant no internal access. Settings retains technical
  configuration, tournament export, audit logs and sheet data. Tournament import
  remains in the platform chooser.
- Old homepage/rules/media/stages/users/roles/audit/sheet URLs redirect to their
  corresponding scoped subsection. Existing saved bookmarks continue to work.

### Everyday Changes

The overview's setup links come from actual saved CMS, stage, pool, team and match
data. Optional items are labelled optional, publication is not blocked, and the
checklist collapses for published tournaments. Saved unpublished page changes have
a separate reminder.

Stage names suggest URL slugs without replacing customized slugs. Match creation
suggests an unused numeric code, selects the stage when only one eligible published
pool exists, and inherits its rules. Multiplayer links can be changed from the
match list through the existing version-checked operation. Import and rule presets
remain in a labelled disclosure rather than competing with routine actions.

Settings have explicit saved/unsaved status, guarded discard and backend-confirmed
notifications. Stage, team, staff and match dialogs have explicit cancel actions.
Website subsection navigation prompts before abandoning unsaved changes. Compact
link rows retain keyboard move buttons on touchscreens. Public page text fields
are grouped by page; all original stored values are preserved.

These source-verified interaction counts start at the selected workspace and
exclude typing, saving and scrolling. They are not a timed usability study:

| Operation                     | Before                                   | After                                                           |
| ----------------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| Open teams                    | More, Teams: 2 clicks                    | Teams & players: 1 click                                        |
| Start creating a stage        | More, Stages, New stage: 3 clicks        | Stages & mappools, New stage: 2 clicks                          |
| Edit public labels            | Settings, Page labels: 2 clicks          | Website, Navigation & text: 2 clicks, with a navigation preview |
| Find a match                  | Two competing Matches/Referee lists      | One Matches list, then Referee/View                             |
| Stage creation forms to learn | Basic pool form plus separate stage form | One shared form, advanced settings disclosed                    |

### Executed Tests

All application changes and checks were made in the existing
`/home/mdistefano/osu-tournament-platform` checkout. Test mutations were restricted
to isolated databases and task-owned fixtures, not installation databases.

- `npm run typecheck`, `npm run lint`, `npm run format:check` and `npm run build` passed.
- `npm test`: **153 tests passed** across 18 files.
- `npm run test:integration`: **63 tests passed** across 8 files. Coverage includes
  tenant isolation, assigned-referee versus manager authorization, draft publication,
  stale updates, histories, import/export and authenticated API mutations.
- `npm run test:e2e`: **20 Chromium tests passed**. The final rerun is split into
  the 7 management/transfer/workspace tests and the 13 public-mappool/referee tests.
  The new full organizer flow
  saves information, uploads branding, saves an accent, previews the actual profile,
  edits navigation and public page text, saves/publishes homepage and rich-text rules,
  creates a custom-rules stage, bulk imports/sorts/publishes its pool, creates and
  approves two rosters, grants referee access, schedules/assigns a match, saves its MP
  link and publishes the website. Guest-visible labels and inherited match rules are
  asserted. The referee follows the compatibility URL to Matches, filters assignments,
  opens assigned referee mode and returns to Matches.
- Additional browser tests cover cancelled unsaved navigation/discard on mobile,
  multiple tournament switching, private tournament visibility, read-only observing,
  complete BO9 actions/corrections/results, qualifiers, forfeit confirmation,
  permanent match deletion, tournament transfer and the untouched public mappool.
- In the separate populated migration-review database, historical matches **1, 25
  and 27** rendered **10, 14 and 11 actions** respectively. Scores remained **6-0,
  7-3 and 7-0**; timelines survived reload, MP URLs appeared in Discord previews,
  and history remained accessible. Guest requests to the private tournament and
  its media correctly returned 404. The populated fixture still contains **31
  matches, 290 individual actions and 194 map results**. No match records were
  changed by this check.
- The standalone **production** build passed **228 route/viewport checks**:
  38 public/platform/workspace routes in dark and light modes at **1366, 390 and
  320px**, executed as 114 checks per theme. Every expected route returned 200,
  with no browser console/page errors or horizontal page overflow. Compatibility
  redirects, subsection editors, stage/match/import dialogs and real artwork
  previews were exercised. The mobile match footer has an explicit geometry
  assertion preventing assignment text from being squeezed by action controls.
  System appearance followed the OS setting, and public mappool slot order,
  positions, card dimensions and corner radius matched the prior baseline.
- Type checking, lint, formatting, `git diff --check`, tracked-source auditing and
  a redacted secret scan of changed/new source passed. No environment files, QA
  session tokens, uploads or screenshot artifacts are included in the changes.

Run integration and E2E suites sequentially when using the same isolated database.
An overlapping verification run temporarily observed two Owner fixture assignments
instead of the single assignment expected by an existing integration assertion.
The sequential rerun passed all 63 tests. An interrupted browser runner was also
rerun in smaller batches; only its own abandoned fixtures were cleaned up.

### Screenshots

Screenshots are local ignored QA artifacts, not shipped tournament content:

- [Website text editor, desktop dark](../.data/visual/workspace/website-navigation-dark-1366.png)
- [Website text editor, mobile dark](../.data/visual/workspace/website-navigation-dark-390.png)
- [Matches, desktop dark](../.data/visual/workspace/matches-editor-dark-1366.png)
- [Matches, mobile dark](../.data/visual/workspace/matches-editor-dark-390.png)
- [Matches, narrow mobile light](../.data/visual/workspace/matches-editor-light-320.png)
- [Stage creation, mobile light](../.data/visual/workspace/new-stage-light-390.png)
- [Actual appearance preview, desktop light](../.data/visual/workspace/appearance-preview-light-1366.png)

### Compatibility and Limits

No schema migration, data reset, permission assignment, public profile redesign,
public mappool redesign or referee-engine change is part of this update. Server-side
mutation authorization and match snapshots are reused. A normal application rebuild
is required when deploying the changes; no live deployment is performed here.

Native browser Back/Forward navigation is not comprehensively intercepted by the
unsaved-link guard. Reload/close and ordinary workspace links are protected.
External osu! OAuth, uncached osu! API requests, remote S3 and a real IRC connection
were not re-exercised against live credentials during this UX task. They remain
existing integrations, not new mocks. Older one-off visual harnesses describe their
historical layouts; `rollout-review.ts` and current E2E tests cover this workspace.
