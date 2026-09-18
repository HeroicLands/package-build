---
"@heroiclands/package-build": patch
---

**Content format** — The specification describes art as addresses rather than
file paths. A note names its artwork with a wikilink address, an asset lives at
an address that holds exactly one file with the extension outside the name, and
`icon`, `image`, `font` and `audio` are types a link can reach like any other.

- The five art slots are `icon`, `portrait`, `tokenIcon`, `bgImage` and
  `banner`, each a wikilink field with its own default type.
- An image in a note's body is written `![[address|alt text]]`, an empty label
  marking it decorative.
- `packagebuild` is reserved, so any package can name a shared section banner
  without declaring a dependency to reach it.

The build reads art as file paths, so it refuses a tree written to this
specification. The specification is the target; the build is what runs today.
