---
---

No release: nothing in the published package changes. `package-lock.json` moves
`@heroiclands/content-build` from 1.2.0 to the published 1.4.0 — a version the
declared `^1.0.0` range already resolved to, so every consumer was installing it
regardless and only this repository's own CI was testing something older. The
lockfile's root `version` catches up to the 0.6.0 that `package.json` already
declares, and `release.yml` gains the refresh that stops it drifting again.

Deliberately empty rather than a patch bump — none of the changed files is in
`files`, so versioning here would publish an identical artifact under a new
number.
