---
"@heroiclands/package-build": minor
---

**The `bundle` note type is specified and declared** (#259).

A bundle is a set of documents taken as a unit — Foundry's `Adventure`, named for
what it is rather than what Foundry calls it. It declares one property of its
own, `contents`: the documents it holds.

**How many Adventures a bundle makes is decided by its system blocks**, as for
every other type, rather than by a property of its own. With no system block it
is one Adventure holding only the `none` documents; with one or more it is one
Adventure per system, each holding every `none` document plus that system's own,
and a document of neither is silently left out.

Each Adventure is written to the pack the note's `pack` names — **the shared
routing field, not a property of the bundle**, so there is one spelling and not
two. It differs only in its default, `adventures`; `<system>.pack` overrides it
per system exactly as it does everywhere else.

That follows from Foundry rather than from taste: **an `Adventure` has no
`system` field**. A bundle spanning two systems cannot be one document that knows
it spans them, so it is one document per system and the pack each is written to
is what carries the system.

**It is not a folder**, and the difference is the whole point: an Adventure
carries **copies**, and importing one creates or updates each document in the
world, after which they live independently. A folder is a live grouping, by
reference, that persists in the pack.

**Nothing compiles a bundle yet**, and authoring one says so. Two decisions come
first: the scenes pass already writes an Adventure per place into a _companion_
pack and the router refuses a note naming a companion in `pack:`, so the
`adventures` default cannot be that pack as things stand; and since an Adventure
holds compiled documents rather than references, `contents` has to resolve after
the passes that produce them.
