---
"@heroiclands/package-build": patch
---

**Link findings**

- A pack build reporting an unlabelled link that names a section quotes the section too, as the site and the book do.
- A book link to one of its own note's events is reported as naming an event, as the website reports it.

**Engine API**

- `resolveWebWikilinks` and `frontmatterWikilinks` are exported from `engine.wikilinks`; the `engine.webWikilinks` namespace is gone.
