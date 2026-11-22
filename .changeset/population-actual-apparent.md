---
"@heroiclands/package-build": minor
---

**Content and notes**

- Public outputs use apparent population figures; private entries retain actual counts.

**Upgrading**

- Use `{actual: value}` maps for `population`, `territorial_population`, and settlement-row counts; use `{actual: null}` for unknown values, and `.apparent` in public queries.
- Omitted `apparent` uses `actual`; Foundry builds with differing figures require compiled, system-neutral private JournalEntry packs (eligible private default, otherwise sole eligible pack); site/index builds don't.
- In a source checkout with dependencies installed, run `node scripts/convert-population-actual.mjs --preview /path/to/content`, then use `--write` to convert declarations; use `--help` for details.
- Unanchored dynamic private pages, private-only SQL-generated pages and their continuations may receive new IDs; update GM links, while literal and public-generated anchors retain stable IDs.
- Public anchors with differing generated destinations are refused; use matching targets and the compile corpus's link index instead of raw private generated tables.
