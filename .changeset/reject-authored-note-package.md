---
"@heroiclands/package-build": major
---

Reject `package:` in a note's frontmatter (#56).

A note's package is the repository's configured `contentPackage`, full stop. A
note that declares the field fails the build, naming the file — **whatever the
value says**. An agreeing declaration is refused exactly as a disagreeing one
is: there is no value that makes writing the field correct, and a field accepted
while it agrees is a field that grows back one note at a time.

```text
assets/content/Gear/Axe.md:12:1: error: `package: sohl` is a retired frontmatter field — delete it. A note's package is this repository's configured `contentPackage` ("sohl", in package-build.config.yaml), and every note in the tree belongs to it.
```

`content-build lint` reports every such note in one pass, so a tree can be
checked before it is compiled; `package compile` and `manifest` refuse it.

**This is the third and last step**, and the two before it are already released
and adopted. 3.3.0 made the field optional so an absent one was normal and a
disagreeing one was an error; every content tree on the org was then swept on
that version — `sohl` (1,639 files), `thalorna` (1,716), `kethira` (363),
`harnensemble` (2,517). Nothing this release refuses is authored anywhere today.

**Why a major.** Consumers resolve `^3`, so a minor would reach every repository
on the next Dependabot run. A major is adopted deliberately, one repository at a
time, in a pull request that can also delete the field if any grew back — which
is the whole mechanism that made the deprecate → migrate → remove sequence safe.

**Migrating** is one line, and nothing else reads the field:

```bash
find assets/content -name '*.md' -print0 | xargs -0 sed -i '' '/^package: /d'
```

`package compile` then produces byte-identical output, because the value the
build derives is the value the notes restated. See `MIGRATING.md`.

**`contentPackage` is unaffected, and is not vestigial.** It is the address
namespace — the first segment of every canonical key, the name of the emitted
link manifest, and the package a cross-package wikilink writes. Retiring the
frontmatter field is what leaves it as the single source of that value: every
key is now derived from the configuration, where it used to come from two
sources that happened to agree.

**A generated table's `WHERE … and package = "<pkg>"` clause keeps matching** —
45 such clauses across `sohl` and `thalorna` depend on it. The package is
_synthesised_ into what the table search sees, from `contentPackage`; it is a
search value, never an authored one.

**API.** `engine/note-package.mjs` no longer exports `notePackage` — every call
site takes `contentPackage` directly, so no key is derived from frontmatter
anywhere — and `assertNotePackage` is now `assertNoDeclaredPackage`, which
asserts the field's absence rather than answering which package a note belongs
to. `expandNoteTables` no longer takes `pkg`: a table searches the whole tree,
which is one package's notes and nothing else.
