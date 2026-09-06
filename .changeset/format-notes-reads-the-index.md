---
"@heroiclands/package-build": patch
---

**`content-format notes` reads the content index, and with it every check
does** (#243).

It was the last one measuring the tree for itself, and it is the check whose
whole output is a _count_ — 3,812 findings across `sohl`'s 1,685 notes. A report
that measures the corpus against the declared vocabulary has to be looking at
the corpus the compile will build, or its counts describe a tree nobody ships.

It measures what the author wrote, recovered with `authoredFrontmatter`: this
compares a note's fields against a declared vocabulary, and `address:` is in no
vocabulary. It also joins the shared contract the other checks now have — a note
the index cannot record is reported with its position and the rest of the tree
is still measured.

`bin/content-build.mjs` no longer walks a content tree at all.

_Findings are unchanged: 3,812 across 1,685 notes, identical._
