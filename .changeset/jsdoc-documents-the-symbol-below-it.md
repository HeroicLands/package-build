---
"@heroiclands/package-build": patch
---

**The published types match the code they are generated from**

The `.d.mts` files ship with `@heroiclands/package-build` and are generated
from the JSDoc, so a block that is not the one belonging to a symbol ships as
that symbol's type. `packRelease` now declares the `pdf` option it accepts and
the `pdf`, `pdfFindings` and `pdfSkipped` fields it returns; `buildSite` and
`expandNoteTables` declare `sqlTables`; a compiler's `resolveEmbedded`
declares `modelPackage`; and `expandContentTables` declares the `warnings` it
returns and the `column` on every error entry. Type-checking the whole
published declaration surface is clean.

**Every exported symbol carries documentation of its own**

`NOTE_VOCABULARY`, `DECLARED_TAGS`, `buildIndexRecord`, `collectContentIndex`,
`expandContentTables`, `walkMarkdownTree`, `declaredPredecessors` and the seven
pack compiler classes each describe what they take and what they return, so
hovering one in an editor answers the question asked of it.
