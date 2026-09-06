---
"@heroiclands/package-build": patch
---

**`kbcat` is documented** (#264), the last of the five universal keys the
specification had never mentioned.

`pack` and the template priority were described in the previous release; `kbcat`
was the sharpest of the three gaps and the one left. It is read 51 times across
SoHL's knowledgebase layouts and authored on more than 1,300 notes, and
`docs/content-format.md` said nothing about it at all — while already using
`sohl.kbcat AS _section` as the worked example of a content table, so the
specification demonstrated the key without ever defining it.

It is now described beside the compendium folder, as the one key in that section
that answers _where does this appear_ for the web rather than for Foundry:
`pack` and `packFolder` place a document in a compendium, `kbcat` places a page
in a list. Nothing compiles it — it reaches a published page because frontmatter
is copied onto that page, where a layout groups by it.

Three things an author cannot infer from the corpus are stated:

- **It is editorial, and independent of `subType`.** Neither is derived from the
  other, and `kbcat` both subdivides a subtype — `trauma`/`physcond` lists as
  `physdisability`, `physfeature` or `physprivations` — and renames one for
  display, `trauma`/`fear` listing under `phobias`. Most notes carrying a `kbcat`
  declare no `subType` at all, so a disagreement between the two is not an error
  to correct.
- **The value is free-form and nothing validates it.** There is no configured
  list of categories, and the frontmatter check knows only that `kbcat` is a key
  every type may write. So a misspelled category is not a build error and is not
  dropped — it silently becomes a group of one.
- **A note that writes none is dropped from the list entirely.** Grouping is by
  the key, so a page with no value falls in no group and is simply absent from
  the list page — not last, not under a fallback heading — with nothing reported
  at either build. Every note of a listed type in SoHL's tree carries one today
  and nothing here enforces that, which is one of the questions the content index
  exists to answer.
