---
"@heroiclands/package-build": major
---

**A note's own `title` no longer fills an affiliation's `system.title`** (#218).

The two were never the same quantity. A note's top-level `title` is _the title
of the note_ — the heading its page is published under, which the site emitter
reads. An `affiliation` item's `system.title` is _the style of address the office
carries_ — Ajaw, Warden, a person's style within the body. They collided only in
spelling, and field resolution's third step, the shared top-level property, fed
the second from the first.

That step also answers **without** applying the field's default — only the
in-block step does — so an authored `title: null` reached the `String()` coercion
unguarded and compiled to the literal string `"null"`. Fifteen `sohl-thalorna`
notes shipped `"system": { "title": "null" }` that way.

**Nothing in any content tree relied on the fallback.** Across all three
consumers — 295 `affiliation` notes in `sohl-thalorna`, 28 in
`sohl-kethira-basic`, none in `sohl` — not one carries a non-empty top-level
`title`, and `content-build package compile` emits byte-identical
`build/packs-json` for all three. It is a major because the rule that decides a
consumer's compiled documents changed with no configuration to restore it, and
because the generated item-field reference moves (below).

**The field is still authorable**, at the two positions that describe the
document rather than the note: `sohl.system.title`, and the legacy in-block
`sohl.title` that most trees already write. A membership's title belongs on the
entry in a being's `sohl.items`, as its `system.title`. `data.title` is neither —
`title` is not a `data:` property any note type declares, so `content-build lint`
refuses it.

**Declaring the exemption:** a field in an `itemBuilders` `fields:` declaration
may now carry `topLevelMeans`, whose value is _what the note's top-level key of
that name means instead_. Declaring it removes the shared top-level position from
that field's resolution order, and the generated item-field reference prints the
reason beneath the type's table, so an author reading it learns that the
top-level key will not fill the field. A repository that commits that page should
regenerate it.

The value is the reason rather than a bare flag deliberately: a boolean would
record the decision and lose the case for it, and the next person adding a field
needs to know the question exists.
