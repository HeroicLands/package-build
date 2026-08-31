---
"@heroiclands/package-build": major
---

Stop emitting five `system` fields no SoHL DataModel declares (#60).

The comparison this release adds was run against sohl's published schema at
0.8.2 and found five, on its first run:

| type             | emitted, undeclared                                      |
| ---------------- | -------------------------------------------------------- |
| `affliction`     | `isTreated`                                              |
| `trauma`         | `isTreated`, `isBleeding`                                |
| `projectilegear` | `impactBase.overrideDice`, `impactBase.overrideModifier` |

Every one was discarded when the document was constructed, on every compiled
document, with nothing said — which is the whole of what #60 is about.

**Two of them were never storable.** `isTreated` and `isBleeding` are _derived_
on the logic classes: `AfflictionLogic.isTreated` is `treatmentDate != null`,
and `TraumaLogic.isBleeding` is `bloodLossAdvanceDurationBase != null`. So the
builder wrote a constant Foundry threw away while the field it is computed from
went unwritten — both directions of the same defect, on the same field. Nothing
replaces them: an untreated affliction is one whose `treatmentDate` is unset,
which is already the initial value.

**Three were authored fields that vanished.** `trauma.isTreated`,
`trauma.isBleeding` and the two projectile overrides carried a frontmatter
`name`, so a note could write them — and the value went nowhere.

**The projectile overrides are removed rather than reported upstream as missing
fields**, because nothing anywhere wants them: no DataModel declares them, no
logic class reads them, no localization key names them. A
launcher-versus-ammunition override may be worth having, but it would have to be
designed in the system first, and a content builder cannot be where it is
invented.

**Checked before removing, because three were authored.** Dropping an authored
field turns a note that writes it from a silent loss into an unknown-key error,
so all six content trees were searched first: `sohl`, `thalorna`, `kethira`,
`harnensemble`, `harnadventures` and `hm3` write none of the five.

**Verified.** Against sohl 0.8.2's published schema, `undeclared` falls from
five to zero. The twelve remaining findings are the advisory direction —
fields a subtype declares that no builder emits, `treatmentDate` among them —
and are reported rather than fatal.

**Bump**

_Major._ Three of the five were part of the authored frontmatter vocabulary, and
a note writing one is now an unknown-key error rather than a value silently
dropped. No content in this organisation writes them, but a consumer outside it
would have to delete the keys — and would find its documents unchanged, since
they never reached a saved document in the first place.
