---
"@heroiclands/package-build": patch
---

**`content-build lint` and `content-build site` reach the content again** — they
threw on the first note for every consumer.

#243 made `walkMarkdownTree`'s scope a required argument, which was the point:
the default it removed read whichever configuration resolved from the working
directory rather than the one the caller was working under. Two CLI callers had
been living on that default and were not converted with the rest — so both
commands failed immediately, reporting nothing about the tree.

This repository ships no content, so nothing in its suite had ever _run_ those
commands over a tree; every test called the engine directly with arguments it
supplied. A test now builds a small content tree and runs `lint`, `links` and
`site` against it, asserting they reach the notes at all — and that they honour
the configured `skipDirectories` rather than reading a directory the tree said
to skip.
