---
---

No consumer-visible change. Refreshes the locked `@heroiclands/content-build`
resolution from 1.0.0 to 1.2.0, which the declared `^1.0.0` floor already
allowed — so this affects only what this repository's own CI installs, not what
a consumer resolves. The floor is deliberately left at `^1.0.0`: nothing here
uses anything added in 1.1.0 or 1.2.0 — 1.2.0 is a change to content-build's
_command line_, and this package consumes it only as a library — and raising it
would assert a requirement that does not exist.

Also corrects the lockfile's own `version` fields, which still read `0.2.1`
against a `0.4.0` manifest.
