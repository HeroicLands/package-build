# Consumer compile proof

The **Consumer proof** workflow runs on explicit dispatch. Supply the full
package-build commit SHA as `candidate_sha` and dispatch the branch containing
that commit. The job packs that commit for a compatibility compile of the pinned
Kethira consumer, checking the installed package and its compiled outputs. It
fails if installing the candidate changes unrelated locked dependencies. The
workflow requires registry and consumer dependency access; it does not publish a
package or site.

The optional `art_archives` input adds a cold and cached artwork compile in the
same pinned consumer. The CI helper creates three small geometric PNG/SVG
originals with explicit CC0 fixture provenance. A disposable configuration adds
their checksum-pinned archive, and three existing notes use fixture icon
references. Other source bytes and the consumer's builders, dependencies and
pack routing stay intact. The original configuration and note bytes are restored
when the helper finishes.

The archive is served over loopback HTTPS with a temporary trusted certificate;
production URL, checksum and artwork validation apply. The cold build downloads
it into an isolated shared cache outside both checkouts. The cached build runs
with the server stopped and local note, image and compiler outputs cleared.
Dependency inputs remain available. Both use `npm run build:db` and verify the
real documents' image references, JPEG/WebP/SVG files, public metadata, unchanged
originals and extraction cleanup. Limits bound fixture bytes, source capture,
server requests and child-process duration.

The helper prints a receipt and writes
`$RUNNER_TEMP/consumer-proof/art-archive-receipt.json`, recording exact source and
candidate identities, overlay hashes and output assertions. It publishes no
artwork, consumer content or package. This proves fixture interoperability with a
real consumer tree; it does not prove a public artwork release, real collection
eligibility, authored alternatives or cross-package alternative support.

## Actual released artwork

Dispatch `consumer-proof.yml` on the candidate branch with these inputs:

| Input                | Value                                                                   |
| -------------------- | ----------------------------------------------------------------------- |
| `consumer`           | `thalorna-art-release`                                                  |
| `candidate_sha`      | The complete package-build commit SHA on that branch.                   |
| `consumer_sha`       | The complete Thalorna source commit SHA.                                |
| `art_release_tag`    | The published `HeroicLands/art-thalorna` version tag, such as `v1.2.3`. |
| `art_release_sha256` | The reviewed complete release digest, computed as described below.      |

The tag must identify a real published release with the complete ZIP/checksum
set. A single ZIP uses `thalorna-originals-<version>.zip`; multipart releases use
sequential `-part<n>.zip` files, each with its `<name>.zip.sha256` checksum file.
Beside the archives, a release may carry one metadata index named
`<package>-metadata.jsonl`, where `<package>` is lowercase letters and digits, such
as `artthalorna-metadata.jsonl`, together with its `<name>.jsonl.sha256` checksum
file. Those are the only accepted attachments. Every attachment requires GitHub's
native SHA-256 digest and an exact versioned download URL. Each checksum file is at
most 1024 bytes and contains exactly `<sha256>  <name>` and a newline, naming its
ZIP or index by its native digest. The index is at most 64 MiB. The index pair is
never an archive pin. An index without its checksum, a checksum without its index, a
second index, an index whose name does not match the pattern, a ZIP without its
checksum, a ZIP checksum without its ZIP, a ZIP outside the release's sequence, and
any other extra attachment each fail the proof with a diagnostic naming the
attachment. Missing, incomplete or inconsistent attachments also fail the proof.
The helper reads GitHub metadata anonymously; unavailable release metadata
and exhausted API quotas remain failures. No fixture release or checksum fallback
is used.

The digest pins the release ID, tag, publication timestamp and ordered native
archive/checksum coordinates, sizes and hashes, and, when the release carries a
metadata index, the index and checksum coordinates, sizes and hashes. A changed release fails even when
its tag stays the same. Review the anonymous GitHub release JSON and complete
assets JSON array, then compute the input from those saved files:

```sh
node --input-type=module - release.json assets.json <<'NODE'
import fs from 'node:fs';
import { releaseArchives, releaseDigest, releaseIndex } from './ci/consumer-art-release-proof.mjs';
const release = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const assets = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const tag = release.tag_name;
console.log(
  releaseDigest(release, releaseArchives(release, assets, tag), releaseIndex(release, assets, tag)),
);
NODE
```

This command hashes reviewed metadata; it neither acquires artwork nor runs a
build. The dispatch records that expected digest separately from the tag.

