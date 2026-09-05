---
"@heroiclands/package-build": major
---

**A `dataview` query that selects no notes is now a build error** (#223).

A zero-row table publishes as a bare header and a rule, so a stale query — a
renamed type, a retired category, a typo'd path — looked exactly like a category
that is legitimately empty. Both builds emitted it and neither said a word.

Where a table is meant to be empty, say so on the fence — `dataview allow-empty`
in place of `dataview`. The opt-in sits on the fence rather than in the query
because it is a statement about the directive, not part of the query language.
The table is still rendered either way: the finding is the point, not
withholding the output.

The finding names the note, the line of the block and **the clause that matched
nothing**, quoted as authored, because that is the string the author will edit.

**The site build's table findings are compiler-parseable too.** They were prose
with a timestamp where a parser reads the path, so one authored table produced a
machine-readable diagnostic from the pack build and something ungreppable from
the site. Both now emit `file:line:column: error: message`.

**Major, because a tree carrying a dead table goes red on adoption.**
`Song-of-Heroic-Lands-FoundryVTT` carries **40**, across eight notes — including
the eight `type = "creature"` tables in `Rules/Bestiary.md` that the issue was
filed about, a `sohl.kbcat = "birthsign"` query for a retired concept, and a
`contains(file.tags, "religous")` that is simply a misspelling. None of them has
published a row in months.
