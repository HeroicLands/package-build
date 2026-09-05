---
"@heroiclands/package-build": major
---

**A content-index record's Foundry address is keyed by the system that compiles
it.** `foundry.uuid` becomes `foundry.<system>.uuid` for a document a _game
system_ defines — an Item or an Actor — while a document the _note format_
defines keeps the unkeyed form.

```json
"foundry": { "sohl": { "uuid": "Compendium.sohl.items.Item.…" } }         // an item
"foundry": { "none": { "uuid": "Compendium.sohl.journals.JournalEntry.…" } } // a journal
```

The vocabulary is the specification's — `sohl`, `hm3`, and **`none`** for a note
that belongs to no system, the same value the canonical address carries in its
`<system>` segment (`harnadventures-none-being-grod`, #59). Every record is
keyed, so "belongs to no system" and "nobody filled this in" are not the same
shape.

**A note may declare more than one system**, and each compiles into its own
document, of that system's type, in that system's pack: 2,497 of
`harn-ensemble`'s notes carry both a `sohl:` and an `hm3:` block, and its
`packs:` declares an `actors-sohl` _and_ an `actors-hm3`. One `uuid` on the
record cannot name two documents — it named whichever the single shipped map
produced and said nothing about the other.

Only `sohl` can appear today, because `KNOWN_DOCUMENT_SUBTYPE_MAPS` holds one
map and #139 tracks the missing `hm3/` half. **The shape changes now so that
adding it is one more key rather than a second breaking change** to an artifact
consumers have already started reading.

**A journal, a macro or a scene is `none`.** Those are the note format's own
documents rather than a system's, and the documentation journal an item
compiles beside itself is `none` too — it is one journal however many systems
the item declares. On `sohl` that is 1,474 records keyed `sohl` and 1,514
keyed `none`.

The uuid _values_ are unchanged: still equal to the link manifest's, verified
across `sohl`'s 2,988 addresses with no mismatch.

**Not synthesized onto the `sohl:`/`hm3:` blocks themselves.** Those are regions
a note authors, and `DERIVED_KEYS` — which refuses a note that writes over
derived data — reaches only the top level. A note authoring `sohl.uuid` would
collide silently, which is the failure this index exists to prevent.
