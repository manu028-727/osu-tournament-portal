# Competition Overhaul

## Audit

The starting point is commit `dc73647`. Work is confined to the generic portal
repository, `/home/mdistefano/osu-tournament-platform`.

| Area             | Existing implementation                                             | Required work                                                              |
| ---------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Refereeing       | Native Match, actions, results, revisions, concurrency checks       | Preserve; connect tournament scoring and confirmed progression             |
| Stage identity   | Native stages with kind, pool and rules                             | Separate bracket labels from stages; reviewed repair mappings              |
| Gameplay scoring | Editable scoreMode inside tournament/stage rule JSON                | One canonical tournament setting; immutable historical provenance          |
| Brackets         | Free-text Match.bracket only                                        | Native brackets, rounds, slots, advancement, preview, public view          |
| Eligibility      | Approved registrations and roster checks                            | Competition-path eligibility, losses, withdrawal and audited overrides     |
| Qualifiers       | Native lobbies, rosters, map scores, referee assignments and events | Dedicated policy, runs, provenance, API capture and stage enforcement      |
| Seedings         | Manual Team.seed                                                    | Validated calculations, finalization snapshots, cutoff and bracket linkage |
| Imports          | Numbered-sheet parsing and persistent action histories              | Canonical mappings, scoring compatibility, reviewed historical repair      |
| IRC              | Per-user auth, validated commands and Sent receipts                 | Preserve; never advertise stable Bancho commands as lazer room support     |
| Transfer         | Versioned archive and reviewed import                               | Preserve additional scoring and competition metadata                       |

## Delivery Order

1. Canonical tournament gameplay scoring and legacy safety.
2. Native competition models, eligibility and reviewed import repair.
3. List/bracket views, deterministic generation and result advancement.
4. Qualifier policies, runs, score provenance and reproducible calculations.
5. Standings finalization/publication and qualifier-to-bracket progression.
6. Complete simulations, security, browser and production verification.

## Organizer Workflow

1. Choose **Scoring System** in Tournament Settings, or during creation. This is
   the only editable gameplay scoring configuration. Stages inherit it; saved
   competitive records retain the scoring under which they were played.
2. Approve participants and publish the relevant stage mappool. In **Matches →
   Bracket**, create a single-elimination, double-elimination or group structure.
   Preview the seeds/byes, then generate. Advanced options include round-to-stage
   assignments, third place, reset finals, qualifier/group seed sources and ordering.
3. **List** and **Bracket** open the same native referee match. Schedule and assign
   it normally. Only organizer-confirmed results advance winners/losers. Publishing
   a bracket publishes its native matches; unpublished tournament visibility remains
   the outer gate. Public bracket/qualifier links are available from Matches.
4. Manual/locked slots and custom winner/loser routes are audited. Automatic
   recalculation respects those decisions and rejects cycles or unsafe replacement
   of started participants. Eligibility is per competition path. Exhibition/rematch
   overrides require an explicit reason and do not reactivate eliminated entrants.
5. For qualifiers, select the **Qualifiers** stage type and its evaluation policy,
   then create full-pool sessions from Matches. No Best-of/pick-ban workflow applies.
   Referees record individual map/run scores, or review games from the linked osu!
   multiplayer history before importing them. A game cannot count as both runs.
6. In **Qualifier results**, calculate and review a provisional version. Resolve
   ties explicitly, finalize the advancing cutoff, then publish if desired. Generate
   a bracket from that finalized version without re-entering participant seeds.
7. **Review correction** previews brackets affected by reopening finalized results.
   It requires an acknowledgment and reason, preserves old versions and frozen
   bracket participants, and hides the superseded public standings. It blocks when
   downstream gameplay has begun. Reopened/stale seed sources cannot start new
   bracket matches; they require explicit organizer reconciliation or a new path.
   No automatic reseeding or historical score conversion occurs.
8. **Matches → Import & rules → Stage reconciliation** previews mappings such as
   `Grand finals - Losers` to configured `Grand Finals`, preserving bracket context,
   source labels, actions and snapshots. Unknown/ambiguous mappings require review.

## Phase Outcomes

