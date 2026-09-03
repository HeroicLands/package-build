---
"@heroiclands/package-build": minor
---

**A map is one type, and the three spellings are its subTypes.**

`docs/content-format.md` has always described a map that way, and said why:
_the three differ only in the canvas defaults derived for them, which is why
they are subTypes of one type rather than three types._ The implementation
declared the opposite, so a map note written to the specification was refused
with `no schema is declared for content type "map"`.

The three names cost three entries in the pack router, three in the claims set,
three in `NOTE_SCHEMAS`, and three in every consumer's `sections` config — for
one idea. `mapProfile()` now keys the derived canvas off `subType`, which is
the one thing the spellings ever decided, and `MAP_SUBTYPES` names them.

`battlemap`, `localmap` and `regionalmap` join `RETIRED_TYPES`, so a note or a
link still writing one is **told what to write instead** rather than routed
silently to the items pack — the treatment `character` and `creature` got.

**`data.place` is declared**, closing a second gap in the same table: the link
from a map to the place it depicts was specified and not declared, so authoring
it was an error. It is named on the map and not on the place, because a place
has several maps and a map depicts one place.

Closes #174
