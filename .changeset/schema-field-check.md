---
"@heroiclands/package-build": minor
---

Compare a builder's emitted `system` fields against the receiving DataModel
(#60) — the comparison half.

Foundry discards an unknown `system` key when a document is constructed, and
says nothing: the value is absent at load while the build that wrote it reported
success. Both directions of that mismatch have already happened here, both
compiled clean, and both were found by set-subtracting compiled documents'
`system` keys against `defineSchema()` **by hand**.

**The emitted half needs neither compilation nor parsing.** `field-spec.mjs`
already makes the field list the only statement of the mapping — "the
declaration is the builder" — so every `system` path a type can emit is
`field.to`, known statically. Nothing compiles a document to find out.

**The declared half arrives as data, pinned to the declared version.** A system
publishes its field sets as an artifact and this reads it, the shape the link
manifest already uses for addresses. Against `compatibility.verified`, never the
system's `main`: `affiliation.subType` _is_ defined on sohl `main` and simply
unreleased, while `sohl-kethira-basic` pins `0.8.2` — so a check against `main`
passes and the field still evaporates for all 21 of its deities.

**`own` and `inherited` are recorded apart, and the two directions read
different sets.** A subtype's schema spreads its parent's, so `notes`, `docHtml`
and the rest land on every subtype; they are the system's own runtime concerns
and no content builder is expected to emit them.

| direction             | read against                                                       | severity |
| --------------------- | ------------------------------------------------------------------ | -------- |
| emitted, not declared | `own` ∪ `inherited` — the field must exist somewhere               | error    |
| declared, not emitted | `own` only — what the subtype adds is what its builder answers for | report   |

Collapsing them would report every inherited field on every type: a wall of
findings that are all correct and none actionable.

**A false positive the real schema caught before this shipped.** Run against
sohl's actual `mysticalability`, the _declared, not emitted_ direction reported
`charges.value` and `charges.max` on a type that populates them correctly — the
builder writes `charges` as a whole object and never names the leaves beneath
it. A declared path is now covered when the builder emits any ancestor. The
first real schema tried produced two false findings, which is exactly the kind
that teaches people to ignore a report.

**Verified against the real declarations.** With sohl's `mysticalability`
schema transcribed from source, the comparison reports nothing; with #35's
`assocMysteryCode` reinstated, it reports exactly that field.

**What this does not do yet.** It does not read an artifact from disk, and
nothing runs it in a build — those wait on a system actually publishing its
schemas, which is sohl's half and a separate change. The comparison, the format
and both regression cases are pinned here so that half has something to satisfy.

**Bump**

_Minor._ New surface — `engine/schema-check.mjs` and its exports — and nothing
existing changes behaviour. No consumer runs the comparison until an artifact
exists to run it against.
