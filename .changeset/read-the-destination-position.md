---
"@heroiclands/package-build": minor
---

**The five declarations that re-read the note now see `<system>.system`**
(#126) — the last mechanism gap before the corpus can move.

Most fields take the value `resolveFieldValue` hands them, so they already
resolve at `<system>.system.<to>` first. Five do not. `subType`, `charges`, a
mystery's `skillAptitudes`, an affiliation's `relations` and a projectile's
impact die each validate a **shape spread over several keys**, so their `read`
re-reads the frontmatter — through `sohlField`, which sees `sohl.<key>` and the
note's top level and **never inside `sohl.system`**.

That was equivalent while every note authored in the block. The moment a note
authors at the destination instead, those five read as unset: a missing
`subType` is a thrown build error, and `charges`, `skillAptitudes` and
`relations` ship empty — in silence, which is the failure class the passthrough
exists to prevent.

`sohlSystemField` reads the destination first and falls back to the legacy
position, so both spellings work while the corpus moves. It takes an optional
`legacyKey` for the one pair spelled differently at the two positions — a
projectile authors `impact.die` and stores `impactBase.die` — which is the same
split `FieldSpec.name`/`legacyKey` makes, for the same reason: one name cannot
key two positions.

The retired-alias probe in `resolveRelation` moves with it. It asked
`sohlField` whether `relations` was authored in order to choose between the
current and retired spelling; a note that had moved to `sohl.system.relations`
carried the current name where the probe could not see it, so it fell through to
`relation` and read `{}`.

Nothing else changes: every note authoring in the block reads exactly as before,
which the suite pins alongside the new position.
