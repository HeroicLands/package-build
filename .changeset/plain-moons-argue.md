---
"@heroiclands/package-build": minor
---

`content-build lint` now holds a content tree to a character allowlist, so a
book can choose its typeface without discovering at print time that no font
carries what the notes are written in.

Typst does not warn when a glyph is missing — it falls back to whatever system
font has one and exits 0, so a rules table can set in three unrelated faces and
the build still reports success. The check moves that failure back to where the
character is written.

The tiers are measured rather than chosen: eight candidate book faces were
probed over every non-ASCII character in the five content trees, and what is
admitted is what enough of them carry. Letters and typography are universal;
Latin Extended Additional is carried by seven of eight; IPA was considered and
refused at five of eight, because requiring it would cost font freedom rather
than buy it.

Two rules ride along that an allowlist cannot express. Content must be NFC — a
decomposed letter is a different string to every byte comparison, including
DuckDB's `=`, so a filter typed one way silently misses a note stored the other.
And box-drawing, geometric and arrow characters are permitted inside a fenced
code block only, where the mono face sets them.

Part of #377.
