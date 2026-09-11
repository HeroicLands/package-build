---
"@heroiclands/package-build": patch
---

**A folder note's published `id` is now the id its Foundry documents carry**
(#310).

The content index derived every note's id under the `document` namespace. A
`Folder` is hashed under the `folder` namespace, so the index published one
value and the packs addressed another — `sohl-none-folder-cookware` was
`f5d3dc635b7e799c` in the index and `b92b28b7d06638ed` in every pack.

`noteDocId` now asks the folder pass for a folder's id instead of deriving a
second one, so the two cannot disagree.

**Why nothing caught it.** Every one of `sohl`'s 79 folder notes pins an `id`,
and a pin wins in both paths — so all 65 emitted folder documents agreed by
coincidence. It is also invisible from inside a build: no pass reads a folder's
id off the index. The published artifact was the only place the wrong value
surfaced, and a reader outside the build could neither recompute the right one
nor notice the wrong one.

**The general rule this settles:** for every entry the content index gives an
identity to, it publishes both the `id` and the `uuid`, each computed once by
whatever owns that entry's derivation. A documentation journal's record
accordingly gains its own `id` — it carried the UUID that id ends in, but not
the id — so a consumer reads it rather than parsing it back out of the UUID's
last segment.

_No emitted document changes; this corrects what the index says about them._
