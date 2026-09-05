---
"@heroiclands/package-build": patch
---

**`pack` is documented** (#264).

`docs/content-format.md` is the published statement of what a note may write, and
`pack` — one of the five universal keys, which every note type may write and the
router has always read — appeared in it only as one incidental sentence inside
another type's section.

It is now described where it belongs, beside the compendium folder: what it
names, that `<system>.pack` overrides it for one system, that an unstated one
falls back to the pack of its type marked `default: true`, and the three
declarations that are refused — a companion pack, a pack nothing answers to, and
a pack of another document type.

`archetype` and `kbcat` are in the same state and are still to do; #264 tracks
them. `kbcat` is the starkest: read 51 times across SoHL's knowledgebase layouts,
and the specification has never mentioned it.
