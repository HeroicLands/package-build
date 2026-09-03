---
"@heroiclands/package-build": patch
---

**A `README` landing may name any section that exists, not only a configured one.**

#197 widened a landing's `subType` check by one term and it was the wrong one:
the sections the repository configures in `site.sections` /
`site.readmeSections`. That keys on configuration a consumer may legitimately not
have. `sohl-thalorna` has **no `site:` block at all** — it renders its site
through a local fork of the emitter — so `declaredSections` answered `[]`, the
accepted set collapsed back to the three `doc` genres, and five of its landings
were still refused for naming their own content type:

```text
assets/content/Characters/README.md:7:1: error: `subType` "being" is not one of the subtypes doc declares (rules, user-guide, reference)
```

A landing's `subType` is an **address**, so it is now checked against the
addresses that exist — the range of `sectionOf` over every note the format
permits, plus whatever the repository names:

1. **Every content type the specification declares.** `sectionOf` returns
   `fm.type` for a non-`doc` note, so `being`, `lore`, `scenario` and
   `weapongear` are sections _by construction_, configured or not.
2. **The type's own subtypes** — `rules`, `user-guide`, `reference`.
3. **The configured sections**, which may name one that is neither: `sohl` has
   `credits` and `dev-docs`.

**The guard survives.** A misspelling is in none of the three, so it still fails,
and the near miss is drawn from the whole union. What is deliberately no longer
caught is a landing for a section that exists but is currently empty — which is
legitimate, and is why the set is the types the format _declares_ rather than
those _present in the tree_: `sohl` ships two such landings above tables that
stay empty until the first note of each type does.

**The type list is the specification's, not the schema map's.** `NOTE_SCHEMAS`
declares 18 types and `docs/content-format.md` declares 23; `lore`, `place`,
`scenario`, `vehicle` and `armorlocation` are in the second only. Checking an
address against the schema map would refuse `Lore/README.md` for a reason that
is not about addresses, and would report one gap twice in two vocabularies.
Whether a note's fields can be checked is a different question, answered
elsewhere and reported on the notes themselves.

`lintNote` / `lintFrontmatter` take a `types` option beside `sections`; both
default to empty, so a caller that passes neither is unaffected.

Closes #200
