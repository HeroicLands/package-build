---
"@heroiclands/package-build": patch
---

**A note-level frontmatter check no longer answers from a system field that
merely shares the name** (#312).

`topLevelMeans` exists because one spelling can name two unrelated quantities. An
`affiliation` item's `system.title` is the style of address an office carries —
"Ajaw", "Warden"; a note's top-level `title` is the heading its page publishes
under. The field declares the collision, and `resolveFieldValue` honours it by
refusing to read the top level for that field.

The frontmatter lint did not. `authoredValue` resolved every check through the
`sohl:` block first, so the blank-heading check — whose emitter is `fm.title ??
name`, the note's top level and nothing else — read `sohl.title` and found the
office's style of address. An office with no style of address is ordinary, and
each one was reported as a page published with no heading, sorting to the front
of its section.

**The statement is symmetric, and is now read that way.** If two positions hold
unrelated quantities then the in-block position is not the note-level field
either, so a note-level check reads past a block key the note's own type claims
for something else. The exemption is still the field's own declaration rather
than a name the linter knows: `collidingBlockKeys` asks the schemas the caller
supplies, so the linter and the resolver cannot disagree about which field
declares one.

**The art fields are checked the same way.** `img` and `portrait` keep resolving
through the block, because that is what their emitter does — `blockProperty`
reads `sohl.img` first, so a `sohl.img: ""` really does ship a document with no
art and is still reported. What changes is that a future system field of either
name cannot quietly answer for the note's own art; a map's was `sohl.image`
until #142.

**What a consumer sees.** Twenty-eight fewer warnings on an unswept
`sohl-kethira-basic` — every affiliation writing `sohl.title: ""`. All were false
positives; their pages took `name.full` throughout. A tree already swept onto
`sohl.system.title` was unaffected either way, which is why the findings
disappearing looked like a lint regression in that sweep rather than the
false positives going away.
