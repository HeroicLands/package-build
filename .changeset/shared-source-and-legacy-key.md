---
"@heroiclands/package-build": minor
---

**A field's shared source and its legacy in-block key are two declarations**
(#305) — so a field can move into `data:` without a flag day.

`FieldSpec.name` carried both jobs, and they came apart the moment `data:`
(#128) put every type-specific fact under a container. `resolveFieldValue` reads
four positions, and steps 2 and 3 were **both keyed on `name`**:

| step | position                    |
| ---- | --------------------------- |
| 1    | `<block>.system.<to>`       |
| 2    | `<block>.<name>` — in-block |
| 3    | the shared source `<name>`  |
| 4    | the field's default         |

So `name: "species"` reached `hm3.species` and could not see `data.species`,
while `name: "data.species"` reached the shared source and could not see
`hm3.species` — and each yielded the field's **default** wherever only the other
position was authored. Silently: the field compiles, the document is emitted,
and the value is simply gone.

Two things followed. The specification's shared→system mapping was implemented
_nowhere_ — `grep 'name: "data\.'` returned zero hits across all 58 declarations,
so rows the format states (`data.species`, `data.gender`, `data.occupation`)
were read by nothing. And no safe transition existed: every other retirement here
— `package:`, `image`, `archetype`, `relation` — works because **both spellings
are read while the corpus moves**, and one property could not offer that.

**`legacyKey` separates them.** `name` is the shared source; `legacyKey` is the
key the system block still carries, and step 2 keys on it. Absent, it falls back
to `name`, so every declaration written before this resolves unchanged.

- **Both are read, the current position wins.** A note that has not been swept
  is still saying what it means.
- **The legacy read is _reported_**, as a warning — at compile through
  `legacyKeyMessage`, and in the frontmatter lint — so a sweep has a progress
  signal, matching `RETIRED_FIELD_ALIASES`. A field that declares no `legacyKey`
  is not mid-sweep and is never reported; that would put a finding on every
  field of every note.
- The lint accepts the legacy key as a key of the block, rather than reporting
  `sohl.species` as a property no `being` has against exactly the notes the
  sweep has not reached.
- The format check normalizes `data.` on **both** sides, so a moved declaration
  still pairs with the specification row that states it.

**HM3's three actor rows are declared as the sources the format names** —
`data.species`, `data.gender`, `data.occupation` — while keeping the in-block
key every note writes. Measured over the four content trees: 2,512 `being` notes
compile byte-identical to before, and all 2,512 read the legacy position, which
is the count #126 has to take to zero.

This is the mechanism the `data:` half of #126 and all of #129 were blocked on.
