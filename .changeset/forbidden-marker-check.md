---
"@heroiclands/package-build": patch
---

**The license header is on every shipped module, and CI refuses a `TODO`.**

`engine/foreign-catalog.mjs` and `engine/schema-extract.mjs` shipped without the
GPL-3.0 header every other module carries — 109 of 111 had one, which is the
state a rule reaches when nothing checks it.

The forbidden-marker check now runs here too, through the org-wide
`HeroicLands/.github/actions/todos` action the other repositories already call.
It scans the whole checkout rather than a named list of directories: this
package's modules sit at its root as well as under `bin/`, `ci/`, `engine/`,
`hm3/` and `sohl/`, so a list would name sixteen root files today and quietly
stop covering the seventeenth.

Nothing a consumer imports changes.
