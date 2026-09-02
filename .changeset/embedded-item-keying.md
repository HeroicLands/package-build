---
"@heroiclands/package-build": minor
---

Key a being's embedded-item references and the predefined-items map on the same vocabulary, and report a reference that resolves to nothing (closes #140, part of #127).

**The defect.** Two vocabularies met in embedded-item resolution and disagreed about which one they were speaking. `Actors.loadItemsMap` keyed each predefined item by the **compiled document's** subtype (`doc.type`), while a being's frontmatter addresses its embedded items by the **note's** `type`. They are the same string in every SoHL row today, so the lookup succeeded by coincidence; the note-type → document-subtype map (#79) made the coincidence visible without creating it.

The first non-identity row breaks it. #78 introduces exactly that — `armorgear` → `armor` and its two siblings — at which point a being's `armor` reference is looked up in a map keyed `armorgear`, finds nothing, and the item is missing from the compiled actor. `harn-ensemble` alone carries 30,741 such references.

**Which vocabulary, and why that one.** The addresses stay keyed on the **document subtype**, and each authored reference is translated forward through the system's map before the lookup. The map is a function from note type to subtype by construction; the reverse is not — two note types may compile into one subtype — and a compiled document records nothing about the note that produced it, so there is no honest way to key the addresses the other way round. The translation lives in one place, `Actors#embeddedSubtype`, over a new `referencedSubtype` in `engine/document-subtypes.mjs`, and both are documented as saying which side translates rather than leaving it implied.

| a reference naming…                           | before                        | after                                  |
| --------------------------------------------- | ----------------------------- | -------------------------------------- |
| a mapped type                                 | looked up verbatim            | looked up as the subtype the row names |
| a type the system does not map                | looked up verbatim            | unchanged — the consumer's own type    |
| a type the system compiles into another class | resolved to nothing, silently | a finding naming the note              |
| a one-to-many row                             | resolved to nothing, silently | a finding listing the candidates       |
| a retired spelling                            | resolved to the old name      | a finding naming the replacement       |

**A stand-alone entry moved too.** An entry carrying no shortcode is built from the reference alone, so the note type became the document's subtype outright — a document of a subtype the system does not define, with nothing said. It now carries the mapped subtype, and the embedded `_id` seed is the subtype as well, so a later note-type rename leaves every embedded id exactly where it was.

**Every finding is located.** An unresolved reference is now reported at the line the reference sits on rather than at the note, in the usual `path:line:column: severity: message` form.

**Nothing compiled changes, and no tree gains a finding.** SoHL's map is the identity throughout: its 3,126 compiled pack files are byte-identical across the change. Compiled read-only against `harn-ensemble`, `sohl-thalorna`, `sohl-kethira-basic`, `harn-adventures` and `sohl`, the diagnostic output is the same finding for finding — 64 pre-existing `sohl-thalorna` findings gain a line and column, and nothing else moves.
