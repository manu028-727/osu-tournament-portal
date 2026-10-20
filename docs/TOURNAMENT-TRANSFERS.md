# Tournament Export and Import

## Browser Workflow

Export: open a tournament's Organizer Workspace, then **Tournament settings →
Export Tournament**. It exports saved database content, not unsaved browser edits.
The account needs `settings.manage`, `users.manage` and `roles.manage` in that
tournament. Platform administrators retain their normal scoped access.

Import: a platform administrator opens **Tournaments → Import Tournament**,
selects a ZIP, and clicks **Preview archive**. Review the counts, warnings and
source assignments, choose an unused slug, and explicitly confirm **Import as
unpublished**. Preview does not modify the database or upload media. The exact
file fingerprint is checked again when importing.

Every successful import creates a **new, unpublished tournament**. Existing
tournaments are never overwritten, even when importing the same archive again.
Page/pool draft and publication states are preserved behind the private tournament
gate. Review the imported workspace before explicitly publishing the tournament.
New imports are not automatically added as the platform's featured tournament.

Only the importing administrator receives the new tournament's Owner role.
Existing osu! identities are resolved by numeric osu! ID without updating their
profiles, sessions or permissions. Missing historical actor profiles are created
without platform access, role memberships or sessions. Imported role definitions,
membership suggestions and referee assignments are retained in the completion
report for **manual review**, not applied as access grants. Public staff positions
remain separate from website permissions.

Recent imports, full completion reports and recovery controls remain available
inside the import dialog. The report includes counts for every imported collection,
media verification, warnings, source identity/role/assignment review and errors.
It is also retained in the tournament's import audit entry.

## Archive v1

The format identifier is `osu-tournament-portal`, version `1`:

```text
manifest.json       Version, source, JSON/media SHA-256 hashes and warnings
tournament.json     Explicitly allowed structured relational collections
media/<local>.webp   Uploaded media and referenced local raster artwork
```

Archive-local identifiers reconstruct foreign keys and JSON snapshot references;
new database IDs and storage keys are generated on import. Numeric osu! user and
beatmap IDs remain stable. Existing global participant and beatmap records are
reused without overwriting another tournament's shared data. Historical snapshots
and registered usernames remain in their tournament-owned records.

Included: configuration/branding, every saved CMS revision and block, rules and
announcements, stages and stage rules, every pool revision/slot, beatmap metadata,
teams/rosters/seeds, public staff/categories, matches and schedules, qualifiers,
actions including voided picks/bans/protects, individual/player scores, map winners,
events, result revisions/corrections, multiplayer evidence and tournament audit
history. Discord output stored in source snapshots is retained; the existing
formatter continues to generate results from the imported records.

Excluded: sessions, OAuth state/tokens, platform settings/administrator authority,
server environment/secrets, IRC credentials and transient IRC lobby requests,
temporary workbook upload previews and unrelated tournaments. Sensitive JSON keys
are excluded on export and rejected on import. Pending preview uploads are not
match history; accepted history is exported as real action/result/event records.

Existing uploaded WebP bytes are preserved. Referenced local raster files under
the source's `public/` directory are bundled; PNG/JPEG/AVIF files are normalized to
WebP. Local SVGs must first be replaced with raster CMS uploads. Missing or unsafe
local artwork fails export rather than silently omitting it. Remote image URLs
remain remote and are not downloaded, preventing arbitrary server-side URL fetches.
Source media and tournament links are remapped to the new destination identifiers.

Unknown versions, tables, fields, enum values, broken/cross-tournament references,
duplicate keys, malformed images and checksum mismatches are rejected. ZIP paths
are allowlisted, with symlinks, encryption, unexpected entries and traversal
rejected before extraction. No ZIP file is ever unpacked into the filesystem.
Rich text is sanitized on import using the existing renderer's policy.

