# Organizer Workflow Update

This update uses the OIDC referee and mappool workbooks as workflow references only. Their tournament names, participants, and rules are not defaults in the application.

## Workbook patterns reviewed

- The referee workbook keeps stage rules in `Round Setup` and schedule, stage, bracket, staff, score, and multiplayer-link data together in `Schedule`/`Chrono Schedule`.
- The mappool workbook separates stage targets and mod counts from suggestions, playtesting, and published pools. Suggestions carry metadata and staff notes; playtesting records reviewer feedback before selection.
- Those patterns informed inline stage editing, reusable pool structure, compact match bulk actions, and stable match numbers. The workbook data itself is not imported or changed by this work.

## Implemented in this update

- Stage overview rows expose stage name/type, Best-of, and action sequence without opening the advanced editor. Qualifier rows show qualifier policy instead of match-only settings.
- Stages can be duplicated with their rules/settings and an empty mappool. Existing match rule snapshots are preserved.
- Mappool rows support selection, range selection, copying selected IDs, bulk category changes, and bulk removal. Organizers can copy pool structure separately from beatmap contents, or build a local slot plan; empty slots must be filled before saving because persisted pool slots require beatmap records.
- Match lists support selecting visible scheduled matches and bulk referee assignment or schedule changes, with version checks, conflict validation, and transactional updates.
- Matches have stable tournament-visible numeric identifiers. New bracket nodes reserve numbers by round position and top-to-bottom slot order; existing numeric codes are retained when unambiguous, and existing records are not renumbered. Internal match codes remain available for historical references.

## Still outstanding

- Persistent beatmap suggestions, configurable skillsets, reviewer assignments, playtest feedback, artist warnings, and suggestion-to-slot selection are not implemented by this update.
- Empty pool slots/target distributions are currently editor-local until beatmaps are assigned; persistent targets and stage difficulty progression need a data-model/API workflow.
- Stage templates/inheritance, multi-select bulk stage rule changes, bulk bracket-slot/round edits, and broad qualifier/session bulk scheduling are not yet available.
- Match bulk editing currently covers scheduled-time changes and referee assignments, not every optional schedule field or arbitrary participant/stage patch.
- Full interactive browser verification remains outstanding where Chromium host libraries are unavailable.

## Verification

See the change report for the exact typecheck, unit, integration, build, and browser-test outcomes. The test database must remain isolated from any tournament installation.
