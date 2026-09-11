---
"@heroiclands/package-build": minor
---

**A pack's `system:` must resolve to the version its documents are stamped with,
and a configuration where it resolves to nothing is now refused.**

Every document in a pack carries `_stats.systemId` and `_stats.systemVersion`,
and for a pack declaring `system:` those come from one of exactly two places:
the `systems:` entry for that system, which carries the verified version, or the
package-wide stats, which answer for a package whose packs are all for its own
system.

A pack naming a system that resolves to **neither** used to fall through to the
package-wide value — and a module that declares no system does not have one, so
both fields were stamped `null`. That is the plausible lie #43 was about,
reached by the one path the guard did not cover:

```
_stats: { systemId: null, systemVersion: null, … }
```

on 2,513 compiled actors in a pack whose configuration says `system: sohl` on
the line above.

**The check existed; it was skipped in exactly this case.** `packs.<n>.system`
was validated against `systems:` only when that block was non-empty — the guard
read `declaredSystems.size && …` — so an absent block meant no check at all. Its
sibling ten lines up refuses the same thing for `requiresSystem` and says "the
`systems:` block is empty or absent" in as many words, and the comment above
both already described this failure. The suite was green throughout because its
`harn-ensemble`-shaped fixture declares the `systems:` block the repository does
not: the fixture was more complete than the configuration it stood for.

**What a consumer sees.** A configuration in this shape now fails with the pack
named and the entry to add:

> `packs.actors-hm3.system` names `hm3`, which `systems:` does not declare — the
> `systems:` block is empty or absent, and this package has no package-wide
> system either. Every document in the pack is stamped `_stats.systemId` and
> `systemVersion` from one of those two, so with neither it would be stamped
> null. Add `systems:` naming `hm3` with a `compatibility.verified` version.

**Nothing changes for a package whose packs name no system**, or whose packs name
its own system — the package-wide stats answer for those exactly as before,
which is every single-system tree. The package-wide derivation itself is now a
named function read by both the stamp and the check, so the value validated
against and the value stamped cannot come to disagree about the case that has no
answer.
