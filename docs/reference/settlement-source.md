<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# Settlement source edits

`engine/settlement-source.mjs` provides explicit preview and commit operations for
an already reviewed settlement proposal. The `package-build settlement` command
uses `prepareSettlementEdit` for its dry run and `commitSettlementEdit` with
`--write`. `writeSettlementPreview` is API-only. There is no build, indexing or
content-check hook. Naming, map bindings, row validation, population calculations
and promotion to settlement notes belong to the caller.

The writer adds rows to one selected polity. The supplied complete row list must
retain every existing row, with every value unchanged and in the same order, as
its prefix. Additions follow that prefix. An identical proposal makes no source
change. Removing, reordering, or refreshing an existing row is refused with a
source location. This append-only contract does not provide promotion or a full
settlement reconciliation operation.

## Prepare and review

Call `prepareSettlementEdit` with these inputs:

| Input            | Meaning                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `contentRoot`    | Absolute local content directory with no symlink components.                                                                      |
| `contentPackage` | The local content package identity.                                                                                               |
| `polityAddress`  | Fully qualified Address string or Address tuple for an affiliation of subtype `polity`.                                           |
| `records`        | Structured content-index records from the authoring session.                                                                      |
| `sources`        | A map from absolute source paths to `{frontmatter, raw}` captures. `raw` is an original byte buffer or its lossless UTF-8 string. |
| `rows`           | Complete reviewed source-form rows, including the unchanged existing prefix. Values are plain JSON data.                          |

Exactly one indexed local polity and one captured source must have the selected
Address. The writer derives source identity from frontmatter, then checks the
actual source's identity and its byte-for-byte agreement with the capture. A path
locates that explicitly selected source; its spelling, folder, and filename do
not determine polity membership. Moving or renaming a note works with a fresh
index and capture.

The returned frozen handle exposes `polityAddress`, `sourcePath`, `sha256`,
`proposedSha256`, `changed`, and `patch`. Patch `start` and `end` are zero-based
UTF-8 byte offsets into the captured file; both name the insertion position.
`replacement` is the inserted UTF-8 text. Private snapshot buffers remain inside
the module. Mutating caller inputs after preparation does not change the edit.
Cloned or deserialized metadata is not a commit handle.

`writeSettlementPreview(handle, {projectRoot})` creates a unique directory below
`build/settlement-previews/` with:

- `before.md` and `after.md`: exact source bytes for review.
- `change.patch`: a unified diff of the proposed insertion.
- `snapshot.json`: the handle's review metadata, including both SHA-256 hashes.

The project must contain the content root. Preview paths refuse symlink
components. Creating the preview does not change content sources and does not
commit the proposal. Preparation itself writes no files.

## YAML and byte preservation

The editor reads YAML AST ranges and concrete source tokens. It inserts bytes
into the selected `data.settlements` value or adds the missing key and enclosing
`data` mapping. It never serializes existing frontmatter or existing rows. All
original bytes, including comments, quotes, spacing, row order, body text, BOM,
and unrelated fields, remain intact. Added rows use JSON flow mappings, which
are valid YAML, and retain their supplied values. New block lines use the
frontmatter's LF or CRLF convention.

Supported sources have UTF-8 frontmatter, a block root mapping, and consistent
frontmatter line endings. `data` can be absent, a block mapping, or a flow
mapping, including `{}`. `settlements` can be absent, a block sequence, or a flow
sequence, including `[]`. Flow sequences may have a trailing comma. Nested
ordinary mappings, sequences, quoted values, and literal or folded strings in
existing rows remain untouched. The editor parses the proposed result and
compares its entire frontmatter against the expected values before issuing a
handle.

Malformed YAML, duplicate keys, aliases, anchors, explicit tags, merge keys,
complex keys, a flow root mapping, null or scalar `data` or `settlements`, mixed
frontmatter line endings, and ambiguous source ranges receive a located refusal.
No fallback rewrites the document. A refusal leaves the source unchanged.

## Explicit commit and concurrency

Only `commitSettlementEdit(handle)` replaces source. It checks the captured file
and each directory component, refuses symbolic links, requires a regular source
file with exactly one hard link, and checks the source inode, device, permission
bits, and exact bytes. Changing a note's identity or replacing its inode requires
a fresh preparation even when its text is identical.

Cooperating calls acquire an exclusive sibling lock named
`.<source filename>.settlement-write.lock`. An occupied lock is a refusal; the
writer does not remove somebody else's lock. A private, randomly named sibling
temporary file is created exclusively with mode `0600` and no symlink following.
The writer writes and syncs the proposal, applies and syncs the original
permission bits, verifies the temporary file's identity and bytes, and checks the
source again immediately before an atomic same-directory rename. The replacement
retains permission bits; ownership, extended attributes, and ACL preservation are
not part of this API's contract.

Atomic rename provides a complete old or new file to readers. The lock serializes
writers using this API. **The final read and rename are separate filesystem
operations.** An editor or process that ignores the lock can change the file or a
parent directory between them. This API provides stale-source detection at its
checks, not an atomic compare-and-swap against uncooperative writers or hostile
directory mutation. Use it in a trusted local workspace with exclusive source
editing during commit. File synchronization does not promise rename durability
across a power failure; the containing directory is not synchronized.

A precommit failure leaves the source untouched by this writer and triggers
cleanup of owned temporary files and locks. Concurrent edits remain intact when
detected. A changed temporary-file identity is refused and retained for
inspection. Cleanup failures accompany the original error; after a successful
rename they appear in the returned `cleanupErrors` array. Callers must report
those messages. A successful result has `written: true`; an unchanged proposal
has `written: false`. An already committed handle has a stale source identity;
an idempotent rerun uses a fresh source capture and preparation.
