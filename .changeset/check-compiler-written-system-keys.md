---
"@heroiclands/package-build": minor
---

Check the `system` keys a compiler writes itself against the receiving DataModel (closes #155, part of #127).

**What a consumer sees.** A compile can now fail with a line naming one of its
notes:

```
assets/content/Skills/Social/Charm.md: error: the compiler writes `system.archetype` into every Item of subtype "skill", and no field declaration names it — Item subtype "skill" does not define it at 0.8.2, and Foundry discards an unknown `system` key when the document is constructed, without a warning, so the value is lost at load while the build reports success. No `itemBuilders` change fixes this: declare the field in the receiving system, or hold this package at a build that does not write it
```

It means the build is running **ahead of the system it compiles for**. Nothing
in the repository's own configuration writes the key, so nothing there can stop
it; the two real fixes are the ones the message names. For `archetype`
specifically that is HeroicLands/Song-of-Heroic-Lands-FoundryVTT#1785 — SoHL
checks against its **own** committed `schema.json`, so merging it is enough and
no release is needed; a module checks against the cached schema of the SoHL
release it pins, so it needs that release.

**The gap.** The emitted-versus-declared check (#60) derives what a build emits
from the `itemBuilders` **field declarations**, so a key a compiler writes on its
own initiative is in neither set it compares and was never compared at all.
That is not a residue: it is `shortcode`, `actionDefs`, `notes`, `docHtml`, and
since #126 `archetype`. #145's authored-`system` check does not reach them
either — it reads `<system>.system`, and these are written rather than authored.
So #126's ordering constraint, stated in the issue and real, was enforced by
nothing: get the order wrong and every compiled document silently loses
`system.archetype`, no check fires, the build is green, and the Create dialog
simply stops finding archetypes.

**Derived by observation, not by a list.** The compilers assemble a `system`
object, so `compareEmittedSystem` reads the keys off what they produced — after
the JSON round trip the pack file actually receives, which is why a key whose
value is `undefined` is correctly not a finding. A compiler that grows a key is
covered on the next build without anyone remembering to add it anywhere, and a
`system` block that is checked is the one that was written.

**Two conditions, because the fixes differ.** Both name the version, as the
existing message already does. A key a `fields:` entry declares is the
consumer's own — change the field's `to`, or get the system to declare it. A key
the compiler writes has no declaration to correct, and the message says so
rather than sending a reader looking through `itemBuilders` for something that
is not there.

**An error, deliberately.** The failure is Foundry's silent discard either way,
and the sibling condition has been an error since #60; making the _less_ fixable
half the quieter one would invert the point. Measured read-only against five
consuming trees, the whole cost is 11 findings in
`Song-of-Heroic-Lands-FoundryVTT` — one `archetype` per subtype, exactly what
#1785 declares. The satellites are unaffected today: sohl 0.8.2 published no
`schema.json`, so there is nothing for them to check against and the check stays
silent, and by the time they pin a release that publishes one the field is in
it.

**A subtree the schema describes no further is not checked.** SoHL's
`strikeMode` is a discriminated `TypedSchemaField`: published as one path,
stored flat as `{ type, name, … }`. Walking into it against a schema that
enumerates nothing beneath it reported all ten of a combat technique's stored
keys — ten findings, every one wrong, about a document that is correct. What the
artifact does not describe is left alone, the same stance the check already takes
on a subtype the artifact does not name.

**Compiled output does not move.** This adds a check, not an emission: the SoHL
tree compiles to the same 3,126 `build/packs-json` files, byte for byte.
