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
