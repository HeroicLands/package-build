---
"@heroiclands/package-build": minor
---

**The content tree publishes as a book**

A third surface beside the compendium packs and the website: one searchable,
bookmarked PDF, built by `content-build pdf` and attached to a release by
`package-build release`.

**A book is a selection, not a rendering of everything.** The packs and the site
publish the whole tree; a book is a declared structure whose leaves pick notes
out of the corpus with a `WHERE` clause, interleaved with prose that need not be
in the tree at all. `pdf.document` names that structure.

```yaml
pdf:
  title: The Hârn Ensemble
  document: book.yaml
  fonts:
    serif: Libertinus Serif
    mono: DejaVu Sans Mono
```

**`publish.site` decides whether one is built, and it is the only switch.**
`content` builds a book; `homepage` does not — the same fence that stops the
tree being walked for pages stops it being walked for a book, so the four
packages that publish only a homepage cannot start emitting a content document
because a `pdf:` block appeared. A package with no block, no tree, or no
compiler builds nothing, says why, and exits 0.

| Property                | How it is got                                                       |
| ----------------------- | ------------------------------------------------------------------- |
| Searchable              | Real text; every embedded font carries a `ToUnicode` map.           |
| Bookmark outline        | Every section and entry is a heading, so the sidebar is the way in. |
| Page-numbered contents  | Shallower than the bookmarks — 2,500 entries would be 40 pages.     |
| Repeating table headers | A property table spilling a page keeps its column names.            |
| Internal references     | A wikilink between two notes of the book resolves inside the PDF.   |
| External references     | A cross-package link, or a note not selected, stays a URL.          |

**Typst is a binary, not a dependency.** It is found on `PATH` or named by
`pdf.binary`. Bundling a native compiler would put a platform-specific artefact
in the dependency tree of three repositories, only one of which is mostly a
book. A missing binary is a finding, and the `.typ` source is written anyway.

Proved against `harn-ensemble`: 2,517 entries, 1,270 pages, 10,421 outline
nodes, 34 seconds, no findings.

Additive — a package that configures no `pdf:` block is unaffected.
