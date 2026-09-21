## 22.4.3

### Patch Changes

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

**A shipped changelog generator writes a release note without a commit hash.**
`@heroiclands/package-build/changelog` is a Changesets changelog generator
whose `getReleaseLine` renders a changeset's summary as a block, verbatim —
no bullet, no indentation, separated from its neighbours by one blank line —
and whose `getDependencyReleaseLine` writes nothing. Point
`.changeset/config.json` at it
(`"changelog": "@heroiclands/package-build/changelog"`) to stop every release
note from carrying a commit-hash prefix.
