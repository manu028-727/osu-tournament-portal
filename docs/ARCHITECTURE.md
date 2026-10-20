# Architecture

One Next.js application serves a tournament directory, public tournament pages,
CMS and referee tools. PostgreSQL holds users, hashed sessions, roles, permissions,
platform settings, tournament settings, revisions, media metadata, teams, stages,
pools, matches and history. Platform administrators are global; local roles and
public staff listings are separate systems.

Tournament request scope comes from validated routes/rewrites, not trusted client
headers. Compound keys and scoped DB helpers enforce tournament ownership. Every
mutation rechecks authorization on the server. Match state uses transaction locks,
versions and persistent action/result revisions; observers cannot overwrite editors.
Published page/pool pointers are independent of drafts. Public reads never return
an unpublished revision because a staff client cached it.

Fresh installations have no tournament anchor or demo records. System bootstrap
upserts permissions and platform configuration only. A pinned numeric osu! identity
can consume initial platform ownership once through genuine OAuth. New visitors
receive no privileges; tournament roles are assigned later.

Platform branding is independent of tournament settings and has its own global
asset ownership. Both upload paths share bounded content inspection and the same
filesystem/S3 adapter. Delivery checks the corresponding publication/reference
state. Storage credentials stay server-side. Failed writes do not create catalog
records; failed post-delete cleanup leaves a retryable orphan rather than a broken
published reference. Backups must include all stored revision references.

The web image runs generated standalone Next behind a small HTTP/upgrade listener.
IRC uses only the authenticated same-origin socket path. The separate gateway
keeps per-user ephemeral connections; it does not replace OAuth or the referee
action engine. Creation intent persists before lobby creation, while chat/passwords
do not. See [IRC](IRC.md) for the plaintext-network warning and outcome limitations.

Public osu! metadata caches use official APIs. Match evidence and workbook imports
are reviewed proposals; they do not silently overwrite match history. Import keys
include destination/namespace where applicable; repeated imports are duplicate-safe.

The schema is a clean generic baseline, including non-Prisma CHECK constraints and
partial uniqueness for unresolved IRC creation. Existing installations retain their
original ledger and adopt the baseline after a reviewed structural upgrade; no
source branch or tournament-specific migration is part of normal releases.
