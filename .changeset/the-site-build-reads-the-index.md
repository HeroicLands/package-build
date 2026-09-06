---
"@heroiclands/package-build": minor
---

**The site build reads the content index, which completes #243's conversion.**
Every pass that reads this repository's content tree — four checks, the whole
compile, and now the site — runs on one derivation of the corpus.

The site walked the tree **twice**, once for homepages and once for content
pages, and each answered "which files are the content?" for itself. It derives
the corpus once and hands it to both. The note is still read for its
`{fm, body}`: the index carries no note text, and a page _is_ its text.

**The reordering everyone was warned about does not exist.** This module kept
directory order deliberately — "a site's emitted pages should not reorder for no
reason" — and index records are content-path ordered, so converting it looked
like a change to shipped output. It is not, and this was measured rather than
argued: over `sohl`'s tree the emitted mount is **byte-identical, all 1,749
files**, and the build's 82 diagnostics are identical **including their order**.
Emission order never reaches the mount — each page is written to its own file at
an address derived from its frontmatter, and the first-writer-wins fallbacks
that once made order load-bearing went with the bare `[[Name]]` form (#180).

A content-path order is also the better of the two: directory-read order is a
fact about the filesystem rather than about the content, so it can differ
between two checkouts of one tree.

**`collectTreePages` is deliberately not converted.** It walks an auxiliary tree
(`site.trees`, the developer documentation) which is not the content tree and
appears in no record — converting it would be reading the wrong index.

_The two content-tree walks that remain are both right where they are: the
content index's own derivation, and `collectFoundryEntries`, which has had no
production caller since the link manifest was deleted in #271._
