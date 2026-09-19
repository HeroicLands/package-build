---
"@heroiclands/package-build": patch
---

**Two pieces of per-repository tooling move here.** Every site-publishing
package held its own copy of both, and a copy per consumer is a copy free to
drift — which is what happened, invisibly, because nobody reads all of them at
once.

- `packageBuild.assetTransform: svg-theme` names a shipped transform, so an
  icon follows the reader's colour scheme without a module in the repository.
  The value still takes a path, so a consumer with a transform of its own is
  unaffected.
- `package-build site-root` writes a deployment's `_headers` and `_redirects`:
  indexing suppressed on every host-assigned address, and both spellings of the
  prefix root redirected to the landing with a lifetime on the 301. The package
  name comes from `contentPackage`, which was the only thing the copies actually
  varied.
