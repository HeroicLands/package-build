---
"@heroiclands/package-build": minor
---

**The `bundle` note type is specified and declared** (#259).

A bundle is a set of documents taken as a unit — Foundry's `Adventure`, named
for what it is rather than what Foundry calls it. `data.system` says which
system's documents it may hold (`none` by default) and constrains
`data.contents`; a document belonging to neither `none` nor the named system is
left out rather than failing.

**It is not a folder, and the difference is the whole point.** An `Adventure`
carries **copies**: importing one creates or updates each document in the world,
after which they live independently. A folder is a live grouping, by reference,
that persists in the pack.

**Nothing compiles a bundle yet**, and authoring one says so — two decisions
come first. The scenes pass already writes an Adventure per place into a
*companion* pack, and the router refuses a note naming a companion in `pack:`,
so a bundle cannot be routed there; and since an Adventure holds compiled
documents rather than references, `contents` has to resolve after the passes
that produce them.
