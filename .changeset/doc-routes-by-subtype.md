---
"@heroiclands/package-build": patch
---

Route a `doc` note by its subtype, not by the retired `category` key (#168).

`sectionOf()` read `fm.category`, and a `doc` is the one type that routes by its
subtype label rather than by its type — so when the content format retired
`category`, every `doc` note began answering `undefined` and, as the function's
own documentation says, _a `doc` with no section has no address and is not
published_. `sohl-thalorna` has 24 such notes and `sohl` has 128. The site build
emitted fewer pages and exited 0.

Two further call sites read the same key: `landingOf()` tested
`category === "collection"`, so a collection stopped being a landing page and its
authored `section` — which is its URL segment — was ignored; and `site-build`
fell back to the tree's section rather than the note's.

Four tests now cover a `doc` of each subtype, and one asserts that a note
carrying the retired key gets no section at all — the regression was visible only
by reading the source, which is what a test is for.
