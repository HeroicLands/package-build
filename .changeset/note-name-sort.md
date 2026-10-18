---
"@heroiclands/package-build": patch
---

A note's name may give a `sort` form, the way an index would write it: `sort: Black Flame, The` for _The Black Flame_, or `sort: Hilvan, Doran`. It files the note in the book index, page lists and other name-ordered lists, and it is the note's entry text in the book index; every other list still shows the full name. Authored `sql` fences can order by the new `nameSort` column of `entries`, which is the `sort` form or, without one, the full name.
