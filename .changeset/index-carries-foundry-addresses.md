---
"@heroiclands/package-build": minor
---

**The content index now carries every address the link manifest does**, which
is the substance of folding the two artifacts into one (#239).

Each record gains a `foundry` block — `{ uuid, anchors }` — and **an item note
now emits two records**: the item, and its documentation journal. The journal is
a document in its own right, with its own canonical address
(`doc<type>/<shortcode>`), its own UUID and its own pages, so it gets its own
record rather than being nested inside the item's. Resolving
`docaffliction/blkdth` is then the same lookup as resolving anything else,
instead of the one address in the index reachable only by knowing to look
somewhere else.

The two are linked in both directions: the item carries `documentation`, the
journal carries `documents`.

**The journal's record is lean, and deliberately not the note's frontmatter.**
The item's `sohl:` block describes the item; copying it onto the journal would
assert things about the journal that are not true, and double the file to do it.
The journal carries its addresses, its name, its anchors and the file it came
from.

**Derived by the manifest's own code, not a second implementation.** A UUID is a
function of the note's `type`, its authored `id` and the pack router —
frontmatter and configuration, nothing from a compiled pack — so the index's
existing walk already had every input. Verified against `sohl`: **2,988 UUIDs
and 1,510 anchor maps, matching the manifest exactly, with none missing on
either side.**

Two smaller changes fall out of it:

- `emitContentIndex` reports `notes` and `records` separately, because an item
  note is one note and two records and reporting one as the other overstates the
  tree. Records sort by path, then canonical address, then id — the address
  before the id, because an item's two records share a file and only one carries
  an id.
- `entriesForNote` takes `docEntryTypes` from its context instead of reading the
  ambient configuration. It is what `manifestContext` already promised — "the
  pass itself is a pure function of its context" — and it was not true: the
  emitter consulted whichever configuration `loadPackConfig()` found, not the one
  it was handed. A fixture that never declared the type it asserted was passing
  on that leak.
