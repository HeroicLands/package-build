---
"@heroiclands/package-build": minor
---

**Definition lists**

- Every package now ships a definition-list style, so a term and its definition
  line up in two columns with the terms sharing one right edge.
- A narrow journal window stacks each term above its own definition instead of
  cramping both into columns, and widening the window restores them.
- A term is bold wherever it appears, so writing one needs no `**` around it.
- Infobox rows in the book sit against the same right edge, with space between
  rows rather than run together.

**Packages**

- `packageBuild.baseStyles: false` declines the shared style for a package that
  wants the surface entirely to itself.
