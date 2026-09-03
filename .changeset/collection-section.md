---
"@heroiclands/package-build": patch
---

Declare `section` on a `doc` of subType `collection` (#170).

The address engine already reads it — a collection is a section's landing page,
and `section` is the URL segment that page occupies — but the specification never
declared it, so nothing could check it and an author had no way to learn it
existed. Fifteen notes in `sohl-thalorna` carry it.

Two things the declaration says that the code alone did not. **Two collections may
not claim the same segment**, so a collection listing a _subset_ of a section
names none and falls back to its own slug: five of that tree's collections list
places and three list affiliations, and they cannot all be `/place/`. And it is
**authored rather than derived** because a note's title is presentation — a
collection called "Creatures" heads the `being` section, and slugging the title
would put it somewhere else.
