---
"@heroiclands/package-build": minor
---

A note can now name an interface icon instead of drawing one. `:icon-star:`
renders as the same Font Awesome element the system's own sheets emit, and an
undeclared name is reported rather than published as literal text.

The user guide described Foundry's interface by pasting Unicode lookalikes of
icons the sheets actually draw — `☆` for the improve flag, `✎` for the formula
editor — so the note and the screen it described were drifting apart. Those
characters are also the worst in the corpus to typeset: of eight candidate book
faces, none carries them.

A registry maps a writer's name to a style and a Font Awesome icon, because the
three surfaces need different artefacts from one name: the journals and the
website want an `<i class="fa-solid fa-star">`, and a PDF wants a font file and
a glyph. It also means an icon renamed between Font Awesome major versions costs
one line rather than a sweep of the corpus.

Codepoints are deliberately absent: a renderer embedding the font has to read it
to subset it, and the font's own `cmap` is the only trustworthy source for which
glyph a name resolves to.

Part of #378.
