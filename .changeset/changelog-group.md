---
"@heroiclands/package-build": patch
---

**A new `changelog group` command folds a release's changeset blocks together by their bold label.**
`@heroiclands/package-build/changelog` writes each changeset's summary into `CHANGELOG.md` as its
own block, so three pull requests each touching compendium content leave three separate
`**Compendiums**` blocks instead of one. `changelog group` rewrites the newest release section in
place: every block sharing one label is merged into a single block, bullets kept in their original
order with an exact duplicate kept once, and the merged blocks are ordered by a new
`changelog.labels` configuration key — the unlabelled lead paragraph first, then every declared
label in order, then any undeclared label last with a warning naming it. `changelog check` warns on
a label absent from a declared `changelog.labels` too, so a drifted spelling is caught before a
release ships it.
