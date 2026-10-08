---
"@heroiclands/package-build": minor
---

**Events**

- An event entry is checked in full: a key or value the format does not admit, a missing `summary`, or an address naming nothing is now an error at that line.
- Each address in an event must name the kind of note it describes: a participant is a being, affiliation or lore note, and a place is a place.
- A note holding several events gives each an `id`, and `follows` names an earlier event, never a later one or a loop back.
- Places and affiliations can carry events too — a settlement's raising, an order's founding.
- Recurring events no longer show their next occurrence in a note's infobox.

**Anchors**

- `follows` and `attributedTo` name one event in a note as `place-ironfells#sack`; every other address field refuses a `#` anchor.
- A wikilink to an event's `id` is an error: link to the note instead. An event's `id` repeating a heading's anchor is an error too.

**Published content index**

- Every address in the published content index is now an object of `address`, `anchor` and `anchorKind`, so build a package and the packages it depends on with this version. SQL tables still show addresses as plain text.
