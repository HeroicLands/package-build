---
"@heroiclands/package-build": minor
---

Add the closed `data:` container, and close `subType` (#128, part of #127).

**What it is.** A note's frontmatter has three regions and only one of them is
open. The top level describes the note as a published artefact and every key of
it is copied into the generated web page, so an unrecognised key there is a Hugo
or theme parameter this build has no standing to refuse. `data:` holds the
type-specific facts about the _subject_ — a weapon's weight, an affliction's
transmission, a being's species — and every note type declares which keys it may
carry.

**Why it earns its place.** Those facts previously sat at the top level, where
the pass-through rule applied to them too, so a misspelled `wieght` became a
theme parameter rather than a finding — indistinguishable, from the outside,
from a weapon that weighs nothing. Under `data:` the same key is reported where
it was written, with the key it was probably meant to be, drawn from that type's
own vocabulary and using the capped edit distance the `sohl:` check already
applies:

```text
assets/content/Gear/Axe.md:14:5: error: "wieght" is not a `data:` property declared by weapongear; the container is closed, so unlike a top-level key it is not passed through to the page. Did you mean "weight"?
```

**`subType` stays at the top level**, and is closed in its own way: a type either
declares a `subType` or does not, and a type that does declares its values. A
`weapon` declares none — SoHL distinguishes a weapon's uses by strike mode rather
than by kind — so `subType` on one is a finding; a `skill` declares ten, so
`subType: crafte` is a finding naming `craft`.

**Additive.** Nothing reads `data:` into a document's `system` block yet — that
is the passthrough slice — and no note in any tree authors one today, so no
compiled output changes. `engine/note-vocabulary.mjs` carries the declaration,
one entry per note type, taken from the content-format specification;
`lintNote` and `lintFrontmatter` take it as a `vocabulary` option, so the linter
stays a checker of whatever it is handed rather than gaining type names of its
own, and a caller that supplies none is checked exactly as before.
