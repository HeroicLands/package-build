---
"@heroiclands/package-build": minor
---

**Content and notes**

- State actual and optional apparent population figures in a map; public outputs use the apparent count and private entries retain the actual count.

**Upgrading**

- Plain population numbers are refused; replace them with maps containing `actual` and optional `apparent`, and use `.apparent` in public queries.
- Private pages with unanchored dynamic headings or captions receive new IDs; update GM links to those pages after upgrading.
