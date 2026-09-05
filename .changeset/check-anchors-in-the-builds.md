---
"@heroiclands/package-build": minor
---

**A `#section` link is checked by the build that emits it, not only by the
checker** (#193). `content-build links` reported a dead anchor as an error while
the pack compilers hashed _any_ slug into a `JournalEntryPage` id and emitted a
`@UUID` for it — so a link the checker refused still compiled, and dead-ended
for the reader.

A **foreign** anchor was already checked, because a vendored manifest publishes
an `anchors` map. A local one was not, for the reason #193 gives: neither index
held the set. The walk that builds the link index yields each note's body and
nothing read it.

It reads it now, through the one anchor reader, and reports `unknown-anchor`
with the message the foreign path already used — nothing new is named.

An index built without anchors still says nothing, which is deliberate: it
cannot answer the question, and answering it wrongly is what this fixes.

`collectAnchors` moves to `engine/anchors.mjs`, a module that imports nothing.
It has to: the link checker, the content index and the compilers all ask this
question, and `helpers.mjs` is imported by the compilers while the index imports
the manifest emitter, which imports them back. A leaf is what lets all three
share one reader instead of two disagreeing ones.
