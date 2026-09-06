---
"@heroiclands/package-build": patch
---

Five hand-resolved reads see `<system>.system` too (#126).

Most fields reach their value through `resolveFieldValue`, which reads
`<block>.system.<to>` first and applies the field's coercion wherever the value came
from. Five did not. Each resolves a **shape spread over several keys** rather than
coercing a scalar, so it re-read the note through `sohlField` — which cannot see
inside `sohl.system`:

| read                                                            | what it would have shipped                                     |
| --------------------------------------------------------------- | -------------------------------------------------------------- |
| `resolveCharges`                                                | `{value: null, max: null}`                                     |
| `requireSubType`                                                | a thrown "missing required 'subType'"                          |
| `resolveRelation`                                               | `{}`                                                           |
| `resolveSkillAptitudes` (via `readMapEntries`)                  | `{}`                                                           |
| `impactDie`, behind a projectile's derived `impactBase.numDice` | `0`, while the die it is derived from sat in the same document |

That was equivalent while every note authored in the block, and stops being so the
moment a note authors at the destination instead — which is exactly what #126's
migration does. A new `sohlSystemField` resolves the destination first and falls back
to the legacy position, so both spellings work and the current one wins.

Found by compiling a real corpus before and after the migration and diffing the
emitted packs: without this, 20 documents changed, silently and each in a different
way. With it, all 3,091 are byte-identical.
