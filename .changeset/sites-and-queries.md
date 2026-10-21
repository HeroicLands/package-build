---
"@heroiclands/package-build": patch
---

**Sites**

- The sitemap and site search list only the pages a reader can reach from the homepage, so a page can be published and read at its address before anything links it.
- Related links, previous and next, and the other generated link sections point only to pages a reader can reach.
- `site build` finishes writing the search index before it reports success.

**Queries**

- A query on a note's `data` reads the same however other notes are shaped; adding a field to one note no longer breaks unrelated queries.
