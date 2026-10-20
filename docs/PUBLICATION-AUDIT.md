# Extraction and Publication Audit

Release candidate prepared on 20 October 2026. Intended repository name:
`osu-tournament-platform`. No public remote, push, license grant or production
cutover has been authorized or performed.

## Removed and Generalized

The extraction excludes the original Git directory/history, private environment
files, deployment units, domains/IPs, tournament graphics, public-source snapshots,
registration manifests, historical workbook fixtures, captured multiplayer API
payloads, real staff/teams/players and private maintenance reports/screenshots.
One-off instance import/provisioning scripts and stale deployment documentation
were not copied. The original repository, uncommitted work and services remain
available privately; none were reverted, committed, rewritten or deployed here.

Database-name checks, cookie names, CSS identifiers, package metadata, CSV filenames,
CLI configuration and test slugs are generic. Reusable registration import now
requires an explicit tournament and namespace and supports variable roster sizes
and IANA timezones. CMS text/branding stay in database content; no tournament
branch, hardcoded owner, original mappool or captured history is required.

Fresh bootstrap now creates system defaults only, with a pinned one-use owner
identity. There is no fake default tournament. Platform branding/global media,
timezone/document language and nullable featured tournament are independent from
tournament configuration. A generic read-only public-directory mount preserves
privately owned static graphics without bundling them in application source.

Existing multi-tournament records adopt a generic baseline through a reviewed
structural upgrade; original migration ledger entries and all historical data are
retained. That procedure is explicit and is not run automatically on web startup.

## Functionality Retained

OAuth/session protections, global/local RBAC, publication revisions, CMS/rules,
media ownership, stages, mappool editor/sorting, teams/rosters, schedules, qualifiers,
referee observing and assigned editing, protect/AB/ABAB/ABBA rules, score conversion,
reviewed multiplayer evidence, workbook action import, audit history and Discord
formatting are retained. PostgreSQL, filesystem/S3 and the optional per-referee IRC
gateway remain in one Compose deployment. IRC is disabled by default.

The reusable referee engine was not replaced. Real historical datasets were replaced
by synthetic cases, including numbered sheets 1, 25 and 27 with protects, bans,
picks, winners, completed results and duplicate-safe persistent import checks.

## Dependencies and Assets

A scoped workbook unzip override to MIT-licensed unzipper 0.12.5 removes an
unlicensed transitive package and obsolete parser chain: the installation removed
79 old packages and added four replacement packages. ESLint/TypeScript tooling is
explicit; unused application functionality was not deleted to reduce package count.
Every direct application dependency retains a concrete use.

The only shipped bitmap is a generated solid-color test fixture. There are no
tournament artworks, imported workbook files, captured screenshots or bundled
commercial fonts. Dependency metadata and known native-library notice requirements
are documented in [licensing](LICENSING.md). No final platform license has been
applied. The missing middleware-handler metadata license was resolved by inspecting
its shipped MIT LICENSE; this is not a blanket legal clearance of container images.

## Verification

Completed checks are recorded below; none imply real third-party credentials were
used where the test substituted a provider.

- 97 unit tests: engine, permissions, slot sorting, Discord golden output,
  synthetic workbooks, storage, proxy and mock IRC behavior.
- 51 PostgreSQL integration tests: CMS/publication, session/OAuth handlers,
  roles, teams, matches, multi-tournament scope, IRC replay/create guards, one-use
  ownership, platform-image privacy and three persistent synthetic history imports.
- 15 retained browser tests: five mappool widths, keyboard/touch/details/layering,
  a complete BO9 with protects/Blue-first ABBA/corrections/tiebreaker, live observers,
  qualifiers, forfeits, lobby links/deletion and independent tournament workspaces.
- Fresh installation browser/HTTP workflow: empty database/no tournament, setup,
  pinned owner, platform and tournament uploads, CMS/rules publication, mania pool,
  teams, completed match, history after reload and two-tournament isolation. This
  test uses synthetic external profiles/metadata and direct isolated DB sessions,
  never a production fake-login endpoint.
- Existing-installation compatibility: a fresh dump was restored into an isolated
  database and adopted. Prisma reports no schema difference. Existing users,
  roles, teams, pools, CMS, branding/media references, matches, actions and results
  match the read-only production hashes. No production writes were used.
- The generic production image rendered 36 public routes/viewports against that
  copy, including a pool and historical match timeline, with no broken images,
  overflow or client exceptions. Its original static graphics were mounted read-only.
