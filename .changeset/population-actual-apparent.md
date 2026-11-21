---
"@heroiclands/package-build": minor
---

**Content and notes**

- State actual and optional apparent population figures in a map; public outputs use the apparent count and private entries retain the actual count.

**Upgrading**

- Plain population numbers are refused; replace them with maps containing `actual` and optional `apparent`, and use `.apparent` in public queries.
- Unanchored dynamic private pages and private-only SQL-generated pages may receive new IDs, as may their continuations; update GM links. Literal and public-generated anchors retain stable IDs.
- Public anchors with differing generated destinations are refused; use matching targets and the compile corpus's link index instead of raw private generated tables.
