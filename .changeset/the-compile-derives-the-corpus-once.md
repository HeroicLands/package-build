---
"@heroiclands/package-build": minor
---

**A compile read every note twenty times. Now it reads it twelve** (#243) —
and the whole compile runs on one corpus rather than one per pass.

Measured over `sohl`'s 1,685 notes: **33,700 note reads**, exactly twenty each.
Four per pass — the content-wide link index, the table-search corpus, the `sql`
directive scan, and the pass's own walk — across five passes that convert
wikilinks. Every one of those four is a pure function of the same three things:
the tree, the scope, and the pack router. **None of the three varies between the
passes of a single compile**, because `generatePacksJson` resolves one router
and hands it to all of them. So the passes were computing the same answers over
and over, and — the part that matters — each was free to compute a _different_
one.

They are derived once now, in `buildCompileCorpus`, and every pass is handed the
result. The compile loop enumerates the index rather than walking, then reads
each note for its **prose**: the index deliberately carries no body, and none of
the `bodyLine`/`bodyColumn` a diagnostic needs, so that read stays — it is a
read the pass was already making. What it no longer does is decide for itself
which files to make it over.

| over `sohl`'s tree | before               | after                     |
| ------------------ | -------------------- | ------------------------- |
| note reads         | 33,700 (20 per note) | **20,220 (12 per note)**  |
| compile wall time  | ~10.5s               | **~6.7s**                 |
| emitted documents  | 3,091                | **3,091, byte-identical** |
| diagnostics        | 33                   | **33, identical**         |

**The record accessors move to `engine/index-records.mjs`.** Deriving the index
reaches the pack router and the manifest emitter, and those reach the compilers
— so `engine/helpers.mjs`, which the compilers load, cannot import
`content-index.mjs` without closing a cycle. Nothing about _reading_ a record
needs that machinery: `noteFile`, `authoredFrontmatter`, `isNoteRecord` and
`DERIVED_KEYS` are pure functions over a plain object. `content-index.mjs`
re-exports them, so the split is an implementation detail of the import graph
rather than a second place to look.

`buildContentLinkIndex` and `collectContentDocs` now **require** the corpus
their caller holds, refused by `assertSuppliedCorpus` the way an unstated scope
is refused by `assertStatedScope`. That is not a workaround for the cycle: a
compile runs several passes over one tree, and requiring the answer to be handed
in makes the sharing structural rather than remembered.

**Two ambient-configuration reads go with it**, the same class as every other
one #243 has turned up: `buildContentLinkIndex` derived each note's id through
`resolveNoteId(fm)` with no package, and `collectContentDocs` synthesised each
row's `package` through `searchableFrontmatter(fm)` with none — both falling
back to whichever configuration the working directory answers with, rather than
the one the build resolved.

A note the index cannot record is reported and counted by the compile exactly as
the compile loop reported it when the loop was the first to see it — it is the
same refusal, deferring to the same `assertNoDeclaredPackage`; only which pass
meets the note first has changed.
