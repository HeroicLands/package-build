---
"@heroiclands/package-build": major
---

**An omitted address segment now defaults from where the link is written** (#336),
instead of being wildcarded or searched for. Three resolvers each carried their
own reading of a partial address and disagreed; there is one rule now, in
`expandAddress` beside `canonicalKey`.

- **package** omitted → the current package.
- **system** omitted → the **system block the link sits under**: anywhere under
  `sohl:` is `sohl`, anywhere under `hm3:` is `hm3`, and anywhere else —
  top-level frontmatter, `data:`, body prose — is `none`. The enclosing block
  decides at any depth; the field has no say.

Every short form therefore expands to exactly one canonical address before
lookup. Resolution is a `Map.get`, with no candidate set and no single-hit rule.

**Under `none`, a system-bearing type addresses its documentation.** A note's
`none` address _is_ its `doc<type>` journal, so a prose `[[affiliation-x|…]]`
names the page — what a prose link almost always means. A prose link that means
the Item states the system: `[[sohl-affiliation-x|…]]`. A `macro` and the map
types are **not** redirected: their own documents are core ones already at
`none`, so `macro-x` still names the Macro.

**Breaking, in three ways a consumer will notice**

|                                     | before                                       | after                                             |
| ----------------------------------- | -------------------------------------------- | ------------------------------------------------- |
| a bare prose link to an item type   | the Item's UUID                              | the documentation journal's                       |
| a bare address naming no local note | fell through to any dependency publishing it | `unresolved`; qualify it to reach another package |
| `[[Skill-Climb\|…]]`                | resolved, case folded                        | `not-lowercase`                                   |

The first rewrites every such link in every pack. The second is the point of the
issue: a link resolved into another package only because no local note claimed
the address, and would have retargeted silently the day one did.

**Two defects go with it.** The index's system-blind `type/shortcode` key is
gone — it was set with a plain `Map.set`, so two notes in one package sharing a
`(type, shortcode)` across systems silently overwrote each other while both
canonical keys sat correctly beside it. And cross-package `ambiguous` is now
unreachable: one expanded address names one package, so a lookup returns one
entry or none. The finding is retained for older vendored manifests.

**An address capitalises nothing but its shortcode.** Package, system and type
are closed vocabularies with one spelling each; a shortcode is case-sensitive and
routinely mixed (`Clb`, `LtShoe`), so it keeps its case. Neither tree carried a
violation — 10,538 authored targets checked. Requiring the shortcode to be
lowercase too is tracked as #340.
