---
"@heroiclands/package-build": minor
---

Stop inferring a Foundry document's subtype from the markdown note's `type`, and look it up in a map each system declares (part of #79, slice 3 of #127).

**The defect.** The two vocabularies were the same identifier for one reason: a builder wrote the same string twice. `sohl/actors.mjs` declared `ACTOR_VAULT_TYPE = "being"` and emitted `type: "being"` several hundred lines below it, under a comment reading _"One content type, named for the Foundry actor it produces."_ Nothing related them, so changing one and not the other produced a wrongly-typed document in silence — a wrong-output risk with **one** system, not only with two.

**The mechanism** is `engine/document-subtypes.mjs` and the declaration is the system's, which is the `engine/` ÷ `sohl/` line this package draws everywhere else: note-format knowledge in the engine, game-system knowledge in the system half. `sohl/document-subtypes.mjs` declares SoHL's own map — _identity rows included_. `skill` → `skill` is written out rather than derived from the item registry's keys, because deriving it is exactly the coincidence the map exists to remove.

| behaviour                                          | before                              | after                                       |
| -------------------------------------------------- | ----------------------------------- | ------------------------------------------- |
| an item's emitted subtype                          | `fm.type`, verbatim                 | the row the system declares                 |
| an actor's emitted subtype                         | the literal `"being"`               | the row the system declares                 |
| which notes the actors pass claims                 | `fm.type === "being"`               | every note type the map sends to an `Actor` |
| a type the system maps onto another document class | claimed by whichever pass got there | claimed by neither                          |

A markdown type with **no** row for a given system produces no document for that system — silently and correctly, exactly as the thousands of notes belonging to another pass already are. A one-to-many row is resolved by the note, which supplies the discriminator in that system's own block; an absent one is an error that names the note and lists the permitted values, never a default. SoHL has no one-to-many row, so that path is exercised against a fixture system in the suite rather than by inventing one.

**Nothing compiled changes.** Every SoHL row is the identity today, so the lookup returns what the inference returned: `sohl`'s 3,126 compiled pack files and the build's whole diagnostic output are byte-identical across the change. The renames the content format calls for (`armorgear` → `armor` and its three siblings) are #78 and stay deferred — when one lands it edits one row here and the notes that address it, which is a data change rather than a mechanism change.

Additive throughout: `itemBuilders`, the pack list and every other configured surface are untouched, and a consumer shipping an item type this system does not map keeps compiling it exactly as before.
