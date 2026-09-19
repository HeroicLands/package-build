---
"@heroiclands/package-build": patch
---

**Dependency bumps** — `package-build bump` is described by what it is for: npm
performs the resolution, so a version whose dependency set differs from the one
it replaces is taken as correctly as one that moves three lines, while patching
the lockfile by hand is right only while the two dependency sets match. npm
writes `package-lock.json` with the indentation `package.json` uses, so a
formatted manifest yields a formatted lockfile; the bump holds each file to the
indent it already carries, which is what covers a lockfile indented unlike its
manifest.
