# osu! Tournament Platform

Self-hosted tournament management with osu! OAuth, a browser CMS, mappools, teams,
match scheduling and referee workspaces. One application manages multiple isolated
tournaments; independent installations use their own database, storage and secrets.

Next.js App Router, React, TypeScript, Tailwind, TipTap, Prisma and PostgreSQL.
Uploads support a persistent filesystem or private S3-compatible storage. The
optional Bancho IRC gateway runs alongside the website, not in a serverless function.

## Quick Start

Requires Docker Engine, Compose v2+, an HTTPS reverse proxy for production, and an
osu! OAuth application. No host Node installation is required for Docker hosting.

```bash
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" -w /work node:22.23.3-trixie-slim node scripts/provision-docker.mjs
```

Edit the generated private `.env.docker`. Set APP_URL, OSU_CLIENT_ID,
OSU_CLIENT_SECRET, OSU_REDIRECT_URI and your numeric OWNER_OSU_ID. Register the
callback `https://YOUR_DOMAIN/api/auth/callback` in
[osu! account settings](https://osu.ppy.sh/home/account/edit#oauth). Use a separate
OAuth application for each environment. Never enter an ordinary osu! password.

```bash
docker compose --env-file .env.docker -f compose.docker.yaml build web migrate
docker compose --env-file .env.docker -f compose.docker.yaml up -d --wait postgres object-storage
docker compose --env-file .env.docker -f compose.docker.yaml run --rm migrate
docker compose --env-file .env.docker -f compose.docker.yaml run --rm bootstrap
docker compose --env-file .env.docker -f compose.docker.yaml run --rm storage-init
docker compose --env-file .env.docker -f compose.docker.yaml up -d --wait web
```

The generated listener is `http://localhost:3335`. Put your existing HTTPS proxy in
front of it. Open `/setup`, sign in as the designated account, then open
`/admin/tournaments`. Configure platform branding and create your first tournament.
There are **no default tournaments, matches, players or staff**. Bootstrap creates
system permissions and pins the designated owner; genuine OAuth sign-in consumes
that designation once. Restarting or reseeding cannot reopen owner provisioning.

## Tournament Operations

Each tournament has independent branding, content drafts and publication, staff,
teams, stages, mappools, schedules and role assignments. Public sites use `/t/SLUG`;
workspaces use `/admin/t/SLUG`. The platform root can show the directory or a
published featured tournament. Platform ownership and local tournament roles are
separate. Public staff positions do not grant website permissions.

Pool editing supports metadata lookup, bulk IDs, compact rows, custom categories,
numeric slot sorting and independent published revisions. Referees can view all
authorized tournament matches, with editing checked separately by assignment and
permission. Match actions, results, corrections and history persist in PostgreSQL.
Protects, AB/ABAB/ABBA sequences, qualifiers, FreeMod conversion, reviewed multiplayer
evidence, spreadsheet import and Discord output are included.

The CMS handles media, rules, homepage blocks, banners, navigation and publication.
Platform name, description, logo, favicon, social image, colors, footer, contact,
social links, default timezone and document language are configured separately from
tournament content. Document language is not automatic translation of organizer text.

## Guides

- [Installation, configuration and storage](docs/SELF-HOSTING.md)
- [Development and tests](docs/DEVELOPMENT.md)
- [Architecture and security](docs/ARCHITECTURE.md)
- [Updates, backups and existing-installation adoption](docs/UPGRADING.md)
- [Optional IRC and credential security](docs/IRC.md)
- [Publication audit and verification](docs/PUBLICATION-AUDIT.md)
- [Contributing](CONTRIBUTING.md) and [security reporting](SECURITY.md)
- [License and attribution status](docs/LICENSING.md)

## Limits

IRC is disabled by default. It has automated mock-server coverage, not verified
live Bancho credentials. The official server connection is unencrypted; read the
warning before entering a separate IRC password. Unknown command outcomes never
automatically become confirmed match results.

RustFS is integration-tested. External AWS S3, R2 and B2 use standard SDK settings
but need verification against your provider. Single-node PostgreSQL/storage volumes
are persistence, not redundancy or off-host backups. OAuth provider interaction
needs your registered credentials; automated tests substitute the external provider.

No final project license or public distribution approval has been granted yet.
This repository is a local release candidate until those decisions are approved.
