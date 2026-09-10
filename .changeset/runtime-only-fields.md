---
"@heroiclands/package-build": minor
---

**A note can no longer author a field the document writes in play** (#330).

A data model declares everything a document stores, and part of that is runtime
state — an affliction's `onsetDate` is the world time its onset fired at.
Writing `sohl.system.onsetDate` reached it as directly as any other field: the
block is a verbatim passthrough, no declared field claimed the path, and the
schema check's fatal direction is _undeclared_, which a field the schema really
does declare satisfies. So a compiled pack could ship one world's play state to
every world that installed it, with the build reporting success.

A field declaration may now say `runtimeOnly`, whose value is the reason — what
the field holds — the way `topLevelMeans` already works. It states both halves
of one fact:

| declaration   | authored    | absent          |
| ------------- | ----------- | --------------- |
| ordinary      | emitted     | default written |
| `runtimeOnly` | **refused** | key omitted     |

The refusal names the note, the line, the whole key and the field's own reason,
and says that deleting it is the fix — there is no value that makes writing one
right. Omitting the key rather than emitting `null` is what leaves the data
model's own `initial` standing.

It is a property of the declaration, not a list of names, so it holds for any
runtime-only field any system adds later. Such an entry declares a `to` and no
`name`, which keeps it out of the authored vocabulary — the generated field
reference lists it under **Never authored** with its reason instead of as a row
an author might fill in — while still claiming the path for the passthrough.

**What a consumer sees**

- SoHL's six timed-phase dates are declared: `contractDate`, `onsetDate`,
  `treatmentDate` and `resolutionDate` on `affliction`; `contractDate` and
  `treatmentDate` on `trauma`. No tree authors one today, so no compiled
  document changes.
- The refusal covers both positions a note can reach them from: a note's own
  `<system>.system` block, and an actor's `items:` entry `system:` overlay,
  which merges verbatim and so passed no field declaration at all.
- A runtime-only path is no longer reported as a field the builder forgot to
  emit — "every compiled document will carry the field's initial value" is what
  the declaration is _for_, so the warning could never be cleared.
- Regenerate the item frontmatter reference to pick up the new section.
