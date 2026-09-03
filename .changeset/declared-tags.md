---
"@heroiclands/package-build": minor
---

Declare the tags that classify, and say that every other tag stays open (#172).

`tags:` lives at the open top level, and most tags belong there: a theme, a
region, a working state is the author's own. **A tag that classifies the subject
is different, because something queries it.** A settlement tagged `village`
appears in the list of villages and an untagged one does not, so `vilage` does
not merely look wrong — it removes the note from an index, silently, while the
index still renders a table that looks complete. That is the failure the closed
`data:` container was introduced to end, in a region that is still open.

Four groups are declared: a place's **kind** (`city`, `town`, `village`, `port`,
`fortress`, `hall`, …), its **character** (`fortified`, `temple`, `market`,
`fishing`, `coastal`, …), its **scale** (`continent`), and a note's **state**
(`draft`).

**Kind and character are separate because one slot could not hold both.** The
single-valued field these replaced ran to 101 values over 196 notes, 72% of them
used exactly once, because `Fishing Village` and `Market Town / Seat of Local
Nobility` each had to be a value of its own — and a query for villages found two
of the eleven that existed.

**A continent is a region carrying a tag, not a subtype**, because structurally it
is a region: the same fields, the same parent chain, everything but scale.

**And the declaration is checked.** `lintFrontmatter` reports a tag that is a near
miss for a declared one — `vilage` for `village` — while leaving every other tag
alone, because the region is open and a theme or a region is the author's own.
The group's **scope** is what makes that sound rather than noisy: distance alone
was wrong on all eight notes it touched in `sohl-thalorna`, since `azravan`,
`barter` and `secret` each sit a typo's distance from a place tag while sitting
on a faith, an economy note and three lore notes. Scoped to the types each group
applies to, both authored trees report nothing.
