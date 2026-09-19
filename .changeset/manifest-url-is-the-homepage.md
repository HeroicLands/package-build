---
"@heroiclands/package-build": major
---

**A manifest's `url` is the package's homepage.** It is the Project Homepage link
a reader follows from the Foundry package listing _before_ installing anything,
so it answers "what is this?" — which the authored page at
`https://www.heroiclands.org/<contentPackage>/` does and a source tree does not.
`bugs`, `manifest` and `download` address release artefacts and stay on the
repository holding them. The address is derived from the content package rather
than declared, because the shared site-deploy workflow already publishes there; a
declared copy would be a second spelling of a settled fact, and the one free to
drift, since nothing fetches `url` the way Foundry fetches `manifest`.

**Breaking — `releaseUrls` takes `homeUrl`.** A call without it produced a
manifest advertising `undefined`, so the parameter is required rather than
defaulted. `packageHomepage` and `HOMEPAGE_ORIGIN` are exported beside it, and
`packageHomepage` refuses an empty name for the same reason.

**A configuration always names a content package**, so the manifest no longer
carries the branch that handled one that did not: the content index is advertised
unconditionally, which is what the comment above it already claimed.
