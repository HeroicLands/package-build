---
"@heroiclands/package-build": minor
---

Mark a link whose target is tagged `draft` (#183).

A note that exists only so a link is not dead is now visibly distinct from one
that is written. Both builds wrap such a link in
`<span class="sohl-draft-link" title="Draft — not yet written">…</span>` —
byte-identically, as `unresolvedLink` already does, so one authored link carries
the same cue in a compiled journal and on the website. The link inside is
untouched: Foundry enriches inside HTML and Goldmark parses markdown inside an
inline span, so it is still a live link either way.

**The note stays in the graph.** This marks at presentation and nothing else.
Resolution, validation, pack compilation and manifest membership are unchanged
for a draft note, which is what separates the tag from the retired `draft:`
field — that field moved a note from _published_ to unresolvable without saying
so, and suppressed the build failures the note carried. Nothing here reinstates
any of it, and declaring the field is still refused by name.

**Read from the tag vocabulary, not respelt.** `draft` is declared in
`DECLARED_TAGS.state` (#172) and exported as `DRAFT_TAG`, with `isDraftNote()`
as its one reader — so the declared tag and the thing that acts on it cannot
drift apart. This is the first thing in either build to read `tags`.

**For consumers.** The class carries no appearance of its own. A Foundry system
supplies it in an SCSS partial beside `_unresolved-link.scss`; a site supplies
it in its theme. Until one does, a draft link renders exactly as it did before.
