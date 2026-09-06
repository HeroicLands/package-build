---
"@heroiclands/package-build": major
---

**The SoHL passes emit `system.templatePriority`, not `system.archetype`**
(#266).

The read half landed already: `templatePriority` is what a note authors, and
`archetype` is read only as the retiring spelling. The **emitted** key stayed
behind, so a compiled document still carried the old name — and that half cannot
move on its own schedule, because the receiving schema and the emitted key have
to agree. `Song-of-Heroic-Lands-FoundryVTT#1836` renames the data-model field;
this is the other side of that single change.

**Why it is breaking.** Foundry discards an undeclared `system` key at
construction _without a warning_, so a build emitting `archetype` into a system
that declares `templatePriority` reports success and ships documents whose
priority is silently gone. The emitted-versus-declared check catches exactly this
and fails the pack build, which is what makes the pairing enforced rather than
hoped for: **a consumer must take this release together with a SoHL that declares
`system.templatePriority`** (0.8.4 or later). Taking one without the other fails
the build with a message naming the field, rather than shipping quietly broken
packs.

`resolveArchetype` and `systemArchetype` are renamed `resolveTemplatePriority`
and `systemTemplatePriority`; the generated field-reference example authors
`templatePriority: null`, since the linter now refuses the old spelling in the
example it tells authors to copy.

The HM3 pass is unaffected — it already wrote `flags.hm3.templatePriority`.
