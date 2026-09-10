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

**Emitted output should be byte-identical.** A shortcode is an identity, so
renaming one normally moves the note's address, its `_id`, its URL and every
wikilink naming it — but all of those already derive from the lowercased form.
The sweep changes what is _authored_ to match what is _already published_.
References need no edit either: no authored wikilink target carries a capital
(10,538 checked), and `model:` addresses are already lowercase.