- All 11 original uploaded files were copied to isolated S3 and SHA-256 verified,
  with zero missing/errors and no original deletion or reference rewrites.
- Fresh-stack restart: two tournaments, the completed 1–0 match, its action/result,
  public history and the consumed owner bootstrap survived web/DB/storage restart.
- Minimal maintenance image: real migration status/schema comparison, bootstrap
  and private storage initialization passed without a shell or global npm.
- Optional IRC browser workflow passed with HTTPS/WSS, mock Bancho, lobby creation,
  command acknowledgments, plain-text-safe chat, read-only denial and restart
  recovery. S3/media tests cover real object operations, image optimization,
  private/public delivery, ownership, cross-tournament denial and authorized delete.
- Development target: non-root hot-reload server and read-only source mounts were
  exercised separately from the release runtime.
- TypeScript, ESLint, Prettier, Prisma validation, npm audit (zero findings),
  Compose validation and production/Docker builds passed. Local verification ran
  on Linux/amd64; other architectures and remote GitHub CI were not exercised.

## Security Scans

Gitleaks 8.30.1 and Trivy 0.76.0 were downloaded from their official releases with
verified checksums. Candidate exports are scanned before Git initialization, and
the fresh repository history is scanned again before handoff. The release workflow
does not publish images automatically. CI repeats full-history secret scanning and
High/Critical vulnerability checks for all three release images.

The initial Node distribution carried fixable OS/global-package-manager findings.
Available distro updates and an updated build package manager were applied. Web,
maintenance and IRC release targets now use a separately digest-pinned Distroless
Node 22/Debian 13 base and run as UID/GID 1000. Shell/global npm/yarn are absent;
the development target keeps its own full tooling. Migrations and fresh browser
setup were retested with the minimal maintenance image.

Each scanned release image has **zero High/Critical vulnerabilities and no detected
secrets**, with 23 Medium and 8 Low OS findings remaining in the current scanner
database. These are point-in-time results, not a vulnerability-free guarantee.
The full build/development base still has upstream OS/toolchain advisories; it is
not distributed as a release service and should not serve production traffic.
PostgreSQL/RustFS remain independently maintained, pinned third-party images; the
three application-image results are not a blanket security clearance of providers.

A staging bridge overlapped a routed client LAN during testing. The conflicting
task-owned networks were removed without deleting volumes, the effective safe
daemon pool was verified, and LAN routing was checked beyond a single-client
workaround. Network preflight and bounded test cleanup are now documented and
required by the local agent instructions. No host-specific subnet is embedded in
the reusable Compose application.

Private verification inputs/backups/screenshots remain under ignored `.data`, never
the release tree. Source audit exports an allowlisted candidate, optionally checks
an operator-supplied private denylist and records a content digest. Gitleaks scans
that candidate with redaction, then scans the fresh Git history. An obvious repeated
synthetic Discord snowflake is used in the privacy test rather than a plausible ID.

## Repository Handoff

The new local repository is initialized only after the clean candidate audit, with
one independent root commit on `main`, no inherited history, no tags and no remote.
The final handoff records its commit and clean-tree verification. The initial commit
uses a neutral automation identity rather than publishing a personal email address.
Private envs, backup dumps, original media, reports and test runtime volumes are
excluded from Git and the Docker build context. No exposed credential was detected
in the candidate; that is not a retrospective audit of the original private history.

The original source-file hashes were checked against the pre-extraction inventory.
No original source changes were made. No production migration, application update,
storage switch or proxy cutover was performed. During the separate network repair,
an existing stopped database container was started using its unchanged volume;
both existing sites were subsequently checked for HTTP 200 responses.

## Remaining Approvals and Limits

Public repository creation/push, final application licensing, container registry
publication and live-service/database/storage/proxy changes require approval.
Configure required reviewers on the `release-approval` environment before enabling
manual image publication. Both web/tools/IRC use the same reviewed release version.
GitHub workflows are prepared locally; no remote CI run is claimed.

Live OAuth and uncached osu! metadata need deployment credentials. Live Bancho
login/commands remain unverified; automated IRC tests use mocks. AWS/R2/B2 account
behavior and real disk-loss recovery are not claimed tested. Existing pg-adapter
concurrent-query deprecation warnings remain visible; review before a pg 9 upgrade.
Single-node persistence still needs encrypted off-host backups and restore drills.

The safe live-transition procedure is in [upgrading](UPGRADING.md). Existing
deployments consume the same tagged generic images and retain their own DB/media,
OAuth app, secrets and private deployment overrides. The original private checkout
must not be archived or removed until an approved migration proves stable.
