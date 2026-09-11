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
rather than asking for it again — in all three places it is written:

- `systems:`, which declares them without requiring one;
- a **pack's** `system:`, which is the same statement per pack and the only one
  some trees make. It is already authoritative at compile, where a note routed
  to such a pack and carrying no such block fails the build, so a lint blind to
  it would refuse a note for want of a block it never checked;
- `stats.systemId` where neither is written, which has already absorbed every
  remaining spelling: a system package is its own system, and a module takes
  `requiresSystem`, its lone `systems:` entry, or its lone system relationship.

**Each block is held to its own system's vocabulary**, and that has two sources.
A system's `itemBuilders` registry covers its item types — `skill` is one name
over two data models, so a key SoHL's `skill` declares is not thereby a key
HM3's. The note schemas cover the rest, `being` above all, which is an actor type
sitting in no item registry; they are SoHL's, because that is the vocabulary
`content-build` is built with.

A type neither source names is a type that system says nothing about, and its
block is left alone on such a note rather than reported wholesale. A package
naming no system anywhere is system-agnostic on purpose — its packs are core
document types carrying no system data — so it has no system block, and none is
invented for it.

**A block whose vocabulary nothing states is said out loud.** A package
declaring a system other than SoHL and no `itemBuilders` registry for it has
nothing that can say what that block may carry, so the block goes unchecked and
`content-build lint` reports that once, naming the system and the registry to
declare. A check that quietly does nothing is indistinguishable from one that
passed, which is the whole subject here.

For `harn-ensemble` — the tree this issue is about, declaring both systems
through its packs — that means its `sohl:` block is checked exactly as before,
its 2,512 `being` notes included, and its `hm3:` block waits on
`itemBuilders: [hm3, sohl]`, which the lint now asks for by name.

**Nothing changes for a package shipping for SoHL**, which is every consumer
today: one system, one registry, and the derivation is the identity on it.
