---
"@heroiclands/package-build": minor
---

Stop emitting `isEquipped` on a compiled gear item (#68).

`GEAR_COMMON` emitted `isEquipped: false` on every gear item, and no SoHL
DataModel declares the field. `GearDataModel` declares `isCarried`,
`containerId` and `sharedWithCohortIds` as its possession state, and nothing
else — Foundry discards the extra key when the document is constructed, so
every gear item in every consuming pack shipped a value that was thrown away at
load, with nothing at compile or load time saying so.

`GEAR_COMMON` is spread into all six gear types (`armorgear`, `concoctiongear`,
`containergear`, `miscgear`, `projectilegear`, `weapongear`), so this reached
every gear item of every consuming package.

This is the second instance of #35's defect and has the same root cause:
nothing compares a builder's emitted `system` block against the DataModel that
receives it. The general check is #60.

**The field was retired, not renamed.**
Song-of-Heroic-Lands-FoundryVTT#662 made the worn/equipped concept armour-only:
it removed `system.isEquipped` from the shared gear data model and gave
`ArmorGearDataModel` its own `system.isWorn`. That shipped in SoHL 0.8.0, so no
released system has read the key since. `isWorn` belongs to armour alone and is
not a target this declaration can be retargeted at — whether an `armorgear`
note should be able to author one is a separate content question, left open on
#68.

**Nothing to sweep.** Unlike `assocMysteryCode`, this was never authorable: the
declaration carried a `to` and a `value` but no `name`, so `readField` never
consulted the frontmatter and no note in any package could set it. It was
already absent from `authoredFields`, so the author-facing field reference is
unchanged. A consumer has no line to delete.

**This changes emitted documents**, so a consumer wants a rebuild rather than a
silent upgrade — though nothing downstream can have depended on the value.
Verified by recompiling two consumer trees at `main` before and after, comparing
every emitted document key-ordered:

- `sohl` — removes exactly 1019 `"isEquipped": false` keys from 1012 of its 3126
  compiled documents: 1010 items (465 `miscgear`, 331 `armorgear`, 114
  `containergear`, 82 `weapongear`, 18 `projectilegear`) and 9 more embedded in
  gear-carrying actors. No other difference, and no document added or removed.
- `sohl-thalorna` — removes 97 of 2018 across 2555 documents (96 items: 71
  `concoctiongear`, 25 `weapongear`). No other difference.

**A consumer that embeds a foreign item catalogue keeps the key until its
upstream republishes.** The 1921 `sohl-thalorna` occurrences this does not
remove are not emitted by this build at all: they are inherited verbatim from
the pinned `sohl@0.8.2` release pack its actors resolve against, which was
compiled by an earlier package-build. They clear when `sohl` cuts a release
built with this version, not before — so a consumer grepping its own output
after upgrading should expect the catalogue's share to remain.
