---
"@heroiclands/package-build": minor
---

Write the derived package into an emitted page's frontmatter (#65).

`content-build site` copied a note's frontmatter to the page verbatim. Since
3.3.0 a note need not declare `package:` — it is derived from the configured
`contentPackage` — and `engine/site-build.mjs` resolved that value one line
before it built the page, carrying it for the index, the table universe and the
local-package set. It never reached the page's own frontmatter, so a swept tree
published pages that said nothing about which package they belong to.

**The visible symptom is the breadcrumb.**
`@heroiclands/hugo-theme`'s `layouts/partials/breadcrumbs.html` reads
`{{ $pkg := .Params.package | default "" }}` and builds the middle crumb from
it. With no `package` the section is never resolved and the crumb degrades from
a linked, labelled section to a bare, unlinked type slug:

```text
before: Home > SoHL Affliction > Aconite   (linked)
after:  Home > affliction       > Aconite   (bare)
```

Consumer layouts reading the field directly degrade the same way — a `package`
column renders blank.

The fix is where the value was already known: `pageFrontmatter` spreads
`package` after the note's own frontmatter, so a note that declares the field
keeps its authored position and value and an unswept tree emits byte-identically,
while a swept one regains the line it lost. The alternative — teaching every
theme and consumer layout to default the package from a site parameter — pushes
a fact the build already knows out to N consumers, and the theme deliberately
carries no addresses.

**This changes emitted output**, so a consumer wants a rebuild rather than a
silent upgrade, which is why it is a minor rather than a patch — the same
reasoning as #35. Verified against the swept `sohl` tree: 1,606 emitted content
pages differ, none added or removed, and the only diff line class across the
whole tree is the restored `package: sohl`. Rendering that tree, 1,600 pages
differ and in exactly two ways — the breadcrumb's middle crumb, and a `package`
column that was blank.

`sohl-thalorna` has the same defect independently, in its own
`utils/build-site-content.mjs`, and is fixed in that repository
(sohl-thalorna#79) — two emitters, one behaviour, which is a second argument
for #36.
