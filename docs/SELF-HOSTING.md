# Self-Hosting

Use the README quick start for a fresh installation. Never apply the fresh baseline
to an existing database; follow [adoption](UPGRADING.md#existing-installations).

## Configuration

`node scripts/provision-docker.mjs` creates `.env.docker` with mode 0600 and unique
database-admin, database-app, storage-root, storage-app and gateway credentials.
It refuses overwriting existing configuration. `.env.example` documents all values;
examples contain placeholders, not working credentials. Do not commit private env
files. If you rename the file, update STACK_ENV_FILE and pass `--env-file` each time.

Web, maintenance and IRC use digest-pinned Distroless Node 22/Debian 13 images with no
shell or package manager. They run as UID/GID 1000, matching the persistent upload
volume. Use `docker compose logs` and Node-based health checks for diagnosis, not
`docker exec ... sh`. Maintenance commands invoke Node/Prisma directly. Development
has a separate build target with shell/npm; do not expose it as the production web
server or publish it as a release image. Build/development stages install available
Debian security updates. Rebuild and rescan all images regularly.

- Required: DATABASE_URL, APP_DATABASE_NAME, APP_URL and OAuth credentials/callback.
- Bootstrap: OWNER_OSU_ID pins the intended numeric identity, INITIAL_SITE_NAME is
  optional. Run bootstrap after migrations, before sign-in. It creates no account.
- Migrations: DIRECT_URL is the administrative/unpooled connection. Web receives
  only the restricted application connection. Never run migrations automatically
  from web startup or use schema reset/synchronization against real data.
- Bundled PostgreSQL: POSTGRES_* and APP_DATABASE_* initialize only an empty
  volume. Changing environment passwords does not rotate existing credentials.
- Storage: STORAGE_DRIVER=s3 or filesystem, S3_ENDPOINT, S3_REGION, S3_BUCKET,
  S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and S3_FORCE_PATH_STYLE.
- Optional IRC: IRC_ENABLED=false, IRC_GATEWAY_SECRET, IRC_SERVER_HOST/PORT.
- Listener: WEB_BIND defaults to loopback, WEB_PORT defaults to 3335; STACK_NAME
  gives each independent deployment separate networks and volumes.

Production APP_URL must use HTTPS. Set the same origin in the proxy, OAuth app,
redirect URI and platform Primary domain. Only the deliberate deployment env can
change authentication origins; a CMS save cannot silently retarget OAuth.

## First Run

`/setup` distinguishes pending initialization, missing OAuth configuration,
designated-owner sign-in, configured-with-no-tournaments and operational states.
Schema migration is an explicit operator prerequisite. Arbitrary first visitors
never become administrators. Owner designation is consumed persistently, not kept
open by an environment variable. Later access changes use protected platform UI;
the last platform administrator cannot remove themselves or the final administrator.

Create tournaments privately in `/admin/tournaments`, configure branding and rules,
add stages and publish reviewed pools. Assign local staff through the access UI.
Publish tournament visibility separately from its individual pages/pools. Platform
images are private until referenced by platform branding; only platform admins can
upload/change/delete them. Tournament admins cannot claim platform assets or other
tournaments' uploads. Images are decoded, bounded and converted to static WebP.

## Networks and Reverse Proxy

### Avoid LAN and VPN Conflicts

Docker's built-in address pools include both `172.16.0.0/12` subranges and
`192.168.x.x` subranges. A bridge subnet overlapping a remote LAN can intercept
SSH replies, even if the LAN is reachable through a router or VPN rather than
directly attached. Do not assume automatically allocated Docker networks are safe.
See [Docker subnet allocation](https://docs.docker.com/engine/network/#subnet-allocation).

Before starting additional stacks, inspect `ip -4 route`, `SSH_CONNECTION`, VPN
routes and `docker info --format '{{json .DefaultAddressPools}}'`. Reserve a
Docker-only range that does not overlap any of those networks. Persist it as
`default-address-pools` in `/etc/docker/daemon.json`, using `/24` allocations when
appropriate; merge with existing daemon settings rather than replacing them.
Validate with `dockerd --validate --config-file=/etc/docker/daemon.json`. Coordinate
any required daemon restart because it can interrupt unrelated containers.

Changing the pools does not renumber existing bridges. Recreate only affected
staging stacks/networks, retaining their database/media volumes. Never use global
network pruning or volume deletion as a routing fix. Check a newly allocated test
network and `ip route get` for the remote client and another LAN address afterward,
then remove the test network. Tear down temporary stacks without `--volumes` when
verification is finished. A single-client host-route workaround is not the fix.

### Public Listener

Only web publishes a listener. PostgreSQL, storage and IRC remain private; the
storage console is disabled. Caddy can proxy all HTTP and WebSockets to web:

```caddyfile
cup.example.com {
    reverse_proxy 127.0.0.1:3335
}
```

A proxy on another server needs WEB_BIND set to a private interface and a firewall
allowlist for that proxy. Do not open database, S3 admin or gateway ports publicly.
`/api/health` checks DB readiness without leaking config. Storage outage does not
make the match engine depend on storage availability.

## External Services

COMPOSE_PROFILES=database,storage enables bundled persistence. Remove `database`
for managed/existing PostgreSQL, or `storage` for external S3. Configure URLs,
database name, TLS and scoped credentials before starting web. Docker localhost
means the container, not the host. `compose.external-network.yaml` can attach an
explicit existing private network through EXTERNAL_SERVICE_NETWORK; it does not
move or replace data. Review network access before using a production network.

For AWS S3, leave S3_ENDPOINT empty and use S3_FORCE_PATH_STYLE=false. R2/B2/custom
endpoints commonly use true; verify provider behavior and region. The application
uses standard AWS SDK v3 operations, not RustFS admin APIs. All browser image URLs
remain same-origin authenticated/publication-aware routes, never Docker hostnames.
No public bucket, presigned URL or multipart upload is needed for these 4 MB images.

RustFS 1.0.3 is pinned by digest. Storage initialization creates a private bucket
and bucket-scoped IAM user, refuses conflicting policies and never resets existing
credentials. Root keys reach storage/init only. Read upstream advisories before
upgrading. Monitor capacity; single-node storage cannot survive disk loss unaided.

Filesystem mode stores uploads in the named `media` volume, not the writable image
layer. `compose.assets.yaml` optionally mounts INSTANCE_PUBLIC_DIRECTORY read-only
at `/app/public`, preserving existing static paths without putting instance artwork
into the platform repository. Confirm distribution rights separately for your files.
