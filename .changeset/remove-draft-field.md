---
"@heroiclands/package-build": major
---

Remove `draft:` from a note's frontmatter (#69).

The field excluded a note from the compiled packs, from the link manifest and
from a consuming site build — and **nothing reported the consequence**.
`content-links.mjs`, `site-index.mjs` and `content-lint.mjs` never read it, so a
wikilink into a drafted note was indistinguishable from a link to a note that
does not exist, and no checker could say which. Its entire effect was to move a
note from _published_ to _unresolvable_, in silence. It also suppressed real
build failures: a note the compilers never reached could not fail on the defects
it carried.

Nothing used it. Across every HeroicLands content repository — `sohl`,
`sohl-thalorna`, `sohl-kethira-basic`, `harn-ensemble`, `harn-adventures` — not
one note declared it.

**What changed**

- The three readers are gone: the compile loop, the link-manifest walk, and the
  scenes pass's map collection. So are the `skippedDraft` tally, its `PassStats`
  field, and the `Skipped N draft(s)` log line.
- A note declaring `draft:` now **fails the build**, naming the file and the
  line, whatever the value says — `draft: false` included, since it reads as
  "publish this note", which is what happens either way. A field left merely
  ignored reads to its author as though it still works, which is the same
  silence in a different place.
- `content-build lint` reports it too, so a whole tree is answered at once
  rather than one note per build.

**The `draft` _tag_ is untouched.** It is an authoring marker, read only by the
generated-table pass for `FROM #draft` queries, and 268 `sohl-thalorna` notes
carry it. An unfinished page is honest about being unfinished; a dropped link is
silent.

**Adopting**

Nothing to sweep — no note in the org declares the field. A consumer that
carries one deletes the line.

This lands in the same major as the `package:` rejection (#56 step 3), so the
two retired fields are one adoption rather than two. They are refused the same
way, through the same diagnostic format and the same positioning, and the
locator both need is now shared rather than written twice.
