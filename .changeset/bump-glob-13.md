---
"@heroiclands/package-build": patch
---

Bump `glob` from 11.1.0 to 13.0.6.

**Both majors are changes to glob's command-line program, not its library.**

- **12** removed the unsafe `--shell` option, keeping it only on shells where it
  can be implemented safely (the remediation for GHSA-5j98-mcp5-4vw2, whose
  mitigation 11.1 had introduced).
- **13** moved the CLI out to a separate `glob-bin` package.

This repository never invokes that program. The single use of the library is
`globSync(patterns, { cwd, absolute: true })` in `readMatching`
(`bin/package-build.mjs`), which is untouched across both majors — no workflow,
hook, or script calls `glob` from a shell, so the removed binary is not a
dependency this package had.

**Verified rather than assumed.** `globSync` was exercised under 13.0.6 with the
options `readMatching` actually passes, returning the same absolute paths; the
repository's 1,642 tests pass unchanged.

**Bump**

_Patch, not minor._ Nothing in this package's surface moves, and the majors are
the library's own. Worth noting for a consumer only in one case: a repository
that installed `glob` transitively through this package and relied on
`node_modules/.bin/glob` being present must now depend on `glob-bin` directly.
That was never a supported edge of this package, and no HeroicLands repository
does it.
