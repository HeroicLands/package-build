---
"@heroiclands/package-build": minor
---

**Content and notes**

- State actual and optional apparent population figures in a map; public outputs use the apparent count and private entries retain the actual count.

**Upgrading**

- Plain population numbers are refused; replace them with maps containing `actual` and optional `apparent`, and use `.apparent` in public queries.
- Unanchored dynamic private pages and SQL-generated private pages without literal IDs receive new IDs, as do their continuation pages; update GM links. A literal `{#id}` fixes a page’s identity.
