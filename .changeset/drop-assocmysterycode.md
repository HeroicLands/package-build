---
"@heroiclands/package-build": minor
---

Stop emitting `assocMysteryCode` on a compiled mystical ability (#35).

The `mysticalability` declaration named a field no SoHL DataModel receives.
`MysticalAbilityDataModel` declares `subType`, `assocSkillCode`,
`assocAffiliationCode`, `masteryLevelBase`, `improveFlag`, `levelBase` and
`charges`, and nothing else — Foundry discards the extra key when the document
is constructed, so every mystical ability in every consuming pack shipped a
value that was thrown away at load, with nothing at compile or load time saying
so.

This is the exact inverse of #3 and has the same root cause: nothing compares a
builder's emitted `system` block against the DataModel that receives it. #3 was a
declared field the builder failed to emit; this is an emitted field the DataModel
never declares. Both compile clean, both lose data silently, and an author cannot
tell either from a correct build. The general check is #60.

**The field was retired, not renamed.**
Song-of-Heroic-Lands-FoundryVTT#973 deleted `assocMysteryCode` because nothing in
production read the mystery it resolved to; #1012 later added
`assocAffiliationCode` as a separate concept — the faction whose standing confers
the ability. They look alike and mean different things, so the declaration is
dropped rather than retargeted.

**This changes emitted documents**, so a consumer wants a rebuild rather than a
silent upgrade — though nothing downstream can have depended on the value:

- `sohl` — nine notes authored the key, all of them blank. Corrected in
  Song-of-Heroic-Lands-FoundryVTT#1747.
- `sohl-kethira-basic` — no note authors it; all 224 mystical abilities carried
  the builder's own `""`. Recompiling `main` with this change removes exactly
  those 224 lines and touches nothing else.
