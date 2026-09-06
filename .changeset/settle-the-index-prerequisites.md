---
"@heroiclands/package-build": patch
---

**#243's two open questions, settled** — one by measurement, one by finding it
had already been answered.

**1. The index does not record frontmatter-key positions, and should not.** The
question was whether a pass reading the index could report a field defect
without opening the note. The numbers are not close: over `sohl`'s 1,685 notes
the index is **3.0 MB** and holds **50,598 leaf values**, so a `{line, column}`
on each would add roughly **1.6 MB — a 54% larger artifact** — for data read
only on the _failing_ path.

The rule that replaces it is the one the module was already built on: _the index
carries what is **about** a note; the file carries the note's text and every
position within it._ A pass needing either opens the file the record already
names, which costs nothing it was not already paying — a check reads each note
once for its body, and a compiler must read the prose regardless, so while it
holds the bytes a position is free. An anchor's `line` is the exception that
proves it: an anchor is structure a consumer addresses, not a locator for a
diagnostic.

`noteFile(contentBase, record)` is the one composition of a record's absolute
path. There were **four** copies of it — one in each reader converted by #290,
#292, #294 and #296 — which is the duplication #243 exists to remove, arriving
by the back door. The index records the path relatively on purpose (an absolute
one is a fact about the build machine, and would put a home directory in a
published artifact), so composing it is a real step and belongs in one place.

**2. "Not everything is a note" no longer holds.** The issue lists folder
documents (`item-folders.yaml`) and the adventures that bundle scenes as
configuration appearing in no record. Both became notes after it was written —
folders in #260/#276, bundles in #263/#286 — and both are indexed today, a
folder with its address and id, a bundle with the `Adventure` UUID it compiles
into.

What a folder record does not carry is a Foundry address, and that is the right
answer rather than a gap: a folder materialises in **every** pack holding a
document that references it, so no one UUID identifies it, and emitting one
would publish an `Item` UUID for a `Folder` at an id no document carries. A
homepage carries none for the opposite reason — it compiles into no document at
all. Both are now pinned at the **record**, which is the level a pass driven by
the index reads, with a bundle as the positive control.

_No behaviour change: `lint`, `links`, `content-format notes` and both address
maps are identical over `sohl`'s tree._
