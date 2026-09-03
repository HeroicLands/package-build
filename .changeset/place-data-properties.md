---
"@heroiclands/package-build": minor
---

Reduce a `place`'s `data` properties to what is true of ground, and let a map name
the place it depicts (#164).

Eight properties become four. Measured against the 246 authored place notes,
three of the eight were used by **no note at all**, one was declared as the wrong
type, and two were the wrong end of a relation.

**`languages` is a fact about a polity.** A place's languages change when its
ruler changes, which is what makes them the ruler's property; `commonSkills` on
the affiliation already holds them. The corpus agrees — of 206 places carrying
`languages`, 190 were settlements and 16 were regions, and not one was a site, a
structure or a feature, because a ruin has no language.

**`peoples` widens to `lore`.** It was the only lore-pointing property a place
had, so a place with a calendar, a body of law or a local history had nowhere to
cite it. The target's own subType already distinguishes a `folk` from a `law`,
which is the same reason `affiliation` carries no `pantheons`.

**`demonym` is a `string`**, which is what all 24 uses are and what
`affiliation.demonym` has always been.

**`summary` duplicated the top-level `description`** — no note carried it.

**`affiliations` and `maps` were authored from the wrong end.** `affiliations` is
the inverse of `affiliation.domains`, which 91 polities populate and no place
does; a relation authored from both ends drifts the moment one is edited. `maps`
moves onto the map, which gains a `place` property — optional, because an
encounter map depicts no named place, but that is the exception the map section
already describes. A place's maps are now derived: every map whose `place` is
this one.
