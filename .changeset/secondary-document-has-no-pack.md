---
"@heroiclands/package-build": minor
---

**A note whose secondary document has no pack is now a finding, instead of
losing that document in silence.**

A note produces more than one document as a matter of course: an item note an
Item and the JournalEntry its prose becomes, a map note a Scene and a
JournalEntry, an actor note an Actor and a JournalEntry since #337. Where the
configuration declares no pack for one of them, that document was dropped while
the rest of the note compiled into a pack that does exist. The build succeeded,
the compendium shipped, and the missing half was discoverable only by noticing
it was not there.

#146 already reports a note **nothing** claims, and could not see this: it asks
one question of the whole configuration — does any pack claim this type — and a
note that compiles its Item into an Item pack answers yes.

> a note of type "being" compiles into a JournalEntry as well as an Actor, and
> `packs:` declares no JournalEntry pack — so the JournalEntry is dropped with
> no error while the rest of the note compiles. Declare a JournalEntry pack in
> package-build.config.yaml, or accept the loss deliberately by not authoring
> what it would have carried.

The message names the note, the class with no pack, and the class that did
compile — the last because it is what tells the two findings apart at a glance:
one is a `type:` to correct, this one a pack to declare.

**Asked per note, not per type**, which is the difference between a useful
finding and a useless one. `Journals` declines a doc-carrying note whose body is
empty — an item with no prose gets no doc — so whether an item note produces a
JournalEntry is decided by the note. `sohl-kethira-basic` declares no
JournalEntry pack and ships 393 notes whose descriptions are _deliberately_
empty under the Fan Material Guidelines its configuration explains at length; a
type-level answer would report every one of them for losing a document none of
them produces. It reports none.

**It names no system**, so a type one system maps and another does not stays
silent for the system that declines it, per #79. That holds by construction: the
`Item` and `Actor` rows fold the systems' maps together before this sees them,
so a type appears once or not at all and no system is ever named.

**What it finds today.** `Song-of-Heroic-Lands-FoundryVTT` and `sohl-thalorna`
report nothing — every document their notes produce already has a pack.
`harn-ensemble` reports 2,512: it declares two Actor packs and no JournalEntry
pack, so every one of its beings has been losing the `{#appearance}` and
`{#dossier}` prose it carries. When the issue was filed no tree authored the
affected combination; one does now.
