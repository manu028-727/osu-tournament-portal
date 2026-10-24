# Project Intent

## Why This Exists

osu! tournaments commonly spread their website, rules, mappools, rosters, schedule,
referee records and results across spreadsheets, forum posts and chat. Organizers
repeat edits, referees reconstruct context during matches, and moving to another
host can lose either the public identity or the underlying history.

osu! Tournament Portal brings that work into one self-hosted application. It gives
organizers a browser-operated tournament website and real competition tools backed
by persistent, inspectable data. Spreadsheet interoperability supports migration;
it is not a requirement to keep a second spreadsheet as the live system of record.

## Who It Serves

- Organizers who need to publish and maintain tournaments without editing source.
- Poolers and playtesters who need a shared selection and review workflow.
- Referees who need reliable match operations, context and recoverable histories.
- Players and spectators who need clear public pools, rules, schedules and results.
- Self-hosters who need understandable installation, updates, backups and portability.

## Product Principles

- **Generic, not tournament-specific.** One platform can host independent events;
  no installation depends on OIDC, Nigachi, private artwork or historical fixtures.
- **Browser ownership.** Tournament identity and routine operations belong in the
  CMS, not a deployment branch or an organizer's source-code patches.
- **Language choice.** English and Italian interfaces serve organizers and viewers
  independently of the language authors choose for their tournament content.
- **Trustworthy history.** Drafts, publications, played matches and corrections
  have distinct lifecycles. Convenience must not silently rewrite competition data.
- **Efficient real work.** Compact lists, bulk edits, visible save states and direct
  navigation matter more than decorative dashboards or spreadsheet-shaped screens.
- **Least privilege.** Public credits and administrative authority are separate;
  tournament access is scoped and every sensitive operation is checked server-side.
- **Operator control.** Configuration and media stay private; archives and backups
  make tournaments portable without exporting authentication or server authority.
- **Honest integration.** A copied or sent command is not proof of execution, and
  an unavailable source must never become an invented score or successful import.
- **Maintainable public software.** MIT-licensed source, reproducible dependency
  installation and focused architecture should make extensions affordable.

## Scope Discipline

This is a usable management platform, not a marketing mockup, a Google Sheets
iframe, a replacement osu! client or an autonomous referee bot. It should support
tournament workflows without becoming a general-purpose social network or an
unbounded competition graph editor. Preserve interoperability without distributing
private workbooks or copying incompatible upstream code.

Functional commitments belong in [SPEC.md](SPEC.md), delivery status in
[PLAN.md](PLAN.md), implementation and operations in
[ARCHITECTURE.md](ARCHITECTURE.md), and visual decisions in [DESIGN.md](DESIGN.md).
