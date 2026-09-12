---
"@heroiclands/package-build": minor
---

Four rules, all of them about a note being renderable into a book.

**A package declares its own icons.** A new `icons:` configuration key merges
over the shipped table rather than replacing it, so a consumer adds one glyph
without restating the shared vocabulary, and a declared name wins where it
spells a shipped one. This is what makes a second family usable: the shipped
table is Font Awesome throughout, and the Game-Icons glyphs an interface draws
come from a webfont the consumer builds for itself, so only the consumer can
name them. The registry is validated at configuration time — a bad table makes
every finding downstream unreliable in the same way.

**Raw HTML in a note's prose is reported.** There is no route from `<p>` to a
PDF: the packs and the website pass HTML through, and Typst is handed markdown
and knows none. A fenced block or a code span is an example and is not
reported. A warning, like the checks beside it.

**A note may not author a key the compiler derives.** `sohl.system.docHtml`
holds the `@UUID` of the JournalEntry the note's prose compiled into, and the
compiler writes it unconditionally — so an authored one is overwritten, or ships
prose where every reader expects a pointer. Each pass declares its own derived
keys, so the rule is the general one rather than a list of names.

**A SQL table selecting nothing renders its header and rule** rather than
nothing at all. The finding is the point, not withholding the output: a heading
with an empty table under it says the query ran and matched nothing, where a
heading with nothing under it reads as a page that failed to build.
