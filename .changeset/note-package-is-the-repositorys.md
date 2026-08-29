---
"@heroiclands/package-build": minor
---

A note's package is the repository's `contentPackage`, and `package:` is
optional.

A note was compiled when its `package:` frontmatter matched the configured
`contentPackage`, and skipped when it did not — silently, and tallied as
`skippedOther`, the same bucket as the thousands of notes that legitimately
belong to another pass. So a tree whose notes named a package no configuration
answered to compiled **zero notes and exited 0**, which is the state the
un-migrated `hm-loc-*` / `hm-adv-*` repositories are in today.

Every content tree is single-package — each is single-sourced in the repository
that ships it — so the field restated one constant about 6,200 times across the
org. This is the first of three steps that retire it, and the only one that
changes any code here:

1. **Optional**, now. An absent `package:` is normal and the note compiles; a
   present one is accepted while it agrees with `contentPackage`, and is a
   **loud error naming the file** when it does not. Nothing a consumer authors
   has to change, which is what makes the sweep safe to land next.
2. **Swept** out of every content tree, on this version.
3. **Rejected** outright — a later major, once the sweeps have merged.

**What changed**

- `engine/note-package.mjs` is the new seam: `notePackage` derives the package
  a note belongs to, `assertNotePackage` refuses one that names another, and
  `searchableFrontmatter` presents a note to a generated table with its package
  present however the note spells it.
- The compile loop no longer filters on the field. A note declaring another
  package is reported through the ordinary diagnostic channel
  (`file:line:column: error: …`), counted in `errorCount` so the build fails,
  and tallied as its own `PassStats.declined` — never folded into
  `skippedOther`, which is what made the original defect invisible.
- The link manifest throws rather than skipping such a note: skipping it
  quietly is how a manifest came to claim a package publishes nothing.
- **No key is derived from frontmatter any more.** The link index
  (`content-links`), the site index (`site-index`) and the site build's
  package grouping all take the derived value; the manifest emitter already
  took it from configuration. A note addresses identically whether or not it
  declares the field.
- A generated table that scopes itself with `WHERE … and package = "<pkg>"` —
  the shape every collection note uses — keeps matching after the field is
  deleted, so a sweep is a mechanical deletion rather than a silent
  emptying of every table.

**`contentPackage` is not becoming dead configuration.** Its selecting job is
what is going; the value is the **address namespace** — the first segment of
every canonical key, the name of the link manifest a build emits, and the
package a cross-package wikilink writes. Its documentation now says so.

Verified against the real `Song-of-Heroic-Lands-FoundryVTT` tree (1,606 notes):
`build/packs-json` is byte-identical to `main`'s output both with the field
present on every note and with it deleted from every note.

Step 1 of #56. Steps 2 (the sweep) and 3 (rejection, a major) follow.
