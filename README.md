# osu! Tournament Portal

Self-hosted osu! tournament management with a browser CMS, mappools, teams,
scheduling and referee workspaces. One installation can manage multiple tournaments.

## Quick Start

You need a Linux server with **Docker Engine and Docker Compose**, a domain with
an HTTPS reverse proxy, and an osu! account. Node.js is not required on the server.

```bash
git clone https://github.com/manu028-727/osu-tournament-portal.git
cd osu-tournament-portal
./portal setup
```

Setup asks for your public URL, local port, osu! OAuth credentials and numeric osu!
user ID. It prints the callback URL to register in
[osu! account settings](https://osu.ppy.sh/home/account/edit#oauth), hides secret
input, and generates database/storage passwords in a private `.env` file.
It then builds and starts the website. The first build can take several minutes.

Point your HTTPS proxy at `http://127.0.0.1:3335` (or your selected port). Open
your public URL, sign in as the designated account, and create your first tournament
in `/admin/tournaments`, then choose **Open tournament**. Its editors live at
`/t/<slug>/admin/...` and work before publication. The platform chooser does not
show tournament editing controls. There are no default
tournaments or fake player accounts.

Use the EN/IT control beside appearance to choose English or Italian. Tournament
content stays in the language its authors used.

Players use **Registration and qualifiers** in tournament navigation. Organizers
configure registration from **Teams & players / Registration settings**. Use
**Matches / Qualifier sessions** for scheduling and refereeing, and **Qualifier
results** for stage-selected multiplayer imports, standings and seedings.

See [deployment and configuration](docs/ARCHITECTURE.md#deployment-and-configuration)
for proxy configuration and troubleshooting.

## Everyday Commands

```bash
./portal start
./portal status
./portal logs
./portal stop
```

Stopping does not delete data. Starting does not run migrations. With an existing
configuration, `./portal install` builds, applies migrations, initializes configured
storage and starts services. Back up before using it for an update; read
[updating and recovery](docs/ARCHITECTURE.md#updating-and-release-cutover) first.

## Included

osu! login, scoped roles, visual page/rules editing, draft/publish workflows,
image uploads, mappool metadata/import/sorting, staff and team management, schedules,
qualifiers, pick/bans, scoring, history imports and Discord result formatting.
The Matches workspace includes native single/double-elimination brackets and groups,
with confirmed-result advancement. Qualifier stages support one/two runs, reviewed
standings, published seedings and bracket generation. Choose gameplay scoring once
in Tournament Settings; see the [specification](docs/SPEC.md#qualifiers-and-scoring)
for compatibility limits.
PostgreSQL and private S3-compatible storage are included. Filesystem/external S3
storage and an optional Bancho IRC gateway are also supported.

## Documentation

- [AGENTS.md](AGENTS.md): development instructions and documentation reading order.
- [INTENT.md](docs/INTENT.md): motivation, audience and product principles.
- [SPEC.md](docs/SPEC.md): functional requirements and explicit capability limits.
- [PLAN.md](docs/PLAN.md): completed work, verification evidence and next steps.
- [ARCHITECTURE.md](docs/ARCHITECTURE.md): technical internals, hosting, upgrades,
  backups, transfers, IRC, security, development and tests.
- [DESIGN.md](docs/DESIGN.md): approved visual language and interaction contracts.

These are the only maintained project Markdown documents. For common tasks, jump
to [tournament transfers](docs/ARCHITECTURE.md#tournament-archive-protocol),
[historical bracket linking](docs/ARCHITECTURE.md#linking-historical-matches),
[development](docs/ARCHITECTURE.md#development-and-tests), or
[security reporting and contributions](docs/ARCHITECTURE.md#security-and-distribution).

IRC is off by default and tested with a mock server, not live Bancho credentials.
Its plaintext-network warning matters. External OAuth/S3 providers require your
credentials and deployment checks. Persistent volumes are not off-host backups.

## License

[MIT](LICENSE). Third-party components retain their own licenses and notices;
see [licensing and attribution](docs/ARCHITECTURE.md#security-and-distribution).
