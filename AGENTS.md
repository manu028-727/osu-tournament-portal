# Agent Work Instructions

## Project Boundary

Work in the existing checkout of `manu028-727/osu-tournament-portal`. Before edits,
run `pwd`, verify `package.json` and the Git remote, and inspect `git status` and
the current branch. The current development checkout is
`/home/mdistefano/osu-tournament-platform`; installation paths elsewhere may differ.
Never switch to the old OIDC or Nigachi projects, change their databases/services,
initialize a replacement repository, or assume the current directory is correct.

Keep instance configuration, artwork, registrations and histories outside Git.
Preserve unrelated user changes. Do not change branches, force-push, publish images,
deploy, restart services or mutate installation data without the applicable user
approval. Pushing reviewed source changes is not permission to deploy them.

## Documentation Contract

These are the only maintained project Markdown documents. Do not add feature
guides, audit reports, design pilots, nested agent files or duplicate specifications.
Dependency documentation and ignored local QA artifacts are not project authority.
Legal notices such as `LICENSE` and `public/fonts/LICENSE.txt` must remain intact.

| Document                                | Owns                                                              | Read When                                           |
| --------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------- |
| [README.md](README.md)                  | Installation entry point and everyday commands                    | Starting or handing off work                        |
| [INTENT.md](docs/INTENT.md)             | Motivation, audience and product principles                       | Deciding whether a feature belongs                  |
| [SPEC.md](docs/SPEC.md)                 | End-state behavior and acceptance contracts                       | Implementing or reviewing behavior                  |
| [PLAN.md](docs/PLAN.md)                 | Ordered delivery history, evidence and remaining work             | Resuming, planning or reporting progress            |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Technical implementation, security, operations and development    | Changing code, data, infrastructure or integrations |
| [DESIGN.md](docs/DESIGN.md)             | Current visual language, interactions and responsive verification | Changing anything rendered in the UI                |

Read INTENT, SPEC and PLAN before substantial work, then the relevant architecture
sections. Read DESIGN before UI changes. Source, schema and tests establish what
actually exists; investigate discrepancies rather than treating a planned feature
or old verification count as proof of implementation.

Update the owning document in the same change as the behavior. Update PLAN with
completed work, actual checks, limitations and next steps. Update ARCHITECTURE for
API/schema/deployment changes, SPEC for agreed contract changes, DESIGN for approved
interaction changes, and README only when setup or entry-point guidance changes.
Keep motivations out of the technical runbook and temporary progress logs out of
the specification. Use relative links to these documents and their headings.

## Engineering Invariants

- Preserve tournament isolation at queries, mutations, foreign keys, media delivery
  and archives. A selected tournament is required for tournament editing; empty and
  unpublished tournaments are valid states.
- Authenticate and authorize every protected server operation. Navigation hiding
  is not authorization. Public staff titles never grant website permissions.
- Preserve independent saved drafts and published revisions. Never expose draft
  content, private reviews, roster details or internal audit payloads publicly.
- Preserve match numbers, roster/rule/pool snapshots, score provenance and action
  history. Use version checks, established transactions/locks and audited corrections;
  do not bypass the referee state machine or silently reseed downstream gameplay.
- Validate inputs with existing Zod schemas, sanitize rich text and use existing
  storage/osu! API/domain helpers. Prefer local patterns and narrowly scoped edits.
- Use additive reviewed migrations. Never reset a database, rewrite an applied
  migration, delete persistent volumes or import fixtures to repair live content.
- No fake production login, bot impersonation, fabricated tournament data, secrets
  in logs or automatic retries of uncertain IRC room creation.

## Implementation And Verification

Use Node 22.12+ with the lockfile (`npm ci`). Read local framework guidance below
before changing Next.js code. Search with `rg` when installed, otherwise `git grep`
or `find`. Use `apply_patch` for manual edits. Keep public source ASCII unless the
existing content needs Unicode; do not translate or rewrite saved tournament text.

Scale tests to risk. The commands and database guards are in
[Development and Tests](docs/ARCHITECTURE.md#development-and-tests). For application
behavior changes run format, lint, types, relevant unit/integration/browser tests
and a production build. Use only isolated test databases and synthetic fixtures.
Run integration and browser suites sequentially when sharing a database. Never
turn an interrupted run into a success claim; rerun its required checks.

UI work needs actual browser screenshots and interactions, including narrow mobile,
both appearances and empty/populated states. Follow the
[visual verification contract](docs/DESIGN.md#verification). Keep generated evidence
in ignored `.data`, not a new Markdown report or shipped assets.

Report what changed, checks actually run, deployment/migration requirements and
unverified provider behavior. Historical evidence belongs in PLAN with its revision
and scope. Do not describe mock Bancho, synthetic OAuth sessions or local storage
tests as live provider verification. Security reporting and redistribution rules
are in [Security and Distribution](docs/ARCHITECTURE.md#security-and-distribution).

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Docker Network Safety

- Before creating staging networks, inspect Docker's effective address pools,
  host routes, SSH client address and routed LAN/VPN ranges. Docker defaults can
  allocate `192.168.x.x`; never assume they only allocate `172.x.x`.
- Do not start additional stacks with unreviewed address pools. Changing daemon
  settings does not renumber existing networks; do not restart the daemon casually.
- Keep temporary stacks bounded and remove only task-owned test containers and
  networks after verification. Preserve named volumes, backups and live services.
- Never use global pruning or `down --volumes` to repair a network conflict.
