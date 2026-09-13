---
"@heroiclands/package-build": patch
---

**`docs/configuration.md` now matches `packageKind: documentation`**

The configuration reference names all three `packageKind` values —
`systems`, `modules` and `documentation` — in the summary table and in the
`packageKind` section itself, and states which keys a `documentation`
package requires, which it refuses (quoting each located refusal message
verbatim), and how `foundryPackage`, `assetRoot` and `stats` resolve for it.
