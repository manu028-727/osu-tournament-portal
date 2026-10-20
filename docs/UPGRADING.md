# Updates and Recovery

## Existing Installations

Changing repositories does not require exporting/reimporting tournament content.
Reuse the intended database and media storage after staging verification. Never
run fresh baseline DDL directly against an existing schema.

The generic baseline represents the current multi-tournament schema with platform
branding/setup fields and a global PlatformAsset table. `deploy/adopt-existing.sql`
adds those fields/table, makes featured tournament nullable, changes defaults and
marks already-owned installations initialized. It does not rewrite tournament
content, users, results, imported actions or media keys. The old migration ledger
is retained; the generic baseline is marked applied using Prisma's resolve command.

First take consistent backups and test a restore. Configure an isolated copy's
DATABASE_URL/DIRECT_URL and explicit APP_DATABASE_NAME, then preview:

```bash
node --env-file=.env.upgrade scripts/adopt-existing.mjs
# After reviewing the target, SQL and backups:
CONFIRM_DATABASE_ADOPTION=YOUR_DATABASE node --env-file=.env.upgrade scripts/adopt-existing.mjs --apply
node --env-file=.env.upgrade node_modules/prisma/build/index.js migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

The helper expects the existing multi-tournament/IRC schema and refuses other
shapes. If the private source predates those migrations, upgrade it privately
first. Keep a migration-specific backup. A failure while marking the baseline
must be reviewed/retried; never resolve it by applying baseline CREATE TABLE DDL.
Generic existing-schema adoption is not an authorization to touch a live database.

Preserve private settings outside Git: map the old database-name guard variable
to APP_DATABASE_NAME, retain the actual database URLs, callback, storage driver and
keys. New generic cookie names require users to sign in again; user identities and
stored sessions are not deleted. Existing staff permissions, published revisions,
media references and static graphics stay authoritative. Static graphics can be
mounted read-only through `compose.assets.yaml`, without distributing them in code.

## Release Cutover

1. Build tagged web/tools/IRC images from one reviewed generic commit. Retain prior
   images and the original private checkout. No branch merging/cherry-picking.
2. Back up DB, storage and encrypted configuration; verify a staging restore.
3. Compare important table hashes, scores/actions, users, roles, CMS revisions,
   branding and media references. Apply only reviewed migrations/adoption to staging.
4. Exercise public/CMS/referee paths, uploads, draft isolation and restart persistence
   using the generic image with instance configuration, not custom source changes.
5. Obtain approval before changing live services, schema, storage or proxy routing.
6. During the approved window, pause writers, take a final backup/reconcile uploads,
   stop only the old web/gateway, run reviewed maintenance tasks, start the generic
   image with the same intended database/storage, verify health, then switch routing.
7. Smoke-test login, branding, histories, protected drafts and a non-disruptive edit.
   Monitor logs/health before authorizing cleanup of the old checkout or backups.

Rebuild with `docker compose --env-file .env.docker -f compose.docker.yaml build
--pull --no-cache web migrate irc-gateway` when refreshing security patches. The
build base is digest-pinned, with current distro updates layered during builds;
record the resulting image digests and scan them. Runtime images are separately
digest-pinned Distroless images without shell/npm/yarn tooling. Refresh those base
digests explicitly when updates are available. Lockfile installation is deterministic;
distro package refreshes are a
deliberate security update, not a claim of byte-identical OS layers forever.

Allow a brief controlled write pause for final reconciliation and service restart;
the exact downtime depends on backup size and migration review. Staging is not
automatic deployment. Rollback routes back to the previous image/configuration;
do not reverse additive schema or restore stale data over new writes blindly.

## Media Migration

Filesystem remains supported. Switching to S3 is a separate explicit operation.
`scripts/migrate-media.ts` previews all files/DB references, backs up originals,
copies without DB rewrites and verifies downloaded bytes with SHA-256, not ETags.

```bash
node --env-file=.env.migration --import tsx scripts/migrate-media.ts --source /private/uploads --report /private/preview.json
node --env-file=.env.migration --import tsx scripts/migrate-media.ts --source /private/uploads --backup /private/originals --report /private/copy.json --copy
```

Reports are exclusive mode-0600 files. Reruns verify existing objects; collisions,
symlinks and missing files require review. Original files are never deleted. After
verification, pause uploads/deletes, reconcile again, switch storage configuration
and verify both published and private images. Rollback must copy any new S3 uploads
back before restoring filesystem settings. Do not delete originals without approval.

## Backups

Volumes are not backups. Keep encrypted, versioned off-host copies and test restores.
During a controlled write pause, stop web/IRC, take `pg_dump -Fc`, stop object
storage cleanly and archive the entire storage volume, including hidden IAM metadata.
Archive filesystem media if used. Protect and back up matching credentials separately.
Restart storage and then web/IRC. Monitor disk capacity and backup age.

Restore into separate empty volumes, using `pg_restore --exit-on-error --no-owner
--no-acl` and preserving object-store UID 10001 / filesystem UID 1000. Verify schema,
table hashes, all referenced media, draft privacy and histories before routing users.
External providers need their own versioned backup/export tooling. An application
credential is deliberately not an object-storage backup administrator.
