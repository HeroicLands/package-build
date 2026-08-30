---
"@heroiclands/package-build": minor
---

Refuse `name`, `shortcode` and `id` on a `type: homepage` note (#53).

A note's URL derives from `name.full` and its identity from `(type, shortcode)`.
The homepage is the one page for which neither holds — it publishes at
`/<package>/`, fixed by the package id — so an author fluent in the conventions
writes them there expecting exactly what they do everywhere else, and gets none
of it. Until now `content-build lint` ignored all three: a homepage carrying
`shortcode`, `id` and `name.full` passed at exit 0.

**They were never inert, which is why ignoring them was the wrong answer.** A
`shortcode` puts the note in the address index and in the `dataview` link
universe, so `[[homepage-<shortcode>]]` resolves _green_ — to `homepage/<slug>/`,
an address derived from `name.full` and published by nothing, because a homepage
is written to `_index.md` at the package root. A build that reports a live link
to a 404 is worse than one that says nothing.

**The inflated address tally is the same defect, not a second one.** The same
note was counted as an address it does not publish, so the lint and the link
manifest disagreed about what the package ships: SoHL's tree reports
`1607 address(es) across 1607 note(s)` with a `shortcode` on its landing and
`1606 address(es) across 1607 note(s)` without one. The tally is only ever
printed on a clean run, so refusing the field is what makes the count honest —
`lintContentTree` needed no change, and got none.

**A named class, not an allow-list, and that boundary is the decision.** An
unknown top-level key is deliberately still accepted. A homepage's frontmatter is
emitted into the published page, so an unrecognised key is a Hugo or theme
parameter this build has never heard of and has no standing to reject, and a
closed list would make every new theme parameter wait on a package-build release.
What is refused is the class that makes a false claim about _where this page is_.
`aliases` is not in it either — it is already dropped from every emitted page, so
authoring one here is the same no-op it is anywhere else. This departs from the
issue's third acceptance criterion, deliberately: over-strictness here breaks
authoring on a page whose whole frontmatter is pass-through.

**Where it fires: `content-build lint` only.** This is a frontmatter-schema rule,
and `content-build site` runs none of them; wiring one type's field rule in there
would have the site build refuse `shortcode` on a homepage while accepting
`weight: heavy` on a weapon. The gap that leaves is `HarnMaster-3-FoundryVTT`,
which runs no `content-build lint` at all and so receives no frontmatter finding
of any kind — a missing script in that repository rather than a rule to duplicate
one at a time.

Each finding is located at the offending key and says what the field would have
decided:

```text
assets/content/homepage.md:26:1: error: `shortcode` decides nothing on a `type: homepage` note: this page's address is the package's own, `/<package>/`, fixed by the package id. It is not ignored either — it puts the note in the address index, so `[[homepage-<shortcode>]]` resolves to a page the site build never writes. Delete it
```

**Minor rather than major, measured rather than assumed.** A new hard error is
breaking only if it fails a previously-passing consumer. All six HeroicLands
content packages were linted at their default branch, before and after — `sohl`,
`hm3`, `thalorna`, `kethira`, `harnensemble` and `harnadventures` — and every one
produces byte-identical findings and the same exit code with the rule as without
it. None of the six authors any of the three fields on its homepage.
