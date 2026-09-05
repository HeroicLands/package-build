---
"@heroiclands/package-build": minor
---

**`place`, `lore` and `scenario` compile into JournalEntries.** They are in the
published content format and #233 declared them for validation, but nothing
routed them: `PACK_BY_TYPE` did not name them, so the open-set default sent
them to the items pack, and the journals pass did not select them. A note of
one lint-ed clean and then compiled into nothing (#241).

`sohl-thalorna` could not compile a single pack for exactly this reason — 450
errors, and _the same 450_ the linter had reported before it learned the types.
The count being identical is the tell: nothing about the content changed, only
which gate noticed. It now compiles 642 actors, and what remains are unrelated
content faults.

The three are declared once, as `JOURNAL_TYPES` in `engine/ids.mjs`, and read
from there by the pack router, the journals pass and the claim table — so the
three cannot disagree about what a journal type is. The drift guard that
asserts the claim table and each pass's `selects` agree is what caught them
disagreeing while this was written.

**They carry no synthesized `doc<type>` entry**, which is the distinction the
new name makes explicit: a journal type's whole document _is_ the journal, so
there is no second document to address and nothing spells `docplace`. That is
different from an item, a macro or a map, whose prose becomes a journal
_beside_ another document and is addressed as `doc<type>`.
