---
"@heroiclands/package-build": minor
---

**A `bundle` note compiles into a Foundry `Adventure`** (#259).

#263 specified and declared the type and left it uncompiled — authoring one said
so, in as many words — because two decisions came first, neither answerable from
the specification. Both are settled here, and the pass exists.

**Which pack.** Not the `adventures` **companion**. The scenes pass already
writes one Adventure per pinned place into that pack, and a companion is written
by its parent pass rather than routed to — the router refuses a note that
addresses one, and is right to. So a bundle lands in an ordinary Adventure pack,
routed and defaulted exactly as items and actors are, and the place-adventures
companion is left alone. A repository that authors bundles declares an Adventure
pack of its own; one that declares none is now told so by name, because `bundle`
is in the type table the unclaimed-note check reads.

**What a `contents` address names: the note's own document.** That is already
the router's rule for `pack:`, so there is one answer and not two. A note that
compiles into _two_ documents — an item and the JournalEntry its prose became —
puts the second in a bundle only when the bundle names it by its own `doc…`
address. Nothing is inferred; an address that resolves to nothing fails the
build, and a `folder` address is refused with a message of its own, since a
folder materialises in every pack holding something filed in it and so has no
single copy to take.

**An Adventure holds copies, not references**, so `contents` resolves against
_compiled output_ rather than against the content tree. The pass therefore reads
every other one, and **says so** — `Bundles.readsPackOutputOf` names Item,
Actor, JournalEntry, Macro and Scene, from which the generator derives the
compile order. An Adventure pack declared first in `packs:` still compiles last.

**A pack's `system:` constrains what its Adventures may hold**, and the
constraint is read from what the pack can see rather than computed from a
member's type — which has no single answer for the types both systems map, most
of them. A pack declaring `system: hm3` reads the HM3 packs and the neutral
ones, so a member publishing no HM3 document is **left out rather than
failing**, with a warning naming it. A pack declaring no system scopes nothing
away, so a member it cannot find is a dead address and fails.

**The note's prose becomes the Adventure's `description`** — the `HTMLField`
Foundry renders on the import card. A bundle is something you hand someone, so
its prose belongs on the document itself, which is why it earns no separate
documentation journal the way an item does. That was #263's third open question.

**A prebuilt pack is passed over rather than compiled.** Its per-document JSON
is checked in, so it has no pass and no note is routed into it — which
`content-config.mjs` already said by refusing `default: true` beside `prebuilt`.
It could not matter before: the only prebuilt pack in the wild holds Adventures,
and no compiler was registered for that document type, so it failed with "no
compiler for document type" whatever it was asked. Now one is registered, and
running a pass over it would wipe its generated JSON directory, write nothing,
and then report the empty pass as an error.
