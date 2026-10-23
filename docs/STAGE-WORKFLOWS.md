# Stage Workflows

Open **Stages & mappools > Stage settings** in a selected tournament workspace.
The stage table keeps name, type, Best-of, action sequence and mappool readiness
together. Use Save on an edited row; use Advanced for less frequent settings.

## Repeated Changes

Select stages individually, with a shift range, or using the select-visible
checkbox. Search/type filters clear selection so hidden stages are not included.
The contextual toolbar supports:

- Patch Best-of and/or actions while retaining other rules.
- Inherit tournament defaults by explicitly clearing stage overrides.
- Copy another stage's rules as independent overrides.

Review affected stages and readiness warnings, then Apply. Mixed values remain
unchanged until explicitly patched. Save or discard dirty inline rows before a
bulk edit. Qualifiers and archived stages reject head-to-head rule patches.

## Templates And Duplication

New stage templates choose editable names and types. Gameplay comes from actual
tournament defaults or a selected source stage. Existing source stages also act
as reusable action configurations; there is no separate named-preset table.

Duplicate Stage offers independent choices:

- Copy gameplay rules and qualifier policy, where authorized.
- Copy appearance using the saved stage banner.
- Empty pool: no plan or beatmaps.
- Structure: saved slot names/categories and star targets, without beatmaps.
- Contents: structure plus the latest saved draft, or published revision when no
  draft exists, including frozen metadata and pool notes.

New pools always start unpublished and in draft review state. Source revisions,
suggestions and review history remain untouched. Progression links, dates,
archive state, matches and staff assignments are never duplicated.

## Actions And Validation

The visual editor changes action pairs, their order, acting-team pattern and
starting privileges. Its preview uses the real referee engine, preserving
AB/ABAB/ABBA, separate protect/ban/pick starters, rolls and tiebreaker behavior.
Roll is a preparation step, not an action-pair entry.

Changing Best-of or counts updates related custom pairs without discarding their
relative order. Inconsistent explicit sequences are rejected. Pool checks report
missing maps, tiebreakers, protect/ban capacity and invalid slots. Rules can be
saved before maps exist; incomplete or impossible pools cannot be published.

## Safety

Bulk rules require both `mappools.edit` and `matches.manage`; duplication requires
`mappools.create` with additional draft/rule permissions for those copy options.
The server validates tournament ownership, complete selections and raw
configuration tokens inside the existing mutation transaction. Concurrent edits
reject stale writes. Per-stage audit records preserve before/after rules.

Display reordering preserves stage IDs and match associations. It does not change
bracket progression. Rule edits never rewrite saved rules or pool snapshots of
existing matches. Use the dedicated reconciliation workflow when those records
need an intentional change.

See [organizer workflow audit](ORGANIZER-WORKFLOW-AUDIT.md) for the broader update,
tests, deployment requirements and remaining limitations.
