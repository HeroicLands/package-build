---
"@heroiclands/package-build": minor
---

**A `README` landing's `subType` is checked against the sections the repository declares, not the genre list.**

Two vocabularies were spelled with one key. For every note, `subType` is a
sub-kind of its type, checked against a closed list. For a `README` under
`publish.address.landing: readme` it is additionally the **URL section** —
`sectionOf` reads a `doc`'s `subType` as the segment the landing addresses — and
that is an open set the consuming repository names in `site.sections` /
`site.readmeSections`. `engine/frontmatter-lint.mjs` applied the closed reading
while `engine/content-address.mjs` applied the open one, so the two halves of the
toolchain disagreed about the same note: `content-build site` addressed and
published `Weapons/README.md` at `weapongear/`, and `content-build lint` refused
it because `doc` declares only `rules`, `user-guide` and `reference`. An item
section's landing was not expressible.

The check now widens **for a landing only**, and only under `landing: readme`: a
`README` whose `subType` is its section may name any section the repository
declares, as well as any of its type's own genres — a genre is a section a `doc`
tree publishes under whether or not the repository describes it, so narrowing to
the configured set alone would refuse a correct `README`. An ordinary note's
`subType` stays closed to its type's genres, unchanged.

**The guard survives**, checked against the set that actually decides where the
page goes:

```text
Weapons/README.md:4:1: error: `subType` "weapongeer" is the section this README
lands at, and nothing declares it: it is neither a section this repository
configures under `site.sections` / `site.readmeSections` (rules, user-guide,
weapongear, …) nor one of the subtypes doc declares (rules, user-guide,
reference). Did you mean "weapongear"?
```

Whether the value is an address is asked of `sectionOf` rather than by naming a
type, so the linter still knows no type names of its own; the section list is
read from the resolved configuration the site build renders those landings from,
through a new `declaredSections(config)`, so neither can name a section the other
does not.

_Minor rather than patch_: `lintNote` and `lintFrontmatter` take two new
options (`landing`, `sections`) and `content-config.mjs` exports
`declaredSections`. Both options default to today's behaviour, so a caller that
passes neither — and a repository that declares no sections — is unaffected.

Closes #197
