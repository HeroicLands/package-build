---
"@heroiclands/package-build": major
---

**A published page's URL is its address, not its display name** (#181).

Every content page now serves at `/<package>/<type>-<shortcode>/`. `(type,
shortcode)` names one note within a package — the rule `content-build lint`
already enforces — so the URL is unique _by construction_: there is no
collision check behind it, and renaming a note moves no URL, because no part of
the address comes from a display string.

**Every published URL moves**, which is what makes this a major. `sohl`'s
`/sohl/kb/rules/shock/` becomes `/sohl/doc-shock/`; `thalorna`'s
`/thalorna/affiliation/the-aerarium-imperii/` becomes
`/thalorna/affiliation-aerarium/`. Measured across the three live trees: 1,595
`sohl` pages, 1,848 `thalorna`, 370 `kethira` — every one of them unique, and no
content edit required in any repository.

**What it replaces.** The URL derived from `name.full`, which made a display
name load-bearing three ways at once: a rename silently 404'd every inbound
link, two notes in one section could derive one URL so a uniqueness gate had to
run, and long names were shortened through a table of 200 abbreviations. The
module doing it justified the cost by promising redirects — _"every change
appends to the legacy-URL map"_ — and no such map was ever written, here or in
any consumer. An address needs none of it.

**Sections stay, as directories.** Hugo derives a page's section from where its
file is written, not from its URL, and that section is what supplies the section
landing pages, `.CurrentSection` and per-section layout lookup. So a page is
still written into `<section>/` and now carries a front-matter `url:` publishing
it at its address. A **landing page** is the one exception: it _is_ its section,
so it still addresses the section under the configured `publish.address.prefix`
(`kb/rules/`), which is why an entry's `path` is still written to the manifest
rather than left for a consumer to compute.

**The `type-` prefix is deliberate.** Flattening to `<shortcode>` would put
content in the same namespace as a package's fixed mounts — `/<package>/` for
the landing page, `/<package>/api/` for generated API docs — neither of which
contains a hyphen or names a type. With it the namespace is provably disjoint.

**Removed**

| Gone                                            | Why                                          |
| ----------------------------------------------- | -------------------------------------------- |
| `contentSlug`                                   | Nothing derives a URL from a name.           |
| `findSlugCollisions`, and the site build's gate | Two addresses cannot collide.                |
| `ABBREVIATIONS` / `abbreviateTokens`            | They only ever shortened a name-derived URL. |

`slugify` stays, unchanged and un-abbreviated, in the two places it was always
right for: heading anchors and pack filenames.

**Breaking, for a consumer calling the engine directly**

- `packageAddress(fm, name, options)` → `packageAddress(fm, options)`, and
  `contentAddress(fm, name, isReadme)` → `contentAddress(fm, isReadme)`. The
  name was the input the address no longer has.
- `addressSlug(fm)` is new: the `type-shortcode` segment, lowercased, so it is
  exactly the tail of the canonical key.
- The site build's gate result renames `slugErrors` to `addressErrors` and drops
  `collisions` entirely. A note with no `shortcode`, or no section to be filed
  under, is reported there rather than published.
- `engine/abbreviations.mjs` is deleted.
