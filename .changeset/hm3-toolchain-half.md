---
"@heroiclands/package-build": minor
---

**The `hm3/` half of the toolchain** — a note can now compile an HM3 document (#139).

`sohl/` was the only system half this package had, so `itemBuilders: [sohl, hm3]` — an
arrangement `CONTENT.md` already documented — named a registry that did not exist, and no
note could produce an HM3 Actor or Item however its frontmatter was written. `hm3/` is now
a sibling of `sohl/`: its own item vocabulary and builders, its own default art, its own
note-type → document-subtype map declared through the same `defineDocumentSubtypes`, and
its own Item and Actor compilers. The two halves import nothing from each other; the only
thing they share is the engine between them.

**A pack's `system:` now selects the compiler.** It already selected the `_stats` stamp, the
item catalogue a being resolves against and the `itemBuilders` lookup; the Item and Actor
passes were still SoHL's whatever a pack declared. So a note carrying both a `sohl:` and an
`hm3:` block compiles **one document in each system**, each shaped by its own builders and
stamped with its own system version — and a note carrying only one block is passed over by
the other system's pass rather than failed for a block it was never going to have.

**Four HM3 rows are one-to-many, and the note says which.** `mysticalability` becomes a
`psionic`, a `spell` or an `invocation`; `trauma` an `injury` or a `trait`; `weapongear` a
`weapongear` or a `missilegear`; `being` a `character` or a `creature`. The note writes
`hm3.type`; nothing is inferred from its `subType`, and a note that says nothing is an error
naming the note and listing the permitted values. `docs/content-format.md` is corrected to
match — it described the `mysticalability` split as derived from a `subType` vocabulary that
no longer contains the values the derivation named.

**The five shared names cannot cross over.** `skill`, `weapongear`, `armorgear`,
`containergear` and `miscgear` exist in both systems with different data models, so each
resolves through its own system's map, is built by its own system's registry, and is
field-checked against **its own** system's published `schema.json`. That last one is new:
`resolveSchemaArtifact` took the package-wide `stats.systemId`, which is deliberately unset
in a two-system build — so every schema check in such a build was skipped in silence.

**Shared machinery moved to `engine/`, unchanged.** `engine/item-compiler.mjs` and
`engine/actor-compiler.mjs` now hold what is note-format knowledge rather than game-system
knowledge, and `engine/anchored-sections.mjs` holds the `{#appearance}` / `{#dossier}`
convention. `sohl/items.mjs` and `sohl/actors.mjs` are what is left: SoHL's map, and the
`system` block SoHL's data model wants. Compiled output is byte-identical — verified by
recompiling `Song-of-Heroic-Lands-FoundryVTT`, `sohl-thalorna` and `sohl-kethira-basic`
before and after and diffing every emitted document.

`npm run lint` now also checks HM3's column of the content format: the specification's
`→ hm3` mapping claims against HM3's published `schema.json`, and its per-type tables
against the new field declarations.
