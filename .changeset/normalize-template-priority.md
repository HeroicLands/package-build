---
"@heroiclands/package-build": minor
---

**The template priority is read as `templatePriority`, and `archetype` is
retiring** (#266).

The number deciding which of several competing templates the Create dialog
offers was called `archetype` — one letter from `archetypes`, which is a list of
what _sort_ a character is. A priority and a taxonomy cannot be told apart by a
plural `s`.

Both spellings are read, `templatePriority` winning, and the retiring one draws a
warning rather than an error: the note compiles identically either way, and
**5,727 notes across four trees** author it.

It is read from `data.templatePriority` first, which is where the specification
puts it and where `sohl-thalorna` already writes it on 941 notes — so a tree that
has authored forward is read from the key it authored.

**A note declaring both spellings with different values is refused.** That is not
hypothetical: **145 of those 941 say `templatePriority: null` where `archetype:
0` says the opposite** — "not a template" against "a template at priority 0".
Preferring either silently would decide that for the author, so the build names
both values and asks. `0` and `null` are distinct and both valid, which is
exactly why a note cannot claim both.

The emitted field is unchanged: SoHL's data model still declares
`system.archetype`, and `Song-of-Heroic-Lands-FoundryVTT#1836` renames it there.