The job archives the pinned Thalorna tree into disposable session storage,
installs the exact candidate with the existing dependency lock and installed-byte
guards, and uses only the complete release's `art.archives` pins. A consumer with
no `art` configuration receives a temporary overlay. An existing declaration must
contain exactly those archive URLs and SHA-256 hashes, in release order, with no
additional art settings; otherwise the proof fails. The receipt identifies the
configuration as `declared` or `overlaid`. Notes, artwork identities, licensing
and alternative selections come from the real source and release. The normal
`npm run build:db` runs twice. The cold compile requests every archive exactly
once into an archive cache outside the source tree with no ZIP entries. The
checksum sidecars, the index checksum included, are already verified in that shared
download cache; they cannot seed the ZIP entries. Before the cold compile, the proof
downloads a released metadata index into that cache under its 64 MiB bound and
requires its bytes to match the native size and SHA-256 and the digest its checksum
file states. The build reads no released metadata index. The warm compile keeps
verified download and materialized dependency caches but clears generated outputs,
note caches (`build/cache/note-page`) and image renditions (`build/.cache/art`). A CI-only fetch observer delegates real cold
requests and rejects warm archive requests before network access. Other dependency
requests retain their normal behavior; this is an offline artwork-cache proof,
not a fully disconnected build.

Normal extraction validates the archive, and an independent streaming ZIP read
compares every extracted original's size and hash with its released member.
Each part contains root `README.md` and `CHANGELOG.md`, with originals under
`artwork/`. The proof verifies indexed identity, credits, license, AI status and
declared alternatives; sanitized public derivatives; non-AI Foundry staging;
compiled document references to released artwork; nonempty packs; matching cold
and warm outputs; unchanged source bytes; and extraction cleanup. It refuses a
release without a real compiled reference to its staged artwork. It does not
create notes, choose alternatives or relax production eligibility checks.

The receipt is `$RUNNER_TEMP/consumer-proof/art-release-evidence/receipt.json`,
retained as `art-release-consumer-proof`. It contains the candidate and consumer
commits, package integrity, release and attachment coordinates, native digests,
archive member hashes, configuration overlay hashes, compiled document identities
and output assertions. `consumerGitTreeSha256` hashes the pinned commit's recursive
Git tree listing, including Git object identities. `postInstallWorkingSourceSha256`
hashes the tracked paths and their working byte digests after the guarded candidate
install, before any art overlay. They describe distinct source states, including
the candidate's package and lockfile changes. Original images, private provenance, source prose and
compiled document contents are not uploaded. Only a completed run creates the
success receipt. A source-test pass is not a real-release receipt.

The proof permits up to 32 ZIP/checksum pairs and 8 GiB of archive bytes, with the
production per-archive limits intact. Metadata responses are bounded to 2 MiB;
each compile has a 60-minute limit and all independent ZIP inventories share one
20-minute budget. The proof has a 150-minute total budget within a 180-minute job,
leaving time for candidate installation and checkout. These limits bound resource
use; they do not promise completion for every release size or runner throughput.
The build runner requires Python 3.8 or newer with its standard `zipfile` module;
the workflow checks it before packing the candidate. The job uses the existing
Thalorna build runner and memory profile and retains its memory counters separately. A valid
release, compatible pinned consumer, registry access and normal dependency
availability are required for execution.

## Settlement calibration trial

The settlement calibration trial input is a JSON object with the optional keys
`bindings`, `settings`, `selection` and `bands`. `settings.householdSizes` maps a
fully qualified culture Address to a positive household size that the run uses in
place of that culture note's `data.householdSize`. A culture whose note declares no
size runs from the trial size alone. A size that is not positive, an Address that
is not an indexed culture, or a culture named twice in different letter case is
reported in the receipt's `preflight.missing` as `settings.householdSizes.<address>`.

The receipt's `cultureSizeSources` maps each culture Address in `cultureSizes` to
`trial` when `settings.householdSizes` supplied its size and `note` when the
culture note did.

## Release-proof HTTPS fixture

The **Artwork release proof fixture** workflow runs the complete `proveRelease`
entry point against a local HTTPS server in CI. It installs the candidate into a
small synthetic consumer and runs its normal content-index, asset staging and
pack compilation commands in both phases. OpenSSL creates a short-lived loopback
certificate; `NODE_EXTRA_CA_CERTS` trusts that certificate without disabling TLS
verification. Python 3.8 or newer supplies the independent ZIP inventory.

The fixture covers declared and overlaid pins, a release carrying a metadata
index, index byte corruption, an index checksum with the wrong digest or file name,
checksum and ZIP corruption,
release identity, layout, indexed credits and private fields, alternative
selection, derivative rights and privacy, AI staging, compiled references and
packs, source preservation, cleanup, cache clearing, output parity and refused
warm downloads. Failure cases assert the intended diagnostic and absence of a
success result. Fixtures use `fixture-evidence/fixture-result.json` with an
explicit synthetic scope. They cannot write `art-release-evidence/receipt.json`
and do not satisfy actual published-release acceptance. The real CLI accepts no
source override and always reads the fixed anonymous GitHub repository.
