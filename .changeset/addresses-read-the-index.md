---
"@heroiclands/package-build": minor
---

**`lint:addresses` reads the content index too** (#243) — the second reader
converted, and the last of the two lints the issue names.

`addresses diff` reads the tree twice: once for the renames notes declare, once
to place its findings against the note that made them. Those were two
independent walks, each parsing every note, each answering "which files are the
corpus?" for itself. They are now **one** derivation — `indexRecordsFor`,
enumerated once by the command and handed to both — so the two halves of a
single command cannot disagree about the corpus, or about the ids in it.

**A latent defect goes with it, and the id is the reason it mattered.**
`noteFilesById` joins tree-side ids against ids read out of the _compiled
packs_. Since #270 an id is derived from the canonical address, whose first
segment is the content package — and the tree side derived it through
`resolveNoteId(fm)` with no package, which falls back to `contentPackage()` and
so to whichever configuration the working directory answers with. The compiled
side is produced by a compiler running on the configuration the _build_
resolved. Let those differ — under `PACKAGE_BUILD_CONFIG`, in a worktree, in a
test — and **every id fails to join**: every rename degrades to a withdrawal, and
every finding loses the note it should have been reported against. The
configuration is now passed in and both sides derive from the one that was
resolved.

**It is also faster, which is the shape of the win.** Two whole-tree walks
became one derivation: over `sohl`'s 1,685 notes the pair of reads goes from
about 2.8s to about 1.4s. Both maps are byte-identical to what the walks
produced — 1,685 ids, and the declared predecessors of five renames spanning
five item types, including the `projectilegear`/`missilegear` pair that a
declaration keys under both maps.

The scope requirement moves to a shared `assertStatedScope`, so a reader of the
content index refuses an unstated scope in the same words `walkMarkdownTree`
does. A pass reading the index makes the identical claim about which files it is
looking at and must be held to the identical rule; a quiet default there would
reintroduce the second answer #243 removed.

`declaredPredecessors` and `noteFilesById` take `config` and already-derived
`records`. Where the walk yielded nothing for a tree that is not there, so do
they.
