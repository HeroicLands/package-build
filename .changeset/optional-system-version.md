---
"@heroiclands/package-build": minor
---

Let a system-agnostic module stamp no system version.

#40 made `stats.systemId` optional. `stats.systemVersion` stayed mandatory and
derived — from the `compatibility.verified` of a declared system relationship,
throwing when there is none — and a data configuration may not declare it
directly. A module that deliberately targets no system therefore could not be
configured at all.

Declaring the relationship is not an escape. Foundry's `_testSupportedSystems`
returns true when a package declares no systems, but returns false when it
declares some and none of them is installed. Naming `hm3` and `sohl` would make
such a module unavailable to a world running anything else — the opposite of
what a system-agnostic package is for.

`shippedSystemVersion` now returns `null` when a module names **neither** a
`stats.systemId` **nor** any `relationships.systems`, and `stats.systemVersion`
is optional alongside it. Every other case is unchanged: a module that names a
system but declares no usable relationship still throws, because that is the
mistake #1548 added the guard for. The two signals together are what separate
system-agnostic on purpose from a forgotten declaration.
