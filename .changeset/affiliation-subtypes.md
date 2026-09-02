---
"@heroiclands/package-build": minor
---

**Affiliation subTypes: `spirittradition` added, `pantheon` removed.**

A totemic or ancestor cult had nowhere to go. `faithtradition` is defined as
concerning _the divine_, and `sohl-thalorna` carries 47 affiliations that are
not — 44 animal totems plus `Nyaluba_Spirits`, `The_Kindred` and `Astrokyklos`.
Folding them into `faithtradition` would also have collapsed the partition
`MYSTICALABILITY_SUBTYPE` distinguishes the spirit families by, and a picker
filter is only as useful as the partition it filters on. `spirittradition` is
worded symmetrically with its two siblings.

`pantheon` is gone because it answered a different question from every other
value. The rest state _what kind of body this is_; `pantheon` stated _where it
sits in a hierarchy_. A pantheon is a `faithtradition` carrying subordinate
faith traditions, and that hierarchy is already authored — 77 divine
affiliations carry a `pantheon:` key holding an affiliation shortcode which
resolves on all 77, while `parents` is set on none of them.

**No content changes.** None of the eleven values is authored anywhere yet, so
removing one and adding another costs no note an edit.

Closes #157.
