---
"@heroiclands/package-build": minor
---

**The markdown note vocabulary drops the `gear` suffix** — `armorgear` → `armor`,
`concoctiongear` → `concoction`, `projectilegear` → `projectile` (#78).

Those three named the **SoHL document subtype** a note happened to compile into rather
than the thing the note is about. A note's `type` sits outside the `sohl:` and `hm3:`
blocks precisely because it belongs to no system, and HM3 already compiles a projectile
into a `missilegear` — so the suffix was never a fact about the note. `weapongear` keeps
its name: both systems call that document a `weapongear`, so it says nothing
system-specific. `armorlocation`, which maps to an HM3 Item and to nothing in SoHL at
all, is a first-class note type: the vocabulary is system-agnostic, not a list of what
SoHL happens to define.

**Nothing in a compiled pack moves.** The emitted document subtypes are unchanged — an
`armor` note still compiles into an `armorgear` Item — so no world, no compendium and no
`_id` is affected. Verified by recompiling `Song-of-Heroic-Lands-FoundryVTT` (331
`armorgear` and 18 `projectilegear` notes) and `sohl-thalorna` (71 `concoctiongear`) with
the released toolchain and with this one, and diffing every emitted document: 3,091 and
2,605 files respectively, byte-identical, with the content trees untouched.

**Both spellings are read, and the retired one is reported — not refused.** This is the
first of the three steps `package:` took, and the rule `RETIRED_FIELD_ALIASES` already
states for a renamed _field_: a note carrying the old spelling compiles into exactly the
document it always did, so failing a build over it would red a tree that has done nothing
wrong. There are some 31,000 references to move, overwhelmingly `(type, shortcode)`
entries inside a being's `items:` list, and a consumer must be able to adopt the new
toolchain before its content does. `content-build lint` reports each one as a **warning**
naming the file, the line and what to write instead; the sweep and the refusal come after.

**Both sides of a reference resolve.** A being's embedded `(type, shortcode)` reference
carries the note vocabulary too, and those outnumber notes' own `type:` keys by roughly a
thousand to one — so `referencedSubtype` normalises alongside the note's own type. A
window that resolved notes but not references would have dropped 30,000 embedded items in
silence.

**Two lookups where the vocabularies now genuinely differ**, and both are translated
rather than joined by name:

| lookup                      | keyed by         | what changed                                                                                                                                                          |
| --------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sohl/default-item-art.mjs` | document subtype | `SohlItem.getDefaultArtwork` reads it with a Foundry `Item`'s own `type`, so the map stays on the document side and `sohl/item-builders.mjs` translates before asking |
| the published-schema check  | document subtype | `compareFields` gets the `subtypeOf` seam it was given for exactly this, so `armorgear`'s findings still fire                                                         |

**Planning a sweep? Two things to move with the frontmatter.** A note's canonical address
— and therefore its document `_id` — carries its `type` as authored, so renaming a note's
type moves the address it publishes at. Every wikilink into it and every content-table
query naming the type (`WHERE type = "armorgear"`) has to move in the same change, and a
package that _links into_ another has to move with it.
