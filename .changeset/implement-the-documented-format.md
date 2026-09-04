---
"@heroiclands/package-build": major
---

**The linter now implements the format it publishes.** `docs/content-format.md`
and the vocabulary had drifted, silently and in both directions, and nothing
compared them.

**Five documented types reached no schema** — `place`, `lore`, `scenario`,
`vehicle` and `armorlocation`. A note using one was reported as having no
schema and then _skipped entirely_: `lintNote` returns after that finding, so
the note's `data:`, `subType`, references and system block all went
unexamined. So the types were legal enough to author and not legal enough to
check, and using one **suppressed** every other check on the note (#231).

**Three documented `data` properties reached no vocabulary** — `epithet` and
`symbol` on `affiliation`, and `lore` on both `affiliation` and `being`. The
`data:` container is closed, so a note that followed the specification exactly
was told its property did not exist _and the value was dropped_ rather than
reaching the page (#232).

`peoples` is **removed**, having widened to `lore` — the specification says so
outright, and no tree authors it: "Nothing is lost by widening: the target's
own subType already distinguishes a `folk` from a `law`." That removal is the
reason this is a major; everything else here turns red trees green.

Between them, on `sohl-thalorna`: **2,001 findings become 20**. The 1,981 that
go were never content defects. The 20 that stay are: 18 embedded shortcode
collisions and two genuinely stale keys.

**The specification is executable now.** `tests/content-format-agreement.test.ts`
parses `docs/content-format.md` and fails if a documented type has no schema or
no vocabulary, or if a type's declared `data` properties differ in either
direction from its documented table. Nothing compared the two before, which is
why this drift lasted.

Also corrects the specification itself: `macro`'s `macroType` and `macroScope`
were tabled as `data` properties, but the compiler reads them with the
`sohl`-field accessor — the `sohl:` block, then the note's top level — so
`data.macroType` is not read at all. They are `sohl` properties, and the table
now says so.
