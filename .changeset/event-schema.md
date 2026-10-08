---
"@heroiclands/package-build": minor
---

**Events**

- An event entry is checked in full: a key or value the format does not admit, a missing `summary`, or an address naming nothing is now an error at that line.
- A note holding several events gives each an `id`, and `follows` names an earlier event, never a later one or a loop back.
- Places and affiliations can carry events too — a settlement's raising, an order's founding.

**Anchors**

- An address may name one event in a note as `place-ironfells#sack` where a field accepts it; every other address field refuses a `#` anchor.
- An event's `id` shares its note's anchors, so an `id` repeating a heading's anchor is an error.
- The published content index now records each anchor's kind and each note's events, so build a package and the packages it depends on with this version.
