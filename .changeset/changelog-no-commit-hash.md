---
"@heroiclands/package-build": patch
---

**A shipped changelog generator writes a release note without a commit hash.**
`@heroiclands/package-build/changelog` is a Changesets changelog generator
whose `getReleaseLine` renders a changeset's summary as a block, verbatim —
no bullet, no indentation, separated from its neighbours by one blank line —
and whose `getDependencyReleaseLine` writes nothing. Point
`.changeset/config.json` at it
(`"changelog": "@heroiclands/package-build/changelog"`) to stop every release
note from carrying a commit-hash prefix.
