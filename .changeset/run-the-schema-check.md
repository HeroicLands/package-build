---
"@heroiclands/package-build": minor
---

Run the emitted-versus-declared field comparison in `content-build lint` (#60).

The comparison shipped in 7.0.0 with nothing calling it, because no system had
published its field sets yet. `sohl` now does, so this reads the artifact and
runs both directions.

**Which system, at which version, is already settled.** `stats.systemId` and
`stats.systemVersion` are derived rather than authored (#48) — a system package
is its own system, a module takes the one it requires, and the version is the
`compatibility.verified` it pins. So there is no second piece of configuration
to disagree with the first about whose schema to check against.

Two places to find it:

- **A system** reads its own `schema.json`, generated from its `src/`.
- **A module** reads the copy `content-build deps fetch` caches from the archive
  of the version it pins — which is what makes the comparison happen at
  `verified` rather than against whatever the system's `main` holds today.

**The fetch now keeps the schema.** Both fetch paths already unpacked the
dependency's archive, but only one kept the result: a download unzips into
`<cache>/package/` and leaves it, while `deps fetch --from` unzips into a
temporary directory and deletes it. A reader looking in the unpacked tree would
have found the schema for one and not the other — so it is copied to one known
place beside the extracted items instead.

**An absent schema is announced, not skipped in silence.** A system before its
first schema build, and a module pinning a version released before the artifact
existed, both have nothing to check against. That is not an error — but a check
that quietly does nothing is indistinguishable from one that passed, and this
issue exists because a defect went unnoticed for a release. So the run says so:

```text
No published schema for sohl@0.8.2, so emitted `system` fields are unchecked.
A system generates its own; a module gets one from `content-build deps fetch`.
```

**Also lands the five fixes the comparison found.** They were pushed after
#116's merge and so were not part of it: `affliction` and `trauma` emitted
`isTreated`, `trauma` emitted `isBleeding`, and `projectilegear` emitted
`impactBase.overrideDice` and `impactBase.overrideModifier` — none of which any
DataModel declares. Without them this change would have turned `sohl`'s own
lint red on the defects it was written to find.

**Verified against both shapes.** Against `sohl`, the run reports zero errors
and twelve advisory warnings, and `lint` passes. Against `sohl-kethira-basic`,
whose pinned 0.8.2 archive predates the artifact, it announces the skip and
reports only that repository's pre-existing findings.

**Bump**

_Minor._ New reporting on an existing command, and a fetch that keeps one more
file. The error direction can fail a build that passed before — but only for a
package whose dependency publishes a schema, which no released version does yet.
