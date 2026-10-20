# Contributing

Read the development and architecture guides. Use an isolated test database and
synthetic fixtures. Never add real registrations, player contacts, private artwork,
environment files, snapshots, backups or credentials. Public screenshots must use
synthetic data and assets with documented redistribution rights.

Keep changes focused. Preserve server authorization, tournament isolation,
draft/publication boundaries and persistent match history. Add regression tests
for behavior changes. Run formatting, lint, type checks, unit/database/browser
tests and a production build before proposing a release. Do not rewrite applied
migrations or use reset commands as upgrades.

The generic main branch is the only application source. Installations consume
versioned images and keep private configuration/content outside Git. Releases need
maintainer approval; no deployment-specific application branches are required.

Contributions to the application are made under the [MIT license](LICENSE).
Preserve copyright and third-party notices. Do not include assets or code without
the necessary redistribution rights.
