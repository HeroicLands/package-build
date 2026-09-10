---
"@heroiclands/package-build": patch
---

**A being's `data.portrait` reaches the actor** (#332). It never had: the
emitters read `blockProperty(fm, "portrait")`, which knows a system block and
the note's top level and never splits a dotted path, so the position the content
format names was invisible to them — and the `?? defaultImg` beside it turned
every miss into the subtype's icon rather than into a complaint. 646
`sohl-thalorna` beings authored a portrait, 341 of them pointing at art that
exists on disk, and every one compiled the generic person icon. Nothing warned.

`portrait` now resolves through the same declaration `data.species` does, in
both the `sohl` and `hm3` actor passes.

**A `data:` source has a retiring top-level spelling, and step 3b reads it.**
`data:` did not invent the facts it holds — it gathered them out of the note's
open top level, where `portrait:` sat beside `img:` — so the pre-`data:`
spelling of `data.<key>` is `<key>`, and until now nothing read it. That is why
this is a resolution-order fix and not a one-line emitter fix: `data.portrait`
had to start working _without_ breaking the top-level `portrait:` that `sohl`'s
own bestiary writes on every note.

The spelling is **derived**, not declared — a second declaration would be a
second place for one fact to live — and only a `data.` source has one, so
`protection.blunt` and `impact.die` resolve exactly as they did.

**Nothing is dropped in silence any more.** A field read from the retiring
top-level key emits a warning naming the line, the counterpart to the existing
in-block report; the note compiles to the identical document either way. The
frontmatter lint's `portrait: ""` check reads the `data:` position too, which it
could not see before.
