---
"@heroiclands/package-build": minor
---

**Every declared note type is routed, or excused for a stated reason** (#243,
#241) — asserted statically, of the toolchain, so it no longer depends on some
repository happening to author the type.

This is the check #241 needed and nobody had. `place`, `lore` and `scenario`
were declared, validated, and claimed by no pass; every gate reported success,
and the only thing that noticed was a downstream repository failing to compile
450 notes. The claim table was already cross-checked against each pass's
`selects`, but that agreement holds just as well when **both** say nobody claims
a type — which was exactly the broken state. The missing property is not
agreement, it is **coverage**.

A declared type must now be one of four things, and the four name different
reasons rather than being interchangeable: claimed by a pass; **never packed**
(compiles to no document — `homepage`); **derived packed** (materialises by
reference in every pack that references it, so no one pass owns it — `folder`);
or declared by a shipped **system map**, so a configuration carrying that
system's packs claims it (`armorlocation`, which is HM3's).

**`UNIMPLEMENTED_TYPES` is new, and it is stated rather than inferred.** An
unimplemented type and a forgotten one look identical from outside: documented,
validating, reaching no pass. Only intent separates them, so intent is written
down. The obvious inference — "declared, but absent from the configured
vocabulary" — reads correctly and is worthless, because that vocabulary is
_derived from the routing_: take a type's route away and it leaves the
vocabulary too, so the inference excuses precisely the mistake it was meant to
catch. That was verified by putting `place` back into its #241 state, where the
inferred form passed and the stated form fails.

`vehicle` is its one member, and `unclaimedNoteFindings` now chooses its
"specified, not implemented" wording from the same set rather than from a second
reading of the same fact.

_No behaviour change: over `sohl`'s tree the compile emits the same 3,085
documents with identical diagnostics, and `lint` reports the same 354 findings._
