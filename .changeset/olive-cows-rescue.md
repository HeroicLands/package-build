---
"@heroiclands/package-build": minor
---

**A note names its art, and the art arrives** — The picture a document carries
is chosen by name now, the way everything else in a note is. `icon` is what a
directory listing shows beside the name, `tokenIcon` what a token on the canvas
wears, `bgImage` a map's background, and `banner` the hero image at the top of a
page. Write the name of the file and the build finds it.

- _The art actually reaches the document._ Every compiled item took its type's
  stock picture whatever its note said; it now carries the one it names, and the
  same goes for a being's profile art, its token and its portrait.
- _A map is art all through._ Its background, the pictures on its tiles and the
  sound clips placed around it are all named the same way and all resolved.
- _A being with no picture of its own gets one that suits it_ — a person and a
  creature fall back to different art, chosen from what the note says it is.
- _A picture one package ships reaches another that names it_, on the website,
  in the book and in Foundry, with each getting the address it serves.
- _`tokenIcon` unset follows `icon`._ A being naming one picture wears it on the
  canvas too.
- _A name nothing answers is reported against the note_ rather than quietly
  becoming the stock picture.

A being's portrait is the first image inside its `{#appearance}` section now,
written in the prose that describes it rather than declared in a field — where
an author can see it, move it and caption it like any other picture.
