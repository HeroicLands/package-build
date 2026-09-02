---
"@heroiclands/package-build": minor
---

Write a document's archetype to `system.archetype` instead of `flags.sohl.docArchetype` (part of #126, part of #127).

**Requires an unreleased SoHL.** This must not ship before HeroicLands/Song-of-Heroic-Lands-FoundryVTT#1780 declares `system.archetype` on SoHL's shared data schema and that release is out. Foundry discards an undeclared `system` key at construction without a word, so a package built with this against an older system carries an archetype nothing can read. The order is: the field, then this, then rebuild.

**What changed.** `sohl/items.mjs` and `sohl/actors.mjs` stop calling `withArchetypeFlag` and write the value into `system` — a number for an archetype at that priority, `null` for a document that is not one. `flags` becomes a plain passthrough of what the note authors, defaulting to `{}` exactly as before. `withArchetypeFlag` is deleted; `resolveArchetype` stays, and so does its required-ness, so an absent `archetype` is still an authoring error rather than a silent "not an archetype".

`engine/helpers.mjs` gains `systemArchetype`, which is where `resolveArchetype`'s `undefined` becomes the field's `null`. That conversion has to be somewhere: an emitted `undefined` is dropped by `JSON.stringify`, which would leave the compiled document with no `archetype` at all and a tri-state readable as two.

**The falsy trap, held by tests.** `0` means "is an archetype, at priority 0" — the priority SoHL's own archetypes ship at — while `null` means "is not one". `resolveArchetype(fm) || null` passes every other case and turns 1,470 SoHL documents from archetypes into non-archetypes, so the suite asserts `0` through the builder and through a `JSON` round trip.

**Compiled output moves, and this is the one change in this stack where it should.** Characterised document by document across three trees, every difference is a `flags.sohl.docArchetype` disappearing and a `system.archetype` appearing with the identical value, plus the now-empty `flags: {}` that the removed flag leaves behind. No `_id` and no `_key` moves anywhere.

Counts, with the last four columns the value each **top-level** document carries (embedded items carry it too, as they carried the flag):

| tree                 | compiled | changed | `0`   | `1` | `100` | `null` |
| -------------------- | -------- | ------- | ----- | --- | ----- | ------ |
| `sohl`               | 3,126    | 1,474   | 1,470 | 1   | —     | 3      |
| `sohl-thalorna`      | 2,561    | 1,273   | 157   | —   | —     | 1,116  |
| `sohl-kethira-basic` | 385      | 363     | 343   | 10  | 10    | —      |

**One diagnostic moves.** Seven `sohl-thalorna` affiliation notes that already fail to compile now report the missing `archetype` rather than a folder id or a missing `subType`, because the requirement is checked earlier in `buildEntry` than the flag it replaces. Same files, same count, same severity; every other finding in all three trees is unchanged, message for message.

**Neither schema check has anything to say about it**, before or after the field is declared. `compareFields` derives what a builder emits from its `itemBuilders` field declarations, and `archetype` is written by the compiler itself — as `shortcode`, `actionDefs`, `notes` and `docHtml` already are — while the note-side check reads only what a note authors under `<system>.system`, and `archetype` is authored at the block's top level. So the ordering constraint above binds at Foundry's silent discard, not at a check that would catch it; the suite records that, so nobody reads the quiet as coverage.
