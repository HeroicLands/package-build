---
"@heroiclands/package-build": major
---

**A shortcode must now match `^[a-z0-9]+$`** — lowercase letters and digits only
(#340). So must every other address segment; the charset is one rule with no
exceptions left in it.

`Dgr` beside `dgr` is a distinction nobody can say out loud and can only see by
looking twice. It was also a silent identity collapse: `canonicalKey` lowercases
the address it builds, so a note declaring `Clb` published
`sohl-sohl-weapongear-clb` and derived its `_id` from that — and two notes
differing only in case shared one address, one `_id` and one URL with nothing to
report it, because the shortcode check compared shortcodes (genuinely distinct)
and the address check saw one address.

It forced two exceptions elsewhere, and both go: #336 had to exempt the shortcode
from the lowercase rule it pinned on every other segment, and #346 had to fold
the shortcode's case in the item catalogue because an address is lowercased when
it is read.

**A consumer with a capital in a shortcode will fail to build**, citing the
note's file, line and column. The sweep is mechanical: every violation in every
tree is a capital letter — no underscores, hyphens or other characters occur —
and **nothing collides when folded**, checked per `(type, shortcode)` in every
tree.

| tree                              |  shortcodes to change |
| --------------------------------- | --------------------: |
| `Song-of-Heroic-Lands-FoundryVTT` |                   438 |
| `sohl-thalorna`                   |                    96 |
| every other tree                  | 0 — already compliant |

**No document changes identity and no URL moves**, because an address and a
document `_id` already derive from the lowercased form. References need no edit
either: no authored wikilink target carries a capital (10,538 checked), and
`model:` addresses are already lowercase.

**The emitted packs do change, in three narrow ways**, measured on `sohl`'s 438:

| change                                                | count |
| ----------------------------------------------------- | ----: |
| `system.shortcode` on an Item document, `Clb` → `clb` |   438 |
| embedded item `_id` / `_key` on one being             |     6 |
| journal pages showing a shortcode in a content table  |     5 |
| **top-level document `_id`**                          | **0** |
| **addresses and published URLs**                      | **0** |

The first is the point: the emitted field now matches the address built from it.
The six embedded ids move because an embedded id derives from the item's own
`system.shortcode`, which #346 deliberately does **not** case-fold — folding
there would re-identify documents rather than look them up.
