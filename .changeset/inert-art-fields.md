---
"@heroiclands/package-build": minor
---

**An `img:` authored on a type that emits none is now reported instead of
dropped in silence** (#349).

`img` is a shared top-level field — it maps onto `document.img`, so it is legal
on every note whatever the type — but not every document has one. `doc`, `place`,
`lore` and `scenario` compile into a JournalEntry, `folder` into a Foundry
`Folder`, and neither carries artwork; a `homepage` compiles into no compendium
document at all. On any of those the authored path went nowhere, the note
validated, the tree compiled clean, and nothing said so.

The frontmatter lint now warns, naming the note, the key and what the type
compiles into. `portrait:` is checked the same way, so an item authoring one is
told it has nowhere to put a sheet portrait.

**What it does not report.** `img: null` — that is the blessed way to say "this
note names no art", and on a type with no art it is a true and harmless thing to
say. A warning rather than an error, too: the note still compiles correctly, and
a note's top level is the generated page's front matter as well, so a site
template may read there what no document carries.

**Which types those are is derived, not listed.** Each pass declares the art it
writes (`BasePackCompiler.emitsArt`), and `emittedArtFor` walks type → document →
pass to answer. A second table of iconless types would be free to drift from what
is actually emitted, which is the defect rather than the check.

**What a consumer sees.** New advisory findings on notes already in this state;
warnings do not fail a build. `sohl-thalorna` has 57 — the `Lore/Totems/` and
`Lore/Deities/Kemetian/` clusters, which carried an `img:` from when they
compiled to affiliation items. The other shipped trees are clean.
