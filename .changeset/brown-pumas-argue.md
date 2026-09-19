---
"@heroiclands/package-build": minor
---

**Art and sound have addresses** — A package's pictures and sound clips are now
addressed the way its notes are. `icon`, `image` and `audio` are types a
reference can reach, one per tree: `assets/icons`, `assets/images` and
`assets/audio`. The filename is the name — `anvil.svg` is `icon-anvil` — and the
directories above it are the package's own business, so a tree can be tidied
into whatever arrangement suits the people who maintain it without a single
reference changing.

- _The extension stays out of the name._ Changing a picture from SVG to WebP is
  dropping a different file in place; nothing that names it has to be touched.
- _Two files cannot claim one name._ A root's names are one list however deeply
  it nests, and the build says which two files collided.
- _Attribution travels with the file._ Who made it, where it came from and what
  licence it carries are published beside it, taken from the `provenance.yaml`
  nearest the file or from a record written for that one file alone.
- _A package can lend its art._ Every address says which package holds the
  bytes, so a picture one package ships resolves for another that cites it — on
  the website, in the book, and in Foundry.
- `packagebuild` is a reserved name, held for the files the toolchain itself
  ships, so no package may claim it.

Fonts are deliberately not addressable: nobody names a typeface the way they
name a picture, and a stylesheet and a typesetter each want something an address
cannot give them.
