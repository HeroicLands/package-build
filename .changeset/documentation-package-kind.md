---
"@heroiclands/package-build": minor
---

**A package that publishes documentation**

`packageKind` takes a third value, `documentation`: a package that publishes a
website and the book built from the same notes, and compiles no Foundry
documents at all. `systems` and `modules` say where Foundry installs a package;
`documentation` says it installs nowhere.

```yaml
contentPackage: toolkit
packageKind: documentation

publish:
  site: content
  address: { prefix: guide/ }

site:
  out: site/content
```

`publish` is required, and `site: content` — publishing the tree is the whole of
what the kind does, and `content` is also what builds the book.

**What it refuses, by name and with a locator.** `packs`, `itemBuilders`,
`docs`, `compatibility`, `relationships`, `systems`, `requiresSystem`, `stats`
and `foundryPackage` each describe a Foundry package, so each fails at load
naming the key and the line and column it was written on, rather than being read
and ignored. `packs` is otherwise still required to declare at least one pack.

**What follows from the kind.**

- _No manifest, and no compile._ `package-build manifest` refuses rather than
  writing a `module.json` for a package Foundry never installs. The compile
  passes refuse too, rather than exiting 0 having compiled nothing.
- _No Foundry ids to author._ A note's id is derived from its address, and no
  pass here asks for a pinned one.
- _`doc` and `homepage` are the whole vocabulary._ Every other note type exists
  to become a Foundry document, so a note carrying one has no destination;
  `content-build lint` reports it at its `type:` line.
- _No asset root._ `assetRoot` and `foundryPackage` resolve to nothing, so a
  note's `img:` names the owning package (`systems/…`, `modules/…`) or a URL.
  A path this package would have to serve itself is refused.
- _A content index all the same._ `content-build content-index` emits
  `<contentPackage>-metadata.jsonl` as it does everywhere else, so another
  package can resolve an address into this one.

Systems and modules are unchanged: the asset root, the `_stats` stamp and the
pack requirement all behave exactly as before.
