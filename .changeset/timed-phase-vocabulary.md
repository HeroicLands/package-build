---
"@heroiclands/package-build": minor
---

**Afflictions and traumas can declare their timed phases** (#329).

SoHL stores each timed phase as `{…DurationFormula, …DurationBase, …Date}`, and
the two authored thirds were declared by nothing. They were reachable only
through the raw `system:` passthrough — undocumented, uncoerced, and absent from
the field list every author-facing surface is built from — so no note in any
tree wrote one. Every shipped affliction carried `null`, and
`AfflictionLogic.rollDuration()` opens `if (!formula) return 0`: the timed-phase
machinery existed, and the content that would drive it could not be written.

They could not simply be declared either. `buildFromFields` wrote every declared
field unconditionally, so a declaration would have stamped `null` onto every
document — the same outcome, minus the ability to tell "unset" from "authored as
empty".

**`omitWhenAbsent`** is the missing capability: a field declaring it is emitted
when the note carries one and has its **key left out entirely** when it does
not, so the DataModel's own `initial` stands. It completes the table
`runtimeOnly` (#330) opened:

| declaration      | authored    | absent          |
| ---------------- | ----------- | --------------- |
| ordinary         | emitted     | default written |
| `omitWhenAbsent` | emitted     | key omitted     |
| `runtimeOnly`    | **refused** | key omitted     |

The decision is made on the **position** a value came from, never on the value:
a declared `default: null` and an authored `null` are the same value and
opposite facts. `readFieldEntry` reports the source beside the value so the
position is resolved once rather than twice.

**Twelve fields are now declared vocabulary** — `onset`, `healingCheck` and
`resolution` on `affliction`; `healingCheck`, `bloodLossAdvance` and `course` on
`trauma` — each as both a `…DurationFormula` and a `…DurationBase`, in the
`sohl:` block and in the closed `data:` container alike. Intervals are in
seconds, and a bare number is a valid formula.

**What a consumer sees**

- The twelve appear in the generated item-frontmatter reference, with `_omitted_`
  in the Default column rather than a value. Regenerate the page.
- The `unemitted` warnings these raised against a pinned schema clear.
- No compiled document changes: no tree authors one yet, and a note that writes
  nothing emits nothing where it previously emitted nothing.
- `omitWhenAbsent` may not be combined with `default` (contradictory), with
  `required`, or with `runtimeOnly`; the shipped declarations are checked for all
  three.
