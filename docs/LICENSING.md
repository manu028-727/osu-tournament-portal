# License and Attribution Review

No final application license has been applied. The package remains private and
UNLICENSED pending the owner's explicit approval. Public availability alone would
not grant reuse permission. Do not publish a license or release until that decision.

Recommendation: MIT for a permissive reusable platform, subject to confirming
ownership/contributor permission and the dependency notices. AGPL-3.0 is an
alternative if hosted modifications should be shared; that is a policy decision,
not an automatic cleanup step.

The release tree excludes original tournament graphics, imported spreadsheets,
rosters, historical match datasets, production screenshots and instance media.
The small WebP fixture is generated from a solid color for tests, not copied art.
There are no bundled web fonts; typography uses system fonts. Icons are provided
by Lucide. Factual country names/codes support flag formatting; no player records
are included. Spreadsheet-compatible algorithms/output are native interoperability
code; no original workbook or Apps Script is distributed.

Dependency licenses are recorded in `docs/dependency-licenses.json`. Review the
full notices of runtime/distributed transitive dependencies before release; a
package metadata inventory alone is not legal clearance. Major components use
MIT/Apache/BSD/ISC-style licenses. Sharp's native libvips distribution also includes
LGPL-licensed components and accompanying notices; retain upstream licenses and
assess native-binary redistribution obligations for container releases.

Collected upstream license/notice texts are retained in
`docs/THIRD-PARTY-NOTICES.txt` and `/app/THIRD_PARTY_NOTICES.txt` in web/IRC images,
including available native libvips notices. This does not license the application.

One package omits its license field: middleware-handler includes an MIT LICENSE
file, verified locally. The old workbook unzip dependency pulled in buffers 0.1.1,
which shipped no license notice. A scoped override to MIT-licensed unzipper 0.12.5
removes that package and its obsolete chain; synthetic workbook and import tests
verify compatibility. Do not remove the override without repeating that review.

RustFS is a separate pinned service under
[Apache-2.0](https://github.com/rustfs/rustfs), not vendored application source.
PostgreSQL and Node/container OS packages have their own terms. npm license
metadata is not a complete OS/native container software bill of materials.
Run an image scanner/SBOM review before publishing container artifacts.
The Distroless runtime is distributed by GoogleContainerTools under its upstream
[license and package terms](https://github.com/GoogleContainerTools/distroless).
Preserve image notices as well as the collected application dependency notices.

Unresolved approvals: application license, contributor/provenance confirmation,
public repository creation and release/image publication. No rights to any
installation's privately mounted assets are granted by the platform.
