---
"@heroiclands/package-build": major
---

**Retire the bare `[[Alias]]` wikilink form and the alias index** (#180, resolving #179).

Every wikilink is now an **address**, and every wikilink carries a **label**. The
pipe no longer selects between two namespaces — there is only one — so a link
written without one addresses nothing and is a finding wherever it is met:
`content-build links` fails on it, the pack compilers fail the note, and the site
resolver reports it. The correction is always the same, and the message says so:
write `[[type-shortcode|Text]]`. `[[#slug|Text]]` still resolves; the link part
may be an anchor, it is the label that is required.

**Why.** The alias namespace was empty in practice. Across 8,305 wikilinks in the
three content trees, **not one** bare `[[Alias]]` resolved to a note. What the
index behind it did do was fold every note's `name.full` into itself, so two
notes of one type could not share a display name — five `doc` notes in the `sohl`
tree collided, and every available fix moved a published URL (#179). The rule had
never prevented a broken link; it had only ever forbidden a name.

**The top-level `aliases:` is a retired field.** It fed nothing else, so it is
now **refused** naming the file and the line, the same way `draft:` and
`package:` are, and reported by the frontmatter lint as well as at compile.

**`name.aliases` is kept, and is read by nothing.** It fed the same index and
lost the same reader, but it is **reserved** — held for a use that does not
exist yet — so it is deliberately neither retired nor consulted. No index folds
it in, no rule validates it, nothing derives a name, address or URL from it, and
the refusal above never mentions it. A note carrying one compiles, resolves and
addresses exactly as the same note without it, and `tests/name-aliases-reserved.test.ts`
pins that equivalence across the pack compile, both wikilink resolvers, the link
manifest and the site index, so a reader cannot be reintroduced unnoticed.

**Removed.** `engine/alias-index.mjs` in its entirety — `aliasesOf`, `aliasKey`,
`indexAliases`, and the `engine.aliasIndex` namespace export — along with
`resolvesAsAddress` from `engine/wikilink-syntax.mjs`, replaced by
`unlabelledLinkMessage`, which is the one place that states the rule for both
builds.

**API changes** for anything importing the engine directly:

| was                                                    | now                            |
| ------------------------------------------------------ | ------------------------------ |
| `index.resolve(note, target, labelled)`                | `index.resolve(target)`        |
| `index.resolveAlias`, `aliasClaims`, `aliasCollisions` | gone                           |
| `auditLinks().deadAliases` / `.aliasCollisions`        | `auditLinks().unlabelledLinks` |
| `buildWikilinkIndex().byAlias` / `.aliasClaims`        | gone                           |
| `buildSiteIndex().typeAlias` / `.typeCollide`          | gone                           |
| `wikiContext()`'s `typeAlias` / `typeCollide`          | gone                           |

`buildSiteIndex` no longer indexes a page by its **name**, filename or bare slug
— those were the collision-aware fallbacks the bare form was looked up in, and
nothing consults them now. `ambiguous` / `collide` becomes the set of short
`type/shortcode` addresses two **foreign packages** both publish, which the web
resolver now reports as ambiguous rather than as merely broken.

**Consumer impact, measured.** Every tree needs a mechanical frontmatter sweep
of the **top-level** field, which is authored almost everywhere: 1,609 notes in
`sohl`, 1,850 in `thalorna`, 370 in `kethira`. A `name.aliases:` is left exactly
where it is — the sweep must delete the top-level list only. Links are cheaper — `sohl` has **0** unlabelled
links and `kethira` has none at all; `thalorna` carries 70 (68 bare links and 2
pipe-less anchors), which is content work in its own repository. The five `sohl`
alias collisions and `thalorna`'s thirteen cease to exist with no note renamed
and no published URL moved.
