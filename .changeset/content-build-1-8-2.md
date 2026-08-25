---
"@heroiclands/package-build": patch
---

Take `@heroiclands/content-build` 1.8.2.

The declared range was `^1.0.0`, which permitted this all along — the lockfile
was the thing four minors behind, pinned at **1.4.0**. So the two packages were
built and tested against a version no consumer would actually resolve. Pinning
the range at `^1.8.2` and refreshing the lockfile makes what CI tests and what a
consumer installs the same thing.

The jump matters more than a patch bump suggests: package-build imports
`loadPackConfig` from `content-build/engine/pack-config`, and 1.4.0 predates
both the move to YAML configuration and the switch to lazy config accessors.
Verified against the new version rather than assumed — 293 tests pass,
`build:types` and `format:check` are clean, and the CLI resolves its
configuration and lists its commands.
