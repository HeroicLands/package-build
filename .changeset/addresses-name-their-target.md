---
"@heroiclands/package-build": minor
---

**Affiliations** — a `seat`, a `parents` list, a `domains` list and a `relations`
map written under `data:` now reach the compiled item, so an affiliation carries
the place its authority sits in, the bodies it answers to, the places it holds
sway over and its standing toward other societies. Every affiliation shipped
these empty whatever its note said, so a setting's compiled packs change without
a word of its content changing, and anything reading those fields — a sheet, a
chat card, a rules outcome — begins seeing them. Every other field the format
maps out of `data:` is read from there too: a gear item's weight, worth,
craftsmanship and durability, an affliction's and a trauma's timed phases, and a
mystery's charges and skill aptitudes. Writing one at its destination still wins.

**Addresses** — a field that points at another note names it by _address_,
written at whatever length says what it means: a note in another package in
full, one in this package by its shortcode alone, with the compiled document
carrying the shortcode the game reads either way. A value naming the wrong kind
of thing now says so, instead of compiling into a reference that resolves to
nothing — a `seat` or a `domains` entry that is not a place, a `parents` entry or
a `relations` key that is not an affiliation, a border's or a route's `to` that
is not a place.

**Art** — `icon`, `tokenIcon`, `bgImage` and `banner` each accept an `icon` or an
`image` address, whichever one they default to, so a deity's profile art can be a
full illustration rather than a game icon. Any other type, an `audio` address
among them, is now an error naming what the slot accepts rather than a silent
fall back to the document's default art.

**Shortcodes** — `assocSkillCode`, `assocAffiliationCode` and `parentSkillCode`
name another item by its bare shortcode, resolved among one actor's own embedded
items, where a qualified value can never resolve. Such a value is now refused
with that reason rather than reported as a dead reference, and no authored value
in any tree carries one today.

**The specification** names three different things where it had one word: an
`Address` is the `package-system-type-shortcode` tuple, written at any of its
lengths; a `Shortcode` is one segment, never expanded, which is what a mystery's
`skillAptitudes` keys are; and a wikilink is `[[<Address>[#<anchor>]|<text>]]`,
whose brackets, anchor and label belong to prose. It states one rule for a bare
value, where it had stated two that could not both hold: the type comes from the
field's own declaration — its default where it has one, and a refusal naming the
accepted types where it has none — never from what the rest of the tree happens
to contain.