| Phases | Outcome                                                                                                                                        |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | Existing referee, import, CMS, session and permission architecture audited and retained.                                                       |
| 2–3    | Canonical tournament scoring and separate bracket/round/slot/standing records; additive migrations.                                            |
| 4      | Path-specific eligibility, withdrawals/disqualifications and audited overrides.                                                                |
| 5–6    | Reviewed stage repair and normalized numbered head-to-head Stat Lord sheets; qualifier-sheet limitation below.                                 |
| 7–9    | Unified views, seed placement/byes, SE/DE/reset, independent brackets, groups, explicit ties, connected group qualification and manual routes. |
| 10–11  | Full-pool qualifier sessions, one/two runs, score provenance, reviewed stable API capture and explicit lazer manual representation.            |
| 12–13  | Raw Score, sample Z-Sum, Team Average and named osu!plus qualifier Match Cost adaptation; four two-run selection policies.                     |
| 14–15  | Versioned/finalized/published standings, cutoff seeding, reviewed correction locks and no silent downstream reseeding.                         |
| 16     | Mathematical, PostgreSQL, export/import and actual development/production browser checks; verification details below.                          |

## Compatibility Limits

- Lazer uses explicitly acknowledged **standardized manual scores**. Legacy Bancho
  IRC commands and legacy match API payloads are not advertised as lazer support.
  Native lazer Rooms API capture is not implemented.
- The Stat Lord numbered head-to-head importer preserves actual actions and detects
  scoring mismatches. `Qualifiers Ref`/`Qualifiers Schedule` worksheet layouts are
  detected and reported as unsupported, not converted into invented session or
  score records. A verified source layout with actual individual performances is
  required for that additional adapter. Native qualifier creation/capture and
  portal archive transfer are separate, working paths.
- Qualifier lobby preparation currently copies commands; it does not attach the
  existing head-to-head IRC execution panel to qualifier sessions. Live OAuth,
  Bancho and osu! API behavior still needs installation credentials/network checks.
- Brackets start from generated supported structures, with manual slots/locks and
  winner/loser routing across paths. An arbitrary blank graph/node builder is not
  provided. Corrections affecting already-started downstream play require manual
  historical reconciliation; automatic reseeding is intentionally disabled.
- Only the documented osu!plus qualifier-cohort Match Cost adaptation is supported,
  not unnamed alternative formulas. Incomplete sources never become zero scores.

## Deployment

Back up database, uploads and private configuration. Pull the reviewed branch and
run `./portal install` during a maintenance window. It rebuilds images and applies
the three additive competition migrations. `./portal start` alone is insufficient.
These changes were migrated only on the isolated test database during development;
no installation database, Docker network, OIDC or Nigachi service was changed.

Export/import includes native brackets, rounds, slots, qualifier runs, provenance
and standings. ID-dependent source hashes are rebound only after comparing restored
results, seed order, policy and numerical witnesses; mismatches fail or remain
explicitly stale rather than silently accepting different historical results.

## Verification

Verified on the isolated `tournament_platform_test` database:

- `npm test`: **315 passed** across 24 files.
- `npm run test:integration`: **101 passed** across 14 files. This includes real
  SE8/DE8/reset and twelve-team bye persistence, group ties and connected paths,
  scoring isolation/locks, all four seeding methods, reviewed API capture with real
  database writes, correction locks, stage repairs and populated archive roundtrips.
- Standalone production `npm run test:e2e`: **28 passed**. This includes real
  qualifier→published standings→cutoff bracket→reviewed correction, SE/DE/groups,
  full Best-of-9 refereeing, assignment security, fresh organizer/CMS lifecycle,
  draft isolation, shared tournament navigation, IRC mocked transport, archive
  transfer, public mappool layouts and three intercepted correction-dialog cases.
- Actual screenshots inspected: public desktop bracket, light narrow-mobile bracket
  and dark 320px qualifier results. Browser assertions also cover light/dark
  1366/390/320px competition layouts and 1920/1366/768/390/320px public mappools.
- A clean development-mode regression pass also completed: **11 competition and
  referee browser tests passed**. Test-database migration diff reports no schema
  difference from the Prisma model.
- Production build, TypeScript, ESLint, Prettier, Prisma schema formatting, Compose
  configuration validation and upstream notice generation pass.

Compose syntax was checked with non-secret placeholder configuration. No Docker
image build, new network, service deployment, real provider credentials, or genuine
concurrent-user race simulation was performed in this task. Existing `pg` query
concurrency and Vite config-loader deprecation warnings remain; they did not fail
the checks. Browser authorization/IRC fixtures are test-only, never production
authentication substitutes.

## References

- [osu! scoring differences](https://osu.ppy.sh/wiki/en/Help_centre/Upgrading_to_lazer#differences-in-scoring)
- [Official seeding definitions](https://osu.ppy.sh/wiki/en/Tournaments/Common_seeding_methods)
- [osu!plus implementation](https://github.com/limjeck/osuplus/blob/master/osuplus.user.js)

Lazer standardized and classic values are display representations, not two
independent performances. Never infer lazer compatibility from a legacy
multiplayer `scorev2` label alone. Do not copy GPL implementation code into this
MIT project; independently implement documented mathematical definitions.
