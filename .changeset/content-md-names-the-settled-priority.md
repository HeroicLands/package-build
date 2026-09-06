---
"@heroiclands/package-build": patch
---

**`CONTENT.md` names the template priority by its settled name** (#266).

The shipped specification still described the field as `archetype`, written to
`system.archetype`, and its worked example authored `archetype: 1` inside the
`sohl:` block. All three were wrong in the same direction, and the example was
the worst of them: it told an author to write the exact key the frontmatter
linter now refuses, in a position that is no longer the field's home.

It now describes what the build does — `data.templatePriority` is the shared
home, reaching `system.templatePriority` in SoHL and `flags.hm3.templatePriority`
in HM3, with the legacy in-block and top-level positions still read and
`archetype` read last and refused by the linter. The emitted-keys list names
`templatePriority`, and the example authors it under `data:`.

The specification's one remaining use of `archetype` to mean the priority — an
aside comparing a map's misplaced fields to it — says "the template priority"
instead, since `archetypes` now means a different thing one letter away.

The schema fixture's comment no longer reads as though
`Song-of-Heroic-Lands-FoundryVTT#1836` were outstanding. It is merged; the gap it
describes closes when SoHL 0.8.4 publishes, since the newest published artifact
(0.8.3) still declares `archetype`.