Limits: 64 MB uploaded ZIP, 128 MB expanded content, 16 MB tournament JSON,
60,000 total records, 1,000 media files and 4 MB per image. This bounded in-memory
workflow targets ordinary self-hosted tournament archives. Very large tournaments
need a future streamed/offline migration path; the importer does not truncate data.
Treat archives as private: they include draft pools, staff notes and roster data.
Do not commit them or attach them to public issues.

## Failure Recovery

Before upload, a durable `TournamentTransfer` journal records fresh planned object
keys. Files are uploaded and read back for checksum verification. All relational
records, role initialization, relationship counts, completion report and journal
completion then commit in one database transaction. Publication is forced off in
that transaction, regardless of the archive's original state.

Failed database/storage operations roll back the tournament and clean only that
attempt's fresh objects. Cleanup failures remain `CLEANUP_REQUIRED`. Interrupted
workers leave a journal; after the worker is stopped and its heartbeat is stale
for 30 minutes, an administrator can recover it from **Recent imports**. A recovery
claim prevents the old attempt from committing. Planned keys remain journaled for
audit/retry. A completed transfer is never eligible for object cleanup, including
when the database committed but its acknowledgement was interrupted.

If database connectivity is unavailable during failure handling, reconnect before
recovering the stopped attempt. Do not remove volumes, manually delete published
media, or retry by overwriting an existing tournament.

## Deployment and Legacy Compatibility

Rebuild the application and apply the additive
`20261020210000_tournament_transfers` migration through the normal bootstrap/update
workflow. No existing tables are reset or rewritten. Retain database and media
backups before updating. The UI is available in the rebuilt application; copying
source files into a running standalone image is insufficient.

Referenced local artwork is read at runtime from the separately deployed `public/`
directory. These lookups are excluded from build-time file tracing; the verified
standalone route manifests contain no private environment or QA archive paths.

The self-hosted proxy must allow at least 65 MB multipart requests and enough time
for the transfer. Next.js's proxy buffer is configured accordingly. Hosting-provider
body/runtime limits still apply; larger archives should use the self-hosted stack.

The compatible legacy OIDC exporter uses the same format/allowlist and marks the
source `legacy-oidc`. It requires no legacy schema migration and exports from a
read-only snapshot. Only the legacy export endpoint/button/dependencies are added;
no live legacy database migration is performed by this feature.

Implementation: `tournament-archive-format.ts`, `tournament-export*.ts`,
`tournament-import.ts`, `/api/tournament-transfer/{export,import}`, and the
Organizer Workspace transfer controls. See `tests/tournament-archive.test.ts`,
`tests/tournament-transfer.integration.test.ts` and
`tests/e2e/tournament-transfer.spec.ts` for safety and workflow coverage.

## Isolated Legacy Migration Verification

An existing legacy backup was restored into a separate QA database, with source
sessions removed and the exporter restricted to read-only database access. The
compatible exporter left its source audit count unchanged. Its ZIP was imported
into a new unpublished tournament in another isolated database, with no live data
or source records modified.

Verified: 31 matches, 290 chronological actions, 194 map results, 71 match events,
65 result revisions, 27 teams, 54 roster entries, 6 stages, 17 pool revisions,
272 pool slots, 19 CMS revisions and two checksum-verified media files. No parsing
errors or truncated collections occurred. Source role memberships and referee
assignments remained review-only; only the importing QA administrator received
the new Owner membership.

Matches 1, 25 and 27 retained their exact action order, sides, slots, winners,
scores and multiplayer URLs. Production browser checks opened their referee
timelines, history tabs and Discord previews, then refreshed to verify persistence.
Guest access to the unpublished tournament and its imported media returned 404.
This verifies the available dated backup, not a newly captured live database.

Automated tests additionally cover instance-to-instance round trips, qualifiers,
duplicate slugs, authorization, CSRF, hostile ZIPs, failed uploads, cleanup/recovery,
and interrupted commit acknowledgement without deleting committed media. Remote
production S3/OAuth/IRC integrations are not exercised by this migration test.
