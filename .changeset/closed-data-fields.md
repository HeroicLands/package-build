---
"@heroiclands/package-build": minor
---

**Notes**

- A `data:` field now refuses keys it does not declare, however deep they are nested. The error points at the misspelled key and suggests the nearest real one.
- Lint now catches a fraction in a month's length, a season or named day, an era's start or a rank, and an affiliation relation other than `aligned`, `unaligned`, `rival` or `nemesis`, each at the value.
- `harnworld` takes only `realm` and `ritual`.
- A being's `social` block is gone. Record a being's occupation as `data.occupation`; the block's other keys have no replacement.

**Infobox**

- A field whose value holds named keys shows each key as its row's label, units exactly as written, and nothing for an empty key. HârnWorld details, compendium routing and calendar definitions stay out of it.
- Each of a being's affiliations is its own line under an _Affiliations_ heading, such as _War Chief, Hárár (5), of Vrystwald Tribes_.
