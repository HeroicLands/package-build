---
"@heroiclands/package-build": major
---

**A document's id is derived from its identity, not authored and not keyed on a
list position.** Three ids changed how they are computed (#270, #268), and every
compiled id this toolchain emits is affected.

**1. A note's document `_id` derives from its canonical address (#270).**

```
_id = makeId("document", "<package>-<system>-<type>-<shortcode>")
```

`id:` becomes **optional**. A note used to author one — an opaque 16-character
string, 6,343 of them across the four content trees — that said nothing its
address did not, could not be read or reviewed, and was guaranteed by nothing:
`content-lint` refuses a duplicate **address** across every pack of a document
type, which is exactly the scope a primary document's id must be unique within,
and it said nothing at all about a duplicate `id`. The derived id inherits a
guard that already exists. It is the same principle that turned
`folder: ONXsqZAIZr2qzxTb` into `packFolder: <path>` (#251, #252).

**An authored `id` always wins, and pinning one is how a document keeps its
identity across a shortcode rename.** That is the pattern the map compiler
already used (`regionDocId(sceneId, key, pinned)`), now applied to primary
documents too.

**2. An actor's embedded item is keyed on its identity, not its index (#268).**

```
_id = makeId(<actor id>, "<subType>:<system.shortcode>")
```

An entry's identity is its **own `system.shortcode`**. The entry's top-level
`shortcode` is a _selector_ naming the template it is written from, is never
written to the document, and may repeat. **Two entries resolving to one identity
are now a build error naming both** — the case a position key used to hide by
compiling them to two documents denoting one entity.

**3. An unanchored journal page is keyed on its heading, not its index (#268).**

```
_id = makeId("journal-page", "<entry id>:<name>")
```

Two sibling pages sharing a heading is likewise a build error, matching the
`MD024` lint rule that already refuses it. An anchored page is unchanged — it
never took an index, and is the shape the other two now share.

**Why position was wrong.** A Foundry id is how a world refers to a document it
imported. Keying on position meant reordering a being's item list, or inserting
a heading into a note, silently renumbered every id after the change — so a
re-import created new documents beside the old ones. Nothing about those
documents had changed; only their neighbours had.

**What this costs, measured against a real corpus** (`sohl`, 1,606 notes →
3,094 documents):

| id                        | count | moved |
| ------------------------- | ----- | ----- |
| primary documents         | 3,094 | **0** |
| embedded items            | 1,337 | 1,337 |
| journal pages, anchored   | 296   | 0     |
| journal pages, unanchored | 1,648 | 1,648 |

No primary id moved **because every note in that tree still authors one**, and a
pin wins. #270 is inert until a tree drops its authored ids; #268 lands at once.
Stripping all 1,605 authored ids compiles with no new errors, derives every id
exactly as the formula above states, and leaves all 5,712 internal `@UUID`
references as consistent as before.

**Consumers must act.**

- **Every embedded item id and every unanchored page id changes once.** A world
  that imported these documents will see new ones on re-import.
- **Removing a tree's authored `id:`s changes every compendium UUID that package
  publishes**, once. Internal references are regenerated in the same build and
  stay consistent with each other; anything outside — a GM's world, a macro, a
  module — will not. Do it deliberately, and per tree.
- **Fix any duplicate embedded identity first.** Measured across the four
  corpora: 20 entries in 17 notes, every one a defect. `sohl` has 1
  (`Characters/Aldrik_Harvenar.md` carries `skill/swim` twice);
  `sohl-thalorna` has 19; `harn-ensemble` and `sohl-kethira-basic` have none.

**One diagnostic narrows.** `content-build addresses` tells a **rename** from a
**withdrawal** by matching document ids across releases. That rested on the id
being independent of the shortcode; it no longer is, so for a note that pins no
`id` both sides move together and a rename is reported as a withdrawal with no
successor named. It never reports a _wrong_ successor, and stays exact for a
pinned note.

**Also:** `assertUniqueAnchors` is renamed `assertUniquePages` (the old name
remains as a deprecated alias) and now checks page names as well as anchors;
`journalPageId(entryId, page)` no longer takes an index.
