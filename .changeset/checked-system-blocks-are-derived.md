---
"@heroiclands/package-build": minor
---

**The frontmatter lint checks the system blocks a package ships for, instead of
a block named `sohl`.**

A system block is a closed region: a key the system's vocabulary does not
declare is an error, because the compiler's builders are an allow-list and drop
it without a word. That held for exactly one block, `sohl:`, and it held whatever
system the package shipped for — the linter takes the blocks its caller names,
and the only caller named none, so every tree fell back to the same constant.

Both directions of that are wrong once a second system exists, and the second is
the costlier:

|                               | before                                                    | now                                  |
| ----------------------------- | --------------------------------------------------------- | ------------------------------------ |
| a package shipping for `sohl` | `sohl:` checked                                           | unchanged                            |
| a package shipping for `hm3`  | `sohl:` checked — a block it does not carry               | `hm3:` checked                       |
| an `hm3:` block               | **never read**, every key discarded at compile in silence | checked against HM3's own vocabulary |
| a tree feeding both           | one of two blocks checked                                 | each block against its own system    |

**Which systems a package ships for is already declared**, so this reads that
rather than asking for it again: `systems:` where there are several,
`stats.systemId` where there is one — and that has already absorbed every way of
spelling it, since a system package is its own system and a module takes
`requiresSystem`, its lone `systems:` entry, or its lone system relationship.

**Each block is held to its own system's vocabulary**, from the registry that
system declares in `itemBuilders`. `skill` is one name over two data models, so
a key SoHL's `skill` declares is not thereby a key HM3's declares. A type a
system's registry does not name is a type that system says nothing about, and
its block is left alone on such a note rather than reported wholesale. A package
naming no system anywhere is system-agnostic on purpose — its packs are core
document types carrying no system data — so it has no system block, and none is
invented for it.

**Nothing changes for a package shipping for SoHL**, which is every consumer
today: one system, one registry, and the derivation is the identity on it.
