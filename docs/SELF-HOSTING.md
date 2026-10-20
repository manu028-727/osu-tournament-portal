# Self-Hosting

## First Installation

Run `./portal setup` from the checkout. The guided setup creates `.env` with mode
0600, unique database/storage credentials and a callback matching your public URL.
The osu! client secret is not displayed. Existing configuration is never overwritten.
Use a separate OAuth application for each environment; never enter your osu! password.

Setup builds the images, waits for bundled persistence, runs migrations and the
one-time owner bootstrap, initializes private storage, then starts the website.
Only the numeric osu! account you selected can acquire initial platform ownership
through real OAuth. Restarting or reseeding cannot rearm that designation.

After signing in, open `/admin/tournaments`. Set platform branding and create a
tournament, then choose **Open tournament**. Tournament editors use
`/t/<slug>/admin/...`; drafts and unpublished tournaments are editable there.
The platform chooser hides tournament-specific menus until a tournament is opened.
Assign staff and publish reviewed content when ready. No tournament is seeded.
Do not use fresh installation against a legacy database; read [adoption](UPGRADING.md).

Old `/admin/t/<slug>/...` bookmarks redirect to the canonical workspace. Unscoped
editor URLs such as `/admin/homepage` return to the tournament chooser. Admin API
calls include `?tournament=<slug>`; an authenticated request without a selected or
configured context returns a selection error, not a missing-record 404. Empty
collections are valid. No special reverse-proxy rules are needed for the workspace.

## Running and Updating

| Command                | Action                                                         |
| ---------------------- | -------------------------------------------------------------- |
| `./portal start`       | Start configured services without migrations.                  |
| `./portal stop`        | Stop services, retaining all volumes.                          |
| `./portal status`      | Show service status.                                           |
| `./portal logs`        | Follow website logs; Ctrl+C stops viewing, not the website.    |
| `./portal install`     | Build, migrate, bootstrap and start an existing configuration. |
| `./portal compose ...` | Advanced Compose commands using the same env/project.          |

Back up before updates and read [updates and recovery](UPGRADING.md). Guided lifecycle
commands never reset databases or delete volumes; advanced Compose commands remain
the operator's responsibility. Changing passwords in `.env` does not rotate
credentials already initialized in a persistent database or storage volume.

## HTTPS and Networking

Only the website port is published, on loopback by default. Caddy on the same host:

```caddyfile
cup.example.com {
    reverse_proxy 127.0.0.1:3335
}
```

For a proxy on another server, set WEB_BIND to the server's private interface and
allow only the proxy through the firewall. Do not expose PostgreSQL, storage or IRC
gateway ports publicly. APP_URL must match the public HTTPS origin and OAuth app.
The callback is `APP_URL/api/auth/callback`; platform branding cannot retarget it.

### Network Safety

Docker's default pools can overlap routed LANs/VPNs. Before creating networks,
`./portal` checks the pools and existing bridge subnets against the IPv4 SSH client
address when SSH_CONNECTION is available. It stops on an overlap and never edits
the host firewall, routing or Docker daemon. IPv6 and other LAN/VPN ranges still need review.

An administrator should reserve a Docker-only range using `default-address-pools`
in `/etc/docker/daemon.json`, merging existing settings, then validate it with
`dockerd --validate --config-file=/etc/docker/daemon.json`. Coordinate any required
daemon restart; unrelated containers can be interrupted. Existing bridges do not
automatically change subnets. Recreate only affected test networks, retaining
volumes. Never use global pruning or volume deletion to fix routing.
See [Docker subnet allocation](https://docs.docker.com/engine/network/#subnet-allocation).

## Advanced Configuration

The root `compose.yaml` is the complete default stack. Normal hosting needs no
other Compose file. `compose.dev.yaml` is only for development. Specialist overrides
are under `deploy/` and are merged with the root file:

| File                                   | Use                                              |
| -------------------------------------- | ------------------------------------------------ |
| `deploy/compose.external-network.yaml` | Attach to an existing private Docker network.    |
| `deploy/compose.assets.yaml`           | Mount privately owned static graphics read-only. |
| `deploy/compose.qa.yaml`               | Automated mock-IRC testing, never production.    |

For example, after setting EXTERNAL_SERVICE_NETWORK:

```bash
./portal compose -f compose.yaml -f deploy/compose.external-network.yaml up -d web
```

To apply an override to every helper command, set
`COMPOSE_FILE=compose.yaml:deploy/compose.external-network.yaml` in `.env`.
The standard Docker Compose variable is honored for install/start/maintenance too.

`.env.example` lists settings. Manual provisioning without a wizard is available
with `node scripts/configure.mjs` (Node 22.12+), followed by editing `.env` and
running `./portal install`. Generated secrets are not placeholders.

- COMPOSE_PROFILES=database,storage enables bundled PostgreSQL and RustFS. Remove
  `database` for managed PostgreSQL, or `storage` for external S3/filesystem storage.
- DATABASE_URL is the restricted application connection. DIRECT_URL is the
  administrative/unpooled migration connection; web never receives it.
- STORAGE_DRIVER is `s3` or `filesystem`. S3 settings are S3_ENDPOINT, S3_REGION,
  S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and S3_FORCE_PATH_STYLE.
- AWS S3 normally leaves S3_ENDPOINT empty and uses S3_FORCE_PATH_STYLE=false.
  R2/B2/custom endpoints need provider-specific values and verification.
- Filesystem uploads persist in the named `media` volume. S3 uses a private bucket
  with scoped application credentials; root storage credentials are only for init.
- Optional IRC requires IRC_ENABLED=true and adding `irc` to COMPOSE_PROFILES.
  Run `./portal install` to build its image. Read [IRC security](IRC.md) first.
- Setup generates a unique STACK_NAME so a fresh installation cannot accidentally
  reuse another checkout's default volumes. It identifies persistent networks/data.
  **Do not change it on an existing installation** or Docker will select different volumes.

Existing `.env.docker` configurations remain supported by `./portal` if `.env` is
absent. Keep the same STACK_NAME and credentials. PORTAL_ENV_FILE selects another
private file; the wrapper supplies its path to storage initialization automatically.

Release images run as UID/GID 1000 without a shell/npm. Use logs and Node-based
health checks for diagnosis, not `docker exec ... sh`. The separate development
image is not intended for production.

## Troubleshooting

- **Docker permission denied:** ask the administrator to grant Docker access.
  Docker-group membership is root-equivalent; never paste a sudo password here.
- **Setup stopped for networking:** resolve the overlapping pool with the host
  administrator. A temporary route for one SSH client does not fix the pool.
- **502 from the proxy:** check `./portal status`, the selected port, proxy target,
  WEB_BIND and the firewall allowlist. The proxy must reach the website listener.
- **OAuth fails:** compare APP_URL, the generated callback and the registered osu!
  application. Preserve the original app credentials when moving an installation.
- **Setup already exists:** use `./portal start` or `./portal install`. Edit the
  private env file deliberately; do not regenerate credentials over existing data.

Volumes are persistence, not backups. Keep encrypted off-host backups and verify
restores as described in [updates and recovery](UPGRADING.md).
