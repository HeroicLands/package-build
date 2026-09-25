---
"@heroiclands/package-build": patch
---

**Affiliations** — a `seat`, a `parents` entry, a `domains` entry and a
`relations` key each name the other note by _address_, written at whatever length
says what it means: a body or a place in another package is named in full, one in
this package by its shortcode alone, and the compiled item carries the shortcode
the game reads either way. A value naming something other than a place — for
`seat` and `domains` — or other than an affiliation — for `parents` and
`relations` — now says so instead of compiling into a reference that resolves to
nothing. Where two of them name notes that share a shortcode in two different
packages, the build names both addresses rather than quietly keeping one of them.
